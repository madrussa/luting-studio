// Slim per-voice timeline: shows the voice's notes, tracks the playhead
// during main or solo playback, and scrubs (click/drag) to solo-play the
// voice from that point.

import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { ScheduledNote } from '../lib/luting'
import { getPlaybackInfo } from '../lib/player'
import { useActivePlayback } from '../lib/usePlayback'
import { instrumentColor } from './Timeline'

const H = 26
const LETTER_SEMI: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }
const pitchValue = (n: ScheduledNote): number =>
  n.midi ?? parseInt(n.drum![1], 10) * 12 + LETTER_SEMI[n.drum![2]]

interface Props {
  notes: ScheduledNote[]
  durationSec: number
  voiceId: string
  instrument: string
  onScrub: (timeSec: number) => void
}

export function VoiceStrip({ notes, durationSec, voiceId, instrument, onScrub }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const phRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const dragging = useRef(false)
  const lastSeek = useRef(0)
  const activeId = useActivePlayback()
  const tracking = activeId === voiceId || activeId === 'main'

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // note blocks
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width === 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = H * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, H)
    if (notes.length === 0 || durationSec === 0) return
    let lo = Infinity
    let hi = -Infinity
    for (const n of notes) {
      const v = pitchValue(n)
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    const span = Math.max(1, hi - lo)
    ctx.fillStyle = instrumentColor(instrument)
    ctx.globalAlpha = 0.8
    for (const n of notes) {
      const x = (n.timeSec / durationSec) * width
      const w = Math.max(1.5, (n.durSec / durationSec) * width - 0.3)
      const y = 2 + (1 - (pitchValue(n) - lo) / span) * (H - 7)
      ctx.fillRect(x, y, w, 3)
    }
    ctx.globalAlpha = 1
  }, [notes, durationSec, width, instrument])

  // playhead
  useEffect(() => {
    const ph = phRef.current
    if (!ph || width === 0) return
    if (!tracking) {
      ph.style.opacity = '0'
      return
    }
    ph.style.opacity = '1'
    let raf = 0
    const tick = () => {
      const info = getPlaybackInfo()
      if (!info) return
      const x = (Math.min(info.position, durationSec) / (durationSec || 1)) * width
      ph.style.transform = `translateX(${x}px)`
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [tracking, width, durationSec])

  const seekTo = (clientX: number) => {
    const el = wrapRef.current
    if (!el || durationSec === 0) return
    const rect = el.getBoundingClientRect()
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    onScrub(frac * durationSec)
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

  if (notes.length === 0) return null

  return (
    <div
      className="voice-strip"
      ref={wrapRef}
      style={{ height: H }}
      title="Click or drag to play this voice from here"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      <div ref={phRef} className="playhead" />
    </div>
  )
}
