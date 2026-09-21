// Сроки изменений (как в GAS lehrlingeCutoffOpen_): Hin до 03:00, Zurück до 12:00 (Europe/Vienna) в день поездки.
const viennaParts = (now) => Object.fromEntries(
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(now).map((part) => [part.type, part.value]),
);

export function directionOpen(date, direction, now = new Date()) {
  const parts = viennaParts(now);
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  if (date > today) return true;
  if (date < today) return false;
  return direction === "morning" ? Number(parts.hour) < 3 : Number(parts.hour) < 12;
}

const flags = (status) => ({ out: status === "both" || status === "out", back: status === "both" || status === "back" });

// rows: [{date, student_id, status}], plan: Map "date|student" -> {status}. Строки без записи считаются «both» (как в расписании).
export function assertCutoffsOpen(rows, plan, now = new Date()) {
  rows.forEach((row) => {
    const before = flags(plan.get(`${row.date}|${row.student_id}`)?.status || "both");
    const after = flags(row.status);
    if (before.out !== after.out && !directionOpen(row.date, "morning", now)) throw Object.assign(new Error("morning_cutoff_passed"), { business: true });
    if (before.back !== after.back && !directionOpen(row.date, "evening", now)) throw Object.assign(new Error("evening_cutoff_passed"), { business: true });
  });
}
