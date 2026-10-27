/*
 * App-shell service worker.
 *
 * Its job is to let the app open and run with no signal: every file the app is
 * built from is saved on the first visit (the build fills in PRECACHE below),
 * so a ward with no coverage never meets a blank page. Supabase traffic is
 * never touched here - the app handles its own offline storage and queue.
 */
const BUILD = '__BUILD__'
const CACHE = `tex-trak-${BUILD}`
const PRECACHE = []
const SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(async (cache) => {
        // The shell must be saved; the rest is best effort so one bad file cannot block an update.
        await cache.addAll(SHELL_URLS)
        await Promise.allSettled(PRECACHE.map((url) => cache.add(url)))
      })
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        // Keep this build and the one before it: a page still open on the old build keeps loading its files.
        const mine = keys.filter((k) => k.startsWith('tex-trak-')).sort()
        const stale = mine.slice(0, Math.max(0, mine.length - 2))
        const legacy = keys.filter((k) => !k.startsWith('tex-trak-'))
        return Promise.all([...stale, ...legacy].map((k) => caches.delete(k)))
      })
      .then(() => self.clients.claim()),
  )
})

/** Network first, but never leave someone staring at a dead connection: after 3s use the saved copy. */
function networkThenCache(request, cacheKey) {
  return new Promise((resolve) => {
    let settled = false
    const fallback = () =>
      caches.match(cacheKey).then((hit) => {
        if (hit) return hit
        return null
      })

    const timer = setTimeout(async () => {
      const hit = await fallback()
      if (hit && !settled) {
        settled = true
        resolve(hit)
      }
    }, 3000)

    fetch(request)
      .then((res) => {
        clearTimeout(timer)
        if (res.ok) {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(cacheKey, copy))
        }
        if (!settled) {
          settled = true
          resolve(res)
        }
      })
      .catch(async () => {
        clearTimeout(timer)
        const hit = await fallback()
        if (!settled) {
          settled = true
          resolve(hit || Response.error())
        }
      })
  })
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return // never touch Supabase traffic

  // Opening the app: the page itself is always the one cached shell.
  if (request.mode === 'navigate') {
    event.respondWith(networkThenCache(request, '/index.html'))
    return
  }

  // Everything else is a hashed build file or a static asset: saved copy first.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(request, copy))
          }
          return res
        }),
    ),
  )
})
