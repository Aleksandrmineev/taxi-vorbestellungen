// Reine Logik für Vorbestellungen (ohne Redis/HTTP); Port der GAS-Funktionen in source/code.gs.
// Muss identisch zu GAS bleiben: tests/orders-parity.test.mjs vergleicht beide Seiten.

export const ORDER_TZ = "Europe/Vienna";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const normalizePhone = (value) => String(value || "").replace(/[^0-9+]/g, "");

// Wanduhrzeit in Wien -> UTC-Millisekunden (Sommer-/Winterzeit korrekt), wie `new Date("YYYY-MM-DDTHH:mm:00")` in GAS.
function tzOffsetMs(utcMs, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(utcMs)).map((part) => [part.type, part.value]),
  );
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(utcMs / 1000) * 1000;
}

export function viennaToUtcMs(date, time, timeZone = ORDER_TZ) {
  const d = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const t = String(time || "").match(/^(\d{1,2}):(\d{2})/);
  if (!d || !t) return NaN;
  const naive = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  const DAY = 24 * 60 * 60 * 1000;
  const before = tzOffsetMs(naive - DAY, timeZone);
  const after = tzOffsetMs(naive + DAY, timeZone);
  // Kandidaten mit dem Offset vor/nach einer Umstellung; gültig ist, wer den Offset tatsächlich hat.
  const valid = [before, after].map((offset) => naive - offset).filter((utc) => tzOffsetMs(utc, timeZone) === naive - utc);
  if (valid.length) return Math.min(...valid); // doppelte Stunde (Rückstellung): wie V8/GAS die erste
  return naive - before; // nicht existierende Stunde (Vorstellung): wie V8/GAS mit dem Offset davor
}

const isOpen = (item) => item.status !== "done" && item.status !== "cancelled";

// getOrdersByDate_
export function listOrders(items, date, includeAll) {
  return items
    .filter((item) => !date || item.date === String(date))
    .filter((item) => includeAll || isOpen(item))
    .sort((a, b) => String(a.time).localeCompare(String(b.time)) || String(a.created_at || "").localeCompare(String(b.created_at || "")) || String(a.id).localeCompare(String(b.id)));
}

// getTodoOrders_ (+ Sortierung nach Start, damit die Reihenfolge stabil ist)
export function todoOrders(items, hours, nowMs = Date.now()) {
  const until = nowMs + Math.max(1, Number(hours) || 24) * 60 * 60 * 1000;
  return items
    .filter(isOpen)
    .map((item) => ({ item, start: viennaToUtcMs(item.date, item.time) }))
    .filter(({ start }) => !Number.isNaN(start) && start >= nowMs && start <= until)
    .sort((a, b) => a.start - b.start || String(a.item.id).localeCompare(String(b.item.id)))
    .map(({ item, start }) => ({ ...item, start_iso: new Date(start).toISOString(), order_id: item.id }));
}

// normalizeOrderDates_
export function normalizeOrderDates(value) {
  let list = value;
  if (typeof list === "string" && list.trim()) {
    try { list = JSON.parse(list); } catch { throw new Error("invalid_dates"); }
  }
  if (list === undefined || list === null || list === "" || (Array.isArray(list) && !list.length)) return [];
  if (!Array.isArray(list)) throw new Error("invalid_dates");
  const seen = new Set();
  list.forEach((entry) => {
    const day = String(entry ?? "").trim();
    const parsed = ISO_DATE.test(day) ? new Date(`${day}T12:00:00Z`) : null;
    if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) throw new Error("invalid_dates");
    seen.add(day);
  });
  const days = [...seen].sort();
  if (days.length > 62) throw new Error("too_many_dates");
  return days;
}

// recurrenceDates_
export function recurrenceDates(startDate, rule, until) {
  if (!rule) return [startDate];
  if (!["DAILY", "WEEKLY", "BIWEEKLY"].includes(rule)) throw new Error("invalid_recurrence");
  if (!until) throw new Error("recurrence_until_required");
  const start = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${until}T12:00:00Z`);
  if (!ISO_DATE.test(startDate) || !ISO_DATE.test(until) || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    throw new Error("invalid_recurrence_until");
  }
  const step = rule === "DAILY" ? 1 : rule === "BIWEEKLY" ? 14 : 7;
  const result = [];
  for (let current = new Date(start); current <= end && result.length < 366; current.setUTCDate(current.getUTCDate() + step)) {
    result.push(current.toISOString().slice(0, 10));
  }
  return result;
}

// orderId_: dreistellig, sonst vier-, dann fünfstellig; `used` = Set belegter Nummern
export function pickOrderId(used, random = Math.random) {
  const ranges = [[100, 900], [1000, 9000], [10000, 90000]];
  for (const [min, size] of ranges) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const candidate = String(min + Math.floor(random() * size));
      if (!used.has(candidate)) return candidate;
    }
  }
  throw new Error("short_order_id_unavailable");
}

// createOrder_: Elemente für alle Tage (ohne Speichern). `now` und `ids` sind injizierbar (Tests).
export function buildOrders(raw, { usedIds, now = new Date(), random = Math.random } = {}) {
  const data = raw && typeof raw === "object" ? raw : {};
  const explicitDates = normalizeOrderDates(data.dates);
  const date = explicitDates.length ? explicitDates[0] : String(data.date || "").trim();
  const time = String(data.time || "").trim();
  const rrule = explicitDates.length ? "" : String(data.rrule || "").trim().toUpperCase();
  const until = explicitDates.length ? "" : String(data.until || "").trim();
  if (!date || !time) throw new Error("date_and_time_required");
  const dates = explicitDates.length ? explicitDates : recurrenceDates(date, rrule, until);
  const seriesId = dates.length > 1 ? `s_${now.getTime()}_${Math.floor(random() * 1000)}` : "";
  const used = new Set(usedIds || []);
  return dates.map((occurrence) => {
    const id = pickOrderId(used, random);
    used.add(id);
    return {
      id, created_at: now.toISOString(), date: occurrence, time,
      type: String(data.type || "Orts"), duration_min: Number(data.duration_min || 15),
      phone: String(data.phone || data.phone_raw || "").trim(),
      phone_norm: normalizePhone(data.phone || data.phone_raw),
      message: String(data.message || "").trim(), rrule, until,
      series_id: seriesId, gcal_event_id: "", status: "open", status_comment: "",
      created_by_name: String(data.created_by_name || ""), created_by_device: String(data.created_by_device || ""),
      confirmation_sent_at: "", reminder_sent_at: "",
    };
  });
}
