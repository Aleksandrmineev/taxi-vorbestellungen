// assets/js/ui/push-client.js
import { Api } from "../api.js";

/** Регистрация SW и подписка на Web Push; отправляет подписку в GAS */
export async function registerAndSubscribePush({
  vapidPublicKey,
  userId = "",
  userName = "",
}) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window))
    return { ok: false, error: "unsupported" };

  // Просим разрешение
  if (Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch {}
  }
  if (Notification.permission !== "granted")
    return { ok: false, error: "denied" };

  // Регистрируем воркер
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });

  // Подписываемся (VAPID public key -> Uint8Array)
  const key = urlBase64ToUint8Array(vapidPublicKey);
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    });
  }

  // Шлём подписку на GAS
  await Api.pushSubscribe({
    endpoint: sub.endpoint,
    keys: sub.toJSON().keys, // { p256dh, auth }
    userId,
    userName,
    ua: navigator.userAgent,
  });

  return { ok: true, sub };
}

function urlBase64ToUint8Array(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
