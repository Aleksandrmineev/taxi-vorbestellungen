// api/send.js — Vercel serverless function
import webpush from "web-push";

const {
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_SUBJECT = "mailto:admin@murtaltaxi.at",
  SHARED_SECRET = "",
} = process.env;

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ ok: false, error: "method not allowed" });

  // auth (если задан секрет)
  if (SHARED_SECRET) {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (token !== SHARED_SECRET)
      return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const { subscriptions, payload } = req.body || {};
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
    return res.status(400).json({ ok: false, error: "no subscriptions" });
  }

  const msg = JSON.stringify({
    title: payload?.title || "MurtalTaxi",
    body: payload?.body || "Neue Nachricht",
    icon: payload?.icon || "/assets/favicon/favicon-32x32.png",
    badge: payload?.badge || "/assets/favicon/favicon-32x32.png",
    url: payload?.url || "/chat.html",
    tag: payload?.tag || "murtaltaxi-chat",
  });

  const results = await Promise.allSettled(
    subscriptions.map((sub) => webpush.sendNotification(sub, msg))
  );

  const removed = [];
  const sent = results.reduce((n, r, i) => {
    if (r.status === "fulfilled") return n + 1;
    const code = r.reason?.statusCode || r.reason?.code;
    if (code === 404 || code === 410) removed.push(subscriptions[i]);
    return n;
  }, 0);

  res.json({ ok: true, sent, total: subscriptions.length, removed });
}
