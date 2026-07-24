// Luting -> standard MIDI file, the reverse of convert.ts. One track per
// voice, drum voices on the GM percussion channel, song tempo = #lute / 4
// (the app's convention: one t1 unit is a sixteenth).

import { Midi } from '@tonejs/midi'
import { parseLuting } from './luting'
import type { Pitch } from './luting'
import { GM_DRUM } from './convert'

// Instrument code -> representative GM program (reverse of gmToInstrument's
// buckets; picked as the most idiomatic member of each bucket).
const GM_PROGRAM: Record<string, number> = {
  l: 24, // lute -> acoustic guitar (nylon)
  b: 32, // bass -> acoustic bass
  f: 73, // flute
  k: 0, // keyboard -> acoustic grand
  c: 80, // chiptune -> square lead
  m: 52, // the cat -> choir aahs (closest vocal-ish patch)
  t: 52, // the bean -> choir aahs
  p: 115, // percussion -> woodblock
  a: 14, // bell -> tubular bells
  o: 19, // organ -> church organ
  e: 52, // choir aahs
  v: 48, // violin -> string ensemble
  g: 79, // ocarina
  h: 60, // horn -> french horn
  i: 11, // vibraphone
  j: 29, // overdriven guitar
  s: 65, // sax -> alto sax
  n: 22, // harmonica
  q: 36, // slap bass 1
}

// drum key (o0a, o3c, …) -> GM percussion note; first GM_DRUM entry wins so
// round-tripping a converted MIDI lands back on the same drums.
const DRUM_GM: Record<string, number> = {}
for (const [gm, p] of Object.entries(GM_DRUM) as unknown as [string, Pitch][]) {
  const key = `o${p.octave}${p.letter}`
  if (!(key in DRUM_GM)) DRUM_GM[key] = parseInt(gm, 10)
}

export function exportMidi(luting: string, labels: string[] = []): Uint8Array {
  const parsed = parseLuting(luting)
  const midi = new Midi()
  midi.header.setTempo(parsed.bpm / 4)

  const byVoice = new Map<number, typeof parsed.notes>()
  for (const n of parsed.notes) {
    const list = byVoice.get(n.voice) ?? []
    list.push(n)
    byVoice.set(n.voice, list)
  }

  for (const [vi, notes] of [...byVoice.entries()].sort((a, b) => a[0] - b[0])) {
    const isDrum = notes.some((n) => n.drum)
    const track = midi.addTrack()
    track.name = labels[vi] ?? `Voice ${vi + 1}`
    const ch = vi % 15 // 16 channels, one reserved for drums
    track.channel = isDrum ? 9 : ch >= 9 ? ch + 1 : ch // melodic voices skip the drum channel
    track.instrument.number = isDrum ? 0 : (GM_PROGRAM[notes[0].instrument] ?? 0)
    for (const n of notes) {
      const pitch = n.drum ? DRUM_GM[n.drum] : n.midi
      if (pitch === undefined) continue
      track.addNote({
        midi: pitch,
        time: n.timeSec,
        duration: Math.max(0.01, n.durSec),
        velocity: Math.min(1, Math.max(0.05, n.volume)),
      })
    }
  }
  return midi.toArray()
}
