// Сроки изменений (как в GAS lehrlingeCutoffOpen_), Europe/Vienna: Hin до 20:00 накануне, Zurück до 11:00 в день поездки.
export const MORNING_CUTOFF_HOUR = 20; // накануне
export const EVENING_CUTOFF_HOUR = 11; // в день поездки

const previousDay = (date) => {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
};

const viennaParts = (now) => Object.fromEntries(
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(now).map((part) => [part.type, part.value]),
);

export function directionOpen(date, direction, now = new Date()) {
  const parts = viennaParts(now);
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const deadlineDay = direction === "morning" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? previousDay(date) : date;
  if (deadlineDay > today) return true;
  if (deadlineDay < today) return false;
  return Number(parts.hour) < (direction === "morning" ? MORNING_CUTOFF_HOUR : EVENING_CUTOFF_HOUR);
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
