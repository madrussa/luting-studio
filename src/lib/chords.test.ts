import { describe, it, expect } from 'vitest'
import { progressionBody } from './chords'
import { parseLuting } from './luting'

const BPM = 400
const parse = (body: string) => parseLuting(`#lute ${BPM} ik${body}`)

describe('progressionBody', () => {
  it('renders I–V–vi–IV in C as the right triads, one bar each', () => {
    const p = parse(progressionBody('C', 'pop'))
    const unit = 60 / BPM
    const byBar = new Map<number, number[]>()
    for (const n of p.notes) {
      const bar = Math.round(n.timeSec / unit / 16)
      byBar.set(bar, [...(byBar.get(bar) ?? []), n.midi!].sort((a, b) => a - b))
    }
    expect(byBar.get(0)).toEqual([48, 52, 55]) // C  E  G
    expect(byBar.get(1)).toEqual([55, 59, 62]) // G  B  D
    expect(byBar.get(2)).toEqual([57, 60, 64]) // A  C  E (minor)
    expect(byBar.get(3)).toEqual([53, 57, 60]) // F  A  C
    expect(p.durationSec).toBeCloseTo(64 * unit, 9)
  })

  it('transposes with the key and pulses on the beat', () => {
    const p = parse(progressionBody('Eb', 'folk', { pulse: 4, repeats: 2 }))
    // first chord: Eb major (Eb G Bb), struck every beat -> 4 hits per bar
    const first = p.notes.filter((n) => n.timeSec === 0).map((n) => n.midi!).sort((a, b) => a - b)
    expect(first).toEqual([51, 55, 58])
    const unit = 60 / BPM
    expect(p.durationSec).toBeCloseTo(2 * 4 * 16 * unit, 9)
    const hitsBar1 = new Set(p.notes.filter((n) => n.timeSec / unit < 16).map((n) => Math.round(n.timeSec / unit)))
    expect([...hitsBar1].sort((a, b) => a - b)).toEqual([0, 4, 8, 12])
  })
})
