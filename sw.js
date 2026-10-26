// Naikkan angka versi ini setiap kali ada perubahan besar pada app.js / index.html / style.css
const CACHE_NAME = 'overwatch-cache-v5';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './config.js',
  './release-lib.js',
  './gas-client.js',
  './wo-poly.js',
  './wo-integration.js',
  './infra.js',
  './measure.js',
  './dashboard.js',
  './compare.js',
  './history.js',
  './drone.js',
  './mobile-ui.js',
  './app.js',
  './logo_overwatch.png'
  // Data audit TIDAK di-precache lagi: sekarang datang dari server (per rilis) dan
  // otomatis tersimpan di cache saat pertama dibuka, jadi tetap bisa dilihat offline.
];

// 1. Install & Cache Asset Inti
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        console.warn('Gagal pre-cache sebagian file:', err);
      });
    })
  );
});

// 2. Aktivasi & Bersihkan Cache Lama
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Fetch Strategy: Network First, Fallback ke Cache Offline
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  if (event.request.method !== 'GET') return;
  if (url.includes('script.google.com') || url.includes('supabase.co') || url.includes('googleusercontent.com')) {
    return;
  }
  // halaman upload admin tidak perlu masuk cache
  if (url.includes('/upload.html')) return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});
