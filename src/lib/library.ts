// Song library persistence: IndexedDB, one record per saved song. The board's
// working copy stays in localStorage; this is the durable, named collection.

import type { VoiceUI } from '../App'

export interface SavedSong {
  id: string
  name: string
  bpm: number
  voices: VoiceUI[]
  updatedAt: number
  chars: number
  voiceCount: number
  durationSec: number
  /** notation key id; optional for songs saved before keys existed */
  songKey?: string
}

const DB_NAME = 'luting-studio'
const STORE = 'songs'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const req = fn(t.objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    t.oncomplete = () => db.close()
  })
}

export async function listSongs(): Promise<SavedSong[]> {
  const all = (await tx('readonly', (s) => s.getAll())) as SavedSong[]
  return all.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function saveSong(song: SavedSong): Promise<void> {
  await tx('readwrite', (s) => s.put(song))
}

export async function deleteSong(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id))
}

export const newSongId = (): string =>
  typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `song-${Date.now()}-${Math.random().toString(36).slice(2)}`

// ---------------------------------------------------------------------------
// Legacy migration: the original luteboi site kept its saved songs in a
// localStorage entry under the key "luting" as { title, message, songs }.
// We pull those into the IndexedDB library once, on first load.

const LEGACY_KEY = 'luting'
const LEGACY_MIGRATED_KEY = 'luting-studio-legacy-migrated'

/**
 * Saved songs (name -> luting text) from a legacy luteboi localStorage entry,
 * or null if there are none or they've already been migrated.
 */
export function readLegacyLibrary(): Record<string, string> | null {
  try {
    if (localStorage.getItem(LEGACY_MIGRATED_KEY)) return null
    const raw = localStorage.getItem(LEGACY_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    const out: Record<string, string> = {}
    if (data?.songs && typeof data.songs === 'object') {
      for (const [name, text] of Object.entries(data.songs)) {
        if (typeof text === 'string' && text.trim()) out[name] = text
      }
    }
    // fall back to a lone open song with no songs map
    if (!Object.keys(out).length && typeof data?.title === 'string' && typeof data?.message === 'string' && data.message.trim()) {
      out[data.title || 'Untitled luting'] = data.message
    }
    return Object.keys(out).length ? out : null
  } catch {
    return null
  }
}

export function markLegacyMigrated() {
  try {
    localStorage.setItem(LEGACY_MIGRATED_KEY, '1')
  } catch {
    // best effort; if it doesn't stick, migration just re-runs (it's idempotent by name)
  }
}
