import { useCallback, useEffect, useRef, useState } from 'react'

const LIMIT = 20
const DEBOUNCE_MS = 450

export interface HistorySnapshot<T> {
  past: T[]
  present: T
  future: T[]
}

// Optional durable backing for the history. `load` runs once on mount; `save`
// is fire-and-forget (it should collapse bursts itself).
export interface HistoryStore<T> {
  load: () => Promise<HistorySnapshot<T> | null>
  save: (state: HistorySnapshot<T>) => void
}

export interface History {
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  undoCount: number
  redoCount: number
}

// Generic past/present/future undo history with a rolling buffer of LIMIT
// steps. `live` is the current document snapshot — recompute it with useMemo so
// its identity only changes on a real edit; `apply` writes a restored snapshot
// back into your state. A burst of edits is coalesced into one undo step. Pass
// a `store` to persist the buffer (e.g. to IndexedDB) across reloads.
export function useHistory<T>(live: T, apply: (snap: T) => void, store?: HistoryStore<T>): History {
  const past = useRef<T[]>([])
  const future = useRef<T[]>([])
  const present = useRef<T>(live) // the last committed snapshot
  const liveRef = useRef<T>(live)
  const ready = useRef(!store) // gate edits until the persisted buffer loads
  const [counts, setCounts] = useState({ undo: 0, redo: 0 })

  liveRef.current = live

  const sync = () => setCounts({ undo: past.current.length, redo: future.current.length })

  const changed = (a: T, b: T) => JSON.stringify(a) !== JSON.stringify(b)

  const persist = useCallback(() => {
    store?.save({
      past: past.current,
      present: present.current,
      future: future.current.slice(0, LIMIT),
    })
  }, [store])

  // Move the live snapshot into the past if it differs from the last commit,
  // capping the depth and dropping any redo future. Returns true if it recorded.
  const commit = useCallback(() => {
    if (!changed(liveRef.current, present.current)) return false
    past.current.push(present.current)
    if (past.current.length > LIMIT) past.current.shift()
    present.current = liveRef.current
    future.current = []
    sync()
    return true
  }, [])

  // Hydrate the buffer from the store, reconciling its `present` against the
  // board that was actually restored (from localStorage) so the two agree.
  useEffect(() => {
    if (!store) return
    let cancelled = false
    const done = (saved: HistorySnapshot<T> | null) => {
      if (cancelled) return
      if (saved) {
        past.current = saved.past.slice(-LIMIT)
        future.current = saved.future.slice(0, LIMIT)
        if (changed(saved.present, liveRef.current)) {
          // The board moved on since the buffer was last saved: keep the live
          // board as present, let the saved state stay undoable, and drop the
          // now-ambiguous redo future.
          past.current.push(saved.present)
          if (past.current.length > LIMIT) past.current.shift()
          future.current = []
          present.current = liveRef.current
        } else {
          present.current = saved.present
        }
      }
      ready.current = true
      sync()
    }
    store.load().then(done, () => done(null))
    return () => {
      cancelled = true
    }
  }, [store])

  // Coalesce rapid edits (e.g. typing in a syntax box) into a single step.
  useEffect(() => {
    const t = setTimeout(() => {
      if (!ready.current) return
      if (commit()) persist()
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [live, commit, persist])

  const undo = useCallback(() => {
    commit() // flush any in-flight edit so Ctrl+Z undoes what you just did
    if (past.current.length === 0) return
    const prev = past.current.pop()!
    future.current.unshift(present.current)
    present.current = prev
    apply(prev)
    sync()
    persist()
  }, [apply, commit, persist])

  const redo = useCallback(() => {
    commit() // an uncommitted edit diverges the timeline, clearing the future
    if (future.current.length === 0) return
    const next = future.current.shift()!
    past.current.push(present.current)
    present.current = next
    apply(next)
    sync()
    persist()
  }, [apply, commit, persist])

  return {
    undo,
    redo,
    canUndo: counts.undo > 0,
    canRedo: counts.redo > 0,
    undoCount: counts.undo,
    redoCount: counts.redo,
  }
}
