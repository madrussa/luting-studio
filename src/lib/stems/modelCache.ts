// One-time model downloads with streaming progress, persisted in the Cache
// API so the (large) stem-separation weights are only fetched once.

const CACHE_NAME = 'luting-models'

export interface DownloadProgress {
  loadedBytes: number
  totalBytes: number
  fromCache: boolean
}

export async function fetchModelCached(
  url: string,
  onProgress: (p: DownloadProgress) => void
): Promise<ArrayBuffer> {
  let cache: Cache | null = null
  try {
    cache = await caches.open(CACHE_NAME)
    const hit = await cache.match(url)
    if (hit) {
      const buf = await hit.arrayBuffer()
      onProgress({ loadedBytes: buf.byteLength, totalBytes: buf.byteLength, fromCache: true })
      return buf
    }
  } catch {
    cache = null // private browsing / quota — download without caching
  }

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Model download failed (HTTP ${res.status})`)
  const totalBytes = Number(res.headers.get('content-length') ?? 0)

  if (!res.body) {
    const buf = await res.arrayBuffer()
    onProgress({ loadedBytes: buf.byteLength, totalBytes: buf.byteLength, fromCache: false })
    return buf
  }

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loadedBytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loadedBytes += value.byteLength
    onProgress({ loadedBytes, totalBytes: Math.max(totalBytes, loadedBytes), fromCache: false })
  }

  const buf = new Uint8Array(loadedBytes)
  let off = 0
  for (const c of chunks) {
    buf.set(c, off)
    off += c.byteLength
  }

  if (cache) {
    try {
      await cache.put(url, new Response(buf.slice().buffer, { headers: { 'Content-Length': String(loadedBytes) } }))
    } catch {
      // quota exceeded — fine, it will just re-download next time
    }
  }
  return buf.buffer
}
