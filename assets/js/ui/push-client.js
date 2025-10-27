// assets/js/ui/push-client.js
import { Api } from "../api.js";

/** Регистрация SW и подписка на Web Push; отправляет подписку в GAS */
export async function registerAndSubscribePush({
  vapidPublicKey,
  userId = "",
  userName = "",
}) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, error: "unsupported" };
  }

  // Разрешение на уведомления
  if (Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch {}
  }
  if (Notification.permission !== "granted") {
    return { ok: false, error: "denied" };
  }

  // --- ВАЖНО: корректный base для GitHub Pages/Vercel/localhost ---
  const base = getSWBase(); // '/', либо '/<repo>/' на github.io
  const swUrl = `${base}sw.js`;

  // Регистрация Service Worker
  let reg;
  try {
    reg = await navigator.serviceWorker.register(swUrl, { scope: base });
    // console.log("SW registered:", swUrl, "scope:", base);
  } catch (err) {
    console.warn("SW register failed:", err, "url:", swUrl, "scope:", base);
    return { ok: false, error: String(err) };
  }

  // Подписка (VAPID public key -> Uint8Array)
  const key = urlBase64ToUint8Array(vapidPublicKey);
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    });
  }

  // Отправляем подписку в backend (через наш Api)
  await Api.pushSubscribe({
    endpoint: sub.endpoint,
    keys: sub.toJSON().keys, // { p256dh, auth }
    userId,
    userName,
    ua: navigator.userAgent,
  });

  return { ok: true, sub };
}

/** Вычисляет корректный базовый путь для SW */
function getSWBase() {
  // На github.io сайт отдаётся как https://<user>.github.io/<repo>/
  if (location.hostname.endsWith("github.io")) {
    const first = location.pathname.split("/").filter(Boolean)[0] || "";
    return first ? `/${first}/` : "/"; // напр. '/taxi-vorbestellungen/'
  }
  // Для Vercel/localhost корень домена
  return "/";
}

function urlBase64ToUint8Array(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
