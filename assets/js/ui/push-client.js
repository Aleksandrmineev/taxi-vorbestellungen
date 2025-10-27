// assets/js/ui/push-client.js
import { Api } from "../api.js";

/**
 * Регистрирует service worker и подписывает пользователя на Web Push.
 * @param {{ vapidPublicKey: string, userId?: string, userName?: string }} opts
 */
export async function registerAndSubscribePush(opts) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window))
    return { ok: false, error: "unsupported" };

  // 1) Разрешения на уведомления
  if (Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch {}
  }
  if (Notification.permission !== "granted")
    return { ok: false, error: "denied" };

  // 2) Регистрация SW
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });

  // 3) Подписка (applicationServerKey = VAPID public key, base64url→Uint8Array)
  const key = urlBase64ToUint8Array(opts.vapidPublicKey);
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    });
  }

  // 4) Отправляем подписку на ваш сервер (GAS)
  try {
    await Api.pushSubscribe({
      endpoint: sub.endpoint,
      keys: sub.toJSON().keys, // p256dh, auth
      userId: opts.userId || "",
      userName: opts.userName || "",
      ua: navigator.userAgent,
    });
  } catch (e) {
    console.warn("push subscribe send failed", e);
  }

  return { ok: true, sub };
}

// utils
function urlBase64ToUint8Array(base64String) {
  const pad = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}
