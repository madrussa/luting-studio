import { describe, it, expect } from 'vitest'
import { computeTimbre, classifyOther, classifyVocals } from './timbre'
import { mergeSustains } from './notes'

const SR = 44100

/** Sustained tone with the given harmonic amplitudes, 5 s. */
function sustained(f0: number, harmonics: number[], seconds = 5): Float32Array {
  const out = new Float32Array(Math.floor(SR * seconds))
  for (let i = 0; i < out.length; i++) {
    const t = i / SR
    let v = 0
    harmonics.forEach((a, k) => {
      const f = f0 * (k + 1)
      if (f < SR / 2) v += a * Math.sin(2 * Math.PI * f * t)
    })
    out[i] = v * 0.2
  }
  return out
}

/** Repeated fast-decaying plucks, 5 s. */
function plucked(f0: number, harmonics: number[], seconds = 5): Float32Array {
  const out = new Float32Array(Math.floor(SR * seconds))
  for (let start = 0; start < seconds; start += 0.35) {
    const s0 = Math.floor(start * SR)
    const len = Math.floor(0.3 * SR)
    for (let i = 0; i < len && s0 + i < out.length; i++) {
      const t = i / SR
      let v = 0
      harmonics.forEach((a, k) => {
        const f = f0 * (k + 1)
        if (f < SR / 2) v += a * Math.sin(2 * Math.PI * f * t)
      })
      out[s0 + i] += v * 0.2 * Math.exp(-t * 12)
    }
  }
  return out
}

const square = (n: number) => Array.from({ length: n }, (_, k) => (k % 2 === 0 ? 1 / (k + 1) : 0))
const dark = [1, 0.4, 0.1] // few, quickly-fading harmonics

describe('timbre classification', () => {
  it('classifies a bright sustained square lead as Chiptune', () => {
    const t = computeTimbre(sustained(880, square(24)), SR)!
    expect(t.sustainRatio).toBeGreaterThan(0.8)
    expect(classifyOther(t)).toBe('c')
  })

  it('classifies a dark sustained pad as Organ', () => {
    const t = computeTimbre(sustained(150, dark), SR)!
    expect(classifyOther(t)).toBe('o')
  })

  it('classifies repeated plucks as a plucked/struck instrument', () => {
    const t = computeTimbre(plucked(330, dark), SR)!
    expect(t.onsetsPerSec).toBeGreaterThan(1.5)
    expect(['k', 'l']).toContain(classifyOther(t))
  })

  it('classifies a near-sine whistle as Flute and rich singing as Choir', () => {
    const whistle = computeTimbre(sustained(1500, [1]), SR)!
    expect(classifyVocals(whistle)).toBe('f')
    const singing = computeTimbre(sustained(250, [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.4, 0.3, 0.3]), SR)!
    expect(classifyVocals(singing)).toBe('e')
  })

  it('returns null on silence', () => {
    expect(computeTimbre(new Float32Array(SR), SR)).toBeNull()
  })
})

describe('mergeSustains', () => {
  it('joins same-pitch fragments separated by small gaps', () => {
    const merged = mergeSustains(
      [
        { startSec: 0, durSec: 0.4, midi: 60, amplitude: 0.8 },
        { startSec: 0.45, durSec: 0.4, midi: 60, amplitude: 0.5 },
        { startSec: 0.9, durSec: 0.4, midi: 60, amplitude: 0.6 },
      ],
      0.08
    )
    expect(merged).toHaveLength(1)
    expect(merged[0].startSec).toBe(0)
    expect(merged[0].durSec).toBeCloseTo(1.3, 5)
    expect(merged[0].amplitude).toBe(0.8)
  })

  it('leaves distinct pitches and real gaps alone', () => {
    const merged = mergeSustains(
      [
        { startSec: 0, durSec: 0.4, midi: 60, amplitude: 0.8 },
        { startSec: 0.45, durSec: 0.4, midi: 62, amplitude: 0.5 }, // different pitch
        { startSec: 1.5, durSec: 0.4, midi: 60, amplitude: 0.6 }, // big gap
      ],
      0.08
    )
    expect(merged).toHaveLength(3)
  })
})
