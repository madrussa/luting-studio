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
