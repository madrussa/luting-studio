// Transcribed note events (seconds-based, from Basic Pitch) -> luting voices.
// Mirrors the melodic path of the MIDI converter: quantize onto the luting
// grid, group simultaneous equal-length notes into chords, spill remaining
// overlaps into extra sub-voices.

import { allocate, gridPhase } from '../convert'
import type { ConvertedVoice } from '../convert'
import { midiToPitch, clampMidi, serializeVoiceBody, instrumentByCode } from '../luting'
import type { Pitch } from '../luting'

export interface StemNote {
  startSec: number
  durSec: number
  midi: number
  /** 0..1 */
  amplitude: number
}

/**
 * Drop transcription ghosts: notes far quieter than the stem's typical note
 * are almost always harmonics the model half-heard, and every one of them
 * would render as a full pluck.
 */
export function dropQuietNotes(notes: StemNote[]): StemNote[] {
  if (notes.length === 0) return notes
  const amps = notes.map((n) => n.amplitude).sort((a, b) => a - b)
  const median = amps[Math.floor(amps.length / 2)]
  const floor = Math.max(0.1, median * 0.35)
  return notes.filter((n) => n.amplitude >= floor)
}

/**
 * Suppress octave doubles: the transcriber often reports a note's octave (or
 * double-octave) harmonic as a second, quieter simultaneous note.
 */
export function suppressOctaveGhosts(notes: StemNote[]): StemNote[] {
  const sorted = [...notes].sort((a, b) => a.startSec - b.startSec)
  const drop = new Set<StemNote>()
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]
    for (let j = i + 1; j < sorted.length && sorted[j].startSec < a.startSec + a.durSec; j++) {
      const b = sorted[j]
      const interval = Math.abs(a.midi - b.midi)
      if (interval !== 12 && interval !== 24) continue
      const overlap = Math.min(a.startSec + a.durSec, b.startSec + b.durSec) - Math.max(a.startSec, b.startSec)
      if (overlap < 0.5 * Math.min(a.durSec, b.durSec)) continue
      const [lo, hi] = a.midi < b.midi ? [a, b] : [b, a]
      if (hi.amplitude < lo.amplitude * 0.6) drop.add(hi)
    }
  }
  return sorted.filter((n) => !drop.has(n))
}

/**
 * Reduce to a single line (for vocals): at any moment keep the strongest
 * note, and absorb the semitone flicker a singer's vibrato/slides produce
 * into the neighbouring longer note.
 */
export function monophonicReduce(notes: StemNote[]): StemNote[] {
  const sorted = [...notes].sort((a, b) => a.startSec - b.startSec || b.amplitude - a.amplitude)
  const line: StemNote[] = []
  for (const n of sorted) {
    const cur = line[line.length - 1]
    if (!cur || n.startSec >= cur.startSec + cur.durSec - 1e-9) {
      line.push({ ...n })
    } else if (n.amplitude > cur.amplitude * 1.2) {
      cur.durSec = Math.max(0.02, n.startSec - cur.startSec)
      line.push({ ...n })
    } // else: weaker overlapping note — drop
  }
  // absorb short blips within 2 semitones of the previous note
  const out: StemNote[] = []
  for (const n of line) {
    const prev = out[out.length - 1]
    if (
      prev &&
      n.durSec <= 0.13 &&
      Math.abs(n.midi - prev.midi) <= 2 &&
      n.startSec - (prev.startSec + prev.durSec) <= 0.08
    ) {
      prev.durSec = n.startSec + n.durSec - prev.startSec
      prev.amplitude = Math.max(prev.amplitude, n.amplitude)
    } else {
      out.push(n)
    }
  }
  return out.filter((n) => n.durSec >= 0.06)
}

/**
 * Re-join sustained notes the transcriber chopped up: a decaying or wobbling
 * sustain dips under the frame threshold and comes back as several fragments
 * of the same pitch. Fragments closer than maxGapSec become one long note.
 */
export function mergeSustains(notes: StemNote[], maxGapSec: number): StemNote[] {
  const sorted = [...notes].sort((a, b) => a.midi - b.midi || a.startSec - b.startSec)
  const out: StemNote[] = []
  for (const n of sorted) {
    const prev = out[out.length - 1]
    if (prev && prev.midi === n.midi && n.startSec - (prev.startSec + prev.durSec) <= maxGapSec) {
      prev.durSec = Math.max(prev.durSec, n.startSec + n.durSec - prev.startSec)
      prev.amplitude = Math.max(prev.amplitude, n.amplitude)
    } else {
      out.push({ ...n })
    }
  }
  return out.sort((a, b) => a.startSec - b.startSec || a.midi - b.midi)
}

export function notesToVoices(
  notes: StemNote[],
  lutingBpm: number,
  instrument: string,
  label: string,
  opts: { maxVoices?: number; volume?: number; gridOffsetSec?: number } = {}
): ConvertedVoice[] {
  const maxVoices = opts.maxVoices ?? 4
  if (notes.length === 0) return []
  const unit = 60 / lutingBpm
  // The phase comes from the whole mix, not from this stem: every stem has to
  // quantize against the same grid or they land out of step with each other.
  const phase = gridPhase(opts.gridOffsetSec ?? 0, unit)

  interface Quant {
    start: number
    dur: number
    pitch: Pitch
    velocity: number
  }
  const quantized: Quant[] = []
  for (const n of notes) {
    const start = Math.max(0, Math.round((n.startSec - phase) / unit))
    const dur = Math.max(1, Math.round(n.durSec / unit))
    quantized.push({ start, dur, pitch: midiToPitch(clampMidi(n.midi)), velocity: n.amplitude })
  }

  // simultaneous equal-length notes become chords
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

  let subs = allocate([...byKey.values()])
  // a spill-over voice holding a stray note or two is clutter, not music
  if (subs.length > 1) {
    const solid = subs.filter((s) => s.velocities.length >= 3)
    if (solid.length > 0) subs = solid
  }
  if (subs.length > maxVoices) {
    // keep the busiest sub-voices, in stable order
    const keep = new Set(
      [...subs].sort((a, b) => b.velocities.length - a.velocities.length).slice(0, maxVoices)
    )
    subs = subs.filter((s) => keep.has(s))
  }

  const baseLabel = label || instrumentByCode(instrument)?.name || 'Stem'
  return subs.map((sub, k) => {
    const avgVel = sub.velocities.reduce((a, b) => a + b, 0) / sub.velocities.length
    const vol = opts.volume ?? Math.min(10, Math.max(1, Math.round(avgVel * 10)))
    return {
      instrument,
      body: serializeVoiceBody(sub.events, { volume: vol < 10 ? vol : undefined }),
      label: subs.length > 1 ? `${baseLabel} ${k + 1}` : baseLabel,
      noteCount: sub.velocities.length,
    }
  })
}
