/* sw.js */
self.addEventListener("install", (e) => {
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  self.clients.claim();
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {}
  const title = data.title || "MurtalTaxi";
  const body = data.body || "Neue Nachricht";
  const icon = data.icon || "./assets/favicon/favicon-32x32.png";
  const badge = data.badge || "./assets/favicon/favicon-32x32.png";
  const tag = data.tag || "murtaltaxi-chat";
  const url = data.url || "/chat.html";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge,
      tag,
      data: { url },
      renotify: true,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        for (const client of list) {
          if ("focus" in client) {
            client.postMessage({ type: "FOCUS_FROM_PUSH" });
            return client.focus();
          }
        }
        return clients.openWindow(url);
      })
  );
});
