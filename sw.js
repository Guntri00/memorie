// ══════════════════════════════════════════════
//  MEMENTOS — Service Worker PWA
//  Stratégie : Cache-First pour assets statiques
//              Network-First pour photos Supabase
// ══════════════════════════════════════════════

const CACHE_NAME    = 'mementos-v1';
const CACHE_STATIC  = 'mementos-static-v1';
const CACHE_PHOTOS  = 'mementos-photos-v1';

// Assets statiques à mettre en cache immédiatement
const STATIC_ASSETS = [
  '/mementos-app.html',
  '/ring-intro.png',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400&family=Jost:wght@200;300;400;500&display=swap'
];

// ── Installation : mise en cache des assets statiques ──
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then((cache) => {
        console.log('[SW] Mise en cache des assets statiques');
        return cache.addAll(STATIC_ASSETS.map(url => new Request(url, { mode: 'no-cors' })));
      })
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('[SW] Erreur cache install:', err))
  );
});

// ── Activation : nettoyage des anciens caches ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter(name => name !== CACHE_STATIC && name !== CACHE_PHOTOS)
          .map(name => {
            console.log('[SW] Suppression ancien cache:', name);
            return caches.delete(name);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch : stratégie intelligente par type de ressource ──
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorer les requêtes non-GET
  if (request.method !== 'GET') return;

  // ── Photos Supabase : Network-First avec cache fallback ──
  if (url.hostname.includes('supabase.co') && url.pathname.includes('/storage/')) {
    event.respondWith(networkFirstWithCache(request, CACHE_PHOTOS, 5000));
    return;
  }

  // ── API Supabase REST : Network-Only (données temps réel) ──
  if (url.hostname.includes('supabase.co') && url.pathname.includes('/rest/')) {
    return; // Laisser passer sans cache
  }

  // ── Polices Google : Cache-First (immutables) ──
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(cacheFirstWithNetwork(request, CACHE_STATIC));
    return;
  }

  // ── Assets statiques locaux : Cache-First ──
  if (url.hostname === self.location.hostname) {
    event.respondWith(cacheFirstWithNetwork(request, CACHE_STATIC));
    return;
  }
});

// ── Network-First : essaie le réseau, fallback cache ──
async function networkFirstWithCache(request, cacheName, timeoutMs) {
  const cache = await caches.open(cacheName);

  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), timeoutMs);
    const response   = await fetch(request, { signal: controller.signal });
    clearTimeout(timeout);

    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached || new Response('', { status: 503 });
  }
}

// ── Cache-First : retourne le cache, fetch si absent ──
async function cacheFirstWithNetwork(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);

  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 503 });
  }
}

// ── Background Sync : upload en attente si hors-ligne ──
self.addEventListener('sync', (event) => {
  if (event.tag === 'upload-photo') {
    event.waitUntil(processPendingUploads());
  }
});

async function processPendingUploads() {
  // Récupérer les uploads en attente depuis IndexedDB
  // (à connecter avec la logique d'upload de l'app)
  console.log('[SW] Traitement des uploads en attente...');
}

// ── Push Notifications (pour plus tard) ──
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();

  event.waitUntil(
    self.registration.showNotification(data.title || 'Mementos', {
      body:    data.body || 'Nouvelle photo partagée !',
      icon:    '/icons/icon-192.png',
      badge:   '/icons/icon-192.png',
      vibrate: [100, 50, 100],
      data:    { url: data.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url || '/')
  );
});
