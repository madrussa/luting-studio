// Offline render: luting text -> AudioBuffer -> WAV / MP3 downloads.
// Uses the exact same per-note scheduling as the live preview (synth or
// Quality samples), just into an OfflineAudioContext, so what you export is
// what you heard.

import { Mp3Encoder } from '@breezystack/lamejs'
import { parseLuting } from './luting'
import { scheduleNote, BASE_GAIN } from './player'
import { getPlaybackMode, loadBank } from './samples'

const TAIL_SEC = 1.5 // room for the last note's release/ring

export async function renderLuting(text: string, sampleRate = 44100): Promise<AudioBuffer> {
  const { notes, durationSec } = parseLuting(text)
  if (notes.length === 0) throw new Error('Nothing to render.')

  // In Quality mode, make sure every pack is in memory before rendering —
  // an offline render can't upgrade mid-flight like the rolling preview.
  if (getPlaybackMode() === 'quality') {
    await Promise.all([...new Set(notes.map((n) => n.instrument))].map((c) => loadBank(c)))
  }

  const ctx = new OfflineAudioContext(2, Math.ceil((durationSec + TAIL_SEC) * sampleRate), sampleRate)
  // same chain as the preview, minus the user's volume slider — exports are
  // at nominal level so they sound the same on every machine
  const master = ctx.createGain()
  master.gain.value = BASE_GAIN
  const comp = ctx.createDynamicsCompressor()
  master.connect(comp)
  comp.connect(ctx.destination)

  const t0 = 0.05
  for (const n of notes) scheduleNote(ctx, master, n, t0)
  return ctx.startRendering()
}

// ---- encoders ---------------------------------------------------------------

const f32ToI16 = (f: Float32Array): Int16Array => {
  const out = new Int16Array(f.length)
  for (let i = 0; i < f.length; i++) {
    const s = Math.max(-1, Math.min(1, f[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

/** 16-bit PCM WAV (stereo or mono, whatever the buffer holds). */
export function audioBufferToWav(buf: AudioBuffer): Blob {
  const numCh = buf.numberOfChannels
  const sr = buf.sampleRate
  const chans = Array.from({ length: numCh }, (_, c) => f32ToI16(buf.getChannelData(c)))
  const dataLen = buf.length * numCh * 2
  const out = new DataView(new ArrayBuffer(44 + dataLen))

  let p = 0
  const str = (s: string) => {
    for (let i = 0; i < s.length; i++) out.setUint8(p++, s.charCodeAt(i))
  }
  const u32 = (v: number) => {
    out.setUint32(p, v, true)
    p += 4
  }
  const u16 = (v: number) => {
    out.setUint16(p, v, true)
    p += 2
  }
  str('RIFF')
  u32(36 + dataLen)
  str('WAVE')
  str('fmt ')
  u32(16)
  u16(1) // PCM
  u16(numCh)
  u32(sr)
  u32(sr * numCh * 2) // byte rate
  u16(numCh * 2) // block align
  u16(16) // bits per sample
  str('data')
  u32(dataLen)
  for (let i = 0; i < buf.length; i++) {
    for (let c = 0; c < numCh; c++) {
      out.setInt16(p, chans[c][i], true)
      p += 2
    }
  }
  return new Blob([out.buffer], { type: 'audio/wav' })
}

/** MP3 via lamejs (pure-JS LAME port). */
export function audioBufferToMp3(buf: AudioBuffer, kbps = 192): Blob {
  const numCh = Math.min(2, buf.numberOfChannels)
  const left = f32ToI16(buf.getChannelData(0))
  const right = numCh > 1 ? f32ToI16(buf.getChannelData(1)) : undefined
  const enc = new Mp3Encoder(numCh, buf.sampleRate, kbps)
  const chunks: Uint8Array[] = []
  const BLOCK = 1152
  for (let i = 0; i < left.length; i += BLOCK) {
    const l = left.subarray(i, i + BLOCK)
    const r = right?.subarray(i, i + BLOCK)
    const d = enc.encodeBuffer(l, r)
    if (d.length > 0) chunks.push(d)
  }
  const end = enc.flush()
  if (end.length > 0) chunks.push(end)
  return new Blob(chunks as BlobPart[], { type: 'audio/mpeg' })
}

/** Trigger a browser download for a rendered blob. */
export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10000)
}
