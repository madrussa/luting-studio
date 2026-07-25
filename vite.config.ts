import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// COOP/COEP make the page crossOriginIsolated, which unlocks SharedArrayBuffer
// and therefore multi-threaded WASM for the stem-separation model. Without
// them everything still works, just single-threaded (slower).
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
})
