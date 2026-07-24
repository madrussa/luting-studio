import { describe, it, expect } from 'vitest'
import { createMidiRecorder } from './midiRecord'
import { parseLuting } from './luting'

// #lute 400 -> one grid unit = 150ms
const BPM = 400
const UNIT = 60000 / BPM

describe('createMidiRecorder', () => {
  it('returns a warning and no voices for an empty take', () => {
    const rec = createMidiRecorder(BPM, 'l')
    const r = rec.finish(1000)
    expect(r.voices).toHaveLength(0)
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it('quantizes a simple melody to the grid, anchored at the first note', () => {
    const rec = createMidiRecorder(BPM, 'l')
    // c4 e4 g4 as slightly-sloppy quarter units starting at an arbitrary time
    const t0 = 5000
    rec.noteOn(60, 0.8, t0)
    rec.noteOff(60, t0 + UNIT * 0.94)
    rec.noteOn(64, 0.8, t0 + UNIT * 1.05)
    rec.noteOff(64, t0 + UNIT * 1.97)
    rec.noteOn(67, 0.8, t0 + UNIT * 2.02)
    const r = rec.finish(t0 + UNIT * 3.1)

    expect(r.voices).toHaveLength(1)
    expect(r.voices[0].noteCount).toBe(3)
    const notes = parseLuting(`#lute ${BPM} i${r.voices[0].instrument}${r.voices[0].body}`).notes
    expect(notes.map((n) => n.midi)).toEqual([60, 64, 67])
    // each lasted ~1 unit and they are back to back
    const unitSec = 60 / BPM
    expect(notes.map((n) => Math.round(n.timeSec / unitSec))).toEqual([0, 1, 2])
    expect(notes.every((n) => Math.abs(n.durSec - unitSec) < 1e-9)).toBe(true)
  })

  it('turns simultaneous equal-length presses into a chord', () => {
    const rec = createMidiRecorder(BPM, 'k')
    const t0 = 100
    for (const m of [60, 64, 67]) rec.noteOn(m, 0.9, t0 + (m - 60)) // a few ms of strum
    for (const m of [60, 64, 67]) rec.noteOff(m, t0 + UNIT * 2)
    const r = rec.finish(t0 + UNIT * 2.5)

    expect(r.voices).toHaveLength(1)
    expect(r.voices[0].body).toContain('(')
    const notes = parseLuting(`#lute ${BPM} ik${r.voices[0].body}`).notes
    expect(notes.map((n) => n.midi ?? 0).sort((a, b) => a - b)).toEqual([60, 64, 67])
    expect(new Set(notes.map((n) => n.timeSec)).size).toBe(1)
  })

  it('spills overlapping-but-unequal notes into extra voices', () => {
    const rec = createMidiRecorder(BPM, 'v')
    const t0 = 0
    rec.noteOn(48, 0.7, t0)
    rec.noteOn(72, 0.7, t0) // same start...
    rec.noteOff(72, t0 + UNIT) // ...but shorter
    rec.noteOff(48, t0 + UNIT * 4)
    const r = rec.finish(t0 + UNIT * 4.2)

    expect(r.voices).toHaveLength(2)
    expect(r.warnings.some((w) => w.includes('split into 2 voices'))).toBe(true)
  })

  it('closes notes still held when the take stops', () => {
    const rec = createMidiRecorder(BPM, 'l')
    rec.noteOn(60, 0.8, 0)
    const r = rec.finish(UNIT * 2)
    expect(r.voices).toHaveLength(1)
    const notes = parseLuting(`#lute ${BPM} il${r.voices[0].body}`).notes
    expect(Math.round(notes[0].durSec / (60 / BPM))).toBe(2)
  })

  it('maps GM drum notes onto the luteboi drumkit', () => {
    const rec = createMidiRecorder(BPM, 'd')
    rec.noteOn(36, 1, 0) // GM bass drum
    rec.noteOff(36, 50)
    rec.noteOn(38, 1, UNIT) // GM acoustic snare
    rec.noteOff(38, UNIT + 50)
    const r = rec.finish(UNIT * 2)

    expect(r.voices).toHaveLength(1)
    const notes = parseLuting(`#lute ${BPM} id${r.voices[0].body}`).notes
    expect(notes.map((n) => n.drum)).toEqual(['o0a', 'o3c']) // kick, snare
  })

  it('records velocity as the voice volume', () => {
    const rec = createMidiRecorder(BPM, 'l')
    rec.noteOn(60, 0.5, 0)
    rec.noteOff(60, UNIT)
    const r = rec.finish(UNIT * 2)
    expect(r.voices[0].body.startsWith('v5')).toBe(true)
  })
})
