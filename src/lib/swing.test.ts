import { describe, it, expect } from 'vitest'
import { swingBody } from './transform'
import { parseLuting } from './luting'

const BPM = 400
const UNIT = 60 / BPM

const notesOf = (body: string, instrument = 'l') => parseLuting(`#lute ${BPM} i${instrument}${body}`).notes

describe('swingBody', () => {
  it('swings straight eighth pairs into 5/2 + 3/2', () => {
    const body = swingBody(notesOf('t2cdef'), BPM, 'swing', false)!
    const notes = notesOf(body)
    const units = notes.map((n) => [n.timeSec / UNIT, n.durSec / UNIT])
    expect(units).toEqual([
      [0, 2.5],
      [2.5, 1.5],
      [4, 2.5],
      [6.5, 1.5],
    ])
  })

  it('straighten is the exact inverse', () => {
    const original = 't2cdef'
    const swung = swingBody(notesOf(original), BPM, 'swing', false)!
    const back = swingBody(notesOf(swung), BPM, 'straighten', false)!
    const a = notesOf(original).map((n) => `${n.timeSec.toFixed(4)}:${n.durSec.toFixed(4)}:${n.midi}`)
    const b = notesOf(back).map((n) => `${n.timeSec.toFixed(4)}:${n.durSec.toFixed(4)}:${n.midi}`)
    expect(b).toEqual(a)
  })

  it('shifts short off-beat drum hits late without stretching them', () => {
    // kick on the beat, hat on the off-beat eighth (1-unit hits, rests between)
    const body = swingBody(notesOf('o0ar o4c r', 'd'), BPM, 'swing', true)!
    const notes = notesOf(body, 'd')
    expect(notes[0].timeSec / UNIT).toBe(0) // kick stays
    expect(notes[1].timeSec / UNIT).toBe(2.5) // hat plays late
    expect(notes[1].durSec / UNIT).toBe(1) // and keeps its length
  })

  it('leaves sixteenth runs alone', () => {
    const result = swingBody(notesOf('cdefgabc'), BPM, 'swing', false) // 1-unit notes
    expect(result).toBeNull() // nothing on the eighth grid to swing
  })

  it('keeps quarter notes and longer untouched while swinging their neighbours', () => {
    const body = swingBody(notesOf('t2cd e4'), BPM, 'swing', false)!
    const notes = notesOf(body)
    expect(notes[2].timeSec / UNIT).toBe(4) // the quarter still starts on its beat
    expect(notes[2].durSec / UNIT).toBe(4)
  })

  it('swings chords like single notes', () => {
    const body = swingBody(notesOf('t2(ce)(df)'), BPM, 'swing', false)!
    const notes = notesOf(body)
    expect(notes.filter((n) => n.timeSec === 0)).toHaveLength(2)
    expect(notes.filter((n) => Math.abs(n.timeSec / UNIT - 2.5) < 1e-9)).toHaveLength(2)
  })
})
