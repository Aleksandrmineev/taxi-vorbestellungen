// api/_lib/auftraege.js — keine eigene Function (Hobby-Plan: höchstens 12), sondern von
// api/orders.js aufgerufen; /api/auftraege wird per vercel.json dorthin umgeschrieben.
// Kachel „Aufträge“ auf der Startseite → Auftragsseite auf dem VPS (mineev-bot /orders).
// Die Adresse steht nur in der Vercel-Umgebungsvariable ORDERS_PAGE_URL, nicht im (öffentlichen) Repo.
// Mit ORDERS_LINK_SECRET (gleicher Wert wie auf dem VPS) bekommt der Link einen kurz gültigen,
// signierten Schlüssel ?k=<Ablauf>.<HMAC> — damit meldet sich das Handy ohne Passwort an.
// Das gewählte Theme der App wird als ?theme=light|dark mitgegeben.
import crypto from "node:crypto";

const LINK_TTL_S = 120;

export function linkToken(secret, nowS = Math.floor(Date.now() / 1000)) {
  const exp = nowS + LINK_TTL_S;
  return `${exp}.${crypto.createHmac("sha256", secret).update(`orders-link:${exp}`).digest("hex")}`;
}

export function openOrdersPage(req, res) {
  const target = process.env.ORDERS_PAGE_URL || "";
  if (!/^https:\/\/[^\s"'<>]+$/.test(target)) {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(503).send("Auftragsseite ist nicht eingerichtet (ORDERS_PAGE_URL fehlt).");
  }
  const theme = req.query?.theme === "light" || req.query?.theme === "dark" ? req.query.theme : "";
  const url = new URL(target);
  const secret = process.env.ORDERS_LINK_SECRET || "";
  if (secret) url.searchParams.set("k", linkToken(secret));
  if (theme) url.searchParams.set("theme", theme);
  res.setHeader("Cache-Control", "no-store");
  return res.redirect(302, url.toString());
}
