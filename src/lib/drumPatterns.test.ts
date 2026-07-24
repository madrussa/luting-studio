import { describe, it, expect } from 'vitest'
import { DRUM_PATTERNS, patternRollNotes } from './drumPatterns'
import { notesToEvents } from './transform'
import { serializeVoiceBody, parseLuting, DRUM_SOUNDS } from './luting'

const BPM = 400
const UNIT = 60 / BPM

describe('drum patterns', () => {
  it('every pattern uses only real drum sounds within its bar', () => {
    for (const p of DRUM_PATTERNS) {
      for (const h of p.hits) {
        expect(DRUM_SOUNDS[h.drum], `${p.id}: ${h.drum}`).toBeDefined()
        for (const s of h.steps) {
          expect(s, `${p.id}: step ${s}`).toBeGreaterThanOrEqual(0)
          expect(s, `${p.id}: step ${s}`).toBeLessThan(p.barUnits)
        }
      }
    }
  })

  it('serializes and parses back with every hit intact (chords included)', () => {
    for (const p of DRUM_PATTERNS) {
      const roll = patternRollNotes(p, 0)
      const body = serializeVoiceBody(notesToEvents(roll, true))
      const notes = parseLuting(`#lute ${BPM} id${body}`).notes
      const got = notes.map((n) => `${Math.round(n.timeSec / UNIT)}:${n.drum}`).sort()
      const want = roll.map((n) => `${n.start}:${n.drum}`).sort()
      expect(got, p.id).toEqual(want)
    }
  })

  it('placement lands on the requested bar', () => {
    const rock = DRUM_PATTERNS[0]
    const notes = patternRollNotes(rock, 32)
    expect(Math.min(...notes.map((n) => n.start))).toBe(32)
  })
})
