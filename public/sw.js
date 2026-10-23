// App-shell cache: hashed assets are cache-first (immutable), pages are network-first
// with a short timeout so the app still opens instantly offline or on a slow network.
const CACHE = 'meishi-shell-v1'
const SHELL = ['/', '/boot.js', '/icon.svg', '/manifest.webmanifest']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/') || url.pathname === '/memo') return

  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()))
            return res
          }),
      ),
    )
    return
  }

  if (req.mode === 'navigate' || SHELL.includes(url.pathname)) {
    const key = req.mode === 'navigate' ? '/' : req
    e.respondWith(
      new Promise((resolve) => {
        let done = false
        const fromCache = () =>
          caches.match(key).then((hit) => {
            if (!done && hit) {
              done = true
              resolve(hit)
            }
          })
        const timer = setTimeout(fromCache, 2000)
        fetch(req)
          .then((res) => {
            clearTimeout(timer)
            if (res.ok && !res.redirected) caches.open(CACHE).then((c) => c.put(key, res.clone()))
            if (!done) {
              done = true
              resolve(res)
            }
          })
          .catch(() => {
            clearTimeout(timer)
            caches.match(key).then((hit) => {
              if (!done) {
                done = true
                resolve(hit || Response.error())
              }
            })
          })
      }),
    )
  }
})
