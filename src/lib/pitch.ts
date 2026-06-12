// Audio (MP3/WAV/OGG...) -> luting, best effort.
// Decodes with Web Audio, runs frame-by-frame autocorrelation pitch detection,
// median-filters the pitch track, segments it into notes, and quantizes to a
// sixteenth-note grid at the user-supplied BPM. Works for monophonic sources
// (a sung/whistled melody, a solo instrument); full mixes won't transcribe.

import { midiToPitch, clampMidi, serializeVoiceBody } from './luting'
import type { VoiceEvent } from './luting'
import type { ConvertResult } from './convert'

const FRAME = 2048
const HOP = 512
const MIN_FREQ = 55
const MAX_FREQ = 1500
const RMS_GATE = 0.01
const CLARITY = 0.8

function detectPitch(buf: Float32Array, sampleRate: number): number | null {
  let rms = 0
  for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i]
  rms = Math.sqrt(rms / buf.length)
  if (rms < RMS_GATE) return null

  const maxLag = Math.min(buf.length - 1, Math.floor(sampleRate / MIN_FREQ))
  const minLag = Math.max(2, Math.floor(sampleRate / MAX_FREQ))

  // normalized autocorrelation
  const c = new Float32Array(maxLag + 1)
  for (let lag = 0; lag <= maxLag; lag++) {
    let sum = 0
    for (let i = 0; i + lag < buf.length; i++) sum += buf[i] * buf[i + lag]
    c[lag] = sum
  }

  // skip the zero-lag peak, then take the best peak
  let d = minLag
  while (d < maxLag && c[d] > c[d + 1]) d++
  let bestLag = -1
  let bestVal = -Infinity
  for (let lag = d; lag <= maxLag; lag++) {
    if (c[lag] > bestVal) {
      bestVal = c[lag]
      bestLag = lag
    }
  }
  if (bestLag <= 0 || bestVal / c[0] < CLARITY) return null

  // parabolic interpolation around the peak
  let lag = bestLag
  if (lag > 0 && lag < maxLag) {
    const a = c[lag - 1]
    const b = c[lag]
    const cc = c[lag + 1]
    const shift = (0.5 * (a - cc)) / (a - 2 * b + cc)
    if (isFinite(shift) && Math.abs(shift) < 1) lag += shift
  }

  const freq = sampleRate / lag
  if (freq < MIN_FREQ || freq > MAX_FREQ) return null
  return 69 + 12 * Math.log2(freq / 440)
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

export async function convertAudio(
  buf: ArrayBuffer,
  opts: { bpm: number; instrument: string }
): Promise<ConvertResult> {
  const warnings: string[] = []
  const ctx = new AudioContext()
  let audio: AudioBuffer
  try {
    audio = await ctx.decodeAudioData(buf)
  } finally {
    void ctx.close()
  }

  // mix to mono
  const mono = new Float32Array(audio.length)
  for (let ch = 0; ch < audio.numberOfChannels; ch++) {
    const data = audio.getChannelData(ch)
    for (let i = 0; i < data.length; i++) mono[i] += data[i] / audio.numberOfChannels
  }

  if (audio.duration > 120) {
    warnings.push('Audio longer than 2 minutes; only the first 2 minutes were analyzed.')
  }
  const analyzeLen = Math.min(mono.length, audio.sampleRate * 120)

  // per-frame pitch track (rounded MIDI or null)
  const raw: (number | null)[] = []
  const frame = new Float32Array(FRAME)
  for (let pos = 0; pos + FRAME <= analyzeLen; pos += HOP) {
    frame.set(mono.subarray(pos, pos + FRAME))
    raw.push(detectPitch(frame, audio.sampleRate))
  }

  // median filter (window 5) over voiced frames to kill octave-error blips
  const track: (number | null)[] = raw.map((v, i) => {
    if (v === null) return null
    const win: number[] = []
    for (let j = Math.max(0, i - 2); j <= Math.min(raw.length - 1, i + 2); j++) {
      const w = raw[j]
      if (w !== null) win.push(w)
    }
    return win.length >= 2 ? median(win) : v
  })

  // segment into notes: runs of the same rounded midi
  const hopSec = HOP / audio.sampleRate
  interface Seg {
    midi: number
    start: number
    end: number
  }
  const segs: Seg[] = []
  let cur: Seg | null = null
  for (let i = 0; i < track.length; i++) {
    const m = track[i] === null ? null : Math.round(track[i] as number)
    const t = i * hopSec
    if (m === null) {
      if (cur) {
        segs.push(cur)
        cur = null
      }
    } else if (cur && cur.midi === m) {
      cur.end = t + hopSec
    } else {
      if (cur) segs.push(cur)
      cur = { midi: m, start: t, end: t + hopSec }
    }
  }
  if (cur) segs.push(cur)

  const minLen = hopSec * 3
  const notes = segs.filter((s) => s.end - s.start >= minLen)

  if (notes.length === 0) {
    warnings.push(
      'Could not detect a melody. Pitch detection needs a clear monophonic source (one voice or instrument at a time); full mixes usually fail.'
    )
    return { bpm: opts.bpm * 4, voices: [], warnings }
  }

  // quantize to the luting grid (sixteenths at the given BPM)
  const lutingBpm = opts.bpm * 4
  const unitSec = 60 / lutingBpm
  const events: VoiceEvent[] = []
  let cursor = 0
  for (const n of notes) {
    const start = Math.round(n.start / unitSec)
    const end = Math.max(start + 1, Math.round(n.end / unitSec))
    if (start > cursor) events.push({ type: 'rest', pitches: [], duration: start - cursor })
    if (start < cursor) continue // overlap after quantization; drop
    events.push({
      type: 'note',
      pitches: [midiToPitch(clampMidi(n.midi))],
      duration: end - start,
    })
    cursor = end
  }

  warnings.push(
    `Detected ${notes.length} notes. Audio transcription is approximate — expect to tidy the result by hand.`
  )

  return {
    bpm: lutingBpm,
    voices: [
      {
        instrument: opts.instrument,
        body: serializeVoiceBody(events),
        label: 'Detected melody',
        noteCount: notes.length,
      },
    ],
    warnings,
  }
}
