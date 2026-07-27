import { describe, it, expect } from 'vitest'
import { gridPhase, phaseFromOnsets } from './convert'
import { quantizeMelody } from './pitch'

describe('gridPhase', () => {
  const UNIT = 0.15

  it('folds an offset into a sub-unit phase', () => {
    expect(gridPhase(0, UNIT)).toBe(0)
    expect(gridPhase(0.04, UNIT)).toBeCloseTo(0.04)
    // whole units carry no alignment information — shifting by one would just
    // slide the whole transcription a unit sideways
    expect(gridPhase(3 * UNIT + 0.04, UNIT)).toBeCloseTo(0.04)
  })

  it('centres on zero, so notes stay at their true position', () => {
    // past halfway it is nearer to pull notes back than push them forward
    expect(gridPhase(0.11, UNIT)).toBeCloseTo(0.11 - UNIT)
    expect(Math.abs(gridPhase(0.149, UNIT))).toBeLessThanOrEqual(UNIT / 2)
  })

  it('is inert for input it cannot use', () => {
    expect(gridPhase(Number.NaN, UNIT)).toBe(0)
    expect(gridPhase(0.2, 0)).toBe(0)
  })
})

describe('phaseFromOnsets', () => {
  const UNIT = 0.15

  it('recovers a grid that is out of step with the file', () => {
    const onsets = [0, 1, 2, 3, 4, 5].map((k) => k * UNIT + 0.07)
    expect(phaseFromOnsets(onsets, UNIT)).toBeCloseTo(0.07, 2)
  })

  it('returns zero with nothing to go on', () => {
    expect(phaseFromOnsets([], UNIT)).toBe(0)
  })
})

describe('quantizeMelody', () => {
  const UNIT = 0.15
  const notes = (spec: [number, number][]) => spec.map(([start, end], i) => ({ midi: 60 + i, start, end }))
  const kinds = (events: { type: string }[]) => events.map((e) => e.type)

  it('keeps every note of a run played faster than the grid', () => {
    // four notes inside two grid units: each one used to be dropped outright
    // for landing before the previous note's quantized end
    const { events, crowded } = quantizeMelody(
      notes([
        [0, 0.05],
        [0.05, 0.1],
        [0.1, 0.15],
        [0.15, 0.2],
      ]),
      UNIT
    )
    expect(events.filter((e) => e.type === 'note')).toHaveLength(4)
    expect(crowded).toBe(3) // reported, so the warning can suggest a finer grid
  })

  it('holds an even rhythm together when the grid is out of step with it', () => {
    // on the half-unit, where rounding is a coin toss: unaligned, the jitter
    // sends neighbouring notes to the same unit and the rhythm falls apart
    const jitter = [0.004, -0.005, 0.003, -0.004, 0.005, -0.003]
    const { events, crowded } = quantizeMelody(
      notes(jitter.map((j, k) => [k * UNIT + UNIT / 2 + j, k * UNIT + UNIT / 2 + j + UNIT])),
      UNIT
    )
    expect(crowded).toBe(0)
    expect(kinds(events)).toEqual(['note', 'note', 'note', 'note', 'note', 'note'])
    expect(events.every((e) => e.duration === 1)).toBe(true)
  })

  it('keeps silence as rests', () => {
    const { events } = quantizeMelody(
      notes([
        [0, UNIT],
        [UNIT * 4, UNIT * 5],
      ]),
      UNIT
    )
    expect(kinds(events)).toEqual(['note', 'rest', 'note'])
    expect(events[1].duration).toBe(3)
  })

  it('gives even the shortest note a whole unit', () => {
    const { events } = quantizeMelody(notes([[0, 0.001]]), UNIT)
    expect(events).toHaveLength(1)
    expect(events[0].duration).toBe(1)
  })

  it('handles an empty melody', () => {
    expect(quantizeMelody([], UNIT)).toEqual({ events: [], crowded: 0 })
  })
})
