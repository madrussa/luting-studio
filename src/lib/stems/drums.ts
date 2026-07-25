// Drum stem -> Drumkit voices.
// Spectral-flux onset detection over an FFT spectrogram, then a band-energy
// classifier per onset (kick / snare / closed hat / open hat / crash), mapped
// onto the luteboi Drumkit pitches used by the MIDI converter.

import { allocate } from '../convert'
import type { ConvertedVoice } from '../convert'
import { serializeVoiceBody } from '../luting'
import type { Pitch } from '../luting'
import { magnitudeSpectrum } from './fft'

const FRAME = 1024
const HOP = 512

// Drumkit pitches (see DRUM_SOUNDS in luting.ts)
const KICK: Pitch = { octave: 0, letter: 'a' }
const SNARE: Pitch = { octave: 3, letter: 'c' }
const HAT_CLOSED: Pitch = { octave: 4, letter: 'c' }
const HAT_OPEN: Pitch = { octave: 4, letter: 'a' }
const CRASH: Pitch = { octave: 5, letter: 'd' }

interface Onset {
  timeSec: number
  strength: number
  pitches: Pitch[]
}

/** Sum of spectrum magnitudes between two frequencies. */
function bandEnergy(spec: Float32Array, sampleRate: number, lo: number, hi: number): number {
  const binHz = sampleRate / FRAME
  const a = Math.max(0, Math.floor(lo / binHz))
  const b = Math.min(spec.length - 1, Math.ceil(hi / binHz))
  let sum = 0
  for (let i = a; i <= b; i++) sum += spec[i] * spec[i]
  return sum
}

export function detectDrumOnsets(samples: Float32Array, sampleRate: number): Onset[] {
  const frames: Float32Array[] = []
  const frame = new Float32Array(FRAME)
  for (let pos = 0; pos + FRAME <= samples.length; pos += HOP) {
    frame.set(samples.subarray(pos, pos + FRAME))
    frames.push(magnitudeSpectrum(frame))
  }
  if (frames.length < 3) return []

  // half-wave rectified spectral flux
  const flux = new Float32Array(frames.length)
  for (let i = 1; i < frames.length; i++) {
    let f = 0
    const prev = frames[i - 1]
    const cur = frames[i]
    for (let k = 0; k < cur.length; k++) {
      const d = cur[k] - prev[k]
      if (d > 0) f += d
    }
    flux[i] = f
  }

  // adaptive threshold: local median + margin
  const W = 8
  const hopSec = HOP / sampleRate
  const onsets: Onset[] = []
  let lastOnset = -Infinity
  const globalMax = flux.reduce((m, v) => Math.max(m, v), 0)
  if (globalMax === 0) return []
  for (let i = 1; i < flux.length - 1; i++) {
    const win: number[] = []
    for (let j = Math.max(0, i - W); j <= Math.min(flux.length - 1, i + W); j++) win.push(flux[j])
    win.sort((a, b) => a - b)
    const med = win[Math.floor(win.length / 2)]
    // the absolute floor keeps decay-tail flux ripples from becoming ghost hits
    const threshold = med * 1.5 + globalMax * 0.06
    const isPeak = flux[i] > threshold && flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1]
    const t = i * hopSec
    if (!isPeak || t - lastOnset < 0.05) continue
    lastOnset = t

    // classify from the spectrum just after the onset
    const spec = frames[Math.min(frames.length - 1, i + 1)]
    const low = bandEnergy(spec, sampleRate, 30, 120)
    const mid = bandEnergy(spec, sampleRate, 150, 800)
    const presence = bandEnergy(spec, sampleRate, 1000, 4000)
    const high = bandEnergy(spec, sampleRate, 5000, Math.min(11000, sampleRate / 2 - 1))
    const total = low + mid + presence + high
    if (total === 0) continue

    // dominant-band scoring; a second drum joins only when its band is
    // genuinely comparable (a real kick+hat hit), not mere attack splatter
    const kickScore = low
    const snareScore = mid + presence * 0.5
    const hatScore = high
    const best = Math.max(kickScore, snareScore, hatScore)
    const pitches: Pitch[] = []
    if (kickScore >= best * 0.6) pitches.push(KICK)
    if (snareScore >= best * 0.6) pitches.push(SNARE)
    if (hatScore >= best * 0.6) {
      // sustained high energy over the following frames = open hat / crash
      let sustain = 0
      const end = Math.min(frames.length - 1, i + 8)
      for (let j = i + 2; j <= end; j++) {
        sustain += bandEnergy(frames[j], sampleRate, 5000, Math.min(11000, sampleRate / 2 - 1))
      }
      const decayRatio = sustain / Math.max(1e-9, high * (end - i - 1))
      if (decayRatio > 0.6 && flux[i] > globalMax * 0.35) pitches.push(CRASH)
      else if (decayRatio > 0.45) pitches.push(HAT_OPEN)
      else pitches.push(HAT_CLOSED)
    }

    onsets.push({ timeSec: t, strength: Math.min(1, flux[i] / globalMax), pitches })
  }
  return onsets
}

export function drumsToVoices(
  samples: Float32Array,
  sampleRate: number,
  lutingBpm: number,
  opts: { maxVoices?: number; volume?: number } = {}
): ConvertedVoice[] {
  const maxVoices = opts.maxVoices ?? 3
  const onsets = detectDrumOnsets(samples, sampleRate)
  if (onsets.length === 0) return []
  const unit = 60 / lutingBpm

  // one group per (instant, drum), duration 1 unit — same as the MIDI path
  const seen = new Set<string>()
  const groups: { start: number; dur: number; pitches: Pitch[]; velocity: number }[] = []
  for (const o of onsets) {
    const start = Math.max(0, Math.round(o.timeSec / unit))
    for (const p of o.pitches) {
      const key = `${start}:o${p.octave}${p.letter}`
      if (seen.has(key)) continue
      seen.add(key)
      groups.push({ start, dur: 1, pitches: [p], velocity: Math.max(0.3, o.strength) })
    }
  }

  let subs = allocate(groups)
  if (subs.length > maxVoices) {
    const keep = new Set(
      [...subs].sort((a, b) => b.velocities.length - a.velocities.length).slice(0, maxVoices)
    )
    subs = subs.filter((s) => keep.has(s))
  }

  return subs.map((sub, k) => {
    const avgVel = sub.velocities.reduce((a, b) => a + b, 0) / sub.velocities.length
    const vol = opts.volume ?? Math.min(10, Math.max(1, Math.round(avgVel * 10)))
    return {
      instrument: 'd',
      body: serializeVoiceBody(sub.events, { volume: vol < 10 ? vol : undefined }),
      label: subs.length > 1 ? `Drums ${k + 1}` : 'Drums',
      noteCount: sub.velocities.length,
    }
  })
}
