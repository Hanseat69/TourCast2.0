'use strict';
// ── TourCast sw.js – Offline Cache & PWA Service Worker ──

const CACHE_NAME    = 'tourcast-v2.0.0';
const CACHE_STATIC  = 'tourcast-static-v2';
const CACHE_DYNAMIC = 'tourcast-dynamic-v2';

// Dateien die sofort gecacht werden (App Shell)
const STATIC_ASSETS = [
  'index.html',
  'manifest.webmanifest',
  'css/tokens.css',
  'css/layout.css',
  'css/components.css',
  'css/sheet.css',
  'css/route.css',
  'css/modals.css',
  'css/style.css',
  'js/state.js',
  'js/map.js',
  'js/radar.js',
  'js/elevation.js',
  'js/weather-engine.js',
  'js/navigation.js',
  'js/data-manager.js',
  'js/ui.js',
  'js/app.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  // Leaflet (CDN – wird gecacht sobald einmal geladen)
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

// Fonts optional cachen (falls vorhanden)
const FONT_ASSETS = [
  'fonts/Rajdhani-Regular.woff2',
  'fonts/Rajdhani-SemiBold.woff2',
  'fonts/Rajdhani-Bold.woff2',
  'fonts/SpaceMono-Regular.woff2',
  'fonts/SpaceMono-Bold.woff2'
];

// ── Install ───────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then(async cache => {
      // App Shell sofort cachen
      await cache.addAll(STATIC_ASSETS);

      // Fonts optional – Fehler ignorieren falls nicht vorhanden
      await Promise.allSettled(
        FONT_ASSETS.map(url =>
          cache.add(url).catch(() => {})
        )
      );
    })
  );
  // Neuen SW sofort aktivieren, ohne auf Tab-Schließen zu warten
  self.skipWaiting();
});

// ── Activate ──────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_STATIC && k !== CACHE_DYNAMIC)
          .map(k => caches.delete(k))
      )
    )
  );
  // Alle offenen Tabs sofort übernehmen
  self.clients.claim();
});

// ── Fetch – Strategie je Ressourcentyp ───────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // POST-Requests (Overpass API) nie cachen
  if (request.method !== 'GET') return;

  // API-Calls: Network First → Dynamic Cache Fallback
  if (isAPIRequest(url)) {
    event.respondWith(networkFirstStrategy(request));
    return;
  }

  // Kartenkacheln: Cache First → Network Fallback
  if (isTileRequest(url)) {
    event.respondWith(cacheFirstStrategy(request));
    return;
  }

  // App Shell: Cache First → Network Fallback
  event.respondWith(cacheFirstStrategy(request));
});

// ── Network First (für API-Daten) ─────────────────────────
async function networkFirstStrategy(request) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 Sek. Timeout

  try {
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.ok) {
      const cache = await caches.open(CACHE_DYNAMIC);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    clearTimeout(timeoutId);
    const cached = await caches.match(request);
    return cached || offlineFallback(request);
  }
}

// ── Cache First (für statische Assets & Tiles) ────────────
async function cacheFirstStrategy(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cacheName = isTileRequest(new URL(request.url))
        ? CACHE_DYNAMIC
        : CACHE_STATIC;
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return offlineFallback(request);
  }
}

// ── Offline Fallback ──────────────────────────────────────
async function offlineFallback(request) {
  const url = new URL(request.url);

  // HTML → index.html aus Cache
  if (request.headers.get('Accept')?.includes('text/html')) {
    return caches.match('index.html');
  }

  // JSON API → leeres Objekt
  if (request.headers.get('Accept')?.includes('application/json')) {
    return new Response('{}', {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Alles andere → 503
  return new Response('Offline – keine Verbindung', {
    status:  503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

// ── Helper: API-Request erkennen ──────────────────────────
function isAPIRequest(url) {
  return (
    url.hostname.includes('open-meteo.com')    ||
    url.hostname.includes('openrouteservice.org') ||
    url.hostname.includes('open-elevation.com') ||
    url.hostname.includes('nominatim.openstreetmap.org') ||
    url.hostname.includes('overpass-api.de')   ||
    url.hostname.includes('air-quality-api')
  );
}

// ── Helper: Kartenkachel erkennen ─────────────────────────
function isTileRequest(url) {
  return (
    url.hostname.includes('tile.openstreetmap')  ||
    url.hostname.includes('tilecache.rainviewer') ||
    url.hostname.includes('unpkg.com')
  );
}

// ── Message: Cache leeren (manueller Refresh) ─────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then(keys =>
        Promise.all(keys.map(k => caches.delete(k)))
      ).then(() => {
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage({ success: true });
        }
      })
    );
  }
});