// Chord progression generator: roman-numeral presets realized as triads in
// the song's key, serialized as a comping voice for the board. Keys are the
// app's flat major keys (see keys.ts); voicings sit around o3 where the
// keyboard/organ comp well under a melody.

import type { Pitch, VoiceEvent } from './luting'
import { midiToPitch, serializeVoiceBody } from './luting'

export interface Progression {
  id: string
  label: string
  numerals: string[]
}

export const PROGRESSIONS: Progression[] = [
  { id: 'pop', label: 'Pop · I–V–vi–IV', numerals: ['I', 'V', 'vi', 'IV'] },
  { id: 'fifties', label: '50s · I–vi–IV–V', numerals: ['I', 'vi', 'IV', 'V'] },
  { id: 'jazz', label: 'Jazz turnaround · ii–V–I', numerals: ['ii', 'V', 'I', 'I'] },
  { id: 'folk', label: 'Folk · I–IV–V–I', numerals: ['I', 'IV', 'V', 'I'] },
  {
    id: 'canon',
    label: 'Canon · I–V–vi–iii–IV–I–IV–V',
    numerals: ['I', 'V', 'vi', 'iii', 'IV', 'I', 'IV', 'V'],
  },
  {
    id: 'blues',
    label: '12-bar blues',
    numerals: ['I', 'I', 'I', 'I', 'IV', 'IV', 'I', 'I', 'V', 'IV', 'I', 'V'],
  },
]

export const progressionById = (id: string): Progression => PROGRESSIONS.find((p) => p.id === id) ?? PROGRESSIONS[0]

// tonic pitch class per key id (flat major keys + C)
const TONIC_PC: Record<string, number> = { C: 0, F: 5, Bb: 10, Eb: 3, Ab: 8, Db: 1, Gb: 6 }

// major-scale roman numerals -> semitones above tonic + chord quality
const DEGREES: Record<string, { semis: number; minor?: boolean }> = {
  I: { semis: 0 },
  ii: { semis: 2, minor: true },
  iii: { semis: 4, minor: true },
  IV: { semis: 5 },
  V: { semis: 7 },
  vi: { semis: 9, minor: true },
}

export interface ProgressionOptions {
  /** length of each numeral's slot, in grid units (16 = one bar) */
  unitsPerChord?: number
  /** re-strike the chord every N units instead of holding it (null = hold) */
  pulse?: number | null
  /** times through the whole progression */
  repeats?: number
}

export function progressionBody(keyId: string, progressionId: string, opts: ProgressionOptions = {}): string {
  const { unitsPerChord = 16, pulse = null, repeats = 1 } = opts
  const tonic = 48 + (TONIC_PC[keyId] ?? 0) // root around o3
  const events: VoiceEvent[] = []
  for (let rep = 0; rep < Math.max(1, repeats); rep++) {
    for (const num of progressionById(progressionId).numerals) {
      const d = DEGREES[num]
      if (!d) continue
      const root = tonic + d.semis
      const pitches: Pitch[] = [root, root + (d.minor ? 3 : 4), root + 7].map(midiToPitch)
      if (pulse) {
        for (let p = 0; p < unitsPerChord; p += pulse) {
          events.push({ type: 'chord', pitches, duration: Math.min(pulse, unitsPerChord - p) })
        }
      } else {
        events.push({ type: 'chord', pitches, duration: unitsPerChord })
      }
    }
  }
  return serializeVoiceBody(events)
}
