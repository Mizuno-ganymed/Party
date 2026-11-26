'use strict';

/**
 * Service Worker
 * - インストール時にアプリの全ファイルを保存（オフライン対応）
 * - 以降は保存済みファイルですぐ表示し、裏で最新版を取得して差し替える
 *   （デプロイ後、次に開いたときに新しい版になる）
 *
 * ファイルを追加・削除したら APP_FILES を更新し、VERSION を上げてください。
 */
const VERSION = 'v11';
const CACHE = `party-tools-${VERSION}`;

const APP_FILES = [
  './',
  'manifest.webmanifest',
  'css/style.css',
  'js/core.js',
  'js/vendor/qrcode.js',
  'js/room.js',
  'js/prizes.js',
  'js/tools/roulette.js',
  'js/tools/teams.js',
  'js/tools/order.js',
  'js/tools/dice.js',
  'js/tools/timer.js',
  'js/tools/scoreboard.js',
  'js/tools/bingo.js',
  'js/tools/warikan.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(APP_FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('party-tools-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // 部屋の通信はキャッシュしない

  // ページ遷移は常にトップページ（1ページ構成のため）
  const key = request.mode === 'navigate' ? new URL('./', self.location).href : request;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(key, { ignoreSearch: true });
      const network = fetch(request)
        .then((res) => {
          // リダイレクト後のレスポンスはページ遷移に使えないので保存しない
          if (res.ok && !res.redirected) cache.put(key, res.clone());
          return res;
        })
        .catch(() => null);

      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      return (await network) || new Response('オフラインです', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }),
  );
});
