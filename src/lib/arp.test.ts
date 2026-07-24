import { describe, it, expect } from 'vitest'
import { arpeggiateBody } from './transform'
import { parseLuting } from './luting'

const BPM = 400
const UNIT = 60 / BPM
const notesOf = (body: string) => parseLuting(`#lute ${BPM} il${body}`).notes

describe('arpeggiateBody', () => {
  it('explodes a chord into unit notes cycling up', () => {
    const body = arpeggiateBody(notesOf('(ceg)6'), BPM, 'up')!
    const notes = notesOf(body)
    expect(notes.map((n) => n.midi)).toEqual([60, 64, 67, 60, 64, 67])
    expect(notes.map((n) => Math.round(n.timeSec / UNIT))).toEqual([0, 1, 2, 3, 4, 5])
    expect(notes.every((n) => Math.abs(n.durSec - UNIT) < 1e-9)).toBe(true)
  })

  it('down and up-down orders', () => {
    const down = notesOf(arpeggiateBody(notesOf('(ceg)3'), BPM, 'down')!)
    expect(down.map((n) => n.midi)).toEqual([67, 64, 60])
    const updown = notesOf(arpeggiateBody(notesOf('(ceg)8'), BPM, 'updown')!)
    expect(updown.map((n) => n.midi)).toEqual([60, 64, 67, 64, 60, 64, 67, 64])
  })

  it('keeps single notes and rests, and the total length', () => {
    const src = 't2c r (eg)4 c'
    const body = arpeggiateBody(notesOf(src), BPM, 'up')!
    const a = parseLuting(`#lute ${BPM} il${src}`)
    const b = parseLuting(`#lute ${BPM} il${body}`)
    expect(b.durationSec).toBeCloseTo(a.durationSec, 9)
    const single = b.notes.filter((n) => Math.abs(n.durSec - 2 * UNIT) < 1e-9)
    expect(single).toHaveLength(2) // the two plain t2 notes survive
  })

  it('returns null when there are no chords', () => {
    expect(arpeggiateBody(notesOf('cdef'), BPM, 'up')).toBeNull()
  })
})
