import { describe, it, expect, afterEach } from 'vitest'
import {
  simNote,
  setSimActive,
  isSimActive,
  getMidiDevices,
  setMidiInput,
  subscribeMidiNotes,
  subscribeMidiDevices,
  isMirrorDuplicate,
  resetMirrorState,
  SIM_DEVICE_ID,
} from './midi'
import type { MidiNoteEvent } from './midi'

afterEach(() => {
  setSimActive(false)
  setMidiInput('all')
  resetMirrorState()
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

  it('tags events with the device they came from', () => {
    setSimActive(true)
    const got: MidiNoteEvent[] = []
    const unsub = subscribeMidiNotes((ev) => got.push(ev))
    simNote('on', 60, 0.8)
    unsub()
    expect(got[0].deviceId).toBe(SIM_DEVICE_ID)
  })
})

describe('mirror-port collapsing', () => {
  const ev = (kind: 'on' | 'off', midi: number, timeMs: number, deviceId: string): MidiNoteEvent => ({
    kind,
    midi,
    velocity: kind === 'on' ? 0.8 : 0,
    timeMs,
    deviceId,
  })

  it("drops a second port's copy of one key press, and that copy's note-off", () => {
    expect(isMirrorDuplicate(ev('on', 60, 1000, 'keys'))).toBe(false)
    expect(isMirrorDuplicate(ev('on', 60, 1000.4, 'keys-DAW'))).toBe(true)
    // the swallowed note-on's note-off has to go too — nothing is holding that
    // voice, so letting it through would release the one that did sound
    expect(isMirrorDuplicate(ev('off', 60, 1200, 'keys-DAW'))).toBe(true)
    expect(isMirrorDuplicate(ev('off', 60, 1201, 'keys'))).toBe(false)
  })

  it('keeps the same key from two devices when the presses are genuinely apart', () => {
    expect(isMirrorDuplicate(ev('on', 60, 1000, 'a'))).toBe(false)
    expect(isMirrorDuplicate(ev('on', 60, 1050, 'b'))).toBe(false)
    expect(isMirrorDuplicate(ev('off', 60, 1100, 'b'))).toBe(false)
    expect(isMirrorDuplicate(ev('off', 60, 1200, 'a'))).toBe(false)
  })

  it('never collapses one device retriggering its own key', () => {
    expect(isMirrorDuplicate(ev('on', 60, 1000, 'a'))).toBe(false)
    expect(isMirrorDuplicate(ev('on', 60, 1000.2, 'a'))).toBe(false)
  })

  it('leaves different keys alone', () => {
    expect(isMirrorDuplicate(ev('on', 60, 1000, 'a'))).toBe(false)
    expect(isMirrorDuplicate(ev('on', 64, 1000.1, 'b'))).toBe(false)
  })
})
