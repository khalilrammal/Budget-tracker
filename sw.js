// ============================================================
// Budget Tracker — Service Worker
// Caches app shell for offline use, background sync for sheets
// ============================================================

const CACHE_NAME = 'budget-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap'
];

// ── INSTALL: cache app shell ──────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })))
        .catch(() => cache.addAll(['/index.html', '/app.js', '/manifest.json']));
    })
  );
  self.skipWaiting();
});

// ── ACTIVATE: clean old caches ────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── FETCH: serve from cache, fall back to network ─────────
self.addEventListener('fetch', e => {
  // Skip non-GET and cross-origin (Google Sheets API, fonts CDN handled separately)
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // Google Sheets API — always network, no cache
  if (url.hostname === 'sheets.googleapis.com' || url.hostname === 'oauth2.googleapis.com') return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        // Cache successful local responses
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback for navigation requests
        if (e.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});

// ── BACKGROUND SYNC ───────────────────────────────────────
self.addEventListener('sync', e => {
  if (e.tag === 'sync-sheets') {
    e.waitUntil(syncToSheets());
  }
});

async function syncToSheets() {
  // Notify all clients to attempt a sync
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(client => client.postMessage({ type: 'SYNC_SHEETS' }));
}

// ── PUSH MESSAGES from app ────────────────────────────────
self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data?.type === 'CACHE_UPDATED') {
    caches.open(CACHE_NAME).then(cache => cache.addAll(['/index.html', '/app.js']));
  }
});
