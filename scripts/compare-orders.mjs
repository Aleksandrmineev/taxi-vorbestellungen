#!/usr/bin/env node
// Vergleicht die Bestellungslisten aus Redis (/api/orders) mit GAS (/api/gas). Nur lesend; zeigt nur Anzahlen und Nummern,
// keine Telefonnummern oder Adressen.   Aufruf: node scripts/compare-orders.mjs [basis-url]
const base = (process.argv[2] || "https://taxi-murtal.vercel.app").replace(/\/$/, "");
const secret = "102030";

async function get(path, params) {
  const url = new URL(base + path);
  Object.entries({ ...params, secret, ts: Date.now() }).forEach(([k, v]) => url.searchParams.set(k, v));
  const started = Date.now();
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, ms: Date.now() - started, body };
}

const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Vienna" });
const checks = [
  ["Liste heute (offen)", { op: "list", date: today, includeAll: "0" }, { action: "ordersbydate", date: today, includeAll: "0" }],
  ["Liste heute (alle)", { op: "list", date: today, includeAll: "1" }, { action: "ordersbydate", date: today, includeAll: "1" }],
  ["Alle Bestellungen", { op: "list", date: "", includeAll: "1" }, { action: "ordersbydate", date: "", includeAll: "1" }],
  ["Nächste (todos, 366 Tage)", { op: "todos", hours: String(24 * 366) }, { action: "todos", hours: String(24 * 366) }],
];

let problems = 0;
for (const [label, redisParams, gasParams] of checks) {
  const [redis, gas] = await Promise.all([get("/api/orders", redisParams), get("/api/gas", gasParams)]);
  if (redis.status !== 200) {
    console.log(`✖ ${label}: Redis-Endpunkt antwortet ${redis.status} (${redis.body.error || "?"}) – Clients nutzen GAS`);
    problems += 1;
    continue;
  }
  const a = new Set((redis.body.items || []).map((o) => String(o.id)));
  const b = new Set((gas.body.items || []).map((o) => String(o.id)));
  const onlyRedis = [...a].filter((id) => !b.has(id));
  const onlyGas = [...b].filter((id) => !a.has(id));
  const same = !onlyRedis.length && !onlyGas.length;
  if (!same) problems += 1;
  console.log(`${same ? "✔" : "✖"} ${label}: Redis ${a.size} (${redis.ms} ms) | GAS ${b.size} (${gas.ms} ms)` +
    (same ? "" : ` | nur Redis: ${onlyRedis.slice(0, 10).join(",") || "-"} | nur GAS: ${onlyGas.slice(0, 10).join(",") || "-"}`) +
    (redis.body.syncedAt ? ` | Stand ${redis.body.syncedAt}` : ""));
}
console.log(problems ? `\n${problems} Abweichung(en). Unterschiede kurz nach einer Änderung sind normal (Synchronisation läuft alle 5 Minuten).` : "\nAlles gleich.");
process.exit(problems ? 1 : 0);
