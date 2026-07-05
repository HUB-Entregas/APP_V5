// Service Worker — cacheia o "app shell" para o app abrir e funcionar
// mesmo sem internet. A fila de comprovantes fica no IndexedDB (app.js),
// o service worker só cuida dos arquivos estáticos.
//
// IMPORTANTE: sempre que você editar qualquer arquivo do app (inclusive
// config.js), troque o número da linha CACHE_NAME abaixo (ex: v2 -> v3).
// Isso força o navegador a perceber que o service worker mudou e buscar
// tudo de novo. Sem isso, mudanças em arquivos estáticos podem demorar
// a aparecer para quem já instalou o app.
const CACHE_NAME = 'comprovantes-shell-v18';
const APP_SHELL = [
  './',
  './index.html',
  './login.html',
  './relatorio.html',
  './admin.html',
  './styles.css',
  './admin.css',
  './config.js',
  './guarda.js',
  './app.js',
  './login.js',
  './relatorio.js',
  './admin.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

// Estratégia: "network first" — com internet, SEMPRE busca a versão mais
// nova do arquivo na rede (e atualiza o cache com ela). Só usa a cópia
// salva no aparelho quando não há conexão. Isso evita o problema de o
// app ficar "preso" numa configuração antiga depois de você editar o
// config.js e publicar de novo.
//
// Chamadas para fora do próprio site (ex: o backend do Apps Script) não
// são interceptadas — passam direto pela rede, sem cache.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    fetch(event.request)
      .then((resposta) => {
        if (resposta && resposta.ok) {
          const copia = resposta.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
        }
        return resposta;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') return caches.match('./index.html');
        })
      )
  );
});
