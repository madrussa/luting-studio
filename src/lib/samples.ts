// Real-sample playback, converted from LuteBoi's recorded multisample banks
// (see tools/convert-samples.py). Packs are lazy-loaded per instrument and
// decoded once; the engine pitch-shifts from the nearest sampled note and
// crossfade-loops the sustain region for long notes. Lute/Bass/Chiptune/
// Percussion have no packs — LuteBoi synthesizes them too, so they always use
// our synth.

import type { ScheduledNote } from './luting'

export type PlaybackMode = 'performance' | 'quality'

const MODE_KEY = 'luting-playback-mode'

let mode: PlaybackMode = (() => {
  try {
    return localStorage.getItem(MODE_KEY) === 'quality' ? 'quality' : 'performance'
  } catch {
    return 'performance'
  }
})()

const modeSubs = new Set<() => void>()
const notifyMode = () => modeSubs.forEach((cb) => cb())

export const getPlaybackMode = (): PlaybackMode => mode
export function setPlaybackMode(m: PlaybackMode) {
  mode = m
  try {
    localStorage.setItem(MODE_KEY, m)
  } catch {
    /* preference won't persist */
  }
  notifyMode()
}
export function subscribePlaybackMode(cb: () => void): () => void {
  modeSubs.add(cb)
  return () => modeSubs.delete(cb)
}

// ---- bank loading ----------------------------------------------------------

interface MelodicSample {
  midi: number
  buffer: AudioBuffer
  /** crossfaded loop region (seconds), baked at decode time; only used if the bank loops */
  loopStart: number
  loopEnd: number
}

interface Bank {
  loop: boolean
  /** melodic notes, ascending by MIDI */
  melodic: MelodicSample[]
  /** drum sounds keyed by our DRUM_SOUNDS key (o0a, o3c, …) */
  drums: Record<string, AudioBuffer>
}

const banks = new Map<string, Bank>()
const inflight = new Map<string, Promise<Bank | null>>()
let indexPromise: Promise<Set<string>> | null = null

const loadSubs = new Set<() => void>()
const notifyLoad = () => loadSubs.forEach((cb) => cb())
export function subscribeSampleLoading(cb: () => void): () => void {
  loadSubs.add(cb)
  return () => loadSubs.delete(cb)
}
export const isLoadingSamples = (): boolean => inflight.size > 0

const base = import.meta.env.BASE_URL || './'

// A persistent context just for decoding; AudioBuffers are reusable across the
// short-lived playback contexts.
let decodeCtx: AudioContext | null = null
const getDecodeCtx = (): AudioContext => (decodeCtx ??= new AudioContext())

function b64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

/**
 * Bake a click-free forward loop into a decoded sustain sample. A native
 * AudioBufferSourceNode loop jumps instantly from loopEnd back to loopStart, so
 * for a clean loop the samples arriving at loopEnd must lead smoothly into the
 * samples at loopStart. We equal-power crossfade the tail of the loop (the
 * samples just before loopEnd) toward the samples just before loopStart, so
 * after the jump the waveform continues as if uninterrupted — continuous in
 * both value and slope, with the amplitude difference between the two points
 * smoothed across the fade rather than stepping (which pops). Pure ping-pong,
 * like LuteBoi's offline renderer, is continuous in value but folds the
 * waveform back on itself, leaving a slope corner that pops on a sustained
 * real-time note; the crossfade avoids that. Mutates `buf` in place (the bank
 * owns it) and returns the loop points in seconds.
 */
function bakeLoop(buf: AudioBuffer): { loopStart: number; loopEnd: number } {
  const sr = buf.sampleRate
  const len = buf.length
  // Loop a stable slice of the sustain: clear of the attack and the decay tail.
  const loopStart = Math.floor(len * 0.3)
  const loopEnd = Math.floor(len * 0.85)
  // Crossfade window, bounded by the headroom before loopStart and the loop length.
  const xf = Math.max(0, Math.min(Math.floor(sr * 0.12), loopStart, loopEnd - loopStart - 1))
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch)
    for (let k = 0; k < xf; k++) {
      const w = (k + 0.5) / xf // 0 → 1 across the window
      const tail = d[loopEnd - xf + k] // original loop tail, fading out
      const head = d[loopStart - xf + k] // pre-loopStart content, fading in
      d[loopEnd - xf + k] = tail * Math.cos((w * Math.PI) / 2) + head * Math.sin((w * Math.PI) / 2)
    }
  }
  return { loopStart: loopStart / sr, loopEnd: loopEnd / sr }
}

function ensureIndex(): Promise<Set<string>> {
  if (!indexPromise) {
    indexPromise = fetch(`${base}samples/index.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((arr: string[]) => new Set(arr))
      .catch(() => new Set<string>())
  }
  return indexPromise
}

export async function hasSamplePack(code: string): Promise<boolean> {
  return (await ensureIndex()).has(code)
}

/** A loaded bank, if present in memory (synchronous; null if not yet loaded). */
export const getBank = (code: string): Bank | undefined => banks.get(code)

/** Lazily fetch + decode an instrument pack. Deduped; cached. */
export function loadBank(code: string): Promise<Bank | null> {
  if (banks.has(code)) return Promise.resolve(banks.get(code)!)
  const existing = inflight.get(code)
  if (existing) return existing

  const p = (async (): Promise<Bank | null> => {
    if (!(await hasSamplePack(code))) return null
    const res = await fetch(`${base}samples/${code}.json`)
    if (!res.ok) return null
    const pack = (await res.json()) as { loop: boolean; notes: Record<string, string> }
    const ctx = getDecodeCtx()
    const melodic: Bank['melodic'] = []
    const drums: Bank['drums'] = {}
    await Promise.all(
      Object.entries(pack.notes).map(async ([key, b64]) => {
        try {
          const buf = await ctx.decodeAudioData(b64ToArrayBuffer(b64))
          if (/^\d+$/.test(key)) {
            const lp = pack.loop ? bakeLoop(buf) : { loopStart: 0, loopEnd: 0 }
            melodic.push({ midi: parseInt(key, 10), buffer: buf, ...lp })
          } else drums[key] = buf
        } catch {
          /* skip a note that won't decode */
        }
      })
    )
    melodic.sort((a, b) => a.midi - b.midi)
    const bank: Bank = { loop: pack.loop, melodic, drums }
    banks.set(code, bank)
    return bank
  })()
    .catch(() => null)
    .finally(() => {
      inflight.delete(code)
      notifyLoad()
    })

  inflight.set(code, p)
  notifyLoad()
  return p
}

/** Kick off loading for a set of instrument codes (fire and forget). */
export function prewarm(codes: Iterable<string>) {
  for (const c of new Set(codes)) void loadBank(c)
}

// ---- scheduling ------------------------------------------------------------

const RELEASE = 0.08

/**
 * Schedule a note from real samples. Returns false if no sample is available
 * (so the caller can fall back to the synth).
 */
export function scheduleSampled(ctx: AudioContext, dest: AudioNode, n: ScheduledNote, t0: number): boolean {
  const bank = banks.get(n.instrument)
  if (!bank) return false
  const start = t0 + n.timeSec

  if (n.drum) {
    const buffer = bank.drums[n.drum]
    if (!buffer) return false
    const src = ctx.createBufferSource()
    src.buffer = buffer
    const g = ctx.createGain()
    g.gain.value = n.volume * 0.9
    src.connect(g)
    g.connect(dest)
    src.start(start)
    src.stop(start + buffer.duration + 0.02)
    return true
  }

  const list = bank.melodic
  if (!list.length || n.midi === undefined) return false
  let best = list[0]
  for (const e of list) if (Math.abs(e.midi - n.midi) < Math.abs(best.midi - n.midi)) best = e

  const src = ctx.createBufferSource()
  src.buffer = best.buffer
  src.playbackRate.value = Math.pow(2, (n.midi - best.midi) / 12)

  const holdEnd = start + Math.max(0.03, n.durSec)
  const effectiveDur = best.buffer.duration / src.playbackRate.value
  if (bank.loop && effectiveDur < n.durSec + RELEASE) {
    src.loop = true
    src.loopStart = best.loopStart
    src.loopEnd = best.loopEnd
  }

  const g = ctx.createGain()
  const peak = n.volume * 0.8
  g.gain.setValueAtTime(0, start)
  g.gain.linearRampToValueAtTime(peak, start + 0.005)
  g.gain.setValueAtTime(peak, holdEnd)
  g.gain.linearRampToValueAtTime(0, holdEnd + RELEASE)
  src.connect(g)
  g.connect(dest)
  src.start(start)
  src.stop(holdEnd + RELEASE + 0.02)
  return true
}
