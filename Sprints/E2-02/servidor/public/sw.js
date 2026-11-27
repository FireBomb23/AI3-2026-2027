// Service Worker provisório da PWA Reporta (Sprint E2-01: sem estratégia de cache ainda)

self.addEventListener('install', () => {
  console.log('[SW Reporta] Evento install');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW Reporta] Evento activate');
  event.waitUntil(self.clients.claim());
});
