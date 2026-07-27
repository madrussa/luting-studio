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

  it('anchors to an explicit grid zero (count-in / overdub mode)', () => {
    const anchor = 10000
    const rec = createMidiRecorder(BPM, 'l', { anchorMs: anchor })
    // played during the count-in and released before it ends: dropped
    rec.noteOn(50, 0.8, anchor - UNIT * 2)
    rec.noteOff(50, anchor - UNIT)
    // held across the anchor: starts at 0, only the post-anchor part counts
    rec.noteOn(60, 0.8, anchor - UNIT)
    rec.noteOff(60, anchor + UNIT)
    // played one beat (4 units) into the take: lands at unit 4, not unit 0
    rec.noteOn(64, 0.8, anchor + UNIT * 4)
    rec.noteOff(64, anchor + UNIT * 5)
    const r = rec.finish(anchor + UNIT * 6)

    const notes = parseLuting(`#lute ${BPM} il${r.voices[0].body}`).notes
    const unitSec = 60 / BPM
    expect(notes.map((n) => [n.midi, Math.round(n.timeSec / unitSec), Math.round(n.durSec / unitSec)])).toEqual([
      [60, 0, 1],
      [64, 4, 1],
    ])
  })

  it('keeps two devices playing the same key apart', () => {
    const rec = createMidiRecorder(BPM, 'l')
    rec.noteOn(60, 0.8, 0, 'keyboard')
    rec.noteOn(60, 0.8, 0, 'pad') // same pitch, other device — must not close the first
    rec.noteOff(60, UNIT, 'pad')
    rec.noteOff(60, UNIT * 4, 'keyboard')
    const r = rec.finish(UNIT * 4.2)

    expect(r.voices).toHaveLength(2) // same start, different lengths
    const lengths = r.voices
      .map((v) => parseLuting(`#lute ${BPM} il${v.body}`).notes[0])
      .map((n) => Math.round(n.durSec / (60 / BPM)))
      .sort((a, b) => a - b)
    expect(lengths).toEqual([1, 4])
  })

  it('anchors past a stray note that never makes it into the take', () => {
    const rec = createMidiRecorder(BPM, 'd')
    // a pad fires a key with no luteboi drum sound before the player starts
    rec.noteOn(127, 1, 0, 'pad')
    rec.noteOff(127, 50, 'pad')
    rec.noteOn(36, 1, UNIT * 8, 'keys') // the real take, 8 units later
    rec.noteOff(36, UNIT * 8 + 50, 'keys')
    rec.noteOn(38, 1, UNIT * 9, 'keys')
    rec.noteOff(38, UNIT * 9 + 50, 'keys')
    const r = rec.finish(UNIT * 10)

    const notes = parseLuting(`#lute ${BPM} id${r.voices[0].body}`).notes
    const unitSec = 60 / BPM
    // grid zero is the first *surviving* note, so there are no leading rests
    expect(notes.map((n) => Math.round(n.timeSec / unitSec))).toEqual([0, 1])
  })

  it('flags a take that arrived from more than one device', () => {
    const rec = createMidiRecorder(BPM, 'l')
    rec.noteOn(60, 0.8, 0, 'a')
    rec.noteOff(60, UNIT, 'a')
    rec.noteOn(64, 0.8, UNIT, 'b')
    rec.noteOff(64, UNIT * 2, 'b')
    const r = rec.finish(UNIT * 3)
    expect(r.warnings.some((w) => w.includes('2 devices'))).toBe(true)
  })

  it('records velocity as the voice volume', () => {
    const rec = createMidiRecorder(BPM, 'l')
    rec.noteOn(60, 0.5, 0)
    rec.noteOff(60, UNIT)
    const r = rec.finish(UNIT * 2)
    expect(r.voices[0].body.startsWith('v5')).toBe(true)
  })
})
