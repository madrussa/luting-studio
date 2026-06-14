import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { parseLuting, INSTRUMENTS } from '../lib/luting'
import { playLuting, getPlaybackInfo } from '../lib/player'
import { useActivePlayback } from '../lib/usePlayback'
import { useTheme, canvasColors, getTheme } from '../lib/theme'

const HUES: Record<string, number> = {}
INSTRUMENTS.forEach((ins, i) => {
  HUES[ins.code] = (i * 137 + 210) % 360
})

export const instrumentColor = (code: string): string => {
  const hue = HUES[code] ?? 264
  if (getTheme() === 'light') {
    // Yellows/greens are perceptually bright, so they wash out on white at a
    // fixed lightness. Darken them by how close the hue is to the bright band
    // (~80°), leaving blues/reds/purples near the base lightness.
    const d = Math.min(Math.abs(hue - 80), 360 - Math.abs(hue - 80))
    const w = Math.max(0, 1 - d / 110)
    const l = 45 - 19 * w
    return `hsl(${hue} 72% ${l.toFixed(1)}%)`
  }
  return `hsl(${hue} 75% 68%)`
}

export interface Lane {
  icon: string
  label: string
}

export interface TrimUI {
  startSec: number | null
  endSec: number | null
  picking: 'start' | 'end' | 'done'
}

interface Props {
  luting: string
  lanes: Lane[]
  /** trim mode: clicks pick cut points instead of seeking */
  trim?: TrimUI | null
  onTrimPick?: (sec: number) => void
}

export function Timeline({ luting, lanes, trim, onTrimPick }: Props) {
  const parsed = useMemo(() => (luting ? parseLuting(luting) : null), [luting])
  const sortedNotes = useMemo(
    () => (parsed ? [...parsed.notes].sort((a, b) => a.timeSec - b.timeSec) : []),
    [parsed]
  )
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  const baseRef = useRef<HTMLCanvasElement>(null)
  const hlRef = useRef<HTMLCanvasElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [hoverSec, setHoverSec] = useState<number | null>(null)
  const theme = useTheme()
  const activeId = useActivePlayback()
  const dragging = useRef(false)
  const lastSeek = useRef(0)

  const laneCount = Math.max(lanes.length, 1)
  const laneH = Math.max(12, Math.min(26, Math.round(300 / laneCount)))
  const H = laneCount * laneH

  // Bind the ResizeObserver through a callback ref so it (re)attaches every
  // time the wrap element mounts. The timeline returns null when there are no
  // notes, so this element comes and goes (e.g. cut everything, then paste); a
  // one-shot effect would miss the remount and leave width stuck at 0, so the
  // canvas would never get sized or drawn.
  const setWrapRef = useCallback((el: HTMLDivElement | null) => {
    wrapRef.current = el
    roRef.current?.disconnect()
    roRef.current = null
    if (el) {
      const ro = new ResizeObserver(() => setWidth(el.clientWidth))
      ro.observe(el)
      roRef.current = ro
      setWidth(el.clientWidth)
    }
  }, [])

  const noteRect = (n: (typeof sortedNotes)[number], dur: number) => {
    const x = (n.timeSec / dur) * width
    const w = Math.max(2, (n.durSec / dur) * width - 0.4)
    const blockH = Math.max(2, Math.min(4, laneH / 5))
    let y: number
    if (n.midi !== undefined) {
      const rel = Math.max(0, Math.min(1, (n.midi - 24) / 83))
      y = n.voice * laneH + 2 + (1 - rel) * (laneH - 4 - blockH)
    } else {
      y = n.voice * laneH + laneH / 2 - blockH / 2
    }
    return { x, y, w, h: blockH }
  }

  // static piano roll
  useEffect(() => {
    const canvas = baseRef.current
    if (!canvas || !parsed || width === 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = H * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, H)
    const col = canvasColors()

    for (let i = 0; i < laneCount; i++) {
      ctx.fillStyle = i % 2 ? col.shadeB : col.shadeA
      ctx.fillRect(0, i * laneH, width, laneH)
    }
    const dur = parsed.durationSec || 1
    const step = dur > 90 ? 30 : dur > 30 ? 10 : 5
    ctx.fillStyle = col.bar
    ctx.font = '9px sans-serif'
    for (let s = step; s < dur; s += step) {
      const x = (s / dur) * width
      ctx.fillRect(x, 0, 1, H)
      ctx.fillText(`${s}s`, x + 3, 9)
    }

    for (const n of sortedNotes) {
      if (n.voice >= laneCount) continue
      const r = noteRect(n, dur)
      ctx.fillStyle = instrumentColor(n.instrument)
      ctx.globalAlpha = 0.75
      ctx.fillRect(r.x, r.y, r.w, r.h)
    }
    ctx.globalAlpha = 1
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, sortedNotes, width, laneCount, laneH, H, theme])

  // playhead + lit-up notes while playing
  useEffect(() => {
    const hl = hlRef.current
    const ph = playheadRef.current
    if (!hl || !ph || !parsed || width === 0) return
    const dpr = window.devicePixelRatio || 1
    hl.width = width * dpr
    hl.height = H * dpr
    const ctx = hl.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, H)
    if (activeId !== 'main') {
      ph.style.opacity = '0'
      return
    }
    ph.style.opacity = '1'
    const dur = parsed.durationSec || 1
    const ink = canvasColors().ink
    let raf = 0
    const tick = () => {
      const info = getPlaybackInfo()
      if (!info) return
      ph.style.transform = `translateX(${(info.position / dur) * width}px)`
      ctx.clearRect(0, 0, width, H)
      for (const n of sortedNotes) {
        if (n.timeSec > info.position) break
        if (n.timeSec + n.durSec < info.position || n.voice >= laneCount) continue
        const r = noteRect(n, dur)
        ctx.fillStyle = ink
        ctx.fillRect(r.x, r.y - 1, r.w, r.h + 2)
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, parsed, sortedNotes, width, laneCount, laneH, H, theme])

  if (!parsed || parsed.notes.length === 0) return null

  const seekTo = (clientX: number) => {
    const el = wrapRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    playLuting(luting, { id: 'main', startAt: frac * parsed.durationSec })
    lastSeek.current = Date.now()
  }

  const secAt = (clientX: number): number => {
    const rect = wrapRef.current!.getBoundingClientRect()
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return frac * parsed.durationSec
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    if (trim && onTrimPick) {
      onTrimPick(secAt(e.clientX))
      return
    }
    dragging.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    seekTo(e.clientX)
  }
  const onPointerMove = (e: ReactPointerEvent) => {
    setHoverSec(secAt(e.clientX))
    if (trim) return
    if (dragging.current && Date.now() - lastSeek.current > 250) seekTo(e.clientX)
  }
  const onPointerUp = (e: ReactPointerEvent) => {
    if (trim) return
    if (!dragging.current) return
    dragging.current = false
    if (Date.now() - lastSeek.current > 120) seekTo(e.clientX)
  }

  // trim overlay: shaded regions that will be removed, labelled in seconds
  const dur = parsed.durationSec || 1
  const startCut = trim ? (trim.startSec ?? (trim.picking === 'start' ? hoverSec : null)) : null
  const endCut = trim ? (trim.endSec ?? (trim.picking === 'end' ? hoverSec : null)) : null

  // seek guide: where a click would start playback, with the time, while hovering
  const showHover = !trim && hoverSec !== null
  const hoverFrac = showHover ? Math.max(0, Math.min(1, hoverSec! / dur)) : 0
  const hoverTx = hoverFrac < 0.06 ? '0' : hoverFrac > 0.94 ? '-100%' : '-50%'

  return (
    <div className="timeline">
      <div className="timeline-labels">
        {lanes.map((l, i) => (
          <div key={i} className="timeline-label" style={{ height: laneH }} title={l.label}>
            <span className="timeline-label-icon">{l.icon}</span>
            <span className="timeline-label-text">{l.label}</span>
          </div>
        ))}
      </div>
      <div
        className="timeline-canvas-wrap"
        ref={setWrapRef}
        style={{ height: H }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHoverSec(null)}
        title={trim ? undefined : 'Click or drag to play from here'}
      >
        <canvas ref={baseRef} className="timeline-canvas" />
        <canvas ref={hlRef} className="timeline-canvas timeline-hl" />
        <div ref={playheadRef} className="playhead" />
        {showHover && (
          <div className="timeline-hover" style={{ left: `${hoverFrac * 100}%` }}>
            <span className="timeline-hover-time" style={{ transform: `translateX(${hoverTx})` }}>
              {hoverSec!.toFixed(1)}s
            </span>
          </div>
        )}
        {startCut !== null && startCut > 0.005 && (
          <div className="trim-shade start" style={{ left: 0, width: `${(Math.min(startCut, dur) / dur) * 100}%` }}>
            <span>−{startCut.toFixed(1)}s</span>
          </div>
        )}
        {endCut !== null && endCut < dur - 0.005 && (
          <div
            className="trim-shade end"
            style={{ left: `${(Math.max(0, endCut) / dur) * 100}%`, width: `${((dur - Math.max(0, endCut)) / dur) * 100}%` }}
          >
            <span>−{(dur - endCut).toFixed(1)}s</span>
          </div>
        )}
      </div>
    </div>
  )
}
