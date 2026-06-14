// In-memory clipboard for the piano-roll editor, shared across every open
// editor so a phrase copied from one voice can be pasted into another. Notes
// are stored relative to their earliest start (so paste can drop them anywhere)
// plus an isDrum flag so we never mix drum hits into a melodic voice.

import type { RollNote } from './transform'

export interface RollClip {
  isDrum: boolean
  notes: RollNote[] // earliest start normalized to 0
}

let clip: RollClip | null = null

export const getClip = (): RollClip | null => clip

export function setClip(notes: RollNote[], isDrum: boolean): void {
  if (!notes.length) return
  const minStart = Math.min(...notes.map((n) => n.start))
  clip = { isDrum, notes: notes.map((n) => ({ ...n, start: n.start - minStart })) }
}

// ---- system-clipboard mirroring ------------------------------------------
// Copies also go to the OS clipboard as plain luting text (so a phrase can be
// pasted into luteboi.com or a note); on paste we can tell our own snippet
// apart from text copied elsewhere.

let lastSysText: string | null = null

export const getLastSysText = (): string | null => lastSysText

export function writeSystem(text: string): void {
  lastSysText = text
  try {
    void navigator.clipboard?.writeText(text).catch(() => {})
  } catch {
    // clipboard API unavailable; the internal clipboard still works
  }
}
