// Visual note editor for one voice, with two views:
//  - grid: a piano roll (rows are semitones; drum voices get one row per
//    drum sound)
//  - staff: a grand staff (treble + bass) for people who read notation —
//    click a line/space to add a note, shift+click for a flat
// Click an empty spot to add a note at the selected length, click a note to
// remove it. Every edit is serialized straight back to the voice's luting
// text. Zoom and horizontal scroll are shared across all open editors
// (rollView) so multiple voices stay column-aligned. The canvas is windowed:
// only the visible slice is drawn, so long tracks at any zoom stay cheap.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { serializeVoiceBody, midiToPitch, DRUM_SOUNDS, parseLuting } from '../lib/luting'
import type { ScheduledNote } from '../lib/luting'
import { notesToEvents, dominantVolume, scheduledToRollNotes } from '../lib/transform'
import type { RollNote } from '../lib/transform'
import { getClip, setClip, writeSystem, getLastSysText } from '../lib/rollClipboard'
import { playLuting, getPlaybackInfo } from '../lib/player'
import { useActivePlayback } from '../lib/usePlayback'
import { useRollView, setRollView, getRollView, clampZoom } from '../lib/rollView'
import { useTheme, canvasColors } from '../lib/theme'
import { instrumentColor } from './Timeline'
import { Minus, Plus, TriangleAlert, LayoutGrid, Music } from 'lucide-react'
import { NumberInput } from './NumberInput'
import { keyById, keyFlattens } from '../lib/keys'

const MIDI_MAX = 107 // b7
const MIDI_MIN = 24 // c1
const MELODIC_ROWS = MIDI_MAX - MIDI_MIN + 1
const DRUM_KEYS = Object.keys(DRUM_SOUNDS)
const NOTE_LEN_MAX = 64
const GUTTER = 64
const RULER = 16

// ---- staff geometry: diatonic steps from C1 (idx 0) to B7 (idx 48) --------
const STEP = 6
const STAFF_PAD = 18
const DIATONIC_MAX = 48
const STAFF_H = STAFF_PAD * 2 + DIATONIC_MAX * STEP
const LETTERS = 'cdefgab'
const LETTER_SEMI: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }
const TREBLE_LINES = [23, 25, 27, 29, 31] // E4 G4 B4 D5 F5
const BASS_LINES = [11, 13, 15, 17, 19] // G2 B2 D3 F3 A3
// staff idx where each key-signature flat sits, per clef (standard positions,
// in the flat order B E A D G C that the keys add them)
const TREBLE_FLAT_IDX: Record<string, number> = { b: 27, e: 30, a: 26, d: 29, g: 25, c: 28 }
const BASS_FLAT_IDX: Record<string, number> = { b: 13, e: 16, a: 12, d: 15, g: 11, c: 14 }

const staffIndex = (midi: number): { idx: number; flat: boolean } => {
  const p = midiToPitch(midi)
  return { idx: (p.octave - 1) * 7 + LETTERS.indexOf(p.letter[0]), flat: p.letter.includes("'") }
}
const midiForIdx = (idx: number, flat: boolean): number => {
  const octave = Math.floor(idx / 7) + 1
  const letter = LETTERS[idx % 7]
  return (octave + 1) * 12 + LETTER_SEMI[letter] - (flat ? 1 : 0)
}

interface Props {
  notes: ScheduledNote[]
  bpm: number
  instrument: string
  body: string
  /** song length in grid units, shared by all editors so they align */
  totalUnits: number
  /** playback id of this voice's solo, for playhead tracking */
  voiceId: string
  /** song key id; sets the default accidental per staff line in notation mode */
  songKey?: string
  /** note range to spotlight (driven by the caret in the syntax box) */
  highlight?: { from: number; count: number } | null
  /** start solo playback at a time (seconds); driven by ruler scrubbing */
  onScrub: (timeSec: number) => void
  onChangeBody: (body: string) => void
}

export function PianoRoll({
  notes: parsedNotes,
  bpm,
  instrument,
  body,
  totalUnits,
  voiceId,
  songKey,
  highlight,
  onScrub,
  onChangeBody,
}: Props) {
  const isDrum = instrument === 'd'
  const view = useRollView()
  const { pxPerUnit, scrollUnits } = view
  const mode = isDrum ? 'grid' : view.mode

  // notation key: the default accidental for a staff line (its letter) before
  // the Shift override. C major flattens nothing, so default behaviour is kept.
  const musicKey = keyById(songKey ?? 'C')
  const staffFlatDefault = (pos: number): boolean => keyFlattens(musicKey, LETTERS[pos % 7])

  const rows = isDrum ? DRUM_KEYS.length : MELODIC_ROWS
  const rowH = isDrum ? 16 : 10
  const H = mode === 'staff' ? STAFF_H : rows * rowH

  const [noteLen, setNoteLen] = useState(4)
  const [flash, setFlash] = useState<{ text: string; warn: boolean } | null>(null)
  const flashTimer = useRef(0)
  const [viewW, setViewW] = useState(600)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [moveDelta, setMoveDelta] = useState<{ du: number; dv: number } | null>(null)
  const drag = useRef<{
    x: number
    y: number
    u: number
    pos: number
    moved: boolean
    kind: 'marquee' | 'move'
    hitKey: string | null
    keys: Set<string>
  } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const rulerRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const hover = useRef<{ u: number; pos: number; flat: boolean } | null>(null)
  const rafRef = useRef(0)
  const drawRef = useRef<() => void>(() => {})
  const scrubbing = useRef(false)
  const lastScrub = useRef(0)
  const activeId = useActivePlayback()
  const tracking = activeId === voiceId || activeId === 'main'
  const theme = useTheme()

  const unsupported = /[@~]/.test(body)
  const hasMacros = /[A-Z]/.test(body)

  const W = Math.max(viewW, totalUnits * pxPerUnit)

  const derived = useMemo(
    () => ({ notes: scheduledToRollNotes(parsedNotes, bpm), volume: dominantVolume(parsedNotes) }),
    [parsedNotes, bpm]
  )

  const rowForNote = (n: RollNote) => (isDrum ? DRUM_KEYS.indexOf(n.drum!) : MIDI_MAX - (n.midi ?? 60))
  // stable identity for selection (two notes can't share start+dur+pitch)
  const noteKey = (n: RollNote) => `${n.start}:${n.dur}:${n.midi ?? 'd' + n.drum}`
  // during a drag-move the selected notes are drawn shifted in the overlay, so
  // hide them at their original spot
  const hiddenForMove = (n: RollNote) => moveDelta != null && selected.has(noteKey(n))
  const yForIdx = (idx: number) => STAFF_PAD + (DIATONIC_MAX - idx) * STEP

  /** geometry of a note for overlays (spotlight, playback flash), per mode */
  const noteRect = (n: RollNote): { x: number; y: number; w: number; h: number } | null => {
    const x = n.start * pxPerUnit
    const w = Math.max(2, n.dur * pxPerUnit - 1)
    if (mode === 'staff') {
      if (n.midi === undefined) return null
      const y = yForIdx(staffIndex(n.midi).idx)
      return { x: x - 2, y: y - 5, w: Math.max(w, 12), h: 10 }
    }
    const r = rowForNote(n)
    if (r < 0) return null
    return { x, y: r * rowH + 1, w, h: rowH - 2 }
  }

  // track visible width
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewW(Math.max(100, el.clientWidth - GUTTER)))
    ro.observe(el)
    setViewW(Math.max(100, el.clientWidth - GUTTER))
    return () => ro.disconnect()
  }, [])

  // scroll vertically to the content (or middle C) when opened in grid mode
  useEffect(() => {
    const el = scrollRef.current
    if (!el || mode === 'staff') return
    const first = derived.notes[0]
    const row = first ? rowForNote(first) : isDrum ? 0 : MIDI_MAX - 60
    el.scrollTop = Math.max(0, row * rowH - el.clientHeight / 2)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // ---- drawing -------------------------------------------------------------

  const drawStaff = (ctx: CanvasRenderingContext2D, offset: number, cw: number) => {
    const color = instrumentColor(instrument)
    const col = canvasColors()
    // beat/bar lines behind everything
    const beatStep = pxPerUnit >= 1.5 ? 4 : 16
    const uFrom = Math.floor(offset / pxPerUnit / beatStep) * beatStep
    const uTo = Math.min(totalUnits, Math.ceil((offset + cw) / pxPerUnit))
    for (let u = uFrom; u <= uTo; u += beatStep) {
      ctx.fillStyle = u % 16 === 0 ? col.staffBar : col.staffBeat
      ctx.fillRect(u * pxPerUnit, yForIdx(31), 1, yForIdx(11) - yForIdx(31))
    }
    // staff lines (the clefs live in the sticky gutter, so notes start at x=0)
    ctx.fillStyle = col.staffLine
    for (const li of [...TREBLE_LINES, ...BASS_LINES]) {
      ctx.fillRect(offset, yForIdx(li) - 0.5, cw, 1)
    }

    const drawLedgers = (idx: number, x: number) => {
      ctx.fillStyle = col.ledger
      const line = (p: number) => ctx.fillRect(x - 7, yForIdx(p) - 0.5, 14, 1)
      if (idx >= 21 && idx <= 22) line(21) // middle C
      for (let p = 33; p <= idx; p += 2) line(p)
      for (let p = 9; p >= idx; p -= 2) line(p)
    }

    // A chord (notes sharing a start) takes ONE stem direction so its stems
    // don't splay both ways. Set by the notes furthest from the staff's middle
    // line, the standard rule; reduces to the per-note rule for a lone note.
    const chordStemUp = new Map<number, boolean>()
    {
      const ext = new Map<number, { top: number; bottom: number }>()
      for (const n of derived.notes) {
        if (n.midi === undefined || hiddenForMove(n)) continue
        const { idx } = staffIndex(n.midi)
        const e = ext.get(n.start)
        if (e) {
          e.top = Math.max(e.top, idx)
          e.bottom = Math.min(e.bottom, idx)
        } else ext.set(n.start, { top: idx, bottom: idx })
      }
      for (const [start, { top, bottom }] of ext) {
        const mid = bottom >= 21 ? 27 : top < 21 ? 15 : 21
        chordStemUp.set(start, mid - bottom > top - mid)
      }
    }

    for (const n of derived.notes) {
      if (n.midi === undefined) continue
      if (hiddenForMove(n)) continue
      const x = n.start * pxPerUnit
      const w = Math.max(2, n.dur * pxPerUnit - 1)
      if (x + w < offset || x > offset + cw) continue
      const { idx, flat } = staffIndex(n.midi)
      const y = yForIdx(idx)
      // faint duration bar keeps the piano-roll affordance
      ctx.fillStyle = color
      ctx.globalAlpha = 0.22
      ctx.fillRect(x, y - 2, w, 4)
      ctx.globalAlpha = 1
      drawLedgers(idx, x + 4)
      // head: hollow for half notes and longer (>= 8 units at 4/beat)
      const hollow = n.dur >= 8
      ctx.beginPath()
      ctx.ellipse(x + 4, y, 4.4, 3.2, -0.25, 0, Math.PI * 2)
      if (hollow) {
        ctx.strokeStyle = color
        ctx.lineWidth = 1.6
        ctx.stroke()
      } else {
        ctx.fillStyle = color
        ctx.fill()
      }
      // stem (none on whole notes)
      if (n.dur < 16) {
        ctx.strokeStyle = color
        ctx.lineWidth = 1.2
        ctx.beginPath()
        const stemUp = chordStemUp.get(n.start) ?? idx < (idx >= 21 ? 27 : 15)
        if (stemUp) {
          ctx.moveTo(x + 8.2, y - 1)
          ctx.lineTo(x + 8.2, y - 19)
        } else {
          ctx.moveTo(x - 0.2, y + 1)
          ctx.lineTo(x - 0.2, y + 19)
        }
        ctx.stroke()
      }
      // accidental: show only what the key signature doesn't already imply — a
      // ♭ for a flat outside the key, a ♮ where the key flattens this line but
      // the note is natural. Notes that match the key draw clean.
      const acc = flat === staffFlatDefault(idx) ? '' : flat ? '♭' : '♮'
      if (acc) {
        ctx.fillStyle = color
        ctx.font = 'bold 11px serif'
        ctx.fillText(acc, x - 7, y + 3.5)
      }
    }

    // hover ghost
    if (hover.current) {
      const { u, pos, flat } = hover.current
      const gx = u * pxPerUnit
      const gy = yForIdx(pos)
      ctx.globalAlpha = 0.5
      ctx.strokeStyle = col.ink
      ctx.lineWidth = 1.3
      ctx.beginPath()
      ctx.ellipse(gx + 4, gy, 4.4, 3.2, -0.25, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = col.hover
      ctx.fillRect(gx, gy - 2, Math.max(2, noteLen * pxPerUnit - 1), 4)
      const acc = flat === staffFlatDefault(pos) ? '' : flat ? '♭' : '♮'
      if (acc) {
        ctx.fillStyle = col.ink
        ctx.font = 'bold 11px serif'
        ctx.fillText(acc, gx - 7, gy + 3.5)
      }
      ctx.globalAlpha = 1
    }
  }

  const drawGrid = (ctx: CanvasRenderingContext2D, offset: number, cw: number) => {
    const col = canvasColors()
    for (let r = 0; r < rows; r++) {
      const midi = MIDI_MAX - r
      const shade = isDrum ? r % 2 === 0 : Math.floor(midi / 12) % 2 === 0
      ctx.fillStyle = shade ? col.shadeA : col.shadeB
      ctx.fillRect(offset, r * rowH, cw, rowH)
      if (!isDrum && midi % 12 === 0) {
        ctx.fillStyle = col.cRow
        ctx.fillRect(offset, r * rowH, cw, rowH)
      }
    }
    const beatStep = pxPerUnit >= 1.5 ? 4 : 16
    const uFrom = Math.floor(offset / pxPerUnit / beatStep) * beatStep
    const uTo = Math.min(totalUnits, Math.ceil((offset + cw) / pxPerUnit))
    for (let u = uFrom; u <= uTo; u += beatStep) {
      ctx.fillStyle = u % 16 === 0 ? col.bar : col.beat
      ctx.fillRect(u * pxPerUnit, 0, 1, H)
    }
    ctx.fillStyle = instrumentColor(instrument)
    for (const n of derived.notes) {
      if (hiddenForMove(n)) continue
      const x = n.start * pxPerUnit
      const w = Math.max(2, n.dur * pxPerUnit - 1)
      if (x + w < offset || x > offset + cw) continue
      const r = rowForNote(n)
      if (r < 0) continue
      ctx.fillRect(x + 0.5, r * rowH + 1, w, rowH - 2)
    }
    if (hover.current) {
      const { u, pos } = hover.current
      ctx.fillStyle = col.hover
      ctx.fillRect(u * pxPerUnit + 0.5, pos * rowH + 1, Math.max(2, noteLen * pxPerUnit - 1), rowH - 2)
    }
  }

  const draw = () => {
    const el = scrollRef.current
    const canvas = canvasRef.current
    if (!el || !canvas) return
    const offset = el.scrollLeft
    const cw = Math.min(viewW + 40, W - offset < 0 ? viewW : Math.max(100, Math.ceil(W - offset)))
    canvas.style.left = `${offset}px`
    canvas.style.width = `${cw}px`
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== Math.round(cw * dpr)) canvas.width = Math.round(cw * dpr)
    if (canvas.height !== Math.round(H * dpr)) canvas.height = Math.round(H * dpr)
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cw, H)
    ctx.translate(-offset, 0)

    if (mode === 'staff') drawStaff(ctx, offset, cw)
    else drawGrid(ctx, offset, cw)

    // caret spotlight: crosshair band + ink-hot note(s) under the cursor
    if (highlight) {
      const col = canvasColors()
      const picked = []
      for (let k = highlight.from; k < highlight.from + highlight.count && k < derived.notes.length; k++) {
        const r = noteRect(derived.notes[k])
        if (r) picked.push(r)
      }
      ctx.fillStyle = col.band
      for (const r of picked) {
        ctx.fillRect(r.x, 0, r.w, H)
        if (mode === 'grid') ctx.fillRect(offset, r.y, cw, r.h)
      }
      ctx.shadowColor = instrumentColor(instrument)
      ctx.shadowBlur = 10
      ctx.strokeStyle = col.ink
      ctx.lineWidth = 1.5
      for (const r of picked) {
        if (mode === 'grid') {
          ctx.fillStyle = col.ink
          ctx.fillRect(r.x + 0.5, r.y, r.w, r.h)
        }
        ctx.strokeRect(r.x - 1, r.y - 0.5, r.w + 2.5, r.h + 1)
      }
      ctx.shadowBlur = 0
    }

    // selected notes: translucent fill (grid) + solid outline, shifted live
    // by the current drag/arrow move delta
    if (selected.size) {
      const col = canvasColors()
      const dx = moveDelta ? moveDelta.du * pxPerUnit : 0
      const dy = moveDelta ? moveDelta.dv * (mode === 'staff' ? STEP : rowH) : 0
      for (const n of derived.notes) {
        if (!selected.has(noteKey(n))) continue
        const r = noteRect(n)
        if (!r) continue
        const x = r.x + dx
        const y = r.y + dy
        if (x + r.w < offset || x > offset + cw) continue
        if (mode === 'grid') {
          ctx.fillStyle = col.selFill
          ctx.fillRect(x + 0.5, y, r.w, r.h)
        }
        ctx.strokeStyle = col.sel
        ctx.lineWidth = 1.5
        ctx.strokeRect(x - 0.5, y - 0.5, r.w + 1.5, r.h + 1)
      }
    }
  }
  drawRef.current = draw
  useEffect(draw)

  // follow shared horizontal scroll
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const target = scrollUnits * pxPerUnit
    if (Math.abs(el.scrollLeft - target) > 2) el.scrollLeft = target
  }, [scrollUnits, pxPerUnit])

  // local scroll -> redraw window + publish shared position
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        drawRef.current()
        const u = el.scrollLeft / getRollView().pxPerUnit
        if (Math.abs(u - getRollView().scrollUnits) * getRollView().pxPerUnit > 2) {
          setRollView({ scrollUnits: u })
        }
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // Ctrl/Cmd+wheel zooms, anchored at the cursor. Needs a non-passive
  // listener so the browser's page zoom can be suppressed.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const v = getRollView()
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      const newPx = clampZoom(v.pxPerUnit * factor)
      if (newPx === v.pxPerUnit) return
      const bodyEl = bodyRef.current
      if (!bodyEl) return
      const cursorUnits = (e.clientX - bodyEl.getBoundingClientRect().left) / v.pxPerUnit
      const viewportX = e.clientX - el.getBoundingClientRect().left - GUTTER
      setRollView({ pxPerUnit: newPx, scrollUnits: Math.max(0, cursorUnits - viewportX / newPx) })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // playhead line + note-flash overlay, tracking solo or main playback
  useEffect(() => {
    const ph = playheadRef.current
    const overlay = overlayRef.current
    const el = scrollRef.current
    if (!ph || !overlay || !el) return
    const octx = overlay.getContext('2d')!
    const clear = () => {
      octx.setTransform(1, 0, 0, 1, 0, 0)
      octx.clearRect(0, 0, overlay.width, overlay.height)
    }
    if (!tracking) {
      ph.style.opacity = '0'
      clear()
      return
    }
    ph.style.opacity = '1'
    const unit = 60 / bpm
    const color = instrumentColor(instrument)
    const flashRgb = canvasColors().flashRgb
    let raf = 0
    const tick = () => {
      const info = getPlaybackInfo()
      if (!info) return
      const posU = info.position / unit
      ph.style.transform = `translateX(${posU * pxPerUnit}px)`
      const offset = el.scrollLeft
      const cw = Math.min(viewW + 40, Math.max(100, Math.ceil(W - offset)))
      const dpr = window.devicePixelRatio || 1
      overlay.style.left = `${offset}px`
      overlay.style.width = `${cw}px`
      if (overlay.width !== Math.round(cw * dpr)) overlay.width = Math.round(cw * dpr)
      if (overlay.height !== Math.round(H * dpr)) overlay.height = Math.round(H * dpr)
      octx.setTransform(dpr, 0, 0, dpr, 0, 0)
      octx.clearRect(0, 0, cw, H)
      octx.translate(-offset, 0)
      for (const n of derived.notes) {
        if (posU < n.start || posU >= n.start + n.dur) continue
        const r = noteRect(n)
        if (!r) continue
        if (r.x + r.w < offset || r.x > offset + cw) continue
        const ageSec = (posU - n.start) * unit
        const fl = Math.exp(-ageSec * 9)
        const pad = fl * 2.5
        octx.shadowColor = color
        octx.shadowBlur = 6 + fl * 16
        octx.fillStyle = `rgba(${flashRgb},${(0.55 + 0.45 * fl).toFixed(3)})`
        octx.fillRect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2)
      }
      octx.shadowBlur = 0
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => {
      cancelAnimationFrame(raf)
      clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracking, pxPerUnit, bpm, derived, viewW, W, H, rowH, instrument, isDrum, mode, theme])

  // bring the caret-spotlighted note into view
  useEffect(() => {
    if (!highlight) return
    const n = derived.notes[highlight.from]
    const el = scrollRef.current
    if (!n || !el) return
    const x = n.start * pxPerUnit
    if (x < el.scrollLeft + 20 || x > el.scrollLeft + viewW - 40) {
      setRollView({ scrollUnits: Math.max(0, n.start - viewW / pxPerUnit / 3) })
    }
    if (mode === 'grid') {
      const rTop = rowForNote(n) * rowH
      if (rTop < el.scrollTop + RULER + 4 || rTop > el.scrollTop + el.clientHeight - 30) {
        el.scrollTop = Math.max(0, rTop - el.clientHeight / 2)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight?.from, highlight?.count])

  // ruler scrubbing: click/drag the bar numbers to solo-play from there
  const scrubTo = (clientX: number) => {
    const ruler = rulerRef.current
    if (!ruler) return
    const u = Math.max(0, (clientX - ruler.getBoundingClientRect().left) / pxPerUnit)
    onScrub(u * (60 / bpm))
    lastScrub.current = Date.now()
  }

  const zoomBy = (factor: number) => {
    const el = scrollRef.current
    const newPx = clampZoom(pxPerUnit * factor)
    const center = ((el?.scrollLeft ?? 0) + viewW / 2) / pxPerUnit
    setRollView({ pxPerUnit: newPx, scrollUnits: Math.max(0, center - viewW / 2 / newPx) })
  }
  const fit = () => setRollView({ pxPerUnit: clampZoom(viewW / totalUnits), scrollUnits: 0 })

  /** map a pointer position to (time unit, row or staff index) */
  const locate = (e: ReactMouseEvent) => {
    const rect = bodyRef.current!.getBoundingClientRect()
    const u = Math.max(0, Math.floor((e.clientX - rect.left) / pxPerUnit))
    const y = e.clientY - rect.top
    if (mode === 'staff') {
      const idx = Math.max(0, Math.min(DIATONIC_MAX, Math.round((STAFF_PAD + DIATONIC_MAX * STEP - y) / STEP)))
      return { u, pos: idx }
    }
    return { u, pos: Math.min(rows - 1, Math.max(0, Math.floor(y / rowH))) }
  }

  const commit = (notes: RollNote[]) => {
    onChangeBody(serializeVoiceBody(notesToEvents(notes, isDrum), { volume: derived.volume }))
  }

  const audition = (n: RollNote) => {
    const mini = isDrum
      ? `#lute 480 ido${n.drum![1]}${n.drum!.slice(2)}`
      : (() => {
          const p = midiToPitch(n.midi!)
          return `#lute 480 i${instrument}o${p.octave}${p.letter}3`
        })()
    playLuting(mini, { id: 'audition' })
  }

  const showFlash = (text: string, isWarn: boolean) => {
    setFlash({ text, warn: isWarn })
    window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setFlash(null), 2200)
  }
  const warn = (msg: string) => showFlash(msg, true)
  const info = (msg: string) => showFlash(msg, false)

  // the note under a grid position, if any
  const hitNoteAt = (u: number, pos: number) =>
    derived.notes.find((n) => {
      if (u < n.start || u >= n.start + n.dur) return false
      if (mode === 'staff') return n.midi !== undefined && staffIndex(n.midi).idx === pos
      return rowForNote(n) === pos
    })

  // a single click on the grid: remove the note under it, else add one
  const addOrRemoveAt = (u: number, pos: number, shiftKey: boolean) => {
    setSelected(new Set())
    const hit = hitNoteAt(u, pos)
    if (hit) {
      commit(derived.notes.filter((n) => n !== hit))
      return
    }
    let note: RollNote
    if (isDrum) {
      note = { start: u, dur: 1, drum: DRUM_KEYS[pos] }
    } else if (mode === 'staff') {
      // key flattens this line by default; Shift toggles back to the natural
      const midi = midiForIdx(pos, staffFlatDefault(pos) !== shiftKey)
      if (midi < MIDI_MIN || midi > MIDI_MAX) {
        warn('That position is outside the playable o1–o7 range.')
        return
      }
      note = { start: u, dur: noteLen, midi }
    } else {
      note = { start: u, dur: noteLen, midi: MIDI_MAX - pos }
    }
    const clashing = derived.notes.filter((m) => note.start < m.start + m.dur && m.start < note.start + note.dur)
    if (clashing.length > 0) {
      if (isDrum) {
        warn('One drum at a time per voice — add another Drumkit voice for simultaneous hits.')
        return
      }
      const c0 = clashing[0]
      if (clashing.every((m) => m.start === c0.start && m.dur === c0.dur)) {
        note.start = c0.start
        note.dur = c0.dur // join the chord
      } else {
        warn('Notes in one voice play in sequence — overlaps only work as chords (same start and length).')
        return
      }
    }
    audition(note)
    commit([...derived.notes, note])
  }

  // ---- selection, marquee & clipboard --------------------------------------

  const selectedNotes = () => derived.notes.filter((n) => selected.has(noteKey(n)))
  const plural = (n: number) => `${n} note${n === 1 ? '' : 's'}`

  const finalizeMarquee = (r: { x0: number; y0: number; x1: number; y1: number }, additive: boolean) => {
    const xMin = Math.min(r.x0, r.x1)
    const xMax = Math.max(r.x0, r.x1)
    const yMin = Math.min(r.y0, r.y1)
    const yMax = Math.max(r.y0, r.y1)
    const hits = new Set<string>(additive ? selected : [])
    for (const n of derived.notes) {
      const rect = noteRect(n)
      if (!rect) continue
      if (rect.x + rect.w < xMin || rect.x > xMax || rect.y + rect.h < yMin || rect.y > yMax) continue
      hits.add(noteKey(n))
    }
    setSelected(hits)
  }

  // write a selection to both the internal clipboard and (as luting text) the
  // system clipboard
  const writeClip = (sel: RollNote[]) => {
    const minStart = Math.min(...sel.map((n) => n.start))
    const rel = sel.map((n) => ({ ...n, start: n.start - minStart }))
    setClip(rel, isDrum)
    writeSystem(serializeVoiceBody(notesToEvents(rel, isDrum), { volume: derived.volume }))
  }

  const copySelection = () => {
    const sel = selectedNotes()
    if (!sel.length) return
    writeClip(sel)
    info(`Copied ${plural(sel.length)}`)
  }

  const deleteSelection = () => {
    const sel = selectedNotes()
    if (!sel.length) return
    setSelected(new Set())
    commit(derived.notes.filter((n) => !selected.has(noteKey(n))))
  }

  const cutSelection = () => {
    const sel = selectedNotes()
    if (!sel.length) return
    writeClip(sel)
    setSelected(new Set())
    commit(derived.notes.filter((n) => !selected.has(noteKey(n))))
    info(`Cut ${plural(sel.length)}`)
  }

  // normalize a note list so its earliest start is 0
  const relativize = (notes: RollNote[]): RollNote[] => {
    const minStart = Math.min(...notes.map((n) => n.start))
    return notes.map((n) => ({ ...n, start: n.start - minStart }))
  }

  // parse system-clipboard text as a voice body (or a full luting) into notes
  // for this voice
  const parseSnippet = (text: string): RollNote[] | null => {
    const clean = text.trim()
    if (!clean) return null
    try {
      const full = clean.startsWith('#lute') ? clean : `#lute ${bpm} i${isDrum ? 'd' : instrument}${clean.replace(/\s+/g, '')}`
      const parsed = parseLuting(full)
      const v0 = parsed.notes.filter((n) => n.voice === 0)
      if (!v0.length) return null
      return relativize(scheduledToRollNotes(v0, parsed.bpm))
    } catch {
      return null
    }
  }

  // drop a block of notes at `target`, respecting the sequential/chord rule
  const placeNotes = (notes: RollNote[], target: number) => {
    const pasted = notes.map((n) => ({ ...n, start: n.start + target }))
    for (const p of pasted) {
      const clash = derived.notes.filter((m) => p.start < m.start + m.dur && m.start < p.start + p.dur)
      const cleanChord = clash.every((m) => m.start === p.start && m.dur === p.dur)
      if (clash.length && (isDrum || !cleanChord)) {
        warn('Paste would overlap existing notes — drop it on empty space or after the end.')
        return
      }
    }
    commit([...derived.notes, ...pasted])
    setSelected(new Set(pasted.map(noteKey)))
    info(`Pasted ${plural(pasted.length)}`)
  }

  const pasteClip = async () => {
    // anchor at the hovered time, else append after the last note
    const target = hover.current ? hover.current.u : derived.notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0)
    // foreign system-clipboard text wins; otherwise our own internal clip
    let sys: string | null = null
    try {
      sys = await navigator.clipboard?.readText()
    } catch {
      sys = null
    }
    if (sys && sys.trim() && sys !== getLastSysText()) {
      const notes = parseSnippet(sys)
      if (notes) {
        placeNotes(notes, target)
        return
      }
    }
    const clip = getClip()
    if (clip && clip.notes.length) {
      if (clip.isDrum !== isDrum) {
        warn(clip.isDrum ? 'Clipboard has drum hits — paste into a Drumkit voice.' : 'Clipboard has melodic notes — paste into a melodic voice.')
        return
      }
      placeNotes(clip.notes, target)
      return
    }
    // nothing internal, but the system clipboard had something parseable
    if (sys && sys.trim()) {
      const notes = parseSnippet(sys)
      if (notes) placeNotes(notes, target)
    }
  }

  // shift the selection by du grid units and dv vertical steps (rows in grid,
  // diatonic steps in staff); used by both drag-move and the arrow keys
  const applyMove = (du: number, dv: number, keysOverride?: Set<string>) => {
    const keys = keysOverride ?? selected
    const sel = derived.notes.filter((n) => keys.has(noteKey(n)))
    if (!sel.length) return
    const minStart = Math.min(...sel.map((n) => n.start))
    if (minStart + du < 0) du = -minStart
    if (du === 0 && dv === 0) return

    const moveOne = (n: RollNote): RollNote | null => {
      const start = n.start + du
      if (isDrum) {
        const di = DRUM_KEYS.indexOf(n.drum!) + dv
        if (di < 0 || di >= DRUM_KEYS.length) return null
        return { ...n, start, drum: DRUM_KEYS[di] }
      }
      if (mode === 'staff') {
        const { idx, flat } = staffIndex(n.midi!)
        const ni = idx - dv
        if (ni < 0 || ni > DIATONIC_MAX) return null
        const midi = midiForIdx(ni, flat)
        if (midi < MIDI_MIN || midi > MIDI_MAX) return null
        return { ...n, start, midi }
      }
      const midi = n.midi! - dv
      if (midi < MIDI_MIN || midi > MIDI_MAX) return null
      return { ...n, start, midi }
    }

    const moved: RollNote[] = []
    for (const n of sel) {
      const m = moveOne(n)
      if (!m) {
        warn('That move would push notes off the grid.')
        return
      }
      moved.push(m)
    }
    const stationary = derived.notes.filter((n) => !keys.has(noteKey(n)))
    for (const p of moved) {
      const clash = stationary.filter((m) => p.start < m.start + m.dur && m.start < p.start + p.dur)
      const cleanChord = clash.every((m) => m.start === p.start && m.dur === p.dur)
      if (clash.length && (isDrum || !cleanChord)) {
        warn('That move would overlap other notes.')
        return
      }
    }
    commit([...stationary, ...moved])
    setSelected(new Set(moved.map(noteKey)))
  }

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
    const mod = e.metaKey || e.ctrlKey
    const k = e.key.toLowerCase()
    if (k === 'escape') {
      if (selected.size) setSelected(new Set())
      return
    }
    // arrow keys nudge the selection: ±1 unit / ±1 step, shift = beat / octave
    if (selected.size && (k === 'arrowleft' || k === 'arrowright' || k === 'arrowup' || k === 'arrowdown')) {
      e.preventDefault()
      if (k === 'arrowleft') applyMove(e.shiftKey ? -4 : -1, 0)
      else if (k === 'arrowright') applyMove(e.shiftKey ? 4 : 1, 0)
      else {
        const big = isDrum ? 1 : mode === 'staff' ? 7 : 12
        const step = e.shiftKey ? big : 1
        applyMove(0, k === 'arrowup' ? -step : step)
      }
      return
    }
    if (mod && k === 'a') {
      e.preventDefault()
      setSelected(new Set(derived.notes.map(noteKey)))
    } else if (mod && k === 'c') {
      e.preventDefault()
      copySelection()
    } else if (mod && k === 'x') {
      e.preventDefault()
      cutSelection()
    } else if (mod && k === 'v') {
      e.preventDefault()
      void pasteClip()
    } else if ((k === 'delete' || k === 'backspace') && selected.size) {
      e.preventDefault()
      deleteSelection()
    }
  }

  // ---- pointer: click adds/removes, drag past a threshold marquee-selects ---

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    containerRef.current?.focus({ preventScroll: true })
    const { u, pos } = locate(e)
    const hit = hitNoteAt(u, pos)
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      u,
      pos,
      moved: false,
      kind: hit ? 'move' : 'marquee',
      hitKey: hit ? noteKey(hit) : null,
      keys: new Set(),
    }
    bodyRef.current?.setPointerCapture(e.pointerId)
  }

  const moveDeltaFor = (d: { x: number; y: number }, e: { clientX: number; clientY: number }) => ({
    du: Math.round((e.clientX - d.x) / pxPerUnit),
    dv: Math.round((e.clientY - d.y) / (mode === 'staff' ? STEP : rowH)),
  })

  const onPointerMove = (e: ReactPointerEvent) => {
    onMove(e) // hover ghost
    const d = drag.current
    if (!d) return
    if (!d.moved) {
      if (Math.abs(e.clientX - d.x) < 4 && Math.abs(e.clientY - d.y) < 4) return
      d.moved = true
      if (d.kind === 'move') {
        // grab the whole selection if the pressed note is in it, else just it
        const inSel = d.hitKey != null && selected.has(d.hitKey)
        d.keys = inSel ? new Set(selected) : new Set(d.hitKey ? [d.hitKey] : [])
        if (!inSel) setSelected(d.keys)
      }
    }
    if (d.kind === 'move') {
      setMoveDelta(moveDeltaFor(d, e))
    } else {
      const rect = bodyRef.current!.getBoundingClientRect()
      setMarquee({ x0: d.x - rect.left, y0: d.y - rect.top, x1: e.clientX - rect.left, y1: e.clientY - rect.top })
    }
  }

  const onPointerUp = (e: ReactPointerEvent) => {
    const d = drag.current
    drag.current = null
    bodyRef.current?.releasePointerCapture?.(e.pointerId)
    if (!d) return
    if (d.kind === 'move') {
      setMoveDelta(null)
      if (d.moved) {
        const { du, dv } = moveDeltaFor(d, e)
        applyMove(du, dv, d.keys)
      } else {
        addOrRemoveAt(d.u, d.pos, e.shiftKey) // click a note = remove it
      }
    } else if (d.moved) {
      const rect = bodyRef.current!.getBoundingClientRect()
      finalizeMarquee({ x0: d.x - rect.left, y0: d.y - rect.top, x1: e.clientX - rect.left, y1: e.clientY - rect.top }, e.shiftKey)
      setMarquee(null)
    } else {
      addOrRemoveAt(d.u, d.pos, e.shiftKey) // click empty = add a note
    }
  }

  const onMove = (e: ReactMouseEvent) => {
    const { u, pos } = locate(e)
    const flat = mode === 'staff' && staffFlatDefault(pos) !== e.shiftKey
    if (hover.current?.u !== u || hover.current?.pos !== pos || hover.current?.flat !== flat) {
      hover.current = { u, pos, flat }
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => drawRef.current())
    }
  }

  const rowLabel = (r: number): string => {
    if (isDrum) return DRUM_SOUNDS[DRUM_KEYS[r]].name
    const midi = MIDI_MAX - r
    return midi % 12 === 0 ? `c${Math.floor(midi / 12) - 1}` : ''
  }

  if (unsupported) {
    return (
      <div className="roll-note warning">
        This voice uses tempo changes (@) or fades (~), which the visual editor can't represent yet — edit
        the text directly.
      </div>
    )
  }

  const bars = Math.ceil(totalUnits / 16)
  const barLabelStep = Math.max(1, Math.ceil(44 / (16 * pxPerUnit)))

  return (
    <div className="roll" ref={containerRef} tabIndex={0} onKeyDown={onKeyDown}>
      <div className="roll-toolbar">
        {!isDrum && (
          <span className="roll-tool">
            <button
              className={`icon-btn ${mode === 'grid' ? 'active' : ''}`}
              aria-label="Grid view"
              data-tip="Piano-roll grid"
              onClick={() => setRollView({ mode: 'grid' })}
            >
              <LayoutGrid size={13} />
            </button>
            <button
              className={`icon-btn ${mode === 'staff' ? 'active' : ''}`}
              aria-label="Staff view"
              data-tip="Staff notation (grand staff)"
              onClick={() => setRollView({ mode: 'staff' })}
            >
              <Music size={13} />
            </button>
          </span>
        )}
        <span className="roll-tool">
          Note length
          <NumberInput
            value={noteLen}
            onChange={setNoteLen}
            min={1}
            max={NOTE_LEN_MAX}
            disabled={isDrum}
            inputClassName="note-len-input"
            ariaLabel="Note length in grid units"
            tip="Length of new notes, in grid units — scroll over the field to change"
          />
          units
        </span>
        <span className="roll-tool">
          Zoom
          <button className="icon-btn" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.4)} data-tip="Zoom out — applies to all open editors">
            <Minus size={13} />
          </button>
          <button className="icon-btn" aria-label="Zoom in" onClick={() => zoomBy(1.4)} data-tip="Zoom in — applies to all open editors">
            <Plus size={13} />
          </button>
          <button className="btn small" onClick={fit} data-tip="Fit the whole track in view">
            Fit
          </button>
        </span>
        <span className="roll-hint">
          click empty = add · click note = remove
          {mode === 'staff' ? ' · shift+click = flat' : ''} · drag empty = select · drag note / arrows = move ·
          ⌘/ctrl C/X/V · ⌫ delete · ctrl/cmd+wheel = zoom · 4 units = 1 beat
        </span>
      </div>
      {hasMacros && (
        <div className="roll-note">
          <TriangleAlert size={13} /> This voice uses macros — the first edit rewrites it as plain notes
          (later voices reusing its macros would break).
        </div>
      )}
      {flash && <div className={`roll-note ${flash.warn ? 'warning' : ''}`}>{flash.text}</div>}
      <div className="roll-scroll" ref={scrollRef}>
        <div style={{ width: GUTTER + W, minWidth: '100%' }}>
          <div className="roll-ruler-row" style={{ height: RULER }}>
            <div className="roll-corner" style={{ width: GUTTER }} />
            <div
              className="roll-ruler scrubbable"
              ref={rulerRef}
              style={{ width: W }}
              title="Click or drag to play this voice from here"
              onPointerDown={(e) => {
                scrubbing.current = true
                e.currentTarget.setPointerCapture(e.pointerId)
                scrubTo(e.clientX)
              }}
              onPointerMove={(e) => {
                if (scrubbing.current && Date.now() - lastScrub.current > 250) scrubTo(e.clientX)
              }}
              onPointerUp={(e) => {
                if (!scrubbing.current) return
                scrubbing.current = false
                if (Date.now() - lastScrub.current > 120) scrubTo(e.clientX)
              }}
            >
              {Array.from({ length: Math.ceil(bars / barLabelStep) }, (_, i) => {
                const bar = i * barLabelStep
                return (
                  <span key={bar} style={{ left: bar * 16 * pxPerUnit + 3 }}>
                    {bar + 1}
                  </span>
                )
              })}
            </div>
          </div>
          <div style={{ display: 'flex' }}>
            <div className="roll-gutter" style={{ width: GUTTER }}>
              {mode === 'staff' ? (
                <>
                  {[...TREBLE_LINES, ...BASS_LINES].map((li) => (
                    <div key={li} className="staff-line-stub" style={{ top: yForIdx(li) }} />
                  ))}
                  <span className="staff-clef" style={{ top: yForIdx(33), fontSize: 52 }}>
                    {'\u{1D11E}'}
                  </span>
                  <span className="staff-clef" style={{ top: yForIdx(20), fontSize: 34 }}>
                    {'\u{1D122}'}
                  </span>
                  {musicKey.flats.flatMap((letter, i) => [
                    <span
                      key={`t-${letter}`}
                      className="staff-keysig"
                      style={{ top: yForIdx(TREBLE_FLAT_IDX[letter]), left: 34 + i * 3.5 }}
                    >
                      ♭
                    </span>,
                    <span
                      key={`b-${letter}`}
                      className="staff-keysig"
                      style={{ top: yForIdx(BASS_FLAT_IDX[letter]), left: 34 + i * 3.5 }}
                    >
                      ♭
                    </span>,
                  ])}
                  <span className="staff-gutter-label" style={{ top: yForIdx(21) - 7 }}>c4</span>
                </>
              ) : (
                Array.from({ length: rows }, (_, r) => (
                  <div key={r} className="roll-row-label" style={{ height: rowH }}>
                    {rowLabel(r)}
                  </div>
                ))
              )}
            </div>
            <div
              ref={bodyRef}
              style={{ position: 'relative', width: W, height: H, cursor: 'pointer' }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={() => {
                if (drag.current) return
                hover.current = null
                requestAnimationFrame(() => drawRef.current())
              }}
            >
              <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, height: H, display: 'block' }} />
              <canvas
                ref={overlayRef}
                style={{ position: 'absolute', top: 0, left: 0, height: H, display: 'block', pointerEvents: 'none' }}
              />
              {marquee && (
                <div
                  className="roll-marquee"
                  style={{
                    left: Math.min(marquee.x0, marquee.x1),
                    top: Math.min(marquee.y0, marquee.y1),
                    width: Math.abs(marquee.x1 - marquee.x0),
                    height: Math.abs(marquee.y1 - marquee.y0),
                  }}
                />
              )}
              <div ref={playheadRef} className="playhead" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
