// Shared types between the full-mix orchestrator and its workers.
// Kept dependency-free so importing it never drags ML runtimes into a bundle.

import type { ConvertedVoice } from '../convert'

/** Demucs 6-stem output order. */
export const STEM_NAMES = ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'] as const
export type StemName = (typeof STEM_NAMES)[number]

export type DemucsWorkerOut =
  | { type: 'progress'; done: number; total: number }
  | { type: 'debug'; stage: string }
  | { type: 'done'; stems: Record<StemName, Float32Array> }
  | { type: 'error'; message: string }

export type TranscribeWorkerIn =
  | {
      kind: 'melodic'
      samples: Float32Array // mono 44.1 kHz
      lutingBpm: number
      /** grid phase measured once on the whole mix, shared by every stem */
      gridOffsetSec?: number
      /** fallback if timbre classification is off or inconclusive */
      instrument: string
      label: string
      modelUrl: string
      minFreq?: number
      maxFreq?: number
      /** pick the instrument from the stem's timbre instead of `instrument` */
      classify?: 'vocals' | 'other'
      /** reduce to a single melodic line (vocals) */
      mono?: boolean
      /** voice volume v1..v10 from the stem's share of the mix */
      volume?: number
    }
  | {
      kind: 'drums'
      samples: Float32Array // mono 44.1 kHz
      lutingBpm: number
      /** grid phase measured once on the whole mix, shared by every stem */
      gridOffsetSec?: number
      volume?: number
    }

export type TranscribeWorkerOut =
  | { type: 'progress'; pct: number }
  | { type: 'debug'; stage: string }
  | { type: 'done'; voices: ConvertedVoice[] }
  | { type: 'error'; message: string }

export type StemState = 'pending' | 'running' | 'done' | 'skipped' | 'failed'

export type FullMixProgress =
  | { stage: 'decode' }
  | { stage: 'download'; loadedBytes: number; totalBytes: number; fromCache: boolean }
  | { stage: 'separate'; done: number; total: number }
  | { stage: 'transcribe'; stems: { name: StemName; state: StemState; pct: number }[] }
