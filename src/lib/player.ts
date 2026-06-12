// In-browser preview synth. Not luteboi's real soundfonts — a Web Audio
// approximation so lutings can be auditioned without leaving the page.

import { parseLuting, DRUM_SOUNDS } from './luting'
import type { ScheduledNote } from './luting'

interface SynthConfig {
  wave: OscillatorType
  style: 'pluck' | 'sustain'
  /** lowpass cutoff as a multiple of the note frequency */
  cutoff: number
  release: number
  gain: number
  /** add an oscillator one octave down */
  sub?: boolean
  /** vibrato depth in cents */
  vibrato?: number
  /** shift the whole instrument up/down by octaves */
  octaveShift?: number
  /** onset glide in cents (positive = start sharp, negative = start flat) */
  glide?: number
  /** roughness: detuned second oscillator + breathy noise */
  grain?: boolean
  /**
   * vocal formant: a bandpass resonance at ~4x the fundamental, pinned to
   * the 1.0–2.6 kHz band. Measured from luteboi's real "The Cat" renders,
   * where the 4th harmonic dominates (h4=1.0, h5=0.6, h1=0.08 at C4) and the
   * peak sits near 1.04 kHz for C3/C4.
   */
  formant?: boolean
}

const SYNTHS: Record<string, SynthConfig> = {
  l: { wave: 'triangle', style: 'pluck', cutoff: 6, release: 0.3, gain: 1 },
  b: { wave: 'sawtooth', style: 'pluck', cutoff: 3, release: 0.2, gain: 1.1, sub: true },
  f: { wave: 'sine', style: 'sustain', cutoff: 8, release: 0.1, gain: 1 },
  k: { wave: 'triangle', style: 'pluck', cutoff: 9, release: 0.4, gain: 1 },
  c: { wave: 'square', style: 'sustain', cutoff: 12, release: 0.02, gain: 0.5 },
  // tuned against real luteboi renders: written pitch (no octave shift), a
  // rise from ~70 cents flat into the note, ±15 cent waver, ~100ms release
  m: { wave: 'sawtooth', style: 'sustain', cutoff: 6, release: 0.1, gain: 1.5, vibrato: 15, glide: -70, grain: true, formant: true },
  t: { wave: 'sine', style: 'pluck', cutoff: 4, release: 0.15, gain: 1.2 },
  p: { wave: 'triangle', style: 'pluck', cutoff: 5, release: 0.1, gain: 1.1 },
  d: { wave: 'triangle', style: 'pluck', cutoff: 5, release: 0.1, gain: 1 }, // unused; drums use generators
  a: { wave: 'sine', style: 'pluck', cutoff: 10, release: 1.4, gain: 0.9 },
  o: { wave: 'sawtooth', style: 'sustain', cutoff: 4, release: 0.15, gain: 0.7, sub: true },
  e: { wave: 'sawtooth', style: 'sustain', cutoff: 2.5, release: 0.25, gain: 0.8, vibrato: 12 },
  v: { wave: 'sawtooth', style: 'sustain', cutoff: 5, release: 0.2, gain: 0.7, vibrato: 18 },
  g: { wave: 'sine', style: 'sustain', cutoff: 6, release: 0.08, gain: 1 },
  h: { wave: 'sawtooth', style: 'sustain', cutoff: 3.5, release: 0.15, gain: 0.8 },
  i: { wave: 'sine', style: 'pluck', cutoff: 12, release: 1.1, gain: 0.9, vibrato: 10 },
  j: { wave: 'square', style: 'sustain', cutoff: 3, release: 0.1, gain: 0.55 },
  s: { wave: 'sawtooth', style: 'sustain', cutoff: 4.5, release: 0.12, gain: 0.75, vibrato: 14 },
  n: { wave: 'square', style: 'sustain', cutoff: 5, release: 0.1, gain: 0.5 },
  q: { wave: 'triangle', style: 'pluck', cutoff: 4, release: 0.12, gain: 1.2, sub: true },
}

let noiseBuffer: AudioBuffer | null = null
function getNoise(ctx: BaseAudioContext): AudioBuffer {
  if (!noiseBuffer || noiseBuffer.sampleRate !== ctx.sampleRate) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }
  return noiseBuffer
}

function scheduleMelodic(ctx: AudioContext, dest: AudioNode, n: ScheduledNote, t0: number) {
  const cfg = SYNTHS[n.instrument] ?? SYNTHS.l
  const freq = 440 * Math.pow(2, ((n.midi ?? 60) - 69) / 12 + (cfg.octaveShift ?? 0))
  const start = t0 + n.timeSec
  const holdEnd = start + Math.max(0.03, n.durSec - 0.02)
  const stopAt = holdEnd + (cfg.style === 'pluck' ? Math.max(cfg.release, 0.1) : cfg.release) + 0.05

  const gain = ctx.createGain()
  const filter = ctx.createBiquadFilter()
  let bodyFilter: BiquadFilterNode | null = null
  if (cfg.formant) {
    filter.type = 'bandpass'
    filter.frequency.value = Math.min(2600, Math.max(1000, freq * 4))
    filter.Q.value = 5
    // a quiet direct path keeps the fundamental's body, stronger on low
    // notes (the real C3 render keeps h1 at 0.89; C4 suppresses it to 0.08)
    bodyFilter = ctx.createBiquadFilter()
    bodyFilter.type = 'lowpass'
    bodyFilter.frequency.value = freq * 2.5
    const bodyGain = ctx.createGain()
    bodyGain.gain.value = Math.min(0.35, 18 / freq)
    bodyFilter.connect(bodyGain)
    bodyGain.connect(gain)
  } else {
    filter.type = 'lowpass'
    filter.frequency.value = Math.min(16000, freq * cfg.cutoff)
  }
  filter.connect(gain)
  gain.connect(dest)

  const peak = cfg.gain * n.volume * 0.22
  const g = gain.gain
  g.setValueAtTime(0, start)
  if (cfg.style === 'pluck') {
    g.linearRampToValueAtTime(peak, start + 0.005)
    const decayEnd = Math.min(holdEnd, start + 2.5)
    g.exponentialRampToValueAtTime(Math.max(peak * 0.05, 0.001), decayEnd + cfg.release)
    g.linearRampToValueAtTime(0, stopAt)
  } else {
    g.linearRampToValueAtTime(peak, start + 0.04)
    g.setValueAtTime(peak, holdEnd)
    g.linearRampToValueAtTime(0, holdEnd + cfg.release)
  }

  const oscs: OscillatorNode[] = []
  const main = ctx.createOscillator()
  main.type = cfg.wave
  if (cfg.glide) {
    main.frequency.setValueAtTime(freq * Math.pow(2, cfg.glide / 1200), start)
    main.frequency.exponentialRampToValueAtTime(freq, start + 0.22)
  } else {
    main.frequency.value = freq
  }
  oscs.push(main)
  if (cfg.sub) {
    const sub = ctx.createOscillator()
    sub.type = 'sine'
    sub.frequency.value = freq / 2
    oscs.push(sub)
  }
  if (cfg.grain) {
    // beating detuned partner for roughness
    const rough = ctx.createOscillator()
    rough.type = cfg.wave
    rough.frequency.value = freq
    rough.detune.value = 15
    oscs.push(rough)
    // breathy band of noise riding the same envelope
    const noise = ctx.createBufferSource()
    noise.buffer = getNoise(ctx)
    noise.loop = true
    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = Math.min(9000, freq * 3)
    band.Q.value = 1.5
    const noiseGain = ctx.createGain()
    noiseGain.gain.value = 0.3
    noise.connect(band)
    band.connect(noiseGain)
    noiseGain.connect(filter)
    noise.start(start)
    noise.stop(stopAt)
  }
  if (cfg.vibrato) {
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 5.5
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = (cfg.vibrato / 1200) * freq
    lfo.connect(lfoGain)
    lfoGain.connect(main.frequency)
    lfo.start(start)
    lfo.stop(stopAt)
  }
  for (const o of oscs) {
    o.connect(filter)
    if (bodyFilter) o.connect(bodyFilter)
    o.start(start)
    o.stop(stopAt)
  }
}

function noiseBurst(
  ctx: AudioContext,
  dest: AudioNode,
  start: number,
  dur: number,
  vol: number,
  filterType: BiquadFilterType,
  freq: number,
  q = 1
) {
  const src = ctx.createBufferSource()
  src.buffer = getNoise(ctx)
  src.loop = true
  const filter = ctx.createBiquadFilter()
  filter.type = filterType
  filter.frequency.value = freq
  filter.Q.value = q
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(vol, start)
  gain.gain.exponentialRampToValueAtTime(0.001, start + dur)
  src.connect(filter)
  filter.connect(gain)
  gain.connect(dest)
  src.start(start)
  src.stop(start + dur + 0.02)
}

function pitchedHit(
  ctx: AudioContext,
  dest: AudioNode,
  start: number,
  dur: number,
  vol: number,
  freqFrom: number,
  freqTo: number,
  wave: OscillatorType = 'sine'
) {
  const osc = ctx.createOscillator()
  osc.type = wave
  osc.frequency.setValueAtTime(freqFrom, start)
  osc.frequency.exponentialRampToValueAtTime(Math.max(freqTo, 1), start + dur)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(vol, start)
  gain.gain.exponentialRampToValueAtTime(0.001, start + dur)
  osc.connect(gain)
  gain.connect(dest)
  osc.start(start)
  osc.stop(start + dur + 0.02)
}

function scheduleDrum(ctx: AudioContext, dest: AudioNode, n: ScheduledNote, t0: number) {
  const sound = DRUM_SOUNDS[n.drum ?? '']
  if (!sound) return
  const start = t0 + n.timeSec
  const v = n.volume * 0.5
  switch (sound.gen) {
    case 'kick':
      pitchedHit(ctx, dest, start, 0.18, v * 1.6, 130, 40)
      break
    case 'hollowkick':
      pitchedHit(ctx, dest, start, 0.28, v * 1.4, 90, 30)
      break
    case 'tom':
      pitchedHit(ctx, dest, start, 0.25, v * 1.2, (sound.freq ?? 120) * 1.4, sound.freq ?? 120)
      break
    case 'bongo':
      pitchedHit(ctx, dest, start, 0.12, v, (sound.freq ?? 220) * 1.2, sound.freq ?? 220)
      break
    case 'wood':
      pitchedHit(ctx, dest, start, 0.07, v, sound.freq ?? 700, (sound.freq ?? 700) * 0.9, 'triangle')
      break
    case 'rim':
      noiseBurst(ctx, dest, start, 0.04, v, 'bandpass', 2500, 4)
      pitchedHit(ctx, dest, start, 0.03, v * 0.6, 1700, 1500, 'triangle')
      break
    case 'snare':
      pitchedHit(ctx, dest, start, 0.1, v * 0.7, 220, 160)
      noiseBurst(ctx, dest, start, 0.16, v * 0.9, 'highpass', 1500)
      break
    case 'brush':
      noiseBurst(ctx, dest, start, 0.2, v * 0.6, 'highpass', 2500)
      break
    case 'clap':
      noiseBurst(ctx, dest, start, 0.02, v, 'bandpass', 1200, 2)
      noiseBurst(ctx, dest, start + 0.025, 0.12, v, 'bandpass', 1200, 2)
      break
    case 'hhclosed':
      noiseBurst(ctx, dest, start, 0.05, v * 0.7, 'highpass', 7000)
      break
    case 'hhopen':
      noiseBurst(ctx, dest, start, 0.35, v * 0.7, 'highpass', 7000)
      break
    case 'cymbal':
      noiseBurst(ctx, dest, start, 0.5, v * 0.5, 'highpass', 5000)
      break
    case 'crash':
      noiseBurst(ctx, dest, start, 1.1, v * 0.7, 'highpass', 4000)
      break
    case 'tambourine':
      noiseBurst(ctx, dest, start, 0.12, v * 0.6, 'bandpass', 6500, 2)
      break
    case 'triangle':
      pitchedHit(ctx, dest, start, 0.8, v * 0.5, sound.freq ?? 3500, sound.freq ?? 3500)
      break
    case 'cowbell':
      pitchedHit(ctx, dest, start, 0.18, v * 0.7, 800, 780, 'square')
      pitchedHit(ctx, dest, start, 0.18, v * 0.5, 540, 525, 'square')
      break
    case 'ding':
      pitchedHit(ctx, dest, start, 1.2, v * 0.6, 1860, 1850)
      break
  }
}

export interface PlayHandle {
  stop: () => void
  durationSec: number
}

export interface PlayOptions {
  /** identifies who started playback, so UI buttons can show their own state */
  id?: string
  /** play only this voice index, with macros from all voices still resolving */
  soloVoice?: number
  /** start playback this many seconds into the luting */
  startAt?: number
  onEnded?: () => void
}

let active: {
  ctx: AudioContext
  timer: number
  pump: number
  id: string
  t0: number
  startAt: number
  total: number
} | null = null
const listeners = new Set<() => void>()

export const getActivePlaybackId = (): string | null => active?.id ?? null

export interface PlaybackInfo {
  id: string
  position: number
  duration: number
}

/** Current playback position, for the timeline playhead. */
export function getPlaybackInfo(): PlaybackInfo | null {
  if (!active) return null
  const elapsed = active.ctx.currentTime - active.t0
  return {
    id: active.id,
    position: Math.max(active.startAt, Math.min(active.startAt + elapsed, active.total)),
    duration: active.total,
  }
}

export function subscribePlayback(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

const notify = () => {
  for (const cb of [...listeners]) cb()
}

export function stopPlayback() {
  if (active) {
    window.clearTimeout(active.timer)
    window.clearInterval(active.pump)
    void active.ctx.close()
    active = null
    notify()
  }
}

export function playLuting(text: string, opts: PlayOptions = {}): PlayHandle {
  stopPlayback()
  const { notes, durationSec } = parseLuting(text, { soloVoice: opts.soloVoice })
  const startAt = Math.max(0, Math.min(opts.startAt ?? 0, durationSec))
  const ctx = new AudioContext()
  const master = ctx.createGain()
  master.gain.value = 0.5
  const comp = ctx.createDynamicsCompressor()
  master.connect(comp)
  comp.connect(ctx.destination)

  const t0 = ctx.currentTime + 0.08

  // Clip the schedule to the seek point and sort it.
  const queue: ScheduledNote[] = []
  for (const n of notes) {
    const end = n.timeSec + n.durSec
    if (end <= startAt + 0.005) continue
    if (n.drum && n.timeSec < startAt) continue // don't re-fire half-played drums
    // a melodic note already sounding at the seek point plays its remainder
    queue.push(
      n.timeSec < startAt ? { ...n, timeSec: 0, durSec: end - startAt } : { ...n, timeSec: n.timeSec - startAt }
    )
  }
  queue.sort((a, b) => a.timeSec - b.timeSec)

  // Schedule just-in-time in a rolling window. Creating every node upfront
  // chokes the audio thread on big songs (thousands of notes); a window keeps
  // the live node count bounded no matter how long the luting is.
  const AHEAD_SEC = 8
  let idx = 0
  const scheduleWindow = () => {
    const limit = ctx.currentTime - t0 + AHEAD_SEC
    while (idx < queue.length && queue[idx].timeSec <= limit) {
      const n = queue[idx++]
      let dest: AudioNode = master
      if (n.pan !== 0) {
        const pan = ctx.createStereoPanner()
        pan.pan.value = n.pan
        pan.connect(master)
        dest = pan
      }
      if (n.drum) scheduleDrum(ctx, dest, n, t0)
      else scheduleMelodic(ctx, dest, n, t0)
    }
  }
  scheduleWindow()
  const pump = window.setInterval(scheduleWindow, 2000)

  const timer = window.setTimeout(() => {
    stopPlayback()
    opts.onEnded?.()
  }, (durationSec - startAt + 1.5) * 1000)
  active = { ctx, timer, pump, id: opts.id ?? 'main', t0, startAt, total: durationSec }
  notify()
  return { stop: stopPlayback, durationSec }
}

/** Quick audition for the instrument palette. Toggles off when already playing. */
export function previewInstrument(code: string) {
  const id = `instrument:${code}`
  if (getActivePlaybackId() === id) {
    stopPlayback()
    return
  }
  if (code === 'd') {
    playLuting('#lute 240 ido0ao3co4co3c', { id })
  } else {
    playLuting(`#lute 480 i${code}t2ceg(ceg)4`, { id })
  }
}
