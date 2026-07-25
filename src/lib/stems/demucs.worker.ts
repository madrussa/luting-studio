// Web Worker: HT-Demucs 6-stem source separation via onnxruntime-web (WASM).
// The StemSplitio ONNX export embeds the STFT in the graph, so this worker
// only chunks the waveform, runs the session, and overlap-adds the result.
//
// in:  { model: ArrayBuffer, left: Float32Array, right: Float32Array }
// out: { type: 'progress', done, total }
//      { type: 'done', stems: Record<StemName, Float32Array> }  (mono, 44.1 kHz)
//      { type: 'error', message }

import * as ort from 'onnxruntime-web/wasm'
// the package's exports map hides dist/, so the runtime files are imported by
// file path. Both the .wasm and the standalone .mjs must be provided: without
// an explicit mjs, ORT spawns its pthread workers from import.meta.url — in a
// production build that is THIS bundled chunk, so every thread re-runs this
// module, clobbers ORT's pthread message handler, and session creation
// deadlocks (dev never hits it because modules are served unbundled there).
import ortWasmUrl from '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url'
import ortMjsUrl from '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url'
import { STEM_NAMES } from './types'
import type { StemName } from './types'

const SAMPLE_RATE = 44100
const SEGMENT_S = 7.8
const N_SAMPLES = Math.round(SEGMENT_S * SAMPLE_RATE) // 343,980
const OVERLAP = Math.floor(N_SAMPLES / 4)
const STRIDE = N_SAMPLES - OVERLAP

const post = self.postMessage.bind(self) as (message: unknown, transfer?: Transferable[]) => void
const debug = (stage: string) => post({ type: 'debug', stage })

function makeTransitionWindow(segment: number, overlap: number): Float32Array {
  const w = new Float32Array(segment).fill(1)
  for (let i = 0; i < overlap; i++) {
    const v = i / overlap
    w[i] = v
    w[segment - 1 - i] = v
  }
  return w
}

async function separate(model: ArrayBuffer, left: Float32Array, right: Float32Array) {
  ort.env.wasm.wasmPaths = { wasm: ortWasmUrl, mjs: ortMjsUrl }
  // multi-threading needs crossOriginIsolated (COOP/COEP); fall back to 1 thread
  ort.env.wasm.numThreads = self.crossOriginIsolated
    ? Math.min(Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1), 4)
    : 1
  debug(`session:start isolated=${self.crossOriginIsolated} threads=${ort.env.wasm.numThreads}`)

  // memory is the constraint, not speed: graph optimization ('basic'/'all')
  // constant-folds the fp16 weights into fp32 copies and the arena
  // over-reserves — either one alone breaches the 32-bit WASM heap
  const session = await ort.InferenceSession.create(model, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'disabled',
    enableCpuMemArena: false,
    enableMemPattern: false,
  })

  debug('session:ready')
  const totalLen = left.length
  const nChunks = Math.max(1, Math.ceil((totalLen - OVERLAP) / STRIDE))
  const win = makeTransitionWindow(N_SAMPLES, OVERLAP)

  const out = STEM_NAMES.map(() => new Float32Array(totalLen))
  const weight = new Float32Array(totalLen)
  const chunkBuf = new Float32Array(2 * N_SAMPLES)

  post({ type: 'progress', done: 0, total: nChunks })
  for (let i = 0; i < nChunks; i++) {
    const start = i * STRIDE
    const end = Math.min(start + N_SAMPLES, totalLen)
    const chunkLen = end - start
    chunkBuf.fill(0)
    chunkBuf.set(left.subarray(start, end), 0)
    chunkBuf.set(right.subarray(start, end), N_SAMPLES)

    const input = new ort.Tensor('float32', chunkBuf, [1, 2, N_SAMPLES])
    const result = await session.run({ mix: input })
    const stems = result.stems.data as Float32Array // [1, 6, 2, N_SAMPLES]

    for (let t = 0; t < STEM_NAMES.length; t++) {
      const lRow = (t * 2 + 0) * N_SAMPLES
      const rRow = (t * 2 + 1) * N_SAMPLES
      const dst = out[t]
      for (let s = 0; s < chunkLen; s++) {
        dst[start + s] += 0.5 * (stems[lRow + s] + stems[rRow + s]) * win[s]
      }
    }
    for (let s = 0; s < chunkLen; s++) weight[start + s] += win[s]
    post({ type: 'progress', done: i + 1, total: nChunks })
  }

  for (const dst of out) {
    for (let s = 0; s < totalLen; s++) dst[s] /= Math.max(weight[s], 1e-8)
  }

  await session.release()
  const byName: Partial<Record<StemName, Float32Array>> = {}
  STEM_NAMES.forEach((name, t) => (byName[name] = out[t]))
  post({ type: 'done', stems: byName }, out.map((a) => a.buffer))
}

self.onmessage = (e: MessageEvent) => {
  const { model, left, right } = e.data as {
    model: ArrayBuffer
    left: Float32Array
    right: Float32Array
  }
  separate(model, left, right).catch((err: unknown) => {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  })
}
