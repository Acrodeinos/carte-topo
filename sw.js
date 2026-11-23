// Carte Topo — service worker
// · interface de l'app : disponible sans réseau après la première ouverture
// · tuiles IGN consultées : gardées en cache (au plus ~3000), réutilisées hors ligne
// · altitude, recherche d'adresse : réseau uniquement
const VERSION = 'cartetopo-v2';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'
];
const TILES = 'cartetopo-tiles';
const BASEMAP = 'cartetopo-basemap';   // carte de France intégrée, remplie par la page (onglet Hors ligne)
const MAX_TILES = 3000;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== TILES && k !== BASEMAP).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trimTiles() {
  const c = await caches.open(TILES);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Carte de France intégrée : uniquement depuis le cache local (jamais de réseau ni d'attente)
  if (url.origin === location.origin && url.pathname.includes('/basemap/plan/')) {
    e.respondWith(caches.open(BASEMAP).then(c => c.match(req, { ignoreSearch: true }))
      .then(hit => hit || new Response('', { status: 404 })));
    return;
  }
  // Paquets et index de la carte de France : réseau direct (déjà découpés dans le cache)
  if (url.origin === location.origin && url.pathname.includes('/basemap/')) return;

  // Tuiles de carte IGN : cache d'abord, réseau ensuite
  if (url.hostname === 'data.geopf.fr' && url.pathname === '/wmts') {
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') { c.put(req, res.clone()); trimTiles(); }
      return res;
    }));
    return;
  }

  // Interface, Leaflet et polices : cache d'abord, mis à jour en arrière-plan
  if (url.origin === location.origin || url.hostname === 'cdnjs.cloudflare.com' ||
      url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(VERSION).then(async c => {
      const hit = await c.match(req, { ignoreSearch: url.origin === location.origin });
      const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; })
                            .catch(() => hit);
      return hit || net;
    }));
  }
  // le reste (altitude, géocodage) passe directement par le réseau
});
