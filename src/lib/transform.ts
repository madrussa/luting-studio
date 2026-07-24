// Shared note-list -> voice-body transforms, used by the piano-roll editor
// and the per-voice transpose buttons.

import { serializeVoiceBody, midiToPitch } from './luting'
import type { VoiceEvent, Pitch, ScheduledNote } from './luting'

export interface RollNote {
  start: number
  dur: number
  midi?: number
  drum?: string
}

export const drumKeyToPitch = (key: string): Pitch => ({ octave: parseInt(key[1], 10), letter: key.slice(2) })

/** Group simultaneous equal-length notes into chords and fill gaps with rests. */
export function notesToEvents(notes: RollNote[], isDrum: boolean): VoiceEvent[] {
  const groups = new Map<string, { start: number; dur: number; pitches: Pitch[] }>()
  for (const n of notes) {
    const key = `${n.start}:${n.dur}`
    const pitch = isDrum ? drumKeyToPitch(n.drum!) : midiToPitch(n.midi!)
    const g = groups.get(key)
    if (g) g.pitches.push(pitch)
    else groups.set(key, { start: n.start, dur: n.dur, pitches: [pitch] })
  }
  const events: VoiceEvent[] = []
  let cursor = 0
  for (const g of [...groups.values()].sort((a, b) => a.start - b.start)) {
    if (g.start < cursor) continue
    if (g.start > cursor) events.push({ type: 'rest', pitches: [], duration: g.start - cursor })
    events.push({ type: g.pitches.length > 1 ? 'chord' : 'note', pitches: g.pitches, duration: g.dur })
    cursor = g.start + g.dur
  }
  return events
}

/** The most common per-note volume, as serializeVoiceBody's v1-9 option. */
export function dominantVolume(notes: ScheduledNote[]): number | undefined {
  const counts = new Map<number, number>()
  for (const n of notes) counts.set(n.volume, (counts.get(n.volume) ?? 0) + 1)
  let volume = 1
  let best = -1
  for (const [v, c] of counts) {
    if (c > best) {
      best = c
      volume = v
    }
  }
  const v = Math.round(volume * 10)
  return v >= 1 && v <= 9 ? v : undefined
}

export function scheduledToRollNotes(notes: ScheduledNote[], bpm: number): RollNote[] {
  const unit = 60 / bpm
  return notes.map((n) => ({
    start: Math.round(n.timeSec / unit),
    dur: Math.max(1, Math.round(n.durSec / unit)),
    midi: n.midi,
    drum: n.drum,
  }))
}

/**
 * Which note (by emission order) sits at a caret position in a voice body.
 * Chords map to all their pitches. Returns null when the caret isn't on a
 * note, or when the body uses macros/tempo changes (ordinal mapping would be
 * unreliable there).
 */
export function locateNoteAt(body: string, caret: number): { from: number; count: number } | null {
  if (/[A-Z@~]/.test(body)) return null
  const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9'
  let i = 0
  let noteIdx = 0
  const readFraction = () => {
    while (isDigit(body[i])) i++
    if (body[i] === '/') {
      i++
      while (isDigit(body[i])) i++
    }
  }
  while (i < body.length) {
    const c = body[i]
    const tokStart = i
    if (c === 'i') {
      i += 2
    } else if (c === 'o') {
      i++
      if (isDigit(body[i])) i++
    } else if (c === 'v' || c === 's') {
      i++
      if (body[i] >= '1' && body[i] <= '9') i++
    } else if (c === 't' || c === 'r') {
      i++
      readFraction()
    } else if (c >= 'a' && c <= 'g') {
      i++
      if (body[i] === "'") i++
      readFraction()
      if (caret >= tokStart && caret <= i) return { from: noteIdx, count: 1 }
      noteIdx++
    } else if (c === '(') {
      let letters = 0
      i++
      while (i < body.length && body[i] !== ')') {
        if (body[i] >= 'a' && body[i] <= 'g') letters++
        i++
      }
      if (body[i] === ')') i++
      readFraction()
      if (caret >= tokStart && caret <= i) return { from: noteIdx, count: letters }
      noteIdx += letters
    } else {
      i++
    }
  }
  return null
}

/**
 * Swing (or straighten) a voice's eighth pairs. In this app's convention one
 * t1 unit is a sixteenth, so an eighth is 2 units and a swing pair becomes
 * 5/2 + 3/2 (the classic long-short triplet feel; it's the same notation the
 * Help table documents). Everything runs on a half-unit integer grid so the
 * math is exact:
 *   - an on-beat eighth extends to 5 halves (when there's room),
 *   - an off-beat eighth shifts late and shrinks to 3 halves,
 *   - a short off-beat hit (e.g. a drum hat, 1 unit) just shifts late.
 * Notes that don't sit on eighth positions are left alone, and the result is
 * validated to stay non-overlapping — if anything would collide, the voice is
 * returned unchanged (null = nothing to do / can't apply).
 */
export function swingBody(
  parsedNotes: ScheduledNote[],
  bpm: number,
  mode: 'swing' | 'straighten',
  isDrum: boolean
): string | null {
  if (parsedNotes.length === 0) return null
  const half = 60 / bpm / 2

  // group simultaneous equal-length notes into chord events on the half grid
  const groups = new Map<string, { start: number; dur: number; notes: ScheduledNote[] }>()
  for (const n of parsedNotes) {
    const start = Math.round(n.timeSec / half)
    const dur = Math.max(1, Math.round(n.durSec / half))
    const key = `${start}:${dur}`
    const g = groups.get(key)
    if (g) g.notes.push(n)
    else groups.set(key, { start, dur, notes: [n] })
  }
  const evs = [...groups.values()].sort((a, b) => a.start - b.start)

  let changed = false
  const orig = evs.map((e) => ({ start: e.start, dur: e.dur }))
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i]
    const o = orig[i]
    const next = orig[i + 1]
    if (mode === 'swing') {
      if (o.start % 8 === 0 && o.dur === 4 && (!next || next.start >= o.start + 5 || (next.start === o.start + 4 && next.dur === 4))) {
        e.dur = 5
        changed = true
      } else if (o.start % 8 === 4 && o.dur === 4) {
        e.start += 1
        e.dur = 3
        changed = true
      } else if (o.start % 8 === 4 && o.dur < 4 && (!next || next.start >= o.start + o.dur + 1)) {
        e.start += 1 // short off-beat hit: just play it late
        changed = true
      }
    } else {
      if (o.start % 8 === 0 && o.dur === 5) {
        e.dur = 4
        changed = true
      } else if (o.start % 8 === 5 && o.dur === 3) {
        e.start -= 1
        e.dur = 4
        changed = true
      } else if (o.start % 8 === 5 && o.dur < 3) {
        e.start -= 1
        changed = true
      }
    }
  }
  if (!changed) return null
  for (let i = 1; i < evs.length; i++) {
    if (evs[i - 1].start + evs[i - 1].dur > evs[i].start) return null // would collide
  }

  const events: VoiceEvent[] = []
  let cursor = 0
  for (const g of evs) {
    if (g.start > cursor) events.push({ type: 'rest', pitches: [], duration: (g.start - cursor) / 2 })
    const pitches = g.notes.map((n) => (isDrum ? drumKeyToPitch(n.drum!) : midiToPitch(n.midi!)))
    events.push({ type: pitches.length > 1 ? 'chord' : 'note', pitches, duration: g.dur / 2 })
    cursor = g.start + g.dur
  }
  return serializeVoiceBody(events, { volume: dominantVolume(parsedNotes) })
}

/**
 * Shift every pitch in a voice by N semitones and re-serialize its body.
 * Returns null if any note would leave the playable o1–o7 range.
 */
export function transposeBody(parsedNotes: ScheduledNote[], bpm: number, semitones: number): string | null {
  const rollNotes = scheduledToRollNotes(parsedNotes, bpm)
  for (const n of rollNotes) {
    if (n.midi === undefined) return null // drums don't transpose
    n.midi += semitones
    if (n.midi < 24 || n.midi > 107) return null
  }
  return serializeVoiceBody(notesToEvents(rollNotes, false), { volume: dominantVolume(parsedNotes) })
}
