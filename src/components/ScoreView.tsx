// Engraved score of the whole luting, rendered with VexFlow (lazy-loaded):
// one labelled part per voice, 4/4 measures (16 grid units), beams, rests,
// dots, ties across splits and barlines, and flat accidentals. Read-only —
// editing lives in the grid/staff editors.

import { useEffect, useRef, useState } from 'react'
import type { ParseResult } from '../lib/luting'
import { scheduledToRollNotes } from '../lib/transform'
import { midiToPitch } from '../lib/luting'
import { useBackdropClose } from '../lib/useBackdropClose'
import type { Lane } from './Timeline'
import { X, Loader2 } from 'lucide-react'

const UNITS_PER_MEASURE = 16
const MEASURE_W = 260
const LINE_H = 110
const MAX_MEASURES = 160

interface Props {
  open: boolean
  onClose: () => void
  parsed: ParseResult | null
  lanes: Lane[]
}

interface Chunk {
  keys: string[] | null // VexFlow key specs; null = rest
  duration: string
  dots: number
  tieToNext: boolean
  measure: number
}

// Drumkit sounds -> percussion-staff positions (GM-style convention):
// membranes as normal heads (kick low, toms middle, snare third space),
// metals and woodblocks as x-heads at the top.
const DRUM_STAFF: Record<string, string> = {
  o0a: 'f/4', // kick
  o0b: 'e/4', // hollow kick
  o1c: 'a/4', // low tom
  o1a: 'b/4', // mid tom
  o2c: 'd/5', // high tom
  o2d: 'e/5', // bongo low
  o2e: 'f/5', // bongo high
  o3c: 'c/5', // snare
  o3d: 'c/5/x2', // snare with brush
  o2a: 'c/5/x2', // rim
  o3a: 'd/5/x2', // clap
  o1d: 'e/5/x2', // wood blocks
  o1e: 'e/5/x2',
  o1f: 'e/5/x2',
  o1g: 'e/5/x2',
  o1b: 'e/5/x2',
  o4c: 'g/5/x2', // closed hi-hat
  o4a: 'g/5/x2', // open hi-hat
  o5c: 'f/5/x2', // cymbal (ride)
  o5d: 'a/5/x2', // crash
  o5e: 'd/5/x2', // tambourine
  o5a: 'e/5/x2', // cowbell
  o5f: 'b/5/x2', // triangle low
  o5g: 'b/5/x2', // triangle high
  o6c: 'b/5/x2', // ding
}

// greedy split into standard engravable durations (units at 16ths)
const SPLITS: [number, string, number][] = [
  [16, 'w', 0],
  [12, 'h', 1],
  [8, 'h', 0],
  [6, 'q', 1],
  [4, 'q', 0],
  [3, '8', 1],
  [2, '8', 0],
  [1, '16', 0],
]

/** voice notes (grid units, as VexFlow keys) -> engravable chunks split at barlines */
function buildChunks(items: { start: number; dur: number; key: string }[]): Chunk[] {
  // group simultaneous equal-length notes into chords
  const groups = new Map<string, { start: number; dur: number; keys: string[] }>()
  for (const n of items) {
    const k = `${n.start}:${n.dur}`
    const g = groups.get(k)
    if (g) {
      if (!g.keys.includes(n.key)) g.keys.push(n.key)
    } else groups.set(k, { start: n.start, dur: n.dur, keys: [n.key] })
  }
  const events: { keys: string[] | null; start: number; units: number }[] = []
  let cursor = 0
  for (const g of [...groups.values()].sort((a, b) => a.start - b.start)) {
    if (g.start < cursor) continue
    if (g.start > cursor) events.push({ keys: null, start: cursor, units: g.start - cursor })
    events.push({ keys: g.keys, start: g.start, units: g.dur })
    cursor = g.start + g.dur
  }

  const chunks: Chunk[] = []
  for (const ev of events) {
    let at = ev.start
    let rem = ev.units
    while (rem > 0) {
      const room = UNITS_PER_MEASURE - (at % UNITS_PER_MEASURE)
      const take = Math.min(rem, room)
      const pieces = []
      let t = take
      while (t > 0) {
        const s = SPLITS.find(([u]) => u <= t)!
        pieces.push(s)
        t -= s[0]
      }
      for (let i = 0; i < pieces.length; i++) {
        const [u, duration, dots] = pieces[i]
        const isLast = i === pieces.length - 1 && take === rem
        chunks.push({
          keys: ev.keys,
          duration,
          dots,
          tieToNext: ev.keys !== null && !isLast,
          measure: Math.floor(at / UNITS_PER_MEASURE),
        })
        at += u
      }
      rem -= take
    }
  }
  return chunks
}

const keyForMidi = (midi: number): string => {
  const p = midiToPitch(midi)
  return `${p.letter[0]}${p.letter.includes("'") ? 'b' : ''}/${p.octave}`
}

export function ScoreView({ open, onClose, parsed, lanes }: Props) {
  const [vf, setVf] = useState<typeof import('vexflow') | null>(null)
  const [error, setError] = useState<string | null>(null)
  const paperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || vf) return
    import('vexflow')
      .then((m) => setVf(m))
      .catch((e) => setError(`Could not load the engraving library: ${e}`))
  }, [open, vf])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    const paper = paperRef.current
    if (!open || !vf || !parsed || !paper) return
    paper.innerHTML = ''
    const { Renderer, Stave, StaveNote, Voice, Formatter, Beam, Accidental, StaveTie, Dot } = vf

    const width = Math.max(560, paper.clientWidth - 8)
    const perLine = Math.max(2, Math.floor((width - 40) / MEASURE_W))

    for (let vi = 0; vi < lanes.length; vi++) {
      const voiceNotes = parsed.notes.filter((n) => n.voice === vi)
      const section = document.createElement('div')
      section.className = 'score-section'
      const title = document.createElement('div')
      title.className = 'score-title'
      title.textContent = `${lanes[vi].icon} ${lanes[vi].label}`
      section.appendChild(title)
      paper.appendChild(section)

      if (voiceNotes.length === 0) continue
      const isDrumVoice = voiceNotes.some((n) => n.drum)

      try {
        const roll = scheduledToRollNotes(voiceNotes, parsed.bpm)
        const items = roll
          .map((n) => ({
            start: n.start,
            dur: n.dur,
            key: n.drum !== undefined ? DRUM_STAFF[n.drum] : n.midi !== undefined ? keyForMidi(n.midi) : null,
          }))
          .filter((n): n is { start: number; dur: number; key: string } => n.key != null)
        const chunks = buildChunks(items)
        let measureCount = (chunks.length ? chunks[chunks.length - 1].measure : 0) + 1
        let truncated = false
        if (measureCount > MAX_MEASURES) {
          measureCount = MAX_MEASURES
          truncated = true
        }
        // clef by average pitch; percussion clef for drum voices
        const avg = roll.reduce((s, n) => s + (n.midi ?? 60), 0) / Math.max(1, roll.length)
        const clef = isDrumVoice ? 'percussion' : avg < 57 ? 'bass' : 'treble'
        const restKey = clef === 'bass' ? 'd/3' : 'b/4'

        const lines = Math.ceil(measureCount / perLine)
        const holder = document.createElement('div')
        section.appendChild(holder)
        const renderer = new Renderer(holder, Renderer.Backends.SVG)
        renderer.resize(width, lines * LINE_H + 20)
        const ctx = renderer.getContext()

        let prevTie: { note: InstanceType<typeof StaveNote>; indices: number[]; line: number } | null = null

        for (let m = 0; m < measureCount; m++) {
          const line = Math.floor(m / perLine)
          const col = m % perLine
          const isLineStart = col === 0
          // the first stave of a line is wider to fit the clef
          const staveX = 10 + (isLineStart ? 0 : 46 + col * MEASURE_W)
          const staveW = isLineStart ? MEASURE_W + 46 : MEASURE_W
          const stave = new Stave(staveX, 10 + line * LINE_H, staveW)
          if (isLineStart) {
            stave.addClef(clef)
            if (line === 0) stave.addTimeSignature('4/4')
          }
          stave.setContext(ctx).draw()

          const mChunks = chunks.filter((c) => c.measure === m)
          const notes = mChunks.map((c) => {
            if (c.keys === null) {
              const r = new StaveNote({ keys: [restKey], duration: `${c.duration}r`, clef })
              if (c.dots) Dot.buildAndAttach([r], { all: true })
              return r
            }
            const n = new StaveNote({ keys: c.keys, duration: c.duration, clef, autoStem: !isDrumVoice })
            if (c.dots) Dot.buildAndAttach([n], { all: true })
            return n
          })
          if (notes.length === 0) {
            const r = new StaveNote({ keys: [restKey], duration: 'wr', clef })
            notes.push(r)
          }

          const voice = new Voice('4/4').setStrict(false).addTickables(notes)
          if (!isDrumVoice) Accidental.applyAccidentals([voice], 'C')
          new Formatter().joinVoices([voice]).format([voice], staveW - (isLineStart ? 76 : 30))
          const beams = Beam.generateBeams(notes.filter((n) => !n.isRest()))
          voice.draw(ctx, stave)
          for (const b of beams) b.setContext(ctx).draw()

          // ties for split notes
          mChunks.forEach((c, i) => {
            const note = notes[i]
            if (prevTie && c.keys !== null) {
              if (prevTie.line === line && prevTie.indices.length === c.keys.length) {
                new StaveTie({
                  firstNote: prevTie.note,
                  lastNote: note,
                  firstIndexes: prevTie.indices,
                  lastIndexes: c.keys.map((_, k) => k),
                }).setContext(ctx).draw()
              } else {
                // partial ties across a line break: VexFlow requires both
                // index arrays to match even when one note is absent
                new StaveTie({
                  firstNote: prevTie.note,
                  firstIndexes: prevTie.indices,
                  lastIndexes: prevTie.indices,
                }).setContext(ctx).draw()
                const idx = c.keys.map((_, k) => k)
                new StaveTie({ lastNote: note, firstIndexes: idx, lastIndexes: idx }).setContext(ctx).draw()
              }
            }
            prevTie = c.tieToNext && c.keys !== null ? { note, indices: c.keys.map((_, k) => k), line } : null
          })
        }
        if (truncated) {
          const note = document.createElement('div')
          note.className = 'score-note'
          note.textContent = `Showing the first ${MAX_MEASURES} measures.`
          section.appendChild(note)
        }
      } catch (e) {
        const note = document.createElement('div')
        note.className = 'score-note'
        note.textContent = `Could not engrave this voice: ${e}`
        section.appendChild(note)
      }
    }
  }, [open, vf, parsed, lanes])

  const backdrop = useBackdropClose(onClose)

  if (!open) return null

  return (
    <div className="modal-backdrop" {...backdrop}>
      <div className="modal modal-score" role="dialog" aria-modal="true" aria-label="Score">
        <div className="modal-head">
          <span className="panel-title">Score</span>
          <button className="icon-btn" aria-label="Close" data-tip="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        {!vf && !error && (
          <div className="score-loading">
            <Loader2 size={16} className="spin" /> Loading engraving…
          </div>
        )}
        {error && <div className="warning error">{error}</div>}
        <div className="score-paper" ref={paperRef} />
        <div className="credits-foot">
          Engraved with VexFlow · 4/4 at one bar per 16 grid units · drums use a percussion staff (kick low,
          snare third space, hats/cymbals as ✕ above) · tempo changes aren't engraved yet.
        </div>
      </div>
    </div>
  )
}
