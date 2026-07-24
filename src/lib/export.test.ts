import { describe, it, expect } from 'vitest'
import { audioBufferToWav } from './render'
import { exportMidi } from './midiExport'
import { convertMidi } from './convert'
import { parseLuting } from './luting'

// audioBufferToWav only touches these members, so a plain object stands in
// for a real AudioBuffer (which node doesn't have).
function fakeBuffer(channels: Float32Array[], sampleRate = 44100): AudioBuffer {
  return {
    numberOfChannels: channels.length,
    length: channels[0].length,
    sampleRate,
    getChannelData: (c: number) => channels[c],
  } as unknown as AudioBuffer
}

describe('audioBufferToWav', () => {
  it('writes a valid 16-bit stereo PCM header and clamps samples', async () => {
    const l = new Float32Array([0, 0.5, 1, 1.5]) // 1.5 must clamp to 1.0
    const r = new Float32Array([0, -0.5, -1, -1.5])
    const blob = audioBufferToWav(fakeBuffer([l, r], 22050))
    const v = new DataView(await blob.arrayBuffer())

    const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3))
    expect(tag(0)).toBe('RIFF')
    expect(tag(8)).toBe('WAVE')
    expect(v.getUint16(22, true)).toBe(2) // channels
    expect(v.getUint32(24, true)).toBe(22050) // sample rate
    expect(v.getUint32(40, true)).toBe(4 * 2 * 2) // data length
    expect(blob.size).toBe(44 + 16)
    // frame 3: clamped full-scale
    expect(v.getInt16(44 + 3 * 4, true)).toBe(0x7fff)
    expect(v.getInt16(44 + 3 * 4 + 2, true)).toBe(-0x8000)
  })
})

describe('exportMidi', () => {
  it('round-trips through the MIDI importer with identical notes', async () => {
    const src = '#lute 400 ikt2ceg(ceg)4|ibo2t4cg'
    const bytes = exportMidi(src, ['Keys', 'Bass'])
    const back = await convertMidi(bytes.buffer.slice(0) as ArrayBuffer, 20)

    expect(back.bpm).toBe(400)
    expect(back.voices).toHaveLength(2)
    const rebuilt = `#lute ${back.bpm} ` + back.voices.map((v) => `i${v.instrument}${v.body}`).join('|')
    const a = parseLuting(src).notes.map((n) => `${n.voice}:${n.timeSec.toFixed(3)}:${n.durSec.toFixed(3)}:${n.midi}`)
    const b = parseLuting(rebuilt).notes.map((n) => `${n.voice}:${n.timeSec.toFixed(3)}:${n.durSec.toFixed(3)}:${n.midi}`)
    expect(b.sort()).toEqual(a.sort())
    // instruments map back into the same GM buckets
    expect(back.voices.map((v) => v.instrument)).toEqual(['k', 'b'])
  })

  it('puts drum voices on the GM percussion channel and round-trips the drums', async () => {
    const src = '#lute 240 ido0ao3co4c'
    const back = await convertMidi(exportMidi(src).buffer.slice(0) as ArrayBuffer, 20)
    expect(back.voices).toHaveLength(1)
    expect(back.voices[0].instrument).toBe('d')
    const notes = parseLuting(`#lute ${back.bpm} id${back.voices[0].body}`).notes
    expect(notes.map((n) => n.drum)).toEqual(['o0a', 'o3c', 'o4c']) // kick, snare, closed hat
  })
})
