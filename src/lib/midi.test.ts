import { describe, it, expect, afterEach } from 'vitest'
import {
  simNote,
  setSimActive,
  isSimActive,
  getMidiDevices,
  setMidiInput,
  subscribeMidiNotes,
  subscribeMidiDevices,
  SIM_DEVICE_ID,
} from './midi'
import type { MidiNoteEvent } from './midi'

afterEach(() => {
  setSimActive(false)
  setMidiInput('all')
})

describe('simulated MIDI device', () => {
  it('emits nothing while switched off', () => {
    const got: MidiNoteEvent[] = []
    const unsub = subscribeMidiNotes((ev) => got.push(ev))
    simNote('on', 60, 0.8)
    unsub()
    expect(got).toHaveLength(0)
  })

  it('emits note events through the normal subscription when active', () => {
    setSimActive(true)
    const got: MidiNoteEvent[] = []
    const unsub = subscribeMidiNotes((ev) => got.push(ev))
    simNote('on', 60, 0.8)
    simNote('off', 60, 0)
    unsub()
    expect(got.map((e) => e.kind)).toEqual(['on', 'off'])
    expect(got[0]).toMatchObject({ midi: 60, velocity: 0.8 })
    expect(typeof got[0].timeMs).toBe('number')
  })

  it('appears in the device list only while active', () => {
    expect(getMidiDevices().some((d) => d.id === SIM_DEVICE_ID)).toBe(false)
    setSimActive(true)
    expect(getMidiDevices().some((d) => d.id === SIM_DEVICE_ID)).toBe(true)
  })

  it('notifies device subscribers when toggled', () => {
    let fires = 0
    const unsub = subscribeMidiDevices(() => fires++)
    setSimActive(true)
    setSimActive(true) // no-op, already on
    setSimActive(false)
    unsub()
    expect(fires).toBe(2)
    expect(isSimActive()).toBe(false)
  })

  it('honors the input-device filter like a real device', () => {
    setSimActive(true)
    const got: MidiNoteEvent[] = []
    const unsub = subscribeMidiNotes((ev) => got.push(ev))

    setMidiInput('some-hardware-id')
    simNote('on', 60, 0.8) // filtered out
    setMidiInput(SIM_DEVICE_ID)
    simNote('on', 62, 0.8) // passes
    setMidiInput('all')
    simNote('on', 64, 0.8) // passes

    unsub()
    expect(got.map((e) => e.midi)).toEqual([62, 64])
  })

  it('clamps velocity and zeroes it on note-off', () => {
    setSimActive(true)
    const got: MidiNoteEvent[] = []
    const unsub = subscribeMidiNotes((ev) => got.push(ev))
    simNote('on', 60, 1.7)
    simNote('off', 60, 0.9)
    unsub()
    expect(got[0].velocity).toBe(1)
    expect(got[1].velocity).toBe(0)
  })
})
