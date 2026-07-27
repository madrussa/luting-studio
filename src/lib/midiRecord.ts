// Live MIDI recording -> luting voices.
// Notes are captured with real timestamps while the player plays, then
// quantized to the luting grid (one t1 unit = 60/bpm seconds — a sixteenth
// when the luting BPM is 4x the song BPM, as this app's convention has it).
// The grid is anchored at the first note that lands in the take, so there's no
// count-in: press record, start playing whenever, and the take begins on your
// first note.
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
  device: string
}

export interface MidiRecorder {
  noteOn: (midi: number, velocity: number, timeMs: number, device?: string) => void
  noteOff: (midi: number, timeMs: number, device?: string) => void
  /** notes captured so far (open ones included) */
  noteCount: () => number
  /** true once the first note-on has arrived (the grid anchor) */
  started: () => boolean
  /** close any held notes and quantize the take into voices */
  finish: (timeMs: number) => RecordResult
}

export interface RecorderOptions {
  /**
   * Explicit grid zero on the MIDI timestamp clock (performance.now()).
   * Set by the metronome count-in and by overdub (playback start); without
   * it the grid anchors on the first note-on. Notes released before the
   * anchor (count-in noodling) are dropped; notes held across it start at 0.
   */
  anchorMs?: number
}

export function createMidiRecorder(lutingBpm: number, instrument: string, opts: RecorderOptions = {}): MidiRecorder {
  const unitMs = 60000 / Math.max(1, lutingBpm)
  // keyed by device+key, not key alone: with two controllers connected, a
  // press on one used to close the other's still-held note of the same pitch
  const open = new Map<string, { midi: number; onMs: number; velocity: number; device: string }>()
  const done: TakenNote[] = []
  let anchor: number | null = opts.anchorMs ?? null

  const openKey = (device: string, midi: number) => `${device}:${midi}`

  const close = (device: string, midi: number, timeMs: number) => {
    const key = openKey(device, midi)
    const o = open.get(key)
    if (!o) return
    open.delete(key)
    done.push({ midi: o.midi, onMs: o.onMs, offMs: timeMs, velocity: o.velocity, device: o.device })
  }

  return {
    noteOn(midi, velocity, timeMs, device = 'default') {
      if (anchor === null) anchor = timeMs
      close(device, midi, timeMs) // retrigger of a held key ends the first press
      open.set(openKey(device, midi), { midi, onMs: timeMs, velocity, device })
    },
    noteOff(midi, timeMs, device = 'default') {
      close(device, midi, timeMs)
    },
    noteCount: () => done.length + open.size,
    started: () => anchor !== null,
    finish(timeMs) {
      for (const key of [...open.values()]) close(key.device, key.midi, timeMs)
      const warnings: string[] = []
      if (done.length === 0 || anchor === null) {
        return { voices: [], warnings: ['Nothing was recorded — no notes arrived.'] }
      }

      const isDrum = instrument === 'd'
      const explicitAnchor = opts.anchorMs !== undefined

      // Resolve pitches before choosing grid zero. Drum mapping can drop a
      // note entirely, and with several devices connected a stray note-on from
      // one of them (a pad waking up, a controller echoing) can easily be the
      // take's first event — anchoring on it and then dropping it left the
      // whole performance behind a wall of leading rests.
      const unmapped = new Set<number>()
      const kept: { onMs: number; offMs: number; pitch: Pitch; velocity: number; device: string }[] = []
      for (const n of done) {
        if (explicitAnchor && n.offMs <= anchor) continue // released during the count-in
        let pitch: Pitch
        if (isDrum) {
          // GM drum note if the pad sends one, else the luteboi drum-map pitch
          pitch = GM_DRUM[n.midi] ?? midiToPitch(n.midi)
          if (!DRUM_SOUNDS[`o${pitch.octave}${pitch.letter[0]}`]) {
            unmapped.add(n.midi)
            continue
          }
        } else {
          pitch = midiToPitch(clampMidi(n.midi))
        }
        kept.push({ onMs: n.onMs, offMs: n.offMs, pitch, velocity: n.velocity, device: n.device })
      }
      if (unmapped.size > 0) {
        warnings.push(`${unmapped.size} drum key${unmapped.size === 1 ? '' : 's'} had no luteboi drum sound and were skipped.`)
      }
      if (kept.length === 0) {
        return { voices: [], warnings: [...warnings, 'Nothing was recorded — no notes survived the drum mapping.'] }
      }

      // Without an explicit grid zero the take starts on its first *surviving*
      // note, so a dropped or stray lead-in can't shift everything late.
      const gridZero = explicitAnchor ? anchor : Math.min(...kept.map((k) => k.onMs))
      const sources = new Set(kept.map((k) => k.device))
      if (sources.size > 1) {
        warnings.push(
          `Notes came from ${sources.size} devices — pick one in the Device menu if the take isn't what you played.`
        )
      }

      const quantized: { start: number; dur: number; pitch: Pitch; velocity: number }[] = []
      for (const k of kept) {
        const onMs = Math.max(k.onMs, gridZero) // held across the anchor -> starts at 0
        const start = Math.max(0, Math.round((onMs - gridZero) / unitMs))
        if (isDrum) {
          quantized.push({ start, dur: 1, pitch: k.pitch, velocity: k.velocity })
        } else {
          const dur = Math.max(1, Math.round((k.offMs - onMs) / unitMs))
          quantized.push({ start, dur, pitch: k.pitch, velocity: k.velocity })
        }
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
