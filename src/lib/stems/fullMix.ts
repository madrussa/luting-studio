// Full-mix audio -> luting voices, one per detected instrument.
// Pipeline: decode at 44.1 kHz -> HT-Demucs 6-stem separation (ONNX, in a
// worker) -> per-stem transcription in parallel workers (Basic Pitch for
// melodic stems, onset classification for drums).

import type { ConvertResult, ConvertedVoice } from '../convert'
import { fetchModelCached } from './modelCache'
import { detectBpm, detectBeatOffset } from './tempo'
import { STEM_NAMES } from './types'
import type { DemucsWorkerOut, FullMixProgress, StemName, StemState, TranscribeWorkerIn, TranscribeWorkerOut } from './types'

export const DEMUCS_MODEL_URL =
  'https://huggingface.co/StemSplitio/htdemucs-6s-onnx/resolve/main/htdemucs_6s_fp16weights.onnx'
export const DEMUCS_MODEL_MB = 131

const MAX_SECONDS = 360
const SAMPLE_RATE = 44100
/** Stems quieter than this RMS are treated as "instrument not present". */
const RMS_GATE = 0.003

// Omit must distribute over the message union to keep the kind-specific fields
type PlanMsg =
  | Omit<Extract<TranscribeWorkerIn, { kind: 'melodic' }>, 'samples'>
  | Omit<Extract<TranscribeWorkerIn, { kind: 'drums' }>, 'samples'>

interface StemPlan {
  name: StemName
  msg: PlanMsg
  order: number
}

function stemPlans(lutingBpm: number, gridOffsetSec: number, modelUrl: string): Record<StemName, StemPlan> {
  const melodic = (
    name: StemName,
    instrument: string,
    label: string,
    order: number,
    extra: { minFreq?: number; maxFreq?: number; classify?: 'vocals' | 'other'; mono?: boolean } = {}
  ): StemPlan => ({
    name,
    order,
    msg: { kind: 'melodic', lutingBpm, gridOffsetSec, instrument, label, modelUrl, ...extra },
  })
  return {
    drums: { name: 'drums', order: 0, msg: { kind: 'drums', lutingBpm, gridOffsetSec } },
    bass: melodic('bass', 'b', 'Bass', 1, { maxFreq: 500 }),
    guitar: melodic('guitar', 'l', 'Guitar', 2),
    piano: melodic('piano', 'k', 'Piano', 3),
    vocals: melodic('vocals', 'e', 'Vocals', 4, { minFreq: 80, maxFreq: 1400, classify: 'vocals', mono: true }),
    other: melodic('other', 'v', 'Other', 5, { classify: 'other' }),
  }
}

function rms(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / Math.max(1, samples.length))
}

async function decodeStereo(buf: ArrayBuffer): Promise<{ left: Float32Array; right: Float32Array; truncated: boolean }> {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: SAMPLE_RATE })
  const audio = await ctx.decodeAudioData(buf)
  const truncated = audio.duration > MAX_SECONDS
  const len = Math.min(audio.length, SAMPLE_RATE * MAX_SECONDS)
  const left = new Float32Array(len)
  const right = new Float32Array(len)
  left.set(audio.getChannelData(0).subarray(0, len))
  right.set(audio.getChannelData(Math.min(1, audio.numberOfChannels - 1)).subarray(0, len))
  return { left, right, truncated }
}

function runDemucs(
  model: ArrayBuffer,
  left: Float32Array,
  right: Float32Array,
  onProgress: (done: number, total: number) => void
): Promise<Record<StemName, Float32Array>> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./demucs.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<DemucsWorkerOut>) => {
      const msg = e.data
      if (msg.type === 'debug') console.info(`[stems] demucs: ${msg.stage}`)
      else if (msg.type === 'progress') onProgress(msg.done, msg.total)
      else if (msg.type === 'done') {
        worker.terminate()
        resolve(msg.stems)
      } else {
        worker.terminate()
        reject(new Error(msg.message))
      }
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(new Error(e.message || 'Stem separation worker failed'))
    }
    worker.postMessage({ model, left, right }, [model, left.buffer, right.buffer])
  })
}

function runTranscribe(
  samples: Float32Array,
  plan: StemPlan,
  volume: number,
  onProgress: (pct: number) => void
): Promise<ConvertedVoice[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./transcribe.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<TranscribeWorkerOut>) => {
      const msg = e.data
      if (msg.type === 'debug') console.info(`[stems] ${plan.name}: ${msg.stage}`)
      else if (msg.type === 'progress') onProgress(msg.pct)
      else if (msg.type === 'done') {
        worker.terminate()
        resolve(msg.voices)
      } else {
        worker.terminate()
        reject(new Error(msg.message))
      }
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(new Error(e.message || 'Transcription worker failed'))
    }
    worker.postMessage({ ...plan.msg, samples, volume }, [samples.buffer])
  })
}

export async function convertAudioFullMix(
  buf: ArrayBuffer,
  opts: { bpm: number; autoBpm?: boolean; onProgress: (p: FullMixProgress) => void }
): Promise<ConvertResult> {
  const { onProgress } = opts
  const warnings: string[] = []

  onProgress({ stage: 'decode' })
  const { left, right, truncated } = await decodeStereo(buf)
  if (truncated) {
    warnings.push(`Audio longer than ${MAX_SECONDS / 60} minutes; only the first ${MAX_SECONDS / 60} minutes were analyzed.`)
  }

  const mono = new Float32Array(left.length)
  for (let i = 0; i < mono.length; i++) mono[i] = 0.5 * (left[i] + right[i])

  let songBpm = opts.bpm
  // Where the grid sits, measured once on the mix so that every stem quantizes
  // against the same phase. Measuring per stem would let a sparse one (a held
  // bass line) settle on a different phase and land out of step with the rest.
  let gridOffsetSec: number | null = null
  if (opts.autoBpm) {
    const est = detectBpm(mono, SAMPLE_RATE)
    if (est) {
      songBpm = est.bpm
      gridOffsetSec = est.offsetSec
      warnings.push(`Detected tempo ≈ ${est.bpm} BPM.`)
    } else {
      warnings.push(`Could not detect a steady tempo; using the manual BPM (${opts.bpm}).`)
    }
  }
  if (gridOffsetSec === null) gridOffsetSec = detectBeatOffset(mono, SAMPLE_RATE, songBpm)
  const lutingBpm = Math.round(songBpm * 4)

  const model = await fetchModelCached(DEMUCS_MODEL_URL, (p) =>
    onProgress({ stage: 'download', loadedBytes: p.loadedBytes, totalBytes: p.totalBytes, fromCache: p.fromCache })
  )

  const stems = await runDemucs(model, left, right, (done, total) =>
    onProgress({ stage: 'separate', done, total })
  )

  const basicPitchModelUrl = new URL(`${import.meta.env.BASE_URL}basic-pitch/model.json`, window.location.href).href
  const plans = stemPlans(lutingBpm, gridOffsetSec, basicPitchModelUrl)

  const states = new Map<StemName, { state: StemState; pct: number }>()
  for (const name of STEM_NAMES) states.set(name, { state: 'pending', pct: 0 })
  const emitTranscribe = () =>
    onProgress({
      stage: 'transcribe',
      stems: STEM_NAMES.map((name) => ({ name, ...states.get(name)! })),
    })

  // each stem's voice volume comes from its share of the mix, so the
  // rendered balance resembles the original (sqrt compresses the range a bit)
  const rmsByStem = {} as Record<StemName, number>
  for (const name of STEM_NAMES) rmsByStem[name] = rms(stems[name])
  const maxStemRms = Math.max(...Object.values(rmsByStem), 1e-9)
  const volumeFor = (name: StemName) =>
    Math.min(10, Math.max(2, Math.round(10 * Math.sqrt(rmsByStem[name] / maxStemRms))))

  const voicesByStem = new Map<StemName, ConvertedVoice[]>()
  await Promise.all(
    STEM_NAMES.map(async (name) => {
      const samples = stems[name]
      if (rmsByStem[name] < RMS_GATE) {
        states.set(name, { state: 'skipped', pct: 0 })
        emitTranscribe()
        return
      }
      states.set(name, { state: 'running', pct: 0 })
      emitTranscribe()
      try {
        const voices = await runTranscribe(samples, plans[name], volumeFor(name), (pct) => {
          states.set(name, { state: 'running', pct })
          emitTranscribe()
        })
        voicesByStem.set(name, voices)
        states.set(name, { state: 'done', pct: 1 })
      } catch (err) {
        states.set(name, { state: 'failed', pct: 0 })
        warnings.push(`${plansLabel(plans[name])} transcription failed: ${err instanceof Error ? err.message : String(err)}`)
      }
      emitTranscribe()
    })
  )

  const voices = STEM_NAMES.filter((n) => voicesByStem.has(n))
    .sort((a, b) => plans[a].order - plans[b].order)
    .flatMap((n) => voicesByStem.get(n)!)

  const skipped = STEM_NAMES.filter((n) => states.get(n)!.state === 'skipped')
  if (skipped.length > 0) {
    warnings.push(`No audible ${skipped.map((n) => plansLabel(plans[n])).join(', ')} detected in this mix.`)
  }
  if (voices.length > 0) {
    const total = voices.reduce((s, v) => s + v.noteCount, 0)
    warnings.push(
      `Detected ${total} notes across ${voices.length} voice${voices.length === 1 ? '' : 's'}. ` +
        'Full-mix transcription is approximate — expect to tidy the result by hand.'
    )
  }

  return { bpm: lutingBpm, voices, warnings }
}

function plansLabel(plan: StemPlan): string {
  return plan.msg.kind === 'drums' ? 'Drums' : plan.msg.label
}
