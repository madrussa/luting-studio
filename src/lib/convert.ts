// MIDI file -> luting voices.
// Strategy: luting BPM = 4x song BPM so one t1 unit = a sixteenth note.
// Notes are quantized to that grid. Notes that start together with the same
// length become chords; remaining overlaps spill into extra voices. The GM
// drum channel maps onto the luteboi Drumkit.

import { Midi } from '@tonejs/midi'
import { midiToPitch, clampMidi, serializeVoiceBody, instrumentByCode } from './luting'
import type { VoiceEvent, Pitch } from './luting'

export interface ConvertedVoice {
  instrument: string
  body: string
  label: string
  noteCount: number
}

export interface ConvertResult {
  bpm: number
  voices: ConvertedVoice[]
  warnings: string[]
}

// GM program number -> luting instrument code
function gmToInstrument(program: number): string {
  if (program <= 7) return 'k' // pianos
  if (program === 14) return 'a' // tubular bells
  if (program <= 15) return 'i' // chromatic percussion -> vibraphone
  if (program === 22) return 'n' // harmonica
  if (program <= 23) return 'o' // organs
  if (program >= 29 && program <= 31) return 'j' // overdriven/distortion guitar
  if (program <= 31) return 'l' // guitars -> lute
  if (program === 36 || program === 37) return 'q' // slap bass
  if (program <= 39) return 'b' // basses
  if (program <= 51) return 'v' // strings & ensembles
  if (program <= 54) return 'e' // choirs
  if (program <= 55) return 'v' // orchestra hit
  if (program <= 63) return 'h' // brass
  if (program <= 71) return 's' // reeds
  if (program === 79) return 'g' // ocarina
  if (program <= 79) return 'f' // pipes
  if (program <= 87) return 'c' // synth leads -> chiptune
  if (program <= 95) return 'e' // pads -> choir
  if (program >= 112 && program <= 119) return 'p' // percussive
  return 'k'
}

// GM percussion key -> drumkit pitch (octave + letter)
const GM_DRUM: Record<number, Pitch> = {
  35: { octave: 0, letter: 'b' }, // acoustic bass drum -> hollow kick
  36: { octave: 0, letter: 'a' }, // bass drum -> kick
  37: { octave: 2, letter: 'a' }, // side stick -> rim
  38: { octave: 3, letter: 'c' }, // acoustic snare
  39: { octave: 3, letter: 'a' }, // hand clap
  40: { octave: 3, letter: 'c' }, // electric snare
  41: { octave: 1, letter: 'c' }, // low floor tom
  42: { octave: 4, letter: 'c' }, // closed hi-hat
  43: { octave: 1, letter: 'c' }, // high floor tom
  44: { octave: 4, letter: 'c' }, // pedal hi-hat
  45: { octave: 1, letter: 'a' }, // low tom
  46: { octave: 4, letter: 'a' }, // open hi-hat
  47: { octave: 1, letter: 'a' }, // low-mid tom
  48: { octave: 2, letter: 'c' }, // hi-mid tom
  49: { octave: 5, letter: 'd' }, // crash 1
  50: { octave: 2, letter: 'c' }, // high tom
  51: { octave: 5, letter: 'c' }, // ride 1
  52: { octave: 5, letter: 'd' }, // chinese cymbal
  53: { octave: 6, letter: 'c' }, // ride bell -> ding
  54: { octave: 5, letter: 'e' }, // tambourine
  55: { octave: 5, letter: 'd' }, // splash
  56: { octave: 5, letter: 'a' }, // cowbell
  57: { octave: 5, letter: 'd' }, // crash 2
  58: { octave: 1, letter: 'b' }, // vibraslap -> wood block
  59: { octave: 5, letter: 'c' }, // ride 2
  60: { octave: 2, letter: 'e' }, // hi bongo
  61: { octave: 2, letter: 'd' }, // low bongo
  62: { octave: 2, letter: 'e' }, // mute hi conga
  63: { octave: 2, letter: 'd' }, // open hi conga
  64: { octave: 1, letter: 'c' }, // low conga
  65: { octave: 2, letter: 'c' }, // high timbale
  66: { octave: 1, letter: 'a' }, // low timbale
  67: { octave: 5, letter: 'a' }, // high agogo
  68: { octave: 5, letter: 'a' }, // low agogo
  69: { octave: 5, letter: 'e' }, // cabasa
  70: { octave: 5, letter: 'e' }, // maracas
  75: { octave: 1, letter: 'd' }, // claves
  76: { octave: 1, letter: 'd' }, // hi wood block
  77: { octave: 1, letter: 'e' }, // low wood block
  80: { octave: 5, letter: 'f' }, // mute triangle
  81: { octave: 5, letter: 'g' }, // open triangle
}

interface QuantNote {
  start: number // grid units
  dur: number // grid units
  pitch: Pitch
  velocity: number
  isDrum: boolean
}

interface SubVoice {
  events: VoiceEvent[]
  nextFree: number
  velocities: number[]
}

/**
 * Greedy sub-voice allocation: each (start, dur, pitches) group goes to the
 * first sub-voice that is free at its start time; gaps become rests.
 */
function allocate(groups: { start: number; dur: number; pitches: Pitch[]; velocity: number }[]): SubVoice[] {
  const subs: SubVoice[] = []
  for (const g of groups.sort((a, b) => a.start - b.start)) {
    let sub = subs.find((s) => s.nextFree <= g.start)
    if (!sub) {
      sub = { events: [], nextFree: 0, velocities: [] }
      subs.push(sub)
    }
    if (g.start > sub.nextFree) {
      sub.events.push({ type: 'rest', pitches: [], duration: g.start - sub.nextFree })
    }
    sub.events.push({
      type: g.pitches.length > 1 ? 'chord' : 'note',
      pitches: g.pitches,
      duration: g.dur,
    })
    sub.velocities.push(g.velocity)
    sub.nextFree = g.start + g.dur
  }
  return subs
}

interface TimingPlan {
  lutingBpm: number
  /** quantize note (ticks for grid mode, seconds for estimated mode) -> grid units */
  toUnits: (note: { ticks: number; durationTicks: number; time: number; duration: number }) => {
    start: number
    dur: number
  }
}

/**
 * Decide how to map MIDI time onto the luting grid.
 *
 * Well-formed MIDIs put note onsets on their own tick grid; quantizing in
 * ticks is then exact (and immune to tempo changes). But some files store
 * events in real time under an arbitrary tempo stamp — their onsets sit
 * nowhere near the tick grid. For those, estimate the true grid unit directly
 * from the onsets and quantize in seconds.
 */
function planTiming(midi: Midi, warnings: string[]): TimingPlan {
  const ppq = midi.header.ppq
  const headerBpm = midi.header.tempos[0]?.bpm ?? 120
  const onsets: number[] = []
  const onsetTicks: number[] = []
  for (const t of midi.tracks) {
    for (const n of t.notes) {
      onsets.push(n.time)
      onsetTicks.push(n.ticks)
    }
  }

  // --- Path A: notes sit on the tick grid ---------------------------------
  const tol = Math.max(1, Math.round(ppq / 64))
  const alignedShare = (grid: number) => {
    let ok = 0
    for (const t of onsetTicks) {
      const m = t % grid
      if (m <= tol || grid - m <= tol) ok++
    }
    return ok / Math.max(1, onsetTicks.length)
  }
  // subdivisions per quarter note, coarsest first (16ths, triplet 8ths, 32nds...)
  for (const div of [4, 6, 8, 12]) {
    const grid = ppq / div
    if (alignedShare(grid) >= 0.9) {
      const lutingBpm = Math.round(headerBpm * div)
      if (div !== 4) {
        warnings.push(`Song uses subdivisions finer than sixteenths; grid set to 1/${div} of a beat (#lute ${lutingBpm}).`)
      }
      if (midi.header.tempos.length > 1) {
        warnings.push('This MIDI changes tempo mid-song; the luting plays everything at the first tempo.')
      }
      return {
        lutingBpm,
        toUnits: (n) => ({
          start: Math.max(0, Math.round(n.ticks / grid)),
          dur: Math.max(1, Math.round(n.durationTicks / grid)),
        }),
      }
    }
  }

  // --- Path B: off-grid file; estimate the grid from onset times ----------
  // Score candidate luting BPMs by how close onsets (relative to the first)
  // land to integer grid positions. Harmonics of the true grid also score
  // well, so take the slowest BPM within tolerance of the best score.
  const sorted = [...new Set(onsets.map((t) => Math.round(t * 1000)))].sort((a, b) => a - b).map((t) => t / 1000)
  const t0 = sorted[0] ?? 0
  const sample = sorted.filter((_, i) => i % Math.ceil(sorted.length / 1200) === 0)
  const err = (lutingBpm: number) => {
    const u = 60 / lutingBpm
    let sum = 0
    for (const t of sample) {
      const x = (t - t0) / u
      const d = Math.abs(x - Math.round(x))
      sum += d * d
    }
    return sum / sample.length
  }
  let bestBpm = Math.round(headerBpm * 4)
  let bestErr = Infinity
  for (let L = 160; L <= 1400; L++) {
    const e = err(L)
    if (e < bestErr) {
      bestErr = e
      bestBpm = L
    }
  }
  let lutingBpm = bestBpm
  for (let L = 160; L < bestBpm; L++) {
    if (err(L) <= bestErr * 1.3 + 1e-5) {
      lutingBpm = L
      break
    }
  }
  const unit = 60 / lutingBpm
  const lead = Math.max(0, Math.round(t0 / unit))
  warnings.push(
    `This MIDI's notes don't follow its own tempo grid (header says ${headerBpm.toFixed(1)} BPM); ` +
      `the real grid was estimated from the note timings instead (#lute ${lutingBpm} ≈ ${(lutingBpm / 4).toFixed(1)} BPM).`
  )
  return {
    lutingBpm,
    toUnits: (n) => ({
      start: lead + Math.max(0, Math.round((n.time - t0) / unit)),
      dur: Math.max(1, Math.round(n.duration / unit)),
    }),
  }
}

export async function convertMidi(buf: ArrayBuffer, maxVoices: number): Promise<ConvertResult> {
  const midi = new Midi(buf)
  const warnings: string[] = []
  const timing = planTiming(midi, warnings)
  const lutingBpm = timing.lutingBpm

  interface Candidate {
    instrument: string
    label: string
    sub: SubVoice
  }
  const candidates: Candidate[] = []

  for (const track of midi.tracks) {
    if (track.notes.length === 0) continue
    const isDrum = track.instrument.percussion || track.channel === 9

    const quantized: QuantNote[] = []
    for (const n of track.notes) {
      const { start, dur } = timing.toUnits(n)
      if (isDrum) {
        const pitch = GM_DRUM[n.midi]
        if (!pitch) continue
        // drum hits are short; keep them to 1 unit so voices stay free
        quantized.push({ start, dur: 1, pitch, velocity: n.velocity, isDrum })
      } else {
        quantized.push({ start, dur, pitch: midiToPitch(clampMidi(n.midi)), velocity: n.velocity, isDrum })
      }
    }
    if (quantized.length === 0) continue

    // Group simultaneous notes of equal duration into chords (melodic only;
    // drumkit octaves are fixed, so simultaneous drums go to separate voices).
    const groups: { start: number; dur: number; pitches: Pitch[]; velocity: number }[] = []
    if (isDrum) {
      // dedupe identical hits at the same instant
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
    const instrument = isDrum ? 'd' : gmToInstrument(track.instrument.number)
    const baseLabel = track.name?.trim() || instrumentByCode(instrument)?.name || 'Track'
    subs.forEach((sub, k) => {
      candidates.push({
        instrument,
        label: subs.length > 1 ? `${baseLabel} ${k + 1}` : baseLabel,
        sub,
      })
    })
  }

  if (candidates.length === 0) {
    warnings.push('No convertible notes found in this MIDI file.')
    return { bpm: lutingBpm, voices: [], warnings }
  }

  // Keep the busiest voices if we exceed the cap.
  let kept = candidates
  if (candidates.length > maxVoices) {
    kept = [...candidates]
      .sort((a, b) => b.sub.velocities.length - a.sub.velocities.length)
      .slice(0, maxVoices)
    // restore original ordering for a stable layout
    kept = candidates.filter((c) => kept.includes(c))
    warnings.push(
      `Song needed ${candidates.length} voices; kept the ${maxVoices} busiest. Raise "max voices" to keep more.`
    )
  }

  const voices: ConvertedVoice[] = kept.map((c) => {
    const avgVel = c.sub.velocities.reduce((a, b) => a + b, 0) / c.sub.velocities.length
    const vol = Math.min(10, Math.max(1, Math.round(avgVel * 10)))
    return {
      instrument: c.instrument,
      body: serializeVoiceBody(c.sub.events, { volume: vol < 10 ? vol : undefined }),
      label: c.label,
      noteCount: c.sub.velocities.length,
    }
  })

  return { bpm: lutingBpm, voices, warnings }
}
