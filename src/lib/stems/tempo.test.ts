import { describe, it, expect } from 'vitest'
import { detectBpm } from './tempo'

const SR = 44100

function clickTrack(bpm: number, seconds: number, offbeatHats = false): Float32Array {
  const out = new Float32Array(Math.floor(SR * seconds))
  const beat = 60 / bpm
  let seed = 7
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x3fffffff - 1
  }
  const hit = (at: number, decay: number, gain: number) => {
    const start = Math.floor(at * SR)
    const len = Math.floor(0.05 * SR)
    for (let i = 0; i < len && start + i < out.length; i++) {
      out[start + i] += rand() * Math.exp((-i / SR) * decay) * gain
    }
  }
  for (let t = 0; t < seconds; t += beat) {
    hit(t, 60, 1)
    if (offbeatHats) hit(t + beat / 2, 120, 0.4)
  }
  return out
}

describe('detectBpm', () => {
  it('finds the tempo of a plain click track', () => {
    const est = detectBpm(clickTrack(100, 10), SR)
    expect(est).not.toBeNull()
    expect(Math.abs(est!.bpm - 100)).toBeLessThan(2)
  })

  it('resolves the beat, not the eighth-note grid, when offbeats are present', () => {
    const est = detectBpm(clickTrack(120, 10, true), SR)
    expect(est).not.toBeNull()
    // 120 itself, or a half/double fold of it — never the untempered 240 grid
    expect([60, 120].some((t) => Math.abs(est!.bpm - t) < 2.5)).toBe(true)
  })

  it('returns null for silence', () => {
    expect(detectBpm(new Float32Array(SR * 10), SR)).toBeNull()
  })

  it('returns null for audio shorter than a couple of beat periods', () => {
    expect(detectBpm(clickTrack(100, 1), SR)).toBeNull()
  })
})
