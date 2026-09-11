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

const LEHRLINGE_STUDENT_HEADERS = [
  "student_id",
  "name",
  "point_id",
  "active",
  "pin_hash",
  "updated_at",
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
  if (!sh || sh.getLastRow() < 2) return { items: items, holidays: [] };

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
    };
    if (String(row[6] || "").trim() === "holiday") holidays.add(date);
  });
  return { items: Object.keys(itemsByKey).sort().map((key) => itemsByKey[key]), holidays: Array.from(holidays).sort() };
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
    const values = [[date, studentId, existing?.[2] ?? morning, existing?.[3] ?? evening, morning, evening, holidays.has(date) ? "holiday" : "", "admin", now]];
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
  sh.getRange(2, 1, values.length, LEHRLINGE_PLAN_HEADERS.length).clearContent();
  if (unique.length) sh.getRange(2, 1, unique.length, LEHRLINGE_PLAN_HEADERS.length).setValues(unique);
  return { ok: true, before: values.length, after: unique.length, removed: values.length - unique.length, invalid: invalid };
}

function ensureLehrlingeSheet_(ss, name, headers) {
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
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
    ]];
    if (rowNumber) sh.getRange(rowNumber, 1, 1, LEHRLINGE_STUDENT_HEADERS.length).setValues(values);
    else sh.appendRow(values[0]);
  });
}

function loginLehrling_(studentId, pin) {
  const id = String(studentId || "").trim();
  const normalizedPin = String(pin || "").replace(/\D/g, "");
  if (!id || !/^\d{4}$/.test(normalizedPin)) throw new Error("invalid_credentials");

  const student = getLehrlingStudent_(id);
  if (!student || student.active !== "1" || !student.pinHash) {
    throw new Error("invalid_credentials");
  }
  if (sha256Hex_(normalizedPin) !== student.pinHash) {
    throw new Error("invalid_credentials");
  }

  const token = Utilities.getUuid() + Utilities.getUuid();
  cachePut_(LEHRLINGE_STUDENT_TOKEN_PREFIX + token, {
    role: "student",
    studentId: student.id,
  }, LEHRLINGE_STUDENT_TOKEN_TTL_SEC);
  return { token: token, expiresInSec: LEHRLINGE_STUDENT_TOKEN_TTL_SEC, studentId: student.id };
}

function requireLehrlingStudentToken_(token) {
  const normalized = String(token || "").trim();
  const session = cacheGet_(LEHRLINGE_STUDENT_TOKEN_PREFIX + normalized);
  if (!session || session.role !== "student" || !session.studentId) {
    throw new Error("student_auth_required");
  }
  return session;
}

function getLehrlingStudent_(studentId) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(LEHRLINGE_STUDENTS_SHEET);
  if (!sh || sh.getLastRow() < 2) return null;
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, LEHRLINGE_STUDENT_HEADERS.length).getValues();
  for (const row of values) {
    if (String(row[0] || "").trim() !== String(studentId || "").trim()) continue;
    return {
      id: String(row[0] || "").trim(),
      name: String(row[1] || ""),
      pointId: String(row[2] || "").trim(),
      active: String(row[3] || "") === "1" ? "1" : "0",
      pinHash: String(row[4] || "").trim().toLowerCase(),
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
