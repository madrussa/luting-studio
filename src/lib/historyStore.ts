// Durable undo/redo history for the working board. A single rolling record in
// its own IndexedDB (kept separate from the song library so the two never have
// to coordinate schema versions). The buffer depth is capped by useHistory.

import type { VoiceUI } from '../App'
import type { HistoryStore, HistorySnapshot } from './useHistory'

export interface DocSnapshot {
  bpm: number
  voices: VoiceUI[]
  songName: string
  currentSongId: string | null
}

const DB_NAME = 'luting-history'
const STORE = 'history'
const KEY = 'board' // one record: the working board's rolling buffer

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function loadHistory(): Promise<HistorySnapshot<DocSnapshot> | null> {
  try {
    const db = await openDb()
    return await new Promise<HistorySnapshot<DocSnapshot> | null>((resolve, reject) => {
      const t = db.transaction(STORE, 'readonly')
      const req = t.objectStore(STORE).get(KEY)
      req.onsuccess = () => resolve((req.result as HistorySnapshot<DocSnapshot>) ?? null)
      req.onerror = () => reject(req.error)
      t.oncomplete = () => db.close()
    })
  } catch {
    return null // IndexedDB unavailable; start with an empty history
  }
}

// Latest-wins write queue: bursts of saves collapse to a single put so rapid
// edits or held-down undo never pile up transactions.
let pending: HistorySnapshot<DocSnapshot> | null = null
let flushing = false

function saveHistory(state: HistorySnapshot<DocSnapshot>): void {
  pending = state
  void flush()
}

async function flush(): Promise<void> {
  if (flushing || !pending) return
  flushing = true
  try {
    const db = await openDb()
    while (pending) {
      const state = pending
      pending = null
      await new Promise<void>((resolve, reject) => {
        const t = db.transaction(STORE, 'readwrite')
        t.objectStore(STORE).put(state, KEY)
        t.oncomplete = () => resolve()
        t.onerror = () => reject(t.error)
      })
    }
    db.close()
  } catch {
    // best effort; history just won't persist if storage is unavailable
  } finally {
    flushing = false
    if (pending) void flush()
  }
}

export const docHistoryStore: HistoryStore<DocSnapshot> = {
  load: loadHistory,
  save: saveHistory,
}
