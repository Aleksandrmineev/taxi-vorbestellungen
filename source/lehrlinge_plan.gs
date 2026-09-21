/**
 * Lehrlinge Plan / Student Portal
 *
 * Изолированный модуль для учеников. Не изменяет Points, Matrix, Drivers,
 * Cars или существующую админскую модель. Листы создаются только явным
 * вызовом setupLehrlingePlanSheets().
 */

const LEHRLINGE_STUDENTS_SHEET = "_Lehrlinge";
const LEHRLINGE_PLAN_SHEET = "_LehrlingePlan";
const LEHRLINGE_STUDENT_TOKEN_PREFIX = "lehrlinge_student_token:";
const LEHRLINGE_STUDENT_TOKEN_TTL_SEC = 12 * 60 * 60;
const LEHRLINGE_REMEMBER_TOKEN_PREFIX = "lehrlinge_remember_token:";
const LEHRLINGE_REMEMBER_TOKEN_TTL_SEC = 365 * 24 * 60 * 60;
const LEHRLINGE_PIN_RESET_PREFIX = "lehrlinge_pin_reset:";
const LEHRLINGE_PIN_RESET_TTL_SEC = 10 * 60;

const LEHRLINGE_STUDENT_HEADERS = [
  "student_id",
  "name",
  "point_id",
  "active",
  "pin_hash",
  "updated_at",
  "phone",
];

const LEHRLINGE_PLAN_HEADERS = [
  "date",
  "student_id",
  "baseline_morning",
  "baseline_evening",
  "override_morning",
  "override_evening",
  "note",
  "updated_by",
  "updated_at",
];

function lehrlingePlanDate_(value) {
  if (value instanceof Date) return Utilities.formatDate(value, "Europe/Vienna", "yyyy-MM-dd");
  if (typeof value === "number" && isFinite(value)) {
    const serialDate = new Date(Date.UTC(1899, 11, 30) + value * 24 * 60 * 60 * 1000);
    return Utilities.formatDate(serialDate, "Europe/Vienna", "yyyy-MM-dd");
  }
  const text = String(value || "").trim();
  const european = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return european ? `${european[3]}-${european[2]}-${european[1]}` : text;
}

/** Явно запускается один раз администратором после проверки проекта. */
function setupLehrlingePlanSheets() {
  const ss = SpreadsheetApp.getActive();
  const students = ensureLehrlingeSheet_(ss, LEHRLINGE_STUDENTS_SHEET, LEHRLINGE_STUDENT_HEADERS);
  const plan = ensureLehrlingeSheet_(ss, LEHRLINGE_PLAN_SHEET, LEHRLINGE_PLAN_HEADERS);
  return {
    ok: true,
    studentsSheet: students.getName(),
    planSheet: plan.getName(),
    note: "Sheets created/updated and hidden; existing sheets were not changed.",
  };
}

/**
 * Одноразово заполняет roster текущими Lehrlinge из проверенного PDF.
 * Работает только через upsert и не удаляет уже существующие строки.
 * PINы намеренно не заполняются.
 */
function seedLehrlingeRoster() {
  const students = [
    ["oliver", "Oliver Kreuzer", "1R4"],
    ["sebastian", "Sebastian Pirker", "1R5"],
    ["marcel", "Marcel Feistl", "1R7"],
    ["patrick", "Patrick Hasler", "1R8"],
    ["leon", "Leon Jocham", "1R10"],
    ["niklas", "Niklas Jocham", "2R2"],
    ["marie", "Marie Kaltenegger", "2R3"],
    ["fabian", "Fabian Gruber", "2R4"],
    ["lorenz", "Lorenz Diethart", "FAL"],
    ["lukas", "Lukas Kaiser", "2R5"],
    ["elias", "Elias Führer", "2R6"],
    ["jakob", "Jakob Pichler", "2R7"],
  ];

  setupLehrlingePlanSheets();
  students.forEach(([id, name, pointId]) => upsertLehrlingStudent(id, name, pointId, "1"));
  return { ok: true, seeded: students.length, pinCount: 0 };
}

/**
 * Одноразово переносит базовый график из проверенного PDF в _LehrlingePlan.
 * Уже существующие строки не перезаписывает, чтобы не потерять ручные изменения.
 */
function seedLehrlingePlanFromPdf() {
  setupLehrlingePlanSheets();
  const source = {
    "2026-09-01": ["oliver", "leon", "patrick", "sebastian", "marie", "fabian", "elias", "lukas"],
    "2026-09-02": ["oliver", "leon", "patrick", "sebastian", "marcel", "marie", "fabian", "elias", "niklas", "lukas"],
    "2026-09-03": ["oliver", "leon", "patrick", "sebastian", "marcel", "marie", "fabian", "elias", "niklas", "lukas"],
    "2026-09-04": ["oliver", "leon", "patrick", "sebastian", "marcel", "marie", "fabian", "elias", "niklas", "lukas"],
    "2026-09-07": ["oliver", "leon", "patrick", "sebastian", "marcel", "marie", "fabian", "lorenz", "elias", "niklas", "lukas"],
    "2026-09-08": ["oliver", "leon", "patrick", "sebastian", "marcel", "marie", "fabian", "lorenz", "elias", "niklas", "lukas"],
    "2026-09-09": ["oliver", "leon", "patrick", "sebastian", "marcel", "marie", "fabian", "lorenz", "elias", "niklas", "lukas"],
    "2026-09-10": ["oliver", "leon", "patrick", "sebastian", "marcel", "marie", "fabian", "lorenz", "elias", "niklas", "lukas"],
    "2026-09-11": ["oliver", "patrick", "sebastian", "marcel", "marie", "fabian", "lorenz", "elias", "niklas", "lukas"],
    "2026-09-14": ["oliver", "patrick", "sebastian", "marcel", "marie", "fabian", "niklas", "lukas"],
    "2026-09-15": ["oliver", "patrick", "sebastian", "marcel", "marie", "fabian", "niklas", "lukas"],
    "2026-09-16": ["oliver", "patrick", "sebastian", "marcel", "marie", "fabian", "niklas", "lukas"],
    "2026-09-17": ["oliver", "patrick", "sebastian", "marcel", "marie", "fabian", "niklas", "lukas"],
    "2026-09-18": ["oliver", "patrick", "sebastian", "marcel", "marie", "fabian", "niklas", "lukas"],
    "2026-09-21": ["oliver", "patrick", "sebastian", "marcel", "marie", "fabian", "niklas", "lukas"],
    "2026-09-22": ["oliver", "patrick", "sebastian", "marcel", "marie", "fabian", "niklas", "lukas"],
    "2026-09-23": ["oliver", "sebastian", "marcel", "marie", "fabian", "niklas", "lukas"],
    "2026-09-24": ["oliver", "patrick", "sebastian", "marcel", "marie", "fabian", "niklas", "lukas"],
    "2026-09-25": ["oliver", "patrick", "sebastian", "marcel", "marie", "fabian", "niklas", "lukas"],
    "2026-09-28": ["oliver", "patrick", "sebastian", "marcel", "marie", "fabian", "lorenz", "niklas", "lukas"],
    "2026-09-29": ["oliver", "patrick", "sebastian", "marcel", "fabian", "lorenz", "niklas", "lukas"],
    "2026-09-30": ["oliver", "patrick", "sebastian", "marcel", "fabian", "lorenz", "niklas", "lukas"],
  };

  const sh = SpreadsheetApp.getActive().getSheetByName(LEHRLINGE_PLAN_SHEET);
  const existing = new Set();
  if (sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach((row) => {
      existing.add(lehrlingePlanDate_(row[0]) + "|" + String(row[1] || "").trim());
    });
  }

  const rows = [];
  Object.keys(source).forEach((date) => {
    const active = new Set(source[date]);
    ["oliver", "sebastian", "marcel", "patrick", "leon", "niklas", "marie", "fabian", "lorenz", "lukas", "elias", "jakob"].forEach((studentId) => {
      const key = date + "|" + studentId;
      if (existing.has(key)) return;
      const rides = active.has(studentId) ? "1" : "0";
      rows.push([date, studentId, rides, rides, "", "", "", "pdf_seed", new Date()]);
    });
  });
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, LEHRLINGE_PLAN_HEADERS.length).setValues(rows);
  return { ok: true, dates: Object.keys(source).length, inserted: rows.length };
}

function getLehrlingePlan_(from, to) {
  const sh = SpreadsheetApp.getActive().getSheetByName(LEHRLINGE_PLAN_SHEET);
  const start = String(from || "").trim();
  const end = String(to || "").trim();
  const itemsByKey = {};
  const holidays = new Set();
  if (!sh || sh.getLastRow() < 2) return { items: [], holidays: [] };

  sh.getRange(2, 1, sh.getLastRow() - 1, LEHRLINGE_PLAN_HEADERS.length).getValues().forEach((row) => {
    const date = lehrlingePlanDate_(row[0]);
    const studentId = String(row[1] || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !studentId || (start && date < start) || (end && date > end)) return;
    const morning = String(row[4] === "" || row[4] == null ? row[2] : row[4]) === "1";
    const evening = String(row[5] === "" || row[5] == null ? row[3] : row[5]) === "1";
    itemsByKey[date + "|" + studentId] = {
      date: date,
      student_id: studentId,
      status: morning && evening ? "both" : morning ? "out" : evening ? "back" : "none",
      note: String(row[6] || "").trim(),
      updated_by: String(row[7] || "").trim(),
      updated_at: row[8] instanceof Date ? row[8].toISOString() : String(row[8] || ""),
    };
    if (String(row[6] || "").trim() === "holiday") holidays.add(date);
  });
  return { items: Object.keys(itemsByKey).sort().map((key) => itemsByKey[key]), holidays: Array.from(holidays).sort() };
}

function lehrlingePlanWeekdays_(from, to) {
  const start = String(from || "").trim();
  const end = String(to || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) return [];
  const result = [];
  const cursor = new Date(`${start}T12:00:00`);
  const last = new Date(`${end}T12:00:00`);
  while (cursor <= last) {
    const weekday = cursor.getDay();
    if (weekday !== 0 && weekday !== 6) result.push(Utilities.formatDate(cursor, "Europe/Vienna", "yyyy-MM-dd"));
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

function getLehrlingeDriverSchedule_(from, to, route, direction) {
  const start = String(from || "").trim();
  const end = String(to || "").trim();
  const selectedRoute = String(route || "all").trim();
  const selectedDirections = direction === "all"
    ? ["morning", "evening"]
    : [direction === "evening" ? "evening" : "morning"];
  const snapshot = getLehrlingeSnapshot_();
  const plan = getLehrlingePlan_(start, end);
  const studentsByPoint = {};

  const studentsSheet = SpreadsheetApp.getActive().getSheetByName(LEHRLINGE_STUDENTS_SHEET);
  if (studentsSheet && studentsSheet.getLastRow() >= 2) {
    studentsSheet.getRange(2, 1, studentsSheet.getLastRow() - 1, LEHRLINGE_STUDENT_HEADERS.length).getValues().forEach((row) => {
      const id = String(row[0] || "").trim();
      const pointId = String(row[2] || "").trim();
      if (!id || !pointId || String(row[3] || "") !== "1") return;
      if (!studentsByPoint[pointId]) studentsByPoint[pointId] = [];
      studentsByPoint[pointId].push({ id: id, name: String(row[1] || "").trim() });
    });
  }

  const statusByKey = {};
  (plan.items || []).forEach((item) => {
    statusByKey[item.date + "|" + item.student_id] = item.status;
  });
  const itemByKey = {};
  (plan.items || []).forEach((item) => {
    itemByKey[item.date + "|" + item.student_id] = item;
  });
  const scheduleDates = lehrlingePlanWeekdays_(start, end);

  const daysByDate = {};
  (snapshot.points || []).forEach((point, pointIndex) => {
    const pointId = String(point.id || "").trim();
    const pointRoute = String(point.route || "").trim();
    if (!pointId || String(point.active || "") !== "1" || !studentsByPoint[pointId]) return;
    if (selectedRoute !== "all" && pointRoute !== selectedRoute) return;

    selectedDirections.forEach((selectedDirection) => {
      const studentsByDate = {};
      const cancellationsByDate = {};
      scheduleDates.forEach((date) => {
        const students = studentsByPoint[pointId].filter((student) => {
          const status = statusByKey[date + "|" + student.id] || "both";
          if (plan.holidays.includes(date) && !statusByKey[date + "|" + student.id]) return false;
          return selectedDirection === "morning"
            ? status === "both" || status === "out"
            : status === "both" || status === "back";
        });
        if (students.length) studentsByDate[date] = students;

        const cancelled = studentsByPoint[pointId].filter((student) => {
          const key = date + "|" + student.id;
          const status = statusByKey[key];
          const item = itemByKey[key];
          const rides = selectedDirection === "morning"
            ? status === "both" || status === "out"
            : status === "both" || status === "back";
          const changed = item && item.updated_by && item.updated_by !== "pdf_seed";
          return !rides && changed;
        });
        if (cancelled.length) cancellationsByDate[date] = cancelled.map((student) => {
          const itemData = itemByKey[date + "|" + student.id];
          return {
            id: student.id,
            name: student.name,
            address: String(point.name || "").trim(),
            updatedBy: itemData?.updated_by || "",
            updatedAt: itemData?.updated_at || "",
            note: itemData?.note || "",
          };
        });
      });

      [...new Set([...Object.keys(studentsByDate), ...Object.keys(cancellationsByDate)])].forEach((date) => {
        if (!daysByDate[date]) daysByDate[date] = {};
        const routeKey = pointRoute + "|" + selectedDirection;
        if (!daysByDate[date][routeKey]) daysByDate[date][routeKey] = {
          route: pointRoute,
          direction: selectedDirection,
          points: [],
          cancellations: [],
        };
        if (studentsByDate[date]) daysByDate[date][routeKey].points.push({
          pointId: pointId,
          address: String(point.name || "").trim(),
          url: String(point.url || "").trim(),
          phone: String(point.phone || "").trim(),
          order: pointIndex,
          students: studentsByDate[date].map((student) => {
            const item = plan.items.find((entry) => entry.date === date && entry.student_id === student.id);
            return Object.assign({}, student, {
              status: statusByKey[date + "|" + student.id] || (plan.holidays.includes(date) ? "none" : "both"),
              updatedBy: item?.updated_by || "",
              updatedAt: item?.updated_at || "",
              note: item?.note || "",
            });
          }),
        });
        if (cancellationsByDate[date]) daysByDate[date][routeKey].cancellations.push(...cancellationsByDate[date]);
      });
    });
  });

  const days = Object.keys(daysByDate).sort().map((date) => ({
    date: date,
    routes: Object.keys(daysByDate[date]).sort((a, b) => {
      const [routeA, directionA] = a.split("|");
      const [routeB, directionB] = b.split("|");
      return Number(routeA) - Number(routeB) || (directionA === "morning" ? -1 : 1) - (directionB === "morning" ? -1 : 1);
    }).map((routeKey) => {
      const route = daysByDate[date][routeKey];
      route.points.sort((a, b) => route.direction === "evening"
        ? b.order - a.order
        : a.order - b.order);
      route.count = route.points.reduce((total, point) => total + point.students.length, 0);
      return route;
    }),
  }));

  return { from: start, to: end, direction: direction === "all" ? "all" : selectedDirections[0], days: days };
}

function getLehrlingeDriverStudentPlan_(studentId, from, to, driver) {
  const wanted = String(studentId || "").trim().toLowerCase();
  const students = getLehrlingeDriverStudents_();
  const student = students.find((item) => item.id === wanted);
  if (!student) throw new Error("student_not_found");
  const plan = getLehrlingePlan_(from, to);
  return {
    driver: { id: driver.id, name: driver.name, surname: driver.surname, taxiNumber: driver.taxiNumber },
    student: student,
    items: plan.items.filter((item) => item.student_id === wanted),
    holidays: plan.holidays,
  };
}

function getLehrlingeDriverStudents_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(LEHRLINGE_STUDENTS_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  const points = {};
  const pointSheet = ss.getSheetByName("Points");
  if (pointSheet && pointSheet.getLastRow() >= 2) {
    pointSheet.getDataRange().getValues().slice(1).forEach((row) => {
      points[String(row[0] || "").trim()] = { address: String(row[1] || ""), route: String(row[2] || ""), time: pointTimeValue_(row[7]) };
    });
  }
  return sh.getRange(2, 1, sh.getLastRow() - 1, LEHRLINGE_STUDENT_HEADERS.length).getValues()
    .filter((row) => String(row[0] || "").trim() && String(row[3] || "") === "1")
    .map((row) => Object.assign({ id: String(row[0]).trim(), name: String(row[1] || "").trim(), pointId: String(row[2] || "").trim() }, points[String(row[2] || "").trim()] || {}));
}

function saveLehrlingeDriverPlan_(body, driver) {
  let requested;
  try {
    requested = JSON.parse(String(body.rows || "[]"));
  } catch (_) {
    throw new Error("invalid_plan_rows");
  }
  const rows = Array.isArray(requested) ? requested : [];
  if (!rows.length) return { ok: true, saved: 0 };

  const activeStudents = new Set(getLehrlingeDriverStudents_().map((student) => student.id));
  const normalized = rows.map((item) => {
    const date = String(item?.date || "").trim();
    const studentId = String(item?.student_id || "").trim().toLowerCase();
    const status = String(item?.status || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("invalid_date");
    if (!activeStudents.has(studentId)) throw new Error("student_not_found");
    if (!["both", "out", "back", "none"].includes(status)) throw new Error("invalid_status");
    return {
      date: date,
      student_id: studentId,
      status: status,
      note: String(item?.note || "").trim(),
    };
  });

  return saveLehrlingePlan_({
    rows: JSON.stringify(normalized),
    holidays: String(body.holidays || "[]"),
    updatedBy: (driver.id === "shared" ? "portal:" : "driver:") + String(driver.taxiNumber || driver.id || "unknown"),
  });
}

function saveLehrlingePlan_(body) {
  const parsed = JSON.parse(String(body.rows || "[]"));
  const rows = Array.isArray(parsed) ? parsed : [];
  const holidays = new Set(JSON.parse(String(body.holidays || "[]")) || []);
  const sh = ensureLehrlingeSheet_(SpreadsheetApp.getActive(), LEHRLINGE_PLAN_SHEET, LEHRLINGE_PLAN_HEADERS);
  const existingRows = sh.getLastRow() >= 2
    ? sh.getRange(2, 1, sh.getLastRow() - 1, LEHRLINGE_PLAN_HEADERS.length).getValues()
    : [];
  const existingDisplay = sh.getLastRow() >= 2
    ? sh.getRange(2, 1, sh.getLastRow() - 1, 2).getDisplayValues()
    : [];
  const rowByKey = {};
  existingRows.forEach((row, index) => {
    const displayDate = existingDisplay[index]?.[0] || row[0];
    rowByKey[lehrlingePlanDate_(displayDate) + "|" + String(row[1] || "").trim()] = index;
  });
  const now = new Date();
  const newRows = [];
  let saved = 0;
  rows.forEach((item) => {
    const date = String(item.date || "").trim();
    const studentId = String(item.student_id || "").trim();
    const status = String(item.status || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !studentId || !["both", "out", "back", "none"].includes(status)) return;
    const morning = status === "both" || status === "out" ? "1" : "0";
    const evening = status === "both" || status === "back" ? "1" : "0";
    const key = date + "|" + studentId;
    const existingIndex = rowByKey[key];
    const existing = existingIndex == null ? null : existingRows[existingIndex];
    const note = holidays.has(date)
      ? "holiday"
      : item.note === undefined
        ? String(existing?.[6] || "")
        : String(item.note || "").trim();
    const values = [[date, studentId, existing?.[2] ?? morning, existing?.[3] ?? evening, morning, evening, note, String(body.updatedBy || "admin"), now]];
    if (existingIndex == null) {
      newRows.push(values[0]);
      rowByKey[key] = existingRows.length + newRows.length - 1;
    } else existingRows[existingIndex] = values[0];
    saved += 1;
  });
  const changedIndexes = [];
  rows.forEach((item) => {
    const key = String(item.date || "").trim() + "|" + String(item.student_id || "").trim();
    if (rowByKey[key] != null && rowByKey[key] < existingRows.length && !changedIndexes.includes(rowByKey[key])) changedIndexes.push(rowByKey[key]);
  });
  changedIndexes.sort((a, b) => a - b);
  let blockStart = null;
  let previous = null;
  const flushBlock = () => {
    if (blockStart == null) return;
    const blockEnd = previous;
    sh.getRange(2 + blockStart, 1, blockEnd - blockStart + 1, LEHRLINGE_PLAN_HEADERS.length)
      .setValues(existingRows.slice(blockStart, blockEnd + 1));
    blockStart = null;
  };
  changedIndexes.forEach((index) => {
    if (blockStart == null) blockStart = index;
    else if (index !== previous + 1) {
      flushBlock();
      blockStart = index;
    }
    previous = index;
  });
  flushBlock();
  if (newRows.length) sh.getRange(sh.getLastRow() + 1, 1, newRows.length, LEHRLINGE_PLAN_HEADERS.length).setValues(newRows);
  return { ok: true, saved: saved };
}

/** Удаляет дубли date + student_id, сохраняя последнюю строку как актуальную. */
function dedupeLehrlingePlan() {
  const sh = SpreadsheetApp.getActive().getSheetByName(LEHRLINGE_PLAN_SHEET);
  if (!sh || sh.getLastRow() < 2) return { ok: true, removed: 0 };
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, LEHRLINGE_PLAN_HEADERS.length).getValues();
  const groups = {};
  let invalid = 0;
  values.forEach((row) => {
    const date = lehrlingePlanDate_(row[0]);
    const studentId = String(row[1] || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !studentId) {
      invalid += 1;
      return;
    }
    const key = date + "|" + studentId;
    if (!groups[key]) groups[key] = [];
    groups[key].push({ row: row, date: date });
  });
  const unique = Object.keys(groups).sort().map((key) => {
    const entries = groups[key];
    const latest = entries[entries.length - 1];
    const baseline = entries.find((entry) => String(entry.row[7] || "").trim() === "pdf_seed") || entries[0];
    const row = latest.row.slice();
    row[0] = latest.date;
    row[2] = baseline.row[2];
    row[3] = baseline.row[3];
    return row;
  });
  if (values.length > 20 && invalid > values.length / 4) {
    throw new Error("dedupe_aborted_suspicious_date_values");
  }
  sh.getRange(2, 1, values.length, LEHRLINGE_PLAN_HEADERS.length).clearContent();
  if (unique.length) sh.getRange(2, 1, unique.length, LEHRLINGE_PLAN_HEADERS.length).setValues(unique);
  return { ok: true, before: values.length, after: unique.length, removed: values.length - unique.length, invalid: invalid };
}

function ensureLehrlingeSheet_(ss, name, headers) {
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    const currentWidth = Math.max(sh.getLastColumn(), 1);
    const currentHeaders = sh.getRange(1, 1, 1, currentWidth).getDisplayValues()[0].map((value) => String(value || "").trim());
    if (headers.includes("pin_hash") && !currentHeaders.includes("pin_hash") && currentHeaders.includes("updated_at")) {
      const updatedAtColumn = currentHeaders.indexOf("updated_at") + 1;
      sh.insertColumnBefore(updatedAtColumn);
      sh.getRange(1, updatedAtColumn).setValue("pin_hash");
      currentHeaders.splice(updatedAtColumn - 1, 0, "pin_hash");
    }
    const missing = headers.filter((header) => !currentHeaders.includes(header));
    if (missing.length) {
      sh.getRange(1, currentWidth + 1, 1, missing.length).setValues([missing]);
    }
  }
  if (!sh.isSheetHidden()) sh.hideSheet();
  return sh;
}

/**
 * Администратор задаёт PIN как последние 4 цифры номера самого Lehrling.
 * В таблицу попадает только SHA-256 hash, не PIN.
 */
function setLehrlingPin(studentId, lastFourDigits) {
  const id = String(studentId || "").trim();
  const pin = String(lastFourDigits || "").replace(/\D/g, "");
  if (!id) throw new Error("student_id_required");
  if (!/^\d{4}$/.test(pin)) throw new Error("pin_must_be_4_digits");

  const ss = SpreadsheetApp.getActive();
  const sh = ensureLehrlingeSheet_(ss, LEHRLINGE_STUDENTS_SHEET, LEHRLINGE_STUDENT_HEADERS);
  const row = findLehrlingStudentRow_(sh, id);
  if (!row) throw new Error("student_not_found");
  sh.getRange(row, 5, 1, 2).setValues([[sha256Hex_(pin), new Date()]]);
  return { ok: true, studentId: id };
}

function upsertLehrlingStudent(studentId, name, pointId, active) {
  const id = String(studentId || "").trim();
  const normalizedName = String(name || "").trim();
  const normalizedPointId = String(pointId || "").trim();
  if (!id || !normalizedName || !normalizedPointId) {
    throw new Error("student_id_name_point_required");
  }

  const ss = SpreadsheetApp.getActive();
  const sh = ensureLehrlingeSheet_(ss, LEHRLINGE_STUDENTS_SHEET, LEHRLINGE_STUDENT_HEADERS);
  const existingRow = findLehrlingStudentRow_(sh, id);
  const values = [id, normalizedName, normalizedPointId, String(active || "1") === "0" ? "0" : "1"];
  if (existingRow) {
    sh.getRange(existingRow, 1, 1, 4).setValues([values]);
    sh.getRange(existingRow, 6).setValue(new Date());
  } else {
    sh.appendRow([...values, "", new Date()]);
  }
  return { ok: true, studentId: id };
}

function getLehrlingeByPointId_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(LEHRLINGE_STUDENTS_SHEET);
  const out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, LEHRLINGE_STUDENT_HEADERS.length).getValues();
  values.forEach((row) => {
    const studentId = String(row[0] || "").trim();
    const pointId = String(row[2] || "").trim();
    if (!studentId || !pointId) return;
    out[pointId] = {
      lehrling_id: studentId,
      lehrling_name: String(row[1] || ""),
      lehrling_has_pin: Boolean(String(row[4] || "").trim()),
    };
  });
  return out;
}

function syncLehrlingeRosterFromPoints_(points) {
  const ss = SpreadsheetApp.getActive();
  const sh = ensureLehrlingeSheet_(ss, LEHRLINGE_STUDENTS_SHEET, LEHRLINGE_STUDENT_HEADERS);
  const sheetHeaders = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map((value) => String(value || "").trim().toLowerCase());
  const phoneIndex = sheetHeaders.indexOf("phone");
  const rows = sh.getLastRow() >= 2
    ? sh.getRange(2, 1, sh.getLastRow() - 1, LEHRLINGE_STUDENT_HEADERS.length).getValues()
    : [];
  const rowByPoint = {};
  rows.forEach((row, index) => {
    const pointId = String(row[2] || "").trim();
    if (pointId) rowByPoint[pointId] = index + 2;
  });

  (points || []).forEach((point) => {
    const pointId = String(point.id || "").trim();
    // contact_name remains the legacy field; here it is the Lehrling name.
    const name = String(point.lehrling_name || point.contact_name || "").trim();
    if (!pointId || !name) return;

    const rowNumber = rowByPoint[pointId];
    const existing = rowNumber
      ? sh.getRange(rowNumber, 1, 1, LEHRLINGE_STUDENT_HEADERS.length).getValues()[0]
      : null;
    const studentId = String(point.lehrling_id || existing?.[0] || pointId).trim();
    const pin = String(point.lehrling_pin || "").trim();
    if (pin && !/^\d{4}$/.test(pin)) throw new Error("pin_must_be_4_digits_for_" + pointId);
    const pinHash = pin ? sha256Hex_(pin) : String(existing?.[4] || "");
    const values = [[
      studentId,
      name,
      pointId,
      String(point.active || "1") === "0" ? "0" : "1",
      pinHash,
      new Date(),
      phoneIndex >= 0 ? String(existing?.[phoneIndex] || "") : "",
    ]];
    if (rowNumber) sh.getRange(rowNumber, 1, 1, LEHRLINGE_STUDENT_HEADERS.length).setValues(values);
    else sh.appendRow(values[0]);
  });
}

function loginLehrling_(studentId, pin) {
  const id = String(studentId || "").trim().toLowerCase();
  const normalizedPin = String(pin || "").replace(/\D/g, "");
  if (!id || !/^\d{4}$/.test(normalizedPin)) throw new Error("invalid_credentials");

  const student = getLehrlingStudent_(id);
  if (!student || student.active !== "1" || !student.pinHash) {
    throw new Error("invalid_credentials");
  }
  if (sha256Hex_(normalizedPin) !== student.pinHash) {
    throw new Error("invalid_credentials");
  }

  const token = student.id + "." + Utilities.getUuid() + Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty(
    LEHRLINGE_REMEMBER_TOKEN_PREFIX + student.id,
    JSON.stringify({ hash: sha256Hex_(token), expiresAt: Date.now() + LEHRLINGE_REMEMBER_TOKEN_TTL_SEC * 1000 })
  );
  return { token: token, expiresInSec: LEHRLINGE_REMEMBER_TOKEN_TTL_SEC, studentId: student.id };
}

function requestLehrlingPinReset_(studentId) {
  const id = String(studentId || "").trim().toLowerCase();
  if (!id) throw new Error("invalid_reset_data");
  const student = getLehrlingStudent_(id);
  if (!student || student.active !== "1" || !student.phone) throw new Error("phone_not_registered");
  const storedPhone = normalizeDriverPhone_(student.phone);
  const code = String(Math.floor(100000 + Math.random() * 900000));
  PropertiesService.getScriptProperties().setProperty(LEHRLINGE_PIN_RESET_PREFIX + id, JSON.stringify({ hash: sha256Hex_(code), phone: storedPhone, expiresAt: Date.now() + LEHRLINGE_PIN_RESET_TTL_SEC * 1000, attempts: 0 }));
  const sms = sendZadarmaSms_(storedPhone, "MurtalTaxi: Dein PIN-Code zum Zurücksetzen lautet " + code + ". Gültig 10 Minuten.");
  if (sms && sms.skipped) throw new Error("sms_not_configured");
  return { sent: true, expiresInSec: LEHRLINGE_PIN_RESET_TTL_SEC, maskedPhone: maskPhoneLastTwo_(storedPhone) };
}

function requestLehrlingIdRecovery_(phone) {
  const requestedPhone = normalizeDriverPhone_(phone);
  if (requestedPhone.replace(/\D/g, "").length < 8) throw new Error("invalid_reset_data");
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(LEHRLINGE_STUDENTS_SHEET);
  if (!sh || sh.getLastRow() < 2) throw new Error("phone_not_registered");
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map((value) => String(value || "").trim().toLowerCase());
  const phoneIndex = headers.indexOf("phone");
  if (phoneIndex < 0) throw new Error("phone_not_registered");
  const matches = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues()
    .filter((row) => String(row[3] || "") === "1" && row[phoneIndex] && normalizeDriverPhone_(row[phoneIndex]) === requestedPhone)
    .map((row) => String(row[0] || "").trim().toLowerCase())
    .filter(Boolean);
  if (!matches.length) throw new Error("phone_not_registered");
  if (matches.length > 1) throw new Error("phone_not_unique");
  const studentId = matches[0];
  const code = String(Math.floor(100000 + Math.random() * 900000));
  PropertiesService.getScriptProperties().setProperty(LEHRLINGE_PIN_RESET_PREFIX + studentId, JSON.stringify({ hash: sha256Hex_(code), phone: requestedPhone, expiresAt: Date.now() + LEHRLINGE_PIN_RESET_TTL_SEC * 1000, attempts: 0 }));
  const sms = sendZadarmaSms_(requestedPhone, "MurtalTaxi: Deine Lehrling-ID ist " + studentId + ". SMS-Code: " + code + ". Gültig 10 Minuten.");
  if (sms && sms.skipped) throw new Error("sms_not_configured");
  return { sent: true, expiresInSec: LEHRLINGE_PIN_RESET_TTL_SEC, maskedPhone: maskPhoneLastTwo_(requestedPhone) };
}

function resetLehrlingPin_(studentId, phone, code, pin) {
  const id = String(studentId || "").trim().toLowerCase();
  const normalizedPin = String(pin || "").replace(/\D/g, "");
  if (!id || !/^\d{6}$/.test(String(code || "").trim()) || !/^\d{4}$/.test(normalizedPin)) throw new Error("invalid_reset_data");
  const student = getLehrlingStudent_(id);
  if (!student || student.active !== "1" || !student.phone) throw new Error("phone_not_registered");
  const props = PropertiesService.getScriptProperties();
  const key = LEHRLINGE_PIN_RESET_PREFIX + id;
  let saved;
  try { saved = JSON.parse(props.getProperty(key) || "null"); } catch (_) { saved = null; }
  if (!saved || saved.expiresAt <= Date.now()) throw new Error("reset_code_expired");
  if (Number(saved.attempts || 0) >= 5) { props.deleteProperty(key); throw new Error("reset_code_locked"); }
  if (sha256Hex_(String(code || "").trim()) !== saved.hash) {
    saved.attempts = Number(saved.attempts || 0) + 1;
    props.setProperty(key, JSON.stringify(saved));
    throw new Error("invalid_reset_code");
  }
  const sh = ensureLehrlingeSheet_(SpreadsheetApp.getActive(), LEHRLINGE_STUDENTS_SHEET, LEHRLINGE_STUDENT_HEADERS);
  const row = findLehrlingStudentRow_(sh, id);
  if (!row) throw new Error("student_not_found");
  sh.getRange(row, 5, 1, 2).setValues([[sha256Hex_(normalizedPin), new Date()]]);
  props.deleteProperty(key);
  return loginLehrling_(id, normalizedPin);
}

function getLehrlingeStudentPlan_(session, from, to) {
  const student = getLehrlingStudent_(session.studentId);
  if (!student || student.active !== "1") throw new Error("student_not_found");
  const plan = getLehrlingePlan_(from, to);
  const point = getPointForLehrling_(student.pointId);
  return {
    student: { id: student.id, name: student.name, pointId: student.pointId, address: point?.name || "", route: point?.route || "", arrivalTime: point?.arrivalTime || "" },
    items: plan.items.filter((item) => item.student_id === student.id),
    holidays: plan.holidays,
  };
}

function logoutLehrling_(token) {
  const normalized = String(token || "").trim();
  const studentId = normalized.split(".")[0];
  if (studentId) PropertiesService.getScriptProperties().deleteProperty(LEHRLINGE_REMEMBER_TOKEN_PREFIX + studentId);
  cacheRemove_(LEHRLINGE_STUDENT_TOKEN_PREFIX + normalized);
  return { ok: true };
}

function saveLehrlingeStudentPlan_(session, body) {
  const student = getLehrlingStudent_(session.studentId);
  if (!student || student.active !== "1") throw new Error("student_not_found");
  const requested = JSON.parse(String(body.rows || "[]"));
  const rows = Array.isArray(requested) ? requested : [];
  const dates = rows.map((item) => String(item.date || "").trim()).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
  const sortedDates = dates.slice().sort();
  const current = sortedDates.length ? getLehrlingePlan_(sortedDates[0], sortedDates[sortedDates.length - 1]) : { items: [], holidays: [] };
  const currentByDate = {};
  current.items.filter((item) => item.student_id === student.id).forEach((item) => { currentByDate[item.date] = item.status; });
  const planRows = [];
  rows.forEach((item) => {
    const date = String(item.date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("invalid_date");
    const out = item.out === true || item.out === "1";
    const back = item.back === true || item.back === "1";
    const currentStatus = currentByDate[date] || "none";
    const currentOut = currentStatus === "both" || currentStatus === "out";
    const currentBack = currentStatus === "both" || currentStatus === "back";
    if (out !== currentOut) assertLehrlingeCutoffOpen_(date, "morning");
    if (back !== currentBack) assertLehrlingeCutoffOpen_(date, "evening");
    planRows.push({ date: date, student_id: student.id, status: out && back ? "both" : out ? "out" : back ? "back" : "none" });
  });
  return saveLehrlingePlan_({ rows: JSON.stringify(planRows), holidays: JSON.stringify(current.holidays), updatedBy: student.id });
}

function getPointForLehrling_(pointId) {
  const sh = SpreadsheetApp.getActive().getSheetByName("Points");
  if (!sh || sh.getLastRow() < 2) return null;
  const rows = sh.getDataRange().getValues();
  const displayRows = sh.getDataRange().getDisplayValues();
  for (let index = 1; index < rows.length; index += 1) {
    if (String(rows[index][0] || "").trim() !== String(pointId || "").trim()) continue;
    return { name: String(rows[index][1] || ""), route: String(rows[index][2] || ""), arrivalTime: String(displayRows[index]?.[7] || rows[index][7] || "") };
  }
  return null;
}

function requireLehrlingStudentToken_(token) {
  const normalized = String(token || "").trim();
  const studentId = normalized.split(".")[0];
  if (studentId && normalized.indexOf(".") > 0) {
    const stored = PropertiesService.getScriptProperties().getProperty(LEHRLINGE_REMEMBER_TOKEN_PREFIX + studentId);
    if (stored) {
      const data = JSON.parse(stored);
      if (data.expiresAt > Date.now() && data.hash === sha256Hex_(normalized)) {
        return { role: "student", studentId: studentId };
      }
      if (data.expiresAt <= Date.now()) PropertiesService.getScriptProperties().deleteProperty(LEHRLINGE_REMEMBER_TOKEN_PREFIX + studentId);
    }
  }
  const session = cacheGet_(LEHRLINGE_STUDENT_TOKEN_PREFIX + normalized);
  if (!session || session.role !== "student" || !session.studentId) {
    throw new Error("student_auth_required");
  }
  return session;
}

function getLehrlingStudent_(studentId) {
  const normalizedId = String(studentId || "").trim().toLowerCase();
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(LEHRLINGE_STUDENTS_SHEET);
  if (!sh || sh.getLastRow() < 2) return null;
  const sheetHeaders = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map((value) => String(value || "").trim().toLowerCase());
  const phoneIndex = sheetHeaders.indexOf("phone");
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  for (const row of values) {
    if (String(row[0] || "").trim().toLowerCase() !== normalizedId) continue;
    return {
      id: String(row[0] || "").trim(),
      name: String(row[1] || ""),
      pointId: String(row[2] || "").trim(),
      active: String(row[3] || "") === "1" ? "1" : "0",
      pinHash: String(row[4] || "").trim().toLowerCase(),
      phone: phoneIndex >= 0 ? String(row[phoneIndex] || "").trim() : "",
    };
  }
  return null;
}

function findLehrlingStudentRow_(sh, studentId) {
  if (sh.getLastRow() < 2) return 0;
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (let index = 0; index < values.length; index += 1) {
    if (String(values[index][0] || "").trim() === String(studentId || "").trim()) {
      return index + 2;
    }
  }
  return 0;
}

function lehrlingeCutoffOpen_(dateValue, direction, now) {
  const date = String(dateValue || "").trim();
  const current = now || new Date();
  const today = Utilities.formatDate(current, "Europe/Vienna", "yyyy-MM-dd");
  if (date > today) return true;
  if (date < today) return false;

  const hour = Number(Utilities.formatDate(current, "Europe/Vienna", "H"));
  return direction === "morning" ? hour < 3 : hour < 12;
}

function assertLehrlingeCutoffOpen_(dateValue, direction) {
  if (!lehrlingeCutoffOpen_(dateValue, direction)) {
    throw new Error(direction === "morning" ? "morning_cutoff_passed" : "evening_cutoff_passed");
  }
}
