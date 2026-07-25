/*!
 * COOP/COEP service-worker shim for hosts that can't send response headers
 * (GitHub Pages). Based on coi-serviceworker v0.1.7 by Guido Zuidhof and
 * contributors (MIT), rewritten to be fail-safe:
 *
 *  - Only navigations and worker scripts are intercepted — those are the
 *    responses that must carry COOP/COEP for crossOriginIsolated. Every
 *    other request goes straight to the network, untouched.
 *  - A failed proxy fetch falls back to a plain pass-through fetch instead
 *    of resolving with `undefined` (which hard-breaks the page with
 *    "Failed to convert value to 'Response'" — upstream v0.1.7 bug).
 *  - Opaque/redirect responses (status 0) and redirected responses are
 *    passed through unmodified; rewrapping them breaks navigations.
 */

if (typeof window === 'undefined') {
  // ---- service worker ----
  self.addEventListener('install', () => self.skipWaiting())
  self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

  self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'deregister') {
      self.registration
        .unregister()
        .then(() => self.clients.matchAll())
        .then((clients) => clients.forEach((client) => client.navigate(client.url)))
    }
  })

  const needsHeaders = (request) =>
    request.mode === 'navigate' ||
    request.destination === 'worker' ||
    request.destination === 'sharedworker'

  self.addEventListener('fetch', (event) => {
    const request = event.request
    if (!needsHeaders(request)) return // untouched: no added failure modes
    if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return

    event.respondWith(
      fetch(request)
        .then((response) => {
          // opaque or redirect responses can't be rewrapped; let the
          // browser handle them and inject headers on the follow-up request
          if (response.status === 0 || response.redirected || response.type === 'opaqueredirect') {
            return response
          }
          const headers = new Headers(response.headers)
          headers.set('Cross-Origin-Embedder-Policy', 'require-corp')
          headers.set('Cross-Origin-Opener-Policy', 'same-origin')
          headers.set('Cross-Origin-Resource-Policy', 'cross-origin')
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
          })
        })
        // if the header-injecting path fails for any reason, degrade to a
        // normal fetch: the page loads without isolation rather than breaking
        .catch(() => fetch(request))
    )
  })
} else {
  // ---- page bootstrap ----
  ;(() => {
    const config = {
      shouldRegister: () => true,
      shouldDeregister: () => false,
      doReload: () => window.location.reload(),
      quiet: false,
      ...window.coi,
    }

    const sw = navigator.serviceWorker
    if (sw && sw.controller && config.shouldDeregister()) {
      sw.controller.postMessage({ type: 'deregister' })
      return
    }

    if (window.crossOriginIsolated !== false || !config.shouldRegister()) return
    if (!window.isSecureContext) {
      if (!config.quiet) console.log('COOP/COEP shim: not registered, secure context required.')
      return
    }
    if (!sw) return

    sw.register(window.document.currentScript.src).then(
      (registration) => {
        if (!config.quiet) console.log('COOP/COEP shim registered', registration.scope)
        registration.addEventListener('updatefound', () => config.doReload())
        // registered but this load isn't controlled yet: reload once so the
        // worker can add the headers
        if (registration.active && !sw.controller) config.doReload()
      },
      (err) => {
        if (!config.quiet) console.error('COOP/COEP shim failed to register:', err)
      }
    )
  })()
}
