const CACHE = "mt-main-v3";

const ASSETS = [
  // Страницы
  "/main/",
  "/main/index.html",
  "/main/hilfe.html",
  "/main/qr-payment.html",
  "/main/anleitung-qr.html",

  // CSS
  "/main/assets/css/theme.css",
  "/main/assets/css/global.css",
  "/main/assets/css/main.css",
  "/main/assets/css/adaptive.css",

  // JS
  "/main/assets/js/theme.js",
  "/main/assets/js/main.js",

  // Медиа/иконки
  "/main/assets/img/logo1.png",

  // PWA
  "/main/assets/favicon/site.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(ASSETS);
      // хотим, чтобы новый SW быстрее активировался
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // чистим старые кэши
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      );
      // аккуратно claim, без падения
      try {
        await self.clients.claim();
      } catch (_) {}
    })()
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // КЭШИРУЕМ ТОЛЬКО http/https И ТОЛЬКО СВОЙ ДОМЕН (исключаем chrome-extension:, data:, etc.)
  const isHttp = url.protocol === "http:" || url.protocol === "https:";
  const isSameOrigin = url.origin === self.location.origin;

  if (!isHttp || !isSameOrigin) {
    // для сторонних/расширений — просто проксируем сеть
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    (async () => {
      // cache first
      const cached = await caches.match(event.request);
      if (cached) return cached;

      try {
        const net = await fetch(event.request);
        // Кладём в кэш только «basic» (same-origin) и успешные ответы
        if (net.ok && net.type === "basic") {
          const copy = net.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return net;
      } catch (err) {
        // Фолбэк для навигации — главная
        if (event.request.mode === "navigate") {
          return caches.match("/main/index.html");
        }
        throw err;
      }
    })()
  );
});
