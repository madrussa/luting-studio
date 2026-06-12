// Visual note editor for one voice: a piano roll (or drum grid for the
// Drumkit). Rows are pitches/drum sounds, columns are t1 grid units. Click an
// empty cell to add a note at the selected length, click a note to remove it.
// Every edit is serialized straight back into the voice's luting text.
//
// Zoom and horizontal scroll are shared across all open editors (rollView),
// so multiple voices stay column-aligned. The canvas is windowed: only the
// visible slice is drawn, so long tracks at any zoom stay cheap.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { serializeVoiceBody, midiToPitch, DRUM_SOUNDS } from '../lib/luting'
import type { ScheduledNote } from '../lib/luting'
import { notesToEvents, dominantVolume, scheduledToRollNotes } from '../lib/transform'
import type { RollNote } from '../lib/transform'
import { playLuting, getPlaybackInfo } from '../lib/player'
import { useActivePlayback } from '../lib/usePlayback'
import { useRollView, setRollView, getRollView, clampZoom } from '../lib/rollView'
import { instrumentColor } from './Timeline'
import { Minus, Plus, TriangleAlert } from 'lucide-react'

const MIDI_MAX = 107 // b7
const MIDI_MIN = 24 // c1
const MELODIC_ROWS = MIDI_MAX - MIDI_MIN + 1
const DRUM_KEYS = Object.keys(DRUM_SOUNDS)
const NOTE_LENGTHS = [1, 2, 3, 4, 6, 8, 12, 16]
const GUTTER = 52
const RULER = 16

interface Props {
  notes: ScheduledNote[]
  bpm: number
  instrument: string
  body: string
  /** song length in grid units, shared by all editors so they align */
  totalUnits: number
  /** playback id of this voice's solo, for playhead tracking */
  voiceId: string
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
  highlight,
  onScrub,
  onChangeBody,
}: Props) {
  const isDrum = instrument === 'd'
  const rows = isDrum ? DRUM_KEYS.length : MELODIC_ROWS
  const rowH = isDrum ? 16 : 10
  const H = rows * rowH

  const { pxPerUnit, scrollUnits } = useRollView()
  const [noteLen, setNoteLen] = useState(4)
  const [flash, setFlash] = useState<string | null>(null)
  const [viewW, setViewW] = useState(600)
  const scrollRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const rulerRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const hover = useRef<{ u: number; row: number } | null>(null)
  const rafRef = useRef(0)
  const drawRef = useRef<() => void>(() => {})
  const scrubbing = useRef(false)
  const lastScrub = useRef(0)
  const activeId = useActivePlayback()
  const tracking = activeId === voiceId || activeId === 'main'

  const unsupported = /[@~]/.test(body)
  const hasMacros = /[A-Z]/.test(body)

  const W = Math.max(viewW, totalUnits * pxPerUnit)

  const derived = useMemo(
    () => ({ notes: scheduledToRollNotes(parsedNotes, bpm), volume: dominantVolume(parsedNotes) }),
    [parsedNotes, bpm]
  )

  const rowForNote = (n: RollNote) => (isDrum ? DRUM_KEYS.indexOf(n.drum!) : MIDI_MAX - (n.midi ?? 60))

  // track visible width
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewW(Math.max(100, el.clientWidth - GUTTER)))
    ro.observe(el)
    setViewW(Math.max(100, el.clientWidth - GUTTER))
    return () => ro.disconnect()
  }, [])

  // scroll vertically to the content (or middle C) when opened
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const first = derived.notes[0]
    const row = first ? rowForNote(first) : isDrum ? 0 : MIDI_MAX - 60
    el.scrollTop = Math.max(0, row * rowH - el.clientHeight / 2)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // windowed canvas draw
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

    for (let r = 0; r < rows; r++) {
      const midi = MIDI_MAX - r
      const shade = isDrum ? r % 2 === 0 : Math.floor(midi / 12) % 2 === 0
      ctx.fillStyle = shade ? 'rgba(255,255,255,0.045)' : 'rgba(255,255,255,0.015)'
      ctx.fillRect(offset, r * rowH, cw, rowH)
      if (!isDrum && midi % 12 === 0) {
        ctx.fillStyle = 'rgba(90,209,179,0.10)'
        ctx.fillRect(offset, r * rowH, cw, rowH)
      }
    }
    // vertical grid: beats (4 units) and bars (16 units); thin out when zoomed far out
    const beatStep = pxPerUnit >= 1.5 ? 4 : 16
    const uFrom = Math.floor(offset / pxPerUnit / beatStep) * beatStep
    const uTo = Math.min(totalUnits, Math.ceil((offset + cw) / pxPerUnit))
    for (let u = uFrom; u <= uTo; u += beatStep) {
      ctx.fillStyle = u % 16 === 0 ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)'
      ctx.fillRect(u * pxPerUnit, 0, 1, H)
    }
    // notes (culled to the window)
    const color = instrumentColor(instrument)
    ctx.fillStyle = color
    for (const n of derived.notes) {
      const x = n.start * pxPerUnit
      const w = Math.max(2, n.dur * pxPerUnit - 1)
      if (x + w < offset || x > offset + cw) continue
      const r = rowForNote(n)
      if (r < 0) continue
      ctx.fillRect(x + 0.5, r * rowH + 1, w, rowH - 2)
    }
    // caret spotlight: crosshair bands + white-hot note(s) under the cursor
    if (highlight) {
      const picked: RollNote[] = []
      for (let k = highlight.from; k < highlight.from + highlight.count && k < derived.notes.length; k++) {
        if (rowForNote(derived.notes[k]) >= 0) picked.push(derived.notes[k])
      }
      // row + column background bands so the spot stands out at any zoom
      ctx.fillStyle = 'rgba(255,255,255,0.08)'
      for (const n of picked) {
        ctx.fillRect(n.start * pxPerUnit, 0, Math.max(2, n.dur * pxPerUnit), H)
        ctx.fillRect(offset, rowForNote(n) * rowH, cw, rowH)
      }
      // the note itself: white fill with a colored glow and ring
      ctx.shadowColor = color
      ctx.shadowBlur = 10
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1.5
      for (const n of picked) {
        const x = n.start * pxPerUnit
        const y = rowForNote(n) * rowH
        const w = Math.max(2, n.dur * pxPerUnit - 1)
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(x + 0.5, y + 1, w, rowH - 2)
        ctx.strokeRect(x - 1, y - 0.5, w + 2.5, rowH + 1)
      }
      ctx.shadowBlur = 0
    }
    if (hover.current) {
      const { u, row } = hover.current
      ctx.fillStyle = 'rgba(255,255,255,0.25)'
      ctx.fillRect(u * pxPerUnit + 0.5, row * rowH + 1, Math.max(2, noteLen * pxPerUnit - 1), rowH - 2)
    }
  }
  drawRef.current = draw
  useEffect(draw)

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
    const rTop = rowForNote(n) * rowH
    if (rTop < el.scrollTop + RULER + 4 || rTop > el.scrollTop + el.clientHeight - 30) {
      el.scrollTop = Math.max(0, rTop - el.clientHeight / 2)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight?.from, highlight?.count])

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

  // Ctrl+wheel zooms, anchored at the cursor. Needs a non-passive listener so
  // the browser's page zoom can be suppressed.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const view = getRollView()
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      const newPx = clampZoom(view.pxPerUnit * factor)
      if (newPx === view.pxPerUnit) return
      const body = bodyRef.current
      if (!body) return
      const cursorUnits = (e.clientX - body.getBoundingClientRect().left) / view.pxPerUnit
      const viewportX = e.clientX - el.getBoundingClientRect().left - GUTTER
      setRollView({ pxPerUnit: newPx, scrollUnits: Math.max(0, cursorUnits - viewportX / newPx) })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Playhead line + note-flash overlay, tracking solo or main playback.
  // Sounding notes glow in the instrument's color with a bright "pop" at
  // their onset that decays over ~250ms.
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
    let raf = 0
    const tick = () => {
      const info = getPlaybackInfo()
      if (!info) return
      const posU = info.position / unit
      ph.style.transform = `translateX(${posU * pxPerUnit}px)`

      // window the overlay to the visible slice, like the base canvas
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
        const x = n.start * pxPerUnit
        const w = Math.max(2, n.dur * pxPerUnit - 1)
        if (x + w < offset || x > offset + cw) continue
        const r = rowForNote(n)
        if (r < 0) continue
        const ageSec = (posU - n.start) * unit
        const flash = Math.exp(-ageSec * 9)
        const pad = flash * 2.5
        octx.shadowColor = color
        octx.shadowBlur = 6 + flash * 16
        octx.fillStyle = `rgba(255,255,255,${(0.55 + 0.45 * flash).toFixed(3)})`
        octx.fillRect(x - pad, r * rowH + 1 - pad, w + pad * 2, rowH - 2 + pad * 2)
      }
      octx.shadowBlur = 0
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => {
      cancelAnimationFrame(raf)
      clear()
    }
  }, [tracking, pxPerUnit, bpm, derived, viewW, W, H, rowH, instrument, isDrum])

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

  const locate = (e: ReactMouseEvent) => {
    const rect = bodyRef.current!.getBoundingClientRect()
    const u = Math.floor((e.clientX - rect.left) / pxPerUnit)
    const row = Math.floor((e.clientY - rect.top) / rowH)
    return { u: Math.max(0, u), row: Math.min(rows - 1, Math.max(0, row)) }
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

  const warn = (msg: string) => {
    setFlash(msg)
    setTimeout(() => setFlash(null), 2200)
  }

  const onClick = (e: ReactMouseEvent) => {
    const { u, row } = locate(e)
    const hit = derived.notes.find((n) => u >= n.start && u < n.start + n.dur && rowForNote(n) === row)
    if (hit) {
      commit(derived.notes.filter((n) => n !== hit))
      return
    }
    const note: RollNote = isDrum
      ? { start: u, dur: 1, drum: DRUM_KEYS[row] }
      : { start: u, dur: noteLen, midi: MIDI_MAX - row }
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

  const onMove = (e: ReactMouseEvent) => {
    const pos = locate(e)
    if (hover.current?.u !== pos.u || hover.current?.row !== pos.row) {
      hover.current = pos
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
    <div className="roll">
      <div className="roll-toolbar">
        <span className="roll-tool">
          Note length
          <select value={noteLen} onChange={(e) => setNoteLen(parseInt(e.target.value, 10))} disabled={isDrum}>
            {NOTE_LENGTHS.map((l) => (
              <option key={l} value={l}>
                {l} unit{l > 1 ? 's' : ''}
              </option>
            ))}
          </select>
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
        <span className="roll-hint">click empty = add · click note = remove · ctrl/cmd+wheel = zoom · 4 units = 1 beat · zoom &amp; scroll are shared across editors</span>
      </div>
      {hasMacros && (
        <div className="roll-note">
          <TriangleAlert size={13} /> This voice uses macros — the first edit rewrites it as plain notes
          (later voices reusing its macros would break).
        </div>
      )}
      {flash && <div className="roll-note warning">{flash}</div>}
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
              {Array.from({ length: rows }, (_, r) => (
                <div key={r} className="roll-row-label" style={{ height: rowH }}>
                  {rowLabel(r)}
                </div>
              ))}
            </div>
            <div
              ref={bodyRef}
              style={{ position: 'relative', width: W, height: H, cursor: 'pointer' }}
              onClick={onClick}
              onMouseMove={onMove}
              onMouseLeave={() => {
                hover.current = null
                requestAnimationFrame(() => drawRef.current())
              }}
            >
              <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, height: H, display: 'block' }} />
              <canvas
                ref={overlayRef}
                style={{ position: 'absolute', top: 0, left: 0, height: H, display: 'block', pointerEvents: 'none' }}
              />
              <div ref={playheadRef} className="playhead" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
