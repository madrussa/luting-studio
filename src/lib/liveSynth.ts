// Live (MIDI-driven) synth: play the board's voices from a hardware keyboard.
// Unlike the scheduled preview, a live note's length isn't known upfront —
// note-on starts it and note-off releases it — so sustained instruments hold
// their envelope open until the key comes up. Plucks and drums fire their
// natural decay on note-on and a release only damps them early.

import {
  SYNTHS,
  buildMelodicGraph,
  karplusBuffer,
  scheduleDrum,
  scheduleNoisePerc,
  BASE_GAIN,
  getMasterVolume,
} from './player'
import { DRUM_SOUNDS, midiToPitch } from './luting'
import type { ScheduledNote } from './luting'
import { getPlaybackMode, getBank, loadBank } from './samples'

// GM percussion key -> DRUM_SOUNDS key, so drum pads / GM keyboards land on
// the right luteboi drum. Kept in sync with the MIDI-file converter's map.
import { GM_DRUM } from './convert'

let ctx: AudioContext | null = null
let master: GainNode | null = null

/**
 * Create (or resume) the live audio context. Must be called from a user
 * gesture (the "enable MIDI" click) — MIDI messages themselves don't satisfy
 * the browser's autoplay policy, so a context created on note-on would stay
 * suspended and silent.
 */
export function ensureLiveAudio(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.gain.value = BASE_GAIN * getMasterVolume()
    const comp = ctx.createDynamicsCompressor()
    master.connect(comp)
    comp.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

interface LiveNote {
  /** ramp the note out from a key release */
  release: (at: number) => void
  /** near-instant damp, for retriggering the same key */
  kill: (at: number) => void
}

const held = new Map<string, LiveNote>()

const noteKey = (instrument: string, midi: number) => `${instrument}:${midi}`

/** velocity 0..1 -> luting-ish volume: quiet touches stay audible */
const velToVol = (velocity: number) => 0.3 + 0.7 * Math.min(1, Math.max(0, velocity))

function liveKarplus(c: AudioContext, dest: AudioNode, midi: number, volume: number, start: number): LiveNote {
  const cfg = SYNTHS.l
  const freq = 440 * Math.pow(2, (midi - 69) / 12 + (cfg.octaveShift ?? 0))
  const src = c.createBufferSource()
  // a fixed ring length: long enough to feel like an open string, short
  // enough that the (cached) buffer render stays instant
  src.buffer = karplusBuffer(c, freq, 1.2)
  const g = c.createGain()
  const peak = cfg.gain * volume * 0.5
  g.gain.setValueAtTime(0, start)
  g.gain.linearRampToValueAtTime(peak, start + 0.002)
  src.connect(g)
  g.connect(dest)
  src.start(start)
  src.stop(start + src.buffer.duration + 0.02)
  const damp = (at: number, tau: number) => {
    g.gain.setTargetAtTime(0, at, tau)
    try {
      src.stop(at + tau * 8)
    } catch {
      // already ended
    }
  }
  return {
    // lifting the key damps the string like lifting a fretting finger
    release: (at) => damp(at, 0.05),
    kill: (at) => damp(at, 0.008),
  }
}

function liveMelodic(c: AudioContext, dest: AudioNode, instrument: string, midi: number, volume: number, start: number): LiveNote {
  const cfg = SYNTHS[instrument] ?? SYNTHS.l
  const freq = 440 * Math.pow(2, (midi - 69) / 12 + (cfg.octaveShift ?? 0))
  const { gain, stop } = buildMelodicGraph(c, dest, cfg, freq, start)
  const peak = cfg.gain * volume * 0.22
  const atk = cfg.attack ?? (cfg.style === 'pluck' ? 0.005 : 0.04)
  const g = gain.gain
  g.setValueAtTime(0, start)
  g.linearRampToValueAtTime(peak, start + atk)
  if (cfg.style === 'pluck') {
    // open-ended natural decay; setTargetAtTime picks up smoothly from
    // wherever the envelope is, so the release below needs no cancel
    g.setTargetAtTime(0, start + atk, (cfg.decay ?? 2.5) / 3)
  }
  // safety net for stuck notes (device unplugged mid-note, missed note-off)
  stop(start + 60)
  const out = (at: number, tau: number) => {
    g.setTargetAtTime(0, at, tau)
    stop(at + tau * 8 + 0.05)
  }
  return {
    release: (at) => out(at, Math.max(cfg.release, 0.03) / 2),
    kill: (at) => out(at, 0.008),
  }
}

// LuteBoi's note-end ring-down time constant (exp(-n/3000) at 44.1kHz ≈ 68ms),
// the same shape samples.ts applies to scheduled notes.
const SAMPLE_RELEASE_TAU = 3000 / 44100

/**
 * Live note from a real sample pack (Quality mode). Ping-pong-looped banks
 * sustain indefinitely — exactly what a held key needs — and one-shot banks
 * just play out like a pluck. Returns null when the pack isn't loaded (yet),
 * so the caller falls back to the synth.
 */
function liveSampled(c: AudioContext, dest: AudioNode, instrument: string, midi: number, volume: number, start: number): LiveNote | null {
  const bank = getBank(instrument)
  if (!bank || bank.melodic.length === 0) return null
  let best = bank.melodic[0]
  for (const e of bank.melodic) if (Math.abs(e.midi - midi) < Math.abs(best.midi - midi)) best = e

  const src = c.createBufferSource()
  src.buffer = best.buffer
  src.playbackRate.value = Math.pow(2, (midi - best.midi) / 12)
  if (bank.loop) {
    src.loop = true
    src.loopStart = best.loopStart
    src.loopEnd = best.loopEnd
  }

  const g = c.createGain()
  const peak = volume * 0.8
  g.gain.setValueAtTime(0, start)
  g.gain.linearRampToValueAtTime(peak, start + 0.005)
  src.connect(g)
  g.connect(dest)
  src.start(start)
  if (bank.loop) {
    src.stop(start + 120) // stuck-note safety net; note-off re-schedules this
  } else {
    src.stop(start + best.buffer.duration / src.playbackRate.value + 0.02)
  }
  const damp = (at: number, tau: number) => {
    g.gain.setTargetAtTime(0, at, tau)
    try {
      src.stop(at + tau * 8 + 0.05)
    } catch {
      // already ended
    }
  }
  return {
    release: (at) => damp(at, SAMPLE_RELEASE_TAU),
    kill: (at) => damp(at, 0.008),
  }
}

const ONESHOT: LiveNote = { release: () => {}, kill: () => {} }

function liveOneShot(c: AudioContext, dest: AudioNode, instrument: string, midi: number, volume: number): LiveNote {
  const n: ScheduledNote = { timeSec: 0, durSec: 0.25, instrument, volume, pan: 0, voice: 0 }
  if (instrument === 'd') {
    // GM drum note if the pad sends one, else the luteboi drum-map pitch
    const p = GM_DRUM[midi] ?? midiToPitch(midi)
    const key = `o${p.octave}${p.letter[0]}`
    if (!DRUM_SOUNDS[key]) return ONESHOT
    // Quality mode: the real drum sample when its pack is loaded
    const buffer = getPlaybackMode() === 'quality' ? getBank('d')?.drums[key] : undefined
    if (buffer) {
      const src = c.createBufferSource()
      src.buffer = buffer
      const g = c.createGain()
      g.gain.value = volume * 0.9
      src.connect(g)
      g.connect(dest)
      src.start(c.currentTime)
      src.stop(c.currentTime + buffer.duration + 0.02)
    } else {
      scheduleDrum(c, dest, { ...n, drum: key }, c.currentTime)
    }
  } else {
    scheduleNoisePerc(c, dest, n, c.currentTime)
  }
  return ONESHOT
}

/**
 * Start a live note. Notes ride the same master-volume setting as the
 * preview player. In Quality mode the real sample packs are used — looped
 * banks sustain while the key is held — falling back to the built-in synth
 * until the pack has loaded (or for the always-synthesized instruments).
 */
export function liveNoteOn(instrument: string, midi: number, velocity: number) {
  if (!ctx || !master) return // not enabled yet
  if (ctx.state === 'suspended') void ctx.resume()
  master.gain.setTargetAtTime(BASE_GAIN * getMasterVolume(), ctx.currentTime, 0.02)

  const key = noteKey(instrument, midi)
  const start = ctx.currentTime
  // retrigger: damp the still-held instance of this key first
  held.get(key)?.kill(start)

  const quality = getPlaybackMode() === 'quality'
  if (quality) void loadBank(instrument) // no-op if loaded or synth-only

  const volume = velToVol(velocity)
  let note: LiveNote
  if (instrument === 'd' || instrument === 'p') {
    note = liveOneShot(ctx, master, instrument, midi, volume)
  } else {
    note =
      (quality ? liveSampled(ctx, master, instrument, midi, volume, start) : null) ??
      (instrument === 'l'
        ? liveKarplus(ctx, master, midi, volume, start)
        : liveMelodic(ctx, master, instrument, midi, volume, start))
  }
  held.set(key, note)
}

export function liveNoteOff(instrument: string, midi: number) {
  if (!ctx) return
  const key = noteKey(instrument, midi)
  held.get(key)?.release(ctx.currentTime)
  held.delete(key)
}

/** Release everything (device switch, panel closed, recording aborted). */
export function stopAllLive() {
  if (!ctx) return
  const at = ctx.currentTime
  for (const note of held.values()) note.release(at)
  held.clear()
}
