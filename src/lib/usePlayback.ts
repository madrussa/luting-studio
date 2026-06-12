import { useSyncExternalStore } from 'react'
import { getActivePlaybackId, subscribePlayback } from './player'

/** The id passed to playLuting for whatever is currently playing, or null. */
export function useActivePlayback(): string | null {
  return useSyncExternalStore(subscribePlayback, getActivePlaybackId)
}
