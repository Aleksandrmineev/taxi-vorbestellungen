// api/auftraege.js — Vercel serverless function
// Kachel „Aufträge“ auf der Startseite → Auftragsseite auf dem VPS (mineev-bot /orders).
// Die Adresse steht nur in der Vercel-Umgebungsvariable ORDERS_PAGE_URL, nicht im (öffentlichen) Repo.
// Das gewählte Theme der App wird als ?theme=light|dark mitgegeben.

export default function handler(req, res) {
  const target = process.env.ORDERS_PAGE_URL || "";
  if (!/^https:\/\/[^\s"'<>]+$/.test(target)) {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(503).send("Auftragsseite ist nicht eingerichtet (ORDERS_PAGE_URL fehlt).");
  }
  const theme = req.query?.theme === "light" || req.query?.theme === "dark" ? req.query.theme : "";
  const url = new URL(target);
  if (theme) url.searchParams.set("theme", theme);
  res.setHeader("Cache-Control", "no-store");
  return res.redirect(302, url.toString());
}
