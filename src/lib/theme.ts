// Light/dark theming. CSS handles DOM colors via [data-theme] variable
// overrides; the canvas components (timeline, piano roll, strips) can't read
// CSS vars cheaply per frame, so they pull concrete colors from canvasColors()
// here. A useTheme() hook re-renders subscribers (and thus redraws canvases)
// when the theme changes.

import { useSyncExternalStore } from 'react'

export type Theme = 'dark' | 'light'

const KEY = 'luting-theme'

let theme: Theme = (() => {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
})()

const subs = new Set<() => void>()

function apply() {
  document.documentElement.dataset.theme = theme
}
apply()

export const getTheme = (): Theme => theme

export function setTheme(t: Theme) {
  theme = t
  try {
    localStorage.setItem(KEY, t)
  } catch {
    /* preference won't persist */
  }
  apply()
  subs.forEach((cb) => cb())
}

export function toggleTheme() {
  setTheme(theme === 'dark' ? 'light' : 'dark')
}

function subscribe(cb: () => void) {
  subs.add(cb)
  return () => subs.delete(cb)
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getTheme)
}

// ---- canvas palette --------------------------------------------------------

export interface CanvasColors {
  shadeA: string
  shadeB: string
  cRow: string
  beat: string
  bar: string
  staffBeat: string
  staffBar: string
  staffLine: string
  ledger: string
  hover: string
  band: string
  ink: string
  /** marquee-selected note: solid outline + translucent fill */
  sel: string
  selFill: string
  /** "r,g,b" for the playback note-flash (alpha applied per frame) */
  flashRgb: string
}

const DARK: CanvasColors = {
  shadeA: 'rgba(255,255,255,0.05)',
  shadeB: 'rgba(255,255,255,0.018)',
  cRow: 'rgba(90,209,179,0.10)',
  beat: 'rgba(255,255,255,0.06)',
  bar: 'rgba(255,255,255,0.16)',
  staffBeat: 'rgba(255,255,255,0.03)',
  staffBar: 'rgba(255,255,255,0.10)',
  staffLine: 'rgba(255,255,255,0.45)',
  ledger: 'rgba(255,255,255,0.4)',
  hover: 'rgba(255,255,255,0.25)',
  band: 'rgba(255,255,255,0.08)',
  ink: '#ffffff',
  sel: '#5ad1b3',
  selFill: 'rgba(90,209,179,0.32)',
  flashRgb: '255,255,255',
}

const LIGHT: CanvasColors = {
  shadeA: 'rgba(40,30,70,0.07)',
  shadeB: 'rgba(40,30,70,0.025)',
  cRow: 'rgba(20,150,120,0.16)',
  beat: 'rgba(40,30,70,0.10)',
  bar: 'rgba(40,30,70,0.24)',
  staffBeat: 'rgba(40,30,70,0.06)',
  staffBar: 'rgba(40,30,70,0.16)',
  staffLine: 'rgba(40,30,70,0.55)',
  ledger: 'rgba(40,30,70,0.5)',
  hover: 'rgba(40,30,70,0.2)',
  band: 'rgba(40,30,70,0.1)',
  ink: '#241b3a',
  sel: '#149678',
  selFill: 'rgba(20,150,120,0.30)',
  flashRgb: '36,27,58',
}

export const canvasColors = (): CanvasColors => (theme === 'light' ? LIGHT : DARK)
