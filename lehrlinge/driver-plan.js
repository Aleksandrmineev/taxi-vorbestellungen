const fromInput = document.getElementById("from");
const toInput = document.getElementById("to");
const routeInput = document.getElementById("route");
const directionInput = document.getElementById("direction");
const loadButton = document.getElementById("load");
const status = document.getElementById("status");
const schedule = document.getElementById("schedule");
const editPlanButton = document.getElementById("editPlan");
const picker = document.getElementById("studentPicker");
const studentSelect = document.getElementById("studentSelect");
const closePicker = document.getElementById("closePicker");
const openStudentPlan = document.getElementById("openStudentPlan");

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayViennaKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vienna",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function setDefaultPeriod() {
  const period = DriverData.defaultPeriod();
  fromInput.value = period.from;
  toInput.value = period.to;
}

function formatDate(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("de-AT", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatChangedAt(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  }[character]));
}

function mapsUrl(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address || "")}`;
}

function showDriverAuthMessage() {
  DriverData.clearSession();
  status.innerHTML = 'Die Fahreranmeldung ist abgelaufen oder nicht mehr gültig. Bitte zuerst auf der <a href="../">zentralen Startseite</a> erneut anmelden.';
}

let loadSeq = 0;
let lastRendered = "";

function statusFor(visibleDays, meta) {
  if (meta.offline) return `Keine Verbindung · gespeicherte Daten von ${DriverData.formatSyncedAt(meta.savedAt)}`;
  if (meta.cached) return `Gespeicherte Daten von ${DriverData.formatSyncedAt(meta.savedAt)} · wird aktualisiert…`;
  return visibleDays ? "" : "Für diesen Zeitraum sind keine zukünftigen Fahrten geplant.";
}

async function loadSchedule() {
  const seq = ++loadSeq;
  loadButton.disabled = true;
  status.textContent = "Daten werden geladen…";
  const params = { from: fromInput.value, to: toInput.value, route: routeInput.value, direction: directionInput.value };
  try {
    await DriverData.loadSchedule(params, (result, meta) => {
      if (seq !== loadSeq) return;
      const signature = JSON.stringify(result.days || []);
      const visibleDays = signature === lastRendered ? schedule.querySelectorAll(".day").length : renderSchedule(result.days || []);
      lastRendered = signature;
      populateStudents(result.students || [], result.days || []);
      status.textContent = statusFor(visibleDays, meta);
    });
  } catch (error) {
    if (seq !== loadSeq) return;
    if (error.name === "AuthError") showDriverAuthMessage();
    else status.textContent = `Fehler beim Laden: ${error.message}`;
  } finally {
    if (seq === loadSeq) loadButton.disabled = false;
  }
}

function populateStudents(allStudents, days) {
  const students = new Map();
  days.forEach((day) => day.routes.forEach((route) => route.points.forEach((point) => point.students.forEach((student) => students.set(student.id, { name: student.name, address: point.address })))));
  allStudents.forEach((student) => students.set(student.id, { name: student.name, address: student.address || students.get(student.id)?.address || "" }));
  const selected = studentSelect.value;
  studentSelect.innerHTML = [...students.entries()]
    .sort((a, b) => a[1].name.localeCompare(b[1].name, "de"))
    .map(([id, student]) => `<option value="${escapeHtml(id)}">${escapeHtml(student.address ? `${student.name} · ${student.address}` : student.name)}</option>`)
    .join("");
  if (selected) studentSelect.value = selected;
  openStudentPlan.disabled = !studentSelect.options.length;
}

editPlanButton.addEventListener("click", () => { picker.hidden = false; });
closePicker.addEventListener("click", () => { picker.hidden = true; });
openStudentPlan.addEventListener("click", () => {
  if (!studentSelect.value) return;
  window.location.href = `driver-student.html?studentId=${encodeURIComponent(studentSelect.value)}&from=${encodeURIComponent(fromInput.value)}&to=${encodeURIComponent(toInput.value)}`;
});

/* ---------- Änderungsprotokoll ---------- */
const logDialog = document.getElementById("logDialog");
const logList = document.getElementById("logList");
const logStatus = document.getElementById("logStatus");
const logStudent = document.getElementById("logStudent");
const logAccounts = document.getElementById("logAccounts");
const logChips = [...document.querySelectorAll(".log-chip")];
const CHANNEL_LABEL = { student: "Eigenes Konto", shared: "Gemeinsames Konto", driver: "Fahrer", admin: "Büro" };
let logEntries = [];
let logChannel = "all";

function formatLogTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("de-AT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function renderLog() {
  const studentId = logStudent.value;
  const shown = logEntries.filter((entry) => {
    if (studentId && entry.studentId !== studentId) return false;
    if (logChannel === "all") return true;
    if (logChannel === "lehrlinge") return entry.channel === "student" || entry.channel === "shared";
    return entry.channel === logChannel && entry.event === "plan";
  });
  logStatus.textContent = logEntries.length && !shown.length ? "Keine Einträge für diesen Filter." : "";
  logList.innerHTML = shown.length ? `
    <div class="log-row log-head" aria-hidden="true"><span>Zeit</span><span>Lehrling</span><span>Änderung</span><span>Von</span></div>
    ${shown.map((entry) => `
      <div class="log-row${entry.event === "login" ? " is-login" : ""}">
        <span class="log-time">${escapeHtml(formatLogTime(entry.at))}</span>
        <strong class="log-name">${escapeHtml(entry.studentName)}</strong>
        <span class="log-text">${escapeHtml(entry.text)}</span>
        <span class="log-actor"><span class="log-badge log-badge--${escapeHtml(entry.event === "login" ? "login" : entry.channel)}">${escapeHtml(entry.event === "login" ? "Login" : CHANNEL_LABEL[entry.channel] || entry.channel)}</span>${entry.channel === "driver" ? ` ${escapeHtml(entry.actor.replace(/^Fahrer /, ""))}` : ""}</span>
      </div>`).join("")}` : "";
}

function renderAccounts(accounts) {
  if (!Array.isArray(accounts) || !accounts.length) { logAccounts.hidden = true; return; }
  const groups = [
    ["never", "Noch nie eingeloggt"],
    ["no_pin", "Kein eigenes Konto (keine PIN)"],
    ["active", "Nutzt eigenes Konto"],
  ];
  logAccounts.innerHTML = `<h3>Konten</h3>${groups.map(([key, label]) => {
    const list = accounts.filter((account) => account.status === key);
    return `<details${key === "never" ? " open" : ""}><summary>${label} <span>${list.length}</span></summary><p>${list.map((account) => escapeHtml(account.name) + (account.lastLogin ? ` <small>(${escapeHtml(formatLogTime(account.lastLogin))})</small>` : account.lastSharedChange ? " <small>(nutzt gemeinsames Konto)</small>" : "")).join(", ") || "—"}</p></details>`;
  }).join("")}`;
  logAccounts.hidden = false;
}

async function openLog() {
  logDialog.hidden = false;
  logStatus.textContent = "Wird geladen…";
  logList.innerHTML = "";
  try {
    const result = await DriverData.loadPlanLog();
    logEntries = result.entries || [];
    const names = new Map(logEntries.map((entry) => [entry.studentId, entry.studentName]));
    const selected = logStudent.value;
    logStudent.innerHTML = '<option value="">Alle Lehrlinge</option>' + [...names.entries()]
      .sort((a, b) => a[1].localeCompare(b[1], "de"))
      .map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`).join("");
    if (names.has(selected)) logStudent.value = selected;
    renderAccounts(result.accounts);
    if (!logEntries.length) { logStatus.textContent = "Noch keine Änderungen protokolliert."; return; }
    renderLog();
  } catch (error) {
    if (error.name === "AuthError") { logDialog.hidden = true; showDriverAuthMessage(); return; }
    logStatus.textContent = "Protokoll gerade nicht erreichbar. Bitte später erneut versuchen.";
  }
}

document.getElementById("openLog").addEventListener("click", openLog);
document.getElementById("closeLog").addEventListener("click", () => { logDialog.hidden = true; });
logDialog.addEventListener("click", (event) => { if (event.target === logDialog) logDialog.hidden = true; });
logStudent.addEventListener("change", renderLog);
logChips.forEach((chip) => chip.addEventListener("click", () => {
  logChannel = chip.dataset.channel;
  logChips.forEach((other) => other.classList.toggle("is-active", other === chip));
  renderLog();
}));

function renderSchedule(days) {
  const today = todayViennaKey();
  const visibleDays = days.filter((day) => day.date >= today);
  const nearestDate = visibleDays[0]?.date;
  schedule.innerHTML = visibleDays.map((day) => `
    <section class="day">
      <h2 class="day-title">${formatDate(day.date)}</h2>
      ${day.routes.map((route) => `
        <details class="route-block"${day.date === nearestDate ? " open" : ""}>
          <summary class="route-title">Route ${escapeHtml(route.route)} · ${route.direction === "evening" ? "Rückfahrt" : "Hinfahrt"} · ${route.count ?? route.points.reduce((total, point) => total + point.students.length, 0)} Lehrlinge</summary>
          <div class="route-points">
          ${(route.direction === "evening" ? [...route.points].reverse() : route.points).map((point) => `
            <div class="stop">
              <div class="stop-address"><a href="${escapeHtml(point.url && /^https?:\/\//i.test(point.url) ? point.url : mapsUrl(point.address))}" target="_blank" rel="noopener">${escapeHtml(point.address || "—")}</a></div>
              <div class="stop-students">
                ${point.students.map((student) => `<span class="student"><strong>${escapeHtml(student.name)}</strong>${student.updatedBy ? `<small>Geändert von ${escapeHtml(student.updatedBy)}${student.note ? ` · ${escapeHtml(student.note)}` : ""}</small>` : ""}</span>`).join("")}
                ${point.phone ? `<a class="call-link" href="tel:${encodeURIComponent(point.phone)}" aria-label="Punkt anrufen">☎</a>` : ""}
              </div>
            </div>`).join("")}
          </div>
          ${route.cancellations?.length ? `<div class="cancellations"><div class="cancellations-title">Absagen / Änderungen</div>${route.cancellations.map((item) => `<div class="cancelled"><div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.address)}</span></div><small>Geändert von ${escapeHtml(item.updatedBy)}${item.updatedAt ? ` · ${escapeHtml(formatChangedAt(item.updatedAt))}` : ""}${item.note ? ` · ${escapeHtml(item.note)}` : ""}</small></div>`).join("")}</div>` : ""}
        </details>`).join("")}
    </section>`).join("") || '<div class="empty">Keine zukünftigen Fahrten.</div>';
  return visibleDays.length;
}

loadButton.addEventListener("click", loadSchedule);
setDefaultPeriod();
loadSchedule();
