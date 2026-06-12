// Shared piano-roll view state: one zoom level and one horizontal scroll
// position (in grid units, so different zoom levels stay aligned) for every
// open editor.

import { useSyncExternalStore } from 'react'

export interface RollView {
  pxPerUnit: number
  scrollUnits: number
}

let view: RollView = { pxPerUnit: 10, scrollUnits: 0 }
const subs = new Set<() => void>()

export const getRollView = (): RollView => view

export function setRollView(patch: Partial<RollView>) {
  view = { ...view, ...patch }
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
