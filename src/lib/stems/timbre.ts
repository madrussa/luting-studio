// Timbre features + instrument guessing for separated stems.
// The 6-stem model names drums/bass/guitar/piano, but "vocals" and "other"
// cover a lot of ground — these heuristics look at how the stem *sounds*
// (percussive vs sustained, bright vs dark, pure vs rich) and pick the
// closest luting instrument.

import { magnitudeSpectrum } from './fft'

const FRAME = 2048
const HOP = 1024

export interface TimbreFeatures {
  /** fraction of frames that are audible between the first and last one */
  sustainRatio: number
  /** spectral-flux peaks per active second — pluck/strike density */
  onsetsPerSec: number
  /** mean spectral centroid of audible frames, Hz */
  centroidHz: number
  /** mean spectral spread around the centroid, Hz — low = pure/sine-like */
  spreadHz: number
}

export function computeTimbre(samples: Float32Array, sampleRate: number): TimbreFeatures | null {
  const specs: Float32Array[] = []
  const rms: number[] = []
  const frame = new Float32Array(FRAME)
  for (let pos = 0; pos + FRAME <= samples.length; pos += HOP) {
    frame.set(samples.subarray(pos, pos + FRAME))
    let e = 0
    for (let i = 0; i < FRAME; i++) e += frame[i] * frame[i]
    rms.push(Math.sqrt(e / FRAME))
    specs.push(magnitudeSpectrum(frame))
  }
  if (specs.length < 4) return null

  const peakRms = Math.max(...rms)
  if (peakRms < 1e-4) return null
  const gate = peakRms * 0.15
  const active = rms.map((r) => r > gate)
  const first = active.indexOf(true)
  const last = active.lastIndexOf(true)
  if (first < 0 || last <= first) return null

  const span = last - first + 1
  let activeCount = 0
  let centroidSum = 0
  let spreadSum = 0
  const binHz = sampleRate / FRAME
  for (let i = first; i <= last; i++) {
    if (!active[i]) continue
    activeCount++
    const spec = specs[i]
    let num = 0
    let den = 0
    for (let k = 1; k < spec.length; k++) {
      num += k * binHz * spec[k]
      den += spec[k]
    }
    const centroid = den > 0 ? num / den : 0
    let varSum = 0
    for (let k = 1; k < spec.length; k++) {
      const d = k * binHz - centroid
      varSum += d * d * spec[k]
    }
    centroidSum += centroid
    spreadSum += den > 0 ? Math.sqrt(varSum / den) : 0
  }

  // pluck/strike density from spectral-flux peaks
  const flux = new Float32Array(specs.length)
  for (let i = 1; i < specs.length; i++) {
    let f = 0
    for (let k = 0; k < specs[i].length; k++) {
      const d = specs[i][k] - specs[i - 1][k]
      if (d > 0) f += d
    }
    flux[i] = f
  }
  const maxFlux = Math.max(...flux)
  let onsets = 0
  if (maxFlux > 0) {
    let lastOnset = -Infinity
    const hopSec = HOP / sampleRate
    for (let i = 1; i < flux.length - 1; i++) {
      const t = i * hopSec
      if (
        flux[i] > maxFlux * 0.25 &&
        flux[i] >= flux[i - 1] &&
        flux[i] >= flux[i + 1] &&
        t - lastOnset >= 0.1
      ) {
        onsets++
        lastOnset = t
      }
    }
  }
  const activeSec = (span * HOP) / sampleRate

  return {
    sustainRatio: activeCount / span,
    onsetsPerSec: onsets / Math.max(0.5, activeSec),
    centroidHz: centroidSum / activeCount,
    spreadHz: spreadSum / activeCount,
  }
}

/** Best luting instrument for the "other" stem (synths, strings, brass…). */
export function classifyOther(t: TimbreFeatures): string {
  const percussive = t.onsetsPerSec >= 2 && t.sustainRatio < 0.6
  if (percussive) return t.centroidHz >= 1800 ? 'k' : 'l' // keys vs plucks
  if (t.centroidHz >= 2000) return 'c' // bright square-ish synth lead
  if (t.centroidHz >= 1200) return 'v' // strings territory
  if (t.centroidHz >= 700) return 'h' // brass
  return 'o' // dark sustained pad
}

/** Best luting instrument for the vocals stem. */
export function classifyVocals(t: TimbreFeatures): string {
  // whistling is nearly sinusoidal: high centroid, almost no spread
  if (t.centroidHz > 700 && t.spreadHz < t.centroidHz * 0.35) return 'f'
  return 'e'
}
