/**
 * Spent PWA — Service Worker
 * Strategi: Cache First untuk aset statis,
 *           Network First untuk halaman HTML (agar update cepat terdeteksi).
 *
 * Alur update:
 *  1. SW baru ditemukan → install & cache aset terbaru di CACHE_NAME baru
 *  2. SW baru aktif    → hapus cache lama
 *  3. Halaman diberi tahu lewat postMessage agar bisa prompt "Versi baru tersedia"
 */

const CACHE_NAME    = 'spent-cache-v1';   // Ganti versi ini setiap deploy baru
const OFFLINE_PAGE  = './index.html';

// Semua aset yang di-pre-cache saat install
const PRECACHE_URLS = [
  './index.html',
  './manifest.json',
  './icon-512.png',
  './icon-192.png',
  // Font Google (akan di-cache saat pertama kali online)
  'https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@400;600;700;800&display=swap',
  // Chart.js CDN
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
];

// ─── INSTALL ─────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Install — cache:', CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())   // Aktifkan SW baru langsung tanpa tunggu tab ditutup
      .catch(err => console.warn('[SW] Pre-cache sebagian gagal (mungkin offline):', err))
  );
});

// ─── ACTIVATE ────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activate — bersihkan cache lama');
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)   // Hapus semua cache selain yang aktif
          .map(key => {
            console.log('[SW] Hapus cache lama:', key);
            return caches.delete(key);
          })
      ))
      .then(() => self.clients.claim())         // Ambil kendali semua tab yang terbuka
      .then(() => notifyClients({ type: 'SW_UPDATED' }))
  );
});

// ─── FETCH ───────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Abaikan request non-GET dan chrome-extension
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // ── Strategi berdasarkan tipe aset ──────────────────────────────────────

  // 1. Navigasi HTML → Network First (pastikan selalu versi terbaru jika online)
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstWithFallback(request));
    return;
  }

  // 2. CDN pihak ketiga (fonts, chart.js) → Stale-While-Revalidate
  if (url.origin !== self.location.origin) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // 3. Aset lokal (JS, CSS, gambar, dll) → Cache First
  event.respondWith(cacheFirst(request));
});

// ─── STRATEGI CACHE ──────────────────────────────────────────────────────────

/**
 * Cache First: Cek cache dulu. Jika ada → kembalikan.
 * Jika tidak → ambil dari network, lalu simpan ke cache.
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Jika offline dan tidak ada di cache → kembalikan halaman offline
    return caches.match(OFFLINE_PAGE);
  }
}

/**
 * Network First: Coba network dulu.
 * Jika berhasil → simpan ke cache dan kembalikan.
 * Jika gagal (offline) → fallback ke cache.
 */
async function networkFirstWithFallback(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || caches.match(OFFLINE_PAGE);
  }
}

/**
 * Stale-While-Revalidate: Kembalikan cache langsung (cepat),
 * sambil di-background fetch versi terbaru untuk update cache.
 */
async function staleWhileRevalidate(request) {
  const cache  = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  // Fetch di background untuk update cache (tidak di-await)
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  return cached || fetchPromise;
}

// ─── PESAN KE KLIEN ──────────────────────────────────────────────────────────
async function notifyClients(message) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.forEach(client => client.postMessage(message));
}

// Terima pesan dari halaman (misalnya: skip waiting manual)
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
