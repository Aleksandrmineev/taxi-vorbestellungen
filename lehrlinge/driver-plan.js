const GAS_URL = "https://script.google.com/macros/s/AKfycbwS88JTgj1NVqhGAaMKi3MXxTawF9zA6mkG6avgxmIj8c61_20EjNZdY0_0U6kKor29/exec";
const API_SECRET = "102030";
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
const driverSession = (() => { try { return JSON.parse(localStorage.getItem("mt:driver-session") || "null"); } catch (_) { return null; } })();

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
  const today = new Date();
  const end = new Date(today);
  end.setDate(today.getDate() + 4);
  fromInput.value = dateKey(today);
  toInput.value = dateKey(end);
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
  localStorage.removeItem("mt:driver-session");
  localStorage.removeItem("mt:driver-authenticated");
    status.innerHTML = 'Die Fahreranmeldung ist abgelaufen oder nicht mehr gültig. Bitte zuerst auf der <a href="../">zentralen Startseite</a> erneut anmelden.';
}

async function loadSchedule() {
  loadButton.disabled = true;
  status.textContent = "Daten werden geladen…";
  schedule.innerHTML = "";
  const url = new URL(GAS_URL);
  if (!driverSession?.token) { showDriverAuthMessage(); loadButton.disabled = false; return; }
  Object.entries({ fn: "driver_schedule", driverToken: driverSession.token, from: fromInput.value, to: toInput.value, route: routeInput.value, direction: directionInput.value, secret: API_SECRET, _ts: Date.now() }).forEach(([key, value]) => url.searchParams.set(key, value));
  try {
    const response = await fetch(url, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok || result.ok === false) throw new Error(result.error || "API-Fehler");
    const visibleDays = renderSchedule(result.days || []);
    populateStudents(result.students || [], result.days || []);
    status.textContent = visibleDays ? "" : "Für diesen Zeitraum sind keine zukünftigen Fahrten geplant.";
  } catch (error) {
    if (String(error.message || "").includes("driver_auth_required")) showDriverAuthMessage();
    else status.textContent = `Fehler beim Laden: ${error.message}`;
  } finally {
    loadButton.disabled = false;
  }
}

function populateStudents(allStudents, days) {
  const students = new Map();
  allStudents.forEach((student) => students.set(student.id, student.name));
  days.forEach((day) => day.routes.forEach((route) => route.points.forEach((point) => point.students.forEach((student) => students.set(student.id, student.name)))));
  studentSelect.innerHTML = [...students.entries()].sort((a, b) => a[1].localeCompare(b[1], "de")).map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`).join("");
  openStudentPlan.disabled = !studentSelect.options.length;
}

editPlanButton.addEventListener("click", () => { picker.hidden = false; });
closePicker.addEventListener("click", () => { picker.hidden = true; });
openStudentPlan.addEventListener("click", () => {
  if (!studentSelect.value) return;
  window.location.href = `driver-student.html?studentId=${encodeURIComponent(studentSelect.value)}&from=${encodeURIComponent(fromInput.value)}&to=${encodeURIComponent(toInput.value)}`;
});

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
