const CACHE = "mt-main-v26";
const ASSETS = [
  "/",
  "/main/index.html",
  "/main/hilfe.html",
  "/main/assets/favicon/site.webmanifest",
  "/main/assets/favicon/android-chrome-192x192.png",
  "/main/assets/favicon/android-chrome-512x512.png",
  "/main/assets/img/logo1.png",
  "/lehrlinge/index.html",
  "/abrechnung/index.html"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request, { cache: "no-store" })
      .then((response) => {
        if (response.ok && response.type === "basic") {
          caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("/main/index.html")))
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {}
  const title = data.title || "MurtalTaxi";
  const body = data.body || "Neue Nachricht";
  const icon = data.icon || "/main/assets/favicon/favicon-32x32.png";
  const badge = data.badge || "/main/assets/favicon/favicon-32x32.png";
  const tag = data.tag || "murtaltaxi-chat";
  const url = data.url || "/main/index.html";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge,
      tag,
      renotify: true,
      data: { url }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/main/index.html";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          client.postMessage({ type: "FOCUS_FROM_PUSH" });
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
