import { describe, it, expect } from 'vitest'
import { notesToVoices, dropQuietNotes, suppressOctaveGhosts, monophonicReduce } from './notes'
import { detectDrumOnsets, drumsToVoices } from './drums'
import { parseLuting } from '../luting'

// 480 luting BPM -> one grid unit = 125 ms
const BPM = 480
const UNIT = 60 / BPM

describe('notesToVoices', () => {
  it('quantizes a simple melody onto the grid', () => {
    const voices = notesToVoices(
      [
        { startSec: 0, durSec: UNIT, midi: 60, amplitude: 0.8 },
        { startSec: UNIT, durSec: UNIT, midi: 62, amplitude: 0.8 },
        { startSec: UNIT * 2, durSec: UNIT * 2, midi: 64, amplitude: 0.8 },
      ],
      BPM,
      'k',
      'Piano'
    )
    expect(voices).toHaveLength(1)
    const parsed = parseLuting(`#lute ${BPM} i${voices[0].instrument}${voices[0].body}`)
    expect(parsed.notes.map((n) => n.midi)).toEqual([60, 62, 64])
    expect(parsed.notes[2].durSec).toBeCloseTo(UNIT * 2, 5)
  })

  it('groups simultaneous equal-length notes into a chord', () => {
    const voices = notesToVoices(
      [
        { startSec: 0, durSec: UNIT, midi: 60, amplitude: 0.8 },
        { startSec: 0, durSec: UNIT, midi: 64, amplitude: 0.8 },
        { startSec: 0, durSec: UNIT, midi: 67, amplitude: 0.8 },
      ],
      BPM,
      'k',
      'Piano'
    )
    expect(voices).toHaveLength(1)
    const parsed = parseLuting(`#lute ${BPM} ik${voices[0].body}`)
    expect(parsed.notes.map((n) => n.midi ?? -1).sort((a, b) => a - b)).toEqual([60, 64, 67])
    expect(new Set(parsed.notes.map((n) => n.timeSec)).size).toBe(1)
  })

  it('spills overlapping lines into extra voices', () => {
    const voices = notesToVoices(
      [
        { startSec: 0, durSec: UNIT * 4, midi: 48, amplitude: 0.8 },
        { startSec: UNIT, durSec: UNIT, midi: 72, amplitude: 0.8 },
      ],
      BPM,
      'k',
      'Piano'
    )
    expect(voices).toHaveLength(2)
  })

  it('returns nothing for no notes', () => {
    expect(notesToVoices([], BPM, 'k', 'Piano')).toHaveLength(0)
  })

  it('honors an explicit stem volume', () => {
    const voices = notesToVoices(
      [{ startSec: 0, durSec: UNIT, midi: 60, amplitude: 0.9 }],
      BPM,
      'k',
      'Piano',
      { volume: 4 }
    )
    expect(voices[0].body.startsWith('v4')).toBe(true)
  })
})

describe('transcription cleanup', () => {
  const note = (startSec: number, midi: number, amplitude: number, durSec = 0.5) => ({
    startSec,
    durSec,
    midi,
    amplitude,
  })

  it('dropQuietNotes removes far-below-median ghosts, keeps the rest', () => {
    const kept = dropQuietNotes([note(0, 60, 0.8), note(1, 62, 0.7), note(2, 64, 0.75), note(3, 84, 0.05)])
    expect(kept.map((n) => n.midi)).toEqual([60, 62, 64])
  })

  it('suppressOctaveGhosts drops the quiet octave double, not a real octave line', () => {
    const cleaned = suppressOctaveGhosts([
      note(0, 60, 0.9),
      note(0, 72, 0.2), // quiet simultaneous octave -> ghost
      note(1, 60, 0.9),
      note(1, 72, 0.85), // deliberate octave doubling -> keep
    ])
    expect(cleaned.map((n) => n.midi)).toEqual([60, 60, 72])
  })

  it('monophonicReduce keeps the strongest line and absorbs vibrato flicker', () => {
    const reduced = monophonicReduce([
      note(0, 67, 0.9, 1.0), // the melody note
      note(0.2, 55, 0.3, 0.5), // quieter overlapping low note -> dropped
      note(1.05, 68, 0.5, 0.1), // semitone blip right after -> absorbed
      note(1.2, 72, 0.8, 0.8), // next real note
    ])
    expect(reduced.map((n) => n.midi)).toEqual([67, 72])
    expect(reduced[0].durSec).toBeGreaterThan(1.0)
  })
})

// -- synthetic drum hits -----------------------------------------------------

const SR = 44100

function synthHit(out: Float32Array, at: number, kind: 'kick' | 'snare' | 'hat') {
  const start = Math.floor(at * SR)
  const len = Math.floor(0.08 * SR)
  let seed = 1234
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x3fffffff - 1
  }
  for (let i = 0; i < len && start + i < out.length; i++) {
    const t = i / SR
    const env = Math.exp(-t * 40)
    let v = 0
    if (kind === 'kick') v = Math.sin(2 * Math.PI * 55 * t) * env
    if (kind === 'snare') v = (Math.sin(2 * Math.PI * 200 * t) * 0.5 + rand() * 0.5) * env
    if (kind === 'hat') {
      // high-passed noise: difference of consecutive noise samples
      v = (rand() - rand()) * 0.7 * Math.exp(-t * 80)
    }
    out[start + i] += v
  }
}

describe('drum transcription', () => {
  it('detects and classifies kick / snare / hat onsets', () => {
    const samples = new Float32Array(SR * 2)
    synthHit(samples, 0.25, 'kick')
    synthHit(samples, 0.75, 'snare')
    synthHit(samples, 1.25, 'hat')

    const onsets = detectDrumOnsets(samples, SR)
    expect(onsets.length).toBe(3)
    expect(Math.abs(onsets[0].timeSec - 0.25)).toBeLessThan(0.05)
    expect(Math.abs(onsets[1].timeSec - 0.75)).toBeLessThan(0.05)
    expect(Math.abs(onsets[2].timeSec - 1.25)).toBeLessThan(0.05)

    const key = (o: { pitches: { octave: number; letter: string }[] }) =>
      o.pitches.map((p) => `o${p.octave}${p.letter}`)
    expect(key(onsets[0])).toContain('o0a') // kick
    expect(key(onsets[1])).toContain('o3c') // snare
    expect(key(onsets[2])).toContain('o4c') // closed hat
  })

  it('produces a parseable Drumkit voice', () => {
    const samples = new Float32Array(SR * 2)
    for (const t of [0.25, 0.5, 0.75, 1.0]) synthHit(samples, t, 'kick')
    const voices = drumsToVoices(samples, SR, BPM)
    expect(voices.length).toBeGreaterThan(0)
    expect(voices[0].instrument).toBe('d')
    const parsed = parseLuting(`#lute ${BPM} id${voices[0].body}`)
    expect(parsed.notes.length).toBe(4)
    expect(parsed.notes.every((n) => n.drum === 'o0a')).toBe(true)
    expect(parsed.warnings).toHaveLength(0)
  })

  it('stays quiet on silence', () => {
    const samples = new Float32Array(SR)
    expect(detectDrumOnsets(samples, SR)).toHaveLength(0)
    expect(drumsToVoices(samples, SR, BPM)).toHaveLength(0)
  })
})
