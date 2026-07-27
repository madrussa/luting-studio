// Web Worker: one separated stem -> luting voices.
// Melodic stems run Spotify's Basic Pitch (polyphonic, tfjs); the drum stem
// runs the spectral-flux onset classifier. Input audio is mono 44.1 kHz.

import * as tf from '@tensorflow/tfjs'
import { BasicPitch, noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch'
import { notesToVoices, mergeSustains, dropQuietNotes, suppressOctaveGhosts, monophonicReduce } from './notes'
import type { StemNote } from './notes'
import { drumsToVoices } from './drums'
import { computeTimbre, classifyOther, classifyVocals } from './timbre'
import type { TranscribeWorkerIn } from './types'

const post = self.postMessage.bind(self) as (message: unknown, transfer?: Transferable[]) => void

const SOURCE_RATE = 44100

/**
 * Halve the sample rate with a windowed-sinc half-band low-pass.
 * 44100 -> 22050 is an exact 2:1 decimation, which is all Basic Pitch needs.
 */
export function decimateByTwo(input: Float32Array): Float32Array {
  const TAPS = 63
  const HALF = (TAPS - 1) / 2
  const kernel = new Float32Array(TAPS)
  let sum = 0
  for (let i = 0; i < TAPS; i++) {
    const n = i - HALF
    const sinc = n === 0 ? 0.5 : Math.sin((Math.PI * n) / 2) / (Math.PI * n)
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (TAPS - 1))
    kernel[i] = sinc * hann
    sum += kernel[i]
  }
  for (let i = 0; i < TAPS; i++) kernel[i] /= sum * 2 // unity gain at DC after 2x

  const out = new Float32Array(Math.floor(input.length / 2))
  for (let o = 0; o < out.length; o++) {
    const center = o * 2
    let acc = 0
    for (let k = 0; k < TAPS; k++) {
      const idx = center + k - HALF
      if (idx >= 0 && idx < input.length) acc += input[idx] * kernel[k]
    }
    out[o] = acc * 2
  }
  return out
}

const debug = (stage: string) => post({ type: 'debug', stage })

async function transcribeMelodic(msg: Extract<TranscribeWorkerIn, { kind: 'melodic' }>) {
  // tfjs's webgl backend wedges on its first inference inside a Worker
  // (shader compile never returns), so use the cpu backend — Basic Pitch is
  // small enough to run near realtime on it
  await tf.setBackend('cpu')
  await tf.ready()
  debug(`backend:${tf.getBackend()}`)

  let instrument = msg.instrument
  if (msg.classify) {
    const features = computeTimbre(msg.samples, SOURCE_RATE)
    if (features) {
      instrument = msg.classify === 'vocals' ? classifyVocals(features) : classifyOther(features)
      debug(
        `timbre:${instrument} centroid=${Math.round(features.centroidHz)} spread=${Math.round(features.spreadHz)} ` +
          `sustain=${features.sustainRatio.toFixed(2)} onsets/s=${features.onsetsPerSec.toFixed(1)}`
      )
    }
  }

  const resampled = decimateByTwo(msg.samples)
  const basicPitch = new BasicPitch(msg.modelUrl)

  const frames: number[][] = []
  const onsets: number[][] = []
  const contours: number[][] = []
  debug('evaluate:start')
  await basicPitch.evaluateModel(
    resampled,
    (f, o, c) => {
      frames.push(...f)
      onsets.push(...o)
      contours.push(...c)
    },
    (pct) => post({ type: 'progress', pct })
  )

  const events = noteFramesToTime(
    outputToNotesPoly(
      frames,
      onsets,
      0.35, // onset threshold
      0.22, // frame threshold — low so decaying sustains stay one note
      6, // min note length in frames (~70 ms)
      true,
      msg.maxFreq ?? null,
      msg.minFreq ?? null,
      true, // melodia trick, also helps sustains survive
      16 // energy tolerance: frames a note may dip under the threshold
    )
  )
  let notes: StemNote[] = events.map((e) => ({
    startSec: e.startTimeSeconds,
    durSec: e.durationSeconds,
    midi: e.pitchMidi,
    amplitude: e.amplitude,
  }))
  notes = dropQuietNotes(notes)
  notes = suppressOctaveGhosts(notes)
  if (msg.mono) notes = monophonicReduce(notes)
  // rejoin fragments the thresholds still split (gap of up to half a grid unit)
  notes = mergeSustains(notes, Math.max(0.08, 30 / msg.lutingBpm))
  const voices = notesToVoices(notes, msg.lutingBpm, instrument, msg.label, {
    volume: msg.volume,
    gridOffsetSec: msg.gridOffsetSec,
  })
  post({ type: 'done', voices })
}

function transcribeDrumStem(msg: Extract<TranscribeWorkerIn, { kind: 'drums' }>) {
  const voices = drumsToVoices(msg.samples, SOURCE_RATE, msg.lutingBpm, {
    volume: msg.volume,
    gridOffsetSec: msg.gridOffsetSec,
  })
  post({ type: 'done', voices })
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data as TranscribeWorkerIn
  const run = async () => {
    if (msg.kind === 'drums') transcribeDrumStem(msg)
    else await transcribeMelodic(msg)
  }
  run().catch((err: unknown) => {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  })
}
