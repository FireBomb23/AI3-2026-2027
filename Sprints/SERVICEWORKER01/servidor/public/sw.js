// Service worker. Fica na raiz (/sw.js) para controlar todo o site.
// Não usa a IndexedDB: só a página lhe acede.
const CACHE_INTERFACE = 'interface-v1';
const CACHE_PUBLICOS = 'dados-publicos';
const FICHEIROS = ['/', '/index.html', '/estilos.css', '/app.js', '/configuracoes.js', '/bd.js', '/pendentes.js'];

// Instalação: guarda os ficheiros da interface. A nova versão fica "à espera" até a página pedir a ativação.
self.addEventListener('install', (evento) => {
  evento.waitUntil(caches.open(CACHE_INTERFACE).then((cache) => cache.addAll(FICHEIROS)));
});

// Ativação: apaga as caches que não são da versão atual.
self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(
        nomes.filter((n) => n !== CACHE_INTERFACE && n !== CACHE_PUBLICOS).map((n) => caches.delete(n)),
      ))
      .then(() => self.clients.claim()),
  );
});

// A página pede a ativação da versão que está à espera.
self.addEventListener('message', (evento) => {
  if (evento.data && evento.data.tipo === 'ativar') self.skipWaiting();
});

// Cache primeiro: ficheiros que só mudam com uma nova versão da interface.
async function cachePrimeiro(pedido) {
  const cache = await caches.open(CACHE_INTERFACE);
  const copia = await cache.match(pedido, { ignoreSearch: true });
  if (copia) return copia;
  const resposta = await fetch(pedido);
  if (resposta.ok) await cache.put(pedido, resposta.clone());
  return resposta;
}

// Cache e atualização em segundo plano: dados públicos, iguais para todos.
async function cacheEAtualizacao(evento) {
  const cache = await caches.open(CACHE_PUBLICOS);
  const copia = await cache.match(evento.request);
  const rede = fetch(evento.request).then((resposta) => {
    if (resposta.ok) cache.put(evento.request, resposta.clone());
    return resposta;
  });
  if (copia) {
    evento.waitUntil(rede.catch(() => {}));
    return copia;
  }
  return rede;
}

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  if (pedido.method !== 'GET') return; // só rede (sem respondWith)
  const url = new URL(pedido.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === '/v2/categorias') {
    evento.respondWith(cacheEAtualizacao(evento));
  } else if (url.pathname.startsWith('/v2/')) {
    return; // só rede: depende do cookie, nunca vai para a Cache API
  } else if (FICHEIROS.includes(url.pathname)) {
    evento.respondWith(cachePrimeiro(pedido));
  }
});
