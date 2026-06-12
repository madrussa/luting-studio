// Shared piano-roll view state: one zoom level and one horizontal scroll
// position (in grid units, so different zoom levels stay aligned) for every
// open editor.

import { useSyncExternalStore } from 'react'

export type RollMode = 'grid' | 'staff'

export interface RollView {
  pxPerUnit: number
  scrollUnits: number
  /** grid = piano roll rows; staff = grand-staff notation */
  mode: RollMode
}

const MODE_KEY = 'luting-roll-mode'

const savedMode = ((): RollMode => {
  try {
    return localStorage.getItem(MODE_KEY) === 'staff' ? 'staff' : 'grid'
  } catch {
    return 'grid'
  }
})()

let view: RollView = { pxPerUnit: 10, scrollUnits: 0, mode: savedMode }
const subs = new Set<() => void>()

export const getRollView = (): RollView => view

export function setRollView(patch: Partial<RollView>) {
  view = { ...view, ...patch }
  if (patch.mode) {
    try {
      localStorage.setItem(MODE_KEY, patch.mode)
    } catch {
      // preference just won't persist
    }
  }
  for (const cb of [...subs]) cb()
}

export function subscribeRollView(cb: () => void): () => void {
  subs.add(cb)
  return () => subs.delete(cb)
}

export function useRollView(): RollView {
  return useSyncExternalStore(subscribeRollView, getRollView)
}

export const clampZoom = (px: number) => Math.max(0.4, Math.min(40, px))
