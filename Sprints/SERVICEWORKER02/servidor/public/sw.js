// Service worker da API05.
importScripts('/bd.js', '/sincronizacao.js');

const ETIQUETA_SYNC = 'sincronizar-sugestoes';
const CACHE_INTERFACE = 'interface-v3';
const CACHE_PUBLICOS = 'dados-publicos';
const FICHEIROS = [
  '/', '/index.html', '/estilos.css', '/app.js', '/configuracoes.js',
  '/bd.js', '/pendentes.js', '/sincronizacao.js',
];
let emCurso = null;

function sincronizar() {
  if (!emCurso) emCurso = executarSincronizacao().finally(() => { emCurso = null; });
  return emCurso;
}

async function avisarPaginas(mensagem) {
  for (const cliente of await self.clients.matchAll({ type: 'window' })) cliente.postMessage(mensagem);
}

self.addEventListener('install', (evento) => {
  evento.waitUntil(caches.open(CACHE_INTERFACE).then((cache) => cache.addAll(FICHEIROS)));
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(
        nomes.filter((nome) => nome !== CACHE_INTERFACE && nome !== CACHE_PUBLICOS).map((nome) => caches.delete(nome)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (evento) => {
  if (evento.data?.tipo === 'ativar') {
    self.skipWaiting();
    return;
  }
  if (evento.data?.tipo === 'sincronizar') {
    evento.waitUntil(
      sincronizar()
        .then((resultado) => avisarPaginas(resultado))
        .catch((erro) => avisarPaginas({
          tipo: erro.tipo || 'sem-rede',
          porEnviar: erro.porEnviar || 0,
        })),
    );
  }
});

async function cachePrimeiro(pedido) {
  const cache = await caches.open(CACHE_INTERFACE);
  const copia = await cache.match(pedido, { ignoreSearch: true });
  if (copia) return copia;
  const resposta = await fetch(pedido);
  if (resposta.ok) await cache.put(pedido, resposta.clone());
  return resposta;
}

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

self.addEventListener('sync', (evento) => {
  if (evento.tag !== ETIQUETA_SYNC) return;
  evento.waitUntil(
    sincronizar()
      .then((resultado) => avisarPaginas(resultado))
      .catch((erro) => {
        avisarPaginas({ tipo: erro.tipo || 'sem-rede', porEnviar: erro.porEnviar || 0 });
        if (erro.tipo !== 'sem-rede' && erro.tipo !== 'erro-servidor') return;
        throw erro;
      }),
  );
});

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  if (pedido.method !== 'GET') return;
  const url = new URL(pedido.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/v2/categorias') evento.respondWith(cacheEAtualizacao(evento));
  else if (url.pathname.startsWith('/v2/')) return;
  else if (FICHEIROS.includes(url.pathname)) evento.respondWith(cachePrimeiro(pedido));
});
