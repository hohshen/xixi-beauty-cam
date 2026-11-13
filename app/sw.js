// SPDX-License-Identifier: Apache-2.0
// Service worker：第一次載入時把整個 app（含 MediaPipe 的 JS、WASM 與模型，約 19 MB）存進快取，
// 之後一律先讀快取，斷網重新整理也能開啟並偵測人臉。
// - 只處理同網域的 GET；其他網域的請求不經手（index.html 的 CSP 也不允許頁面連其他網域）。
// - 更新方式：改了 app/ 裡任何檔案就要改 CACHE_VERSION（tests/pwa.test.mjs 會檢查清單與版本），
//   瀏覽器發現 sw.js 變了就會在背景下載新版、刪掉舊快取並接手頁面；頁面（app.js）這時顯示「有新版，點此更新」。
//   版本號同時寫在 version.js 的 APP_VERSION 與 package.json（tests/ui.test.mjs 檢查三者一致）。

// 格式：xixi-beauty-cam-<package.json 版本>-<序號>；同一版內改了 app/ 的檔案就把序號加 1，發新版時序號回到 1
const CACHE_VERSION = 'xixi-beauty-cam-0.3.1-1';

// 相對於 sw.js 所在的資料夾。tests/pwa.test.mjs 會比對這份清單與 app/ 裡實際的檔案。
const PRECACHE = [
  './',
  'index.html',
  'style.css',
  'manifest.webmanifest',
  'app.js',
  'layout.js',
  'look.js',
  'mask.js',
  'presets.js',
  'quality.js',
  'renderer.js',
  'tracker.js',
  'version.js',
  'warp.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'filters/index.json',
  'filters/none.xixi-filter.json',
  'filters/fresh.xixi-filter.json',
  'filters/warm.xixi-filter.json',
  'filters/cool.xixi-filter.json',
  'filters/film.xixi-filter.json',
  'filters/mono.xixi-filter.json',
  'filters/fit-f1.xixi-filter.json',
  'filters/fit-f2.xixi-filter.json',
  'filters/fit-f3.xixi-filter.json',
  'filters/fit-f4.xixi-filter.json',
  'beauty/index.json',
  'beauty/none.xixi-beauty.json',
  'beauty/natural.xixi-beauty.json',
  'beauty/clear.xixi-beauty.json',
  'beauty/bright.xixi-beauty.json',
  'beauty/refined.xixi-beauty.json',
  'beauty/glam.xixi-beauty.json',
  'beauty/fit-f1.xixi-beauty.json',
  'beauty/fit-f2.xixi-beauty.json',
  'beauty/fit-f3.xixi-beauty.json',
  'beauty/fit-f4.xixi-beauty.json',
  'styles/index.json',
  'styles/soft-pink.xixi-style.json',
  'styles/vivid-cool.xixi-style.json',
  'styles/cool-green.xixi-style.json',
  'styles/cool-grain.xixi-style.json',
  'vendor/mediapipe/tasks-vision@1.2.2/vision_bundle.mjs',
  'vendor/mediapipe/tasks-vision@1.2.2/wasm/vision_wasm_internal.js',
  'vendor/mediapipe/tasks-vision@1.2.2/wasm/vision_wasm_internal.wasm',
  'vendor/mediapipe/models/face_landmarker/float16/1/face_landmarker.task',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // cache: 'reload' 跳過 HTTP 快取，確保存進來的是這一版的檔案
      await cache.addAll(PRECACHE.map((p) => new Request(new URL(p, self.registration.scope), { cache: 'reload' })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('xixi-beauty-cam-') && key !== CACHE_VERSION) await caches.delete(key);
      }
      // 讓第一次開啟的這個頁面也立刻由 service worker 接手：按「開啟鏡頭」時 WASM 與模型直接從快取讀，不再下載一次
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // 頁面導覽（含 ?autostart 之類的參數）都回同一份 index.html
      if (req.mode === 'navigate') {
        const hit = await cache.match(new URL('./', self.registration.scope));
        if (hit) return hit;
      }
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      return fetch(req);
    })(),
  );
});
