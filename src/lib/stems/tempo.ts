// Tempo (BPM) estimation from audio.
// Spectral-flux onset envelope -> autocorrelation over musical lags. Harmonic
// support (a real beat's multiples also correlate) resolves double/half-time
// ambiguity, and the result is folded into a musical 55-165 BPM window.

import { magnitudeSpectrum } from './fft'

const FRAME = 1024
const HOP = 512
const MIN_BPM = 50
const MAX_BPM = 220
/** Analyze at most this much audio — plenty to lock a tempo. */
const MAX_SECONDS = 60

export interface TempoEstimate {
  bpm: number
  /** normalized autocorrelation of the winning lag, roughly 0..1 */
  confidence: number
  /**
   * Seconds from the start of the audio to the first beat — the grid's phase.
   * Quantizing without it pins the grid to t=0, which is wherever the file
   * happens to have been cut, so a performance's onsets can sit half a grid
   * unit off every line and each note then rounds whichever way the noise
   * leans.
   */
  offsetSec: number
}

/** Onset strength envelope: half-wave rectified spectral flux per hop. */
function onsetEnvelope(samples: Float32Array, sampleRate: number): Float32Array {
  const end = Math.min(samples.length, sampleRate * MAX_SECONDS)
  const frames: Float32Array[] = []
  const frame = new Float32Array(FRAME)
  for (let pos = 0; pos + FRAME <= end; pos += HOP) {
    frame.set(samples.subarray(pos, pos + FRAME))
    frames.push(magnitudeSpectrum(frame))
  }
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
  // remove the local mean so quiet/loud sections weigh the same
  const W = 16
  const out = new Float32Array(flux.length)
  for (let i = 0; i < flux.length; i++) {
    let sum = 0
    let n = 0
    for (let j = Math.max(0, i - W); j <= Math.min(flux.length - 1, i + W); j++) {
      sum += flux[j]
      n++
    }
    out[i] = Math.max(0, flux[i] - sum / n)
  }
  return out
}

/**
 * Beat phase for a known period: the comb of beat positions that collects the
 * most onset strength. Returned in envelope frames.
 */
function combPhase(env: Float32Array, lagFrames: number): number {
  const lag = Math.max(1, lagFrames)
  const span = Math.max(1, Math.round(lag))
  let best = 0
  let bestSum = -Infinity
  for (let phase = 0; phase < span; phase++) {
    let sum = 0
    // step by the fractional period and round per tooth; stepping by a rounded
    // lag instead would drift a frame every few beats and smear the comb
    for (let k = 0; ; k++) {
      const i = Math.round(phase + k * lag)
      if (i >= env.length) break
      sum += env[i]
    }
    if (sum > bestSum) {
      bestSum = sum
      best = phase
    }
  }
  return best
}

/**
 * Grid phase in seconds for a tempo the caller already knows (the manual-BPM
 * path, where detectBpm never runs). 0 if the audio is too short to tell.
 */
export function detectBeatOffset(samples: Float32Array, sampleRate: number, bpm: number): number {
  const env = onsetEnvelope(samples, sampleRate)
  const fps = sampleRate / HOP
  const lag = (60 / Math.max(1, bpm)) * fps
  if (env.length < lag * 2) return 0
  return combPhase(env, lag) / fps
}

export function detectBpm(samples: Float32Array, sampleRate: number): TempoEstimate | null {
  const env = onsetEnvelope(samples, sampleRate)
  const fps = sampleRate / HOP
  const minLag = Math.max(1, Math.floor((60 / MAX_BPM) * fps))
  const maxLag = Math.ceil((60 / MIN_BPM) * fps)
  // need a few beat periods of signal to correlate against
  if (env.length < maxLag * 2) return null

  // normalized autocorrelation of the envelope
  let energy = 0
  for (let i = 0; i < env.length; i++) energy += env[i] * env[i]
  if (energy === 0) return null
  const corr = new Float32Array(maxLag * 3 + 1)
  for (let lag = minLag; lag < corr.length; lag++) {
    let sum = 0
    for (let i = 0; i + lag < env.length; i++) sum += env[i] * env[i + lag]
    corr[lag] = sum / energy
  }

  // score candidate lags with harmonic support: the true beat period keeps
  // correlating at 2x and 3x, an eighth-note grid does not
  let bestLag = -1
  let bestScore = -Infinity
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (corr[lag] < corr[lag - 1] || corr[lag] < corr[lag + 1]) continue
    let score = corr[lag]
    if (lag * 2 < corr.length) score += 0.5 * corr[lag * 2]
    if (lag * 3 < corr.length) score += 0.33 * corr[lag * 3]
    if (score > bestScore) {
      bestScore = score
      bestLag = lag
    }
  }
  if (bestLag < 0 || corr[bestLag] < 0.1) return null

  // parabolic interpolation for sub-frame precision
  let lag: number = bestLag
  const a = corr[bestLag - 1]
  const b = corr[bestLag]
  const c = corr[bestLag + 1]
  const denom = a - 2 * b + c
  if (denom !== 0) {
    const shift = (0.5 * (a - c)) / denom
    if (isFinite(shift) && Math.abs(shift) < 1) lag += shift
  }

  let bpm = (60 * fps) / lag
  // fold into the range people actually tap along to
  while (bpm > 165) bpm /= 2
  while (bpm < 55) bpm *= 2
  bpm = Math.round(bpm * 10) / 10
  // phase against the folded tempo, so it lines up with the BPM we report
  const offsetSec = combPhase(env, (60 / bpm) * fps) / fps
  return { bpm, confidence: corr[bestLag], offsetSec }
}
