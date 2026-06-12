import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { parseLuting, INSTRUMENTS } from '../lib/luting'
import { playLuting, getPlaybackInfo } from '../lib/player'
import { useActivePlayback } from '../lib/usePlayback'

const COLORS: Record<string, string> = {}
INSTRUMENTS.forEach((ins, i) => {
  COLORS[ins.code] = `hsl(${(i * 137 + 210) % 360} 80% 68%)`
})

export const instrumentColor = (code: string): string => COLORS[code] ?? '#9d7bff'

export interface Lane {
  icon: string
  label: string
}

interface Props {
  luting: string
  lanes: Lane[]
}

export function Timeline({ luting, lanes }: Props) {
  const parsed = useMemo(() => (luting ? parseLuting(luting) : null), [luting])
  const sortedNotes = useMemo(
    () => (parsed ? [...parsed.notes].sort((a, b) => a.timeSec - b.timeSec) : []),
    [parsed]
  )
  const wrapRef = useRef<HTMLDivElement>(null)
  const baseRef = useRef<HTMLCanvasElement>(null)
  const hlRef = useRef<HTMLCanvasElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const activeId = useActivePlayback()
  const dragging = useRef(false)
  const lastSeek = useRef(0)

  const laneCount = Math.max(lanes.length, 1)
  const laneH = Math.max(12, Math.min(26, Math.round(300 / laneCount)))
  const H = laneCount * laneH

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
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

    for (let i = 0; i < laneCount; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.05)'
      ctx.fillRect(0, i * laneH, width, laneH)
    }
    const dur = parsed.durationSec || 1
    const step = dur > 90 ? 30 : dur > 30 ? 10 : 5
    ctx.fillStyle = 'rgba(255,255,255,0.08)'
    ctx.font = '9px sans-serif'
    for (let s = step; s < dur; s += step) {
      const x = (s / dur) * width
      ctx.fillRect(x, 0, 1, H)
      ctx.fillText(`${s}s`, x + 3, 9)
    }

    for (const n of sortedNotes) {
      if (n.voice >= laneCount) continue
      const r = noteRect(n, dur)
      ctx.fillStyle = COLORS[n.instrument] ?? '#9d7bff'
      ctx.globalAlpha = 0.7
      ctx.fillRect(r.x, r.y, r.w, r.h)
    }
    ctx.globalAlpha = 1
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, sortedNotes, width, laneCount, laneH, H])

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
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(r.x, r.y - 1, r.w, r.h + 2)
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, parsed, sortedNotes, width, laneCount, laneH, H])

  if (!parsed || parsed.notes.length === 0) return null

  const seekTo = (clientX: number) => {
    const el = wrapRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    playLuting(luting, { id: 'main', startAt: frac * parsed.durationSec })
    lastSeek.current = Date.now()
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    dragging.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    seekTo(e.clientX)
  }
  const onPointerMove = (e: ReactPointerEvent) => {
    if (dragging.current && Date.now() - lastSeek.current > 250) seekTo(e.clientX)
  }
  const onPointerUp = (e: ReactPointerEvent) => {
    if (!dragging.current) return
    dragging.current = false
    if (Date.now() - lastSeek.current > 120) seekTo(e.clientX)
  }

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
        ref={wrapRef}
        style={{ height: H }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title="Click or drag to play from here"
      >
        <canvas ref={baseRef} className="timeline-canvas" />
        <canvas ref={hlRef} className="timeline-canvas timeline-hl" />
        <div ref={playheadRef} className="playhead" />
      </div>
    </div>
  )
}
