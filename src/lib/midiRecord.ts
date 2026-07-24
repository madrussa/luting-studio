// Live MIDI recording -> luting voices.
// Notes are captured with real timestamps while the player plays, then
// quantized to the luting grid (one t1 unit = 60/bpm seconds — a sixteenth
// when the luting BPM is 4x the song BPM, as this app's convention has it).
// The grid is anchored at the FIRST note-on, so there's no count-in: press
// record, start playing whenever, and the take begins on your first note.
// Mirrors the MIDI-file converter: simultaneous equal-length notes become
// chords, remaining overlaps spill into extra voices.

import { clampMidi, midiToPitch, instrumentByCode, serializeVoiceBody, DRUM_SOUNDS } from './luting'
import type { Pitch } from './luting'
import { GM_DRUM, allocate } from './convert'

export interface RecordedVoice {
  instrument: string
  body: string
  label: string
  noteCount: number
}

export interface RecordResult {
  voices: RecordedVoice[]
  warnings: string[]
}

interface TakenNote {
  midi: number
  onMs: number
  offMs: number
  velocity: number
}

export interface MidiRecorder {
  noteOn: (midi: number, velocity: number, timeMs: number) => void
  noteOff: (midi: number, timeMs: number) => void
  /** notes captured so far (open ones included) */
  noteCount: () => number
  /** true once the first note-on has arrived (the grid anchor) */
  started: () => boolean
  /** close any held notes and quantize the take into voices */
  finish: (timeMs: number) => RecordResult
}

export function createMidiRecorder(lutingBpm: number, instrument: string): MidiRecorder {
  const unitMs = 60000 / Math.max(1, lutingBpm)
  const open = new Map<number, { onMs: number; velocity: number }>()
  const done: TakenNote[] = []
  let anchor: number | null = null

  const close = (midi: number, timeMs: number) => {
    const o = open.get(midi)
    if (!o) return
    open.delete(midi)
    done.push({ midi, onMs: o.onMs, offMs: timeMs, velocity: o.velocity })
  }

  return {
    noteOn(midi, velocity, timeMs) {
      if (anchor === null) anchor = timeMs
      close(midi, timeMs) // retrigger of a held key ends the first press
      open.set(midi, { onMs: timeMs, velocity })
    },
    noteOff(midi, timeMs) {
      close(midi, timeMs)
    },
    noteCount: () => done.length + open.size,
    started: () => anchor !== null,
    finish(timeMs) {
      for (const midi of [...open.keys()]) close(midi, timeMs)
      const warnings: string[] = []
      if (done.length === 0 || anchor === null) {
        return { voices: [], warnings: ['Nothing was recorded — no notes arrived.'] }
      }

      const isDrum = instrument === 'd'
      const quantized: { start: number; dur: number; pitch: Pitch; velocity: number }[] = []
      const unmapped = new Set<number>()
      for (const n of done) {
        const start = Math.max(0, Math.round((n.onMs - anchor) / unitMs))
        if (isDrum) {
          // GM drum note if the pad sends one, else the luteboi drum-map pitch
          const pitch = GM_DRUM[n.midi] ?? midiToPitch(n.midi)
          if (!DRUM_SOUNDS[`o${pitch.octave}${pitch.letter[0]}`]) {
            unmapped.add(n.midi)
            continue
          }
          quantized.push({ start, dur: 1, pitch, velocity: n.velocity })
        } else {
          const dur = Math.max(1, Math.round((n.offMs - n.onMs) / unitMs))
          quantized.push({ start, dur, pitch: midiToPitch(clampMidi(n.midi)), velocity: n.velocity })
        }
      }
      if (unmapped.size > 0) {
        warnings.push(`${unmapped.size} drum key${unmapped.size === 1 ? '' : 's'} had no luteboi drum sound and were skipped.`)
      }
      if (quantized.length === 0) {
        return { voices: [], warnings: [...warnings, 'Nothing was recorded — no notes survived the drum mapping.'] }
      }

      // Group simultaneous equal-length notes into chords (melodic only; the
      // drumkit's octaves are fixed, so simultaneous drums get separate voices).
      const groups: { start: number; dur: number; pitches: Pitch[]; velocity: number }[] = []
      if (isDrum) {
        const seen = new Set<string>()
        for (const q of quantized) {
          const key = `${q.start}:o${q.pitch.octave}${q.pitch.letter}`
          if (seen.has(key)) continue
          seen.add(key)
          groups.push({ start: q.start, dur: 1, pitches: [q.pitch], velocity: q.velocity })
        }
      } else {
        const byKey = new Map<string, { start: number; dur: number; pitches: Pitch[]; velocity: number }>()
        for (const q of quantized) {
          const key = `${q.start}:${q.dur}`
          const g = byKey.get(key)
          if (g) {
            g.pitches.push(q.pitch)
            g.velocity = Math.max(g.velocity, q.velocity)
          } else {
            byKey.set(key, { start: q.start, dur: q.dur, pitches: [q.pitch], velocity: q.velocity })
          }
        }
        groups.push(...byKey.values())
      }

      const subs = allocate(groups)
      if (subs.length > 1) {
        warnings.push(`Overlapping notes were split into ${subs.length} voices.`)
      }
      const baseLabel = `${instrumentByCode(instrument)?.name ?? 'Voice'} (MIDI)`
      const voices: RecordedVoice[] = subs.map((sub, k) => {
        const avgVel = sub.velocities.reduce((a, b) => a + b, 0) / sub.velocities.length
        const vol = Math.min(10, Math.max(1, Math.round(avgVel * 10)))
        return {
          instrument,
          body: serializeVoiceBody(sub.events, { volume: vol < 10 ? vol : undefined }),
          label: subs.length > 1 ? `${baseLabel} ${k + 1}` : baseLabel,
          noteCount: sub.velocities.length,
        }
      })
      return { voices, warnings }
    },
  }
}
