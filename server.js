// server.js
import express from "express";
import webpush from "web-push";

const {
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_SUBJECT = "mailto:admin@example.com",
  PORT = 3000,
} = process.env;

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const app = express();
app.use(express.json());

// Пинг
app.get("/", (_, res) => res.send("Web Push sender OK"));

// Рассылка на массив подписок
app.post("/send", async (req, res) => {
  const { subscriptions = [], payload = {} } = req.body || {};
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
    return res.status(400).json({ ok: false, error: "no subscriptions" });
  }

  const msg = JSON.stringify({
    title: payload.title || "MurtalTaxi",
    body: payload.body || "Neue Nachricht",
    icon: payload.icon || "/assets/favicon/favicon-32x32.png",
    badge: payload.badge || "/assets/favicon/favicon-32x32.png",
    url: payload.url || "/chat.html",
    tag: payload.tag || "murtaltaxi-chat",
  });

  const results = await Promise.allSettled(
    subscriptions.map((sub) => webpush.sendNotification(sub, msg))
  );

  const removed = []; // сюда можно собрать «битые» подписки
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      const code = r.reason?.statusCode || r.reason?.code;
      // 404/410 => удалять подписку на бэкенде
      if (code === 404 || code === 410) removed.push(subscriptions[i]);
    }
  });

  res.json({ ok: true, sent: subscriptions.length, removed: removed.length });
});

app.listen(PORT, () => {
  console.log("Web Push sender on :" + PORT);
});
