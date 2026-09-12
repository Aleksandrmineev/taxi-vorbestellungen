const GAS_URL = "https://script.google.com/macros/s/AKfycbwS88JTgj1NVqhGAaMKi3MXxTawF9zA6mkG6avgxmIj8c61_20EjNZdY0_0U6kKor29/exec";
const API_SECRET = "102030";
const fromInput = document.getElementById("from");
const toInput = document.getElementById("to");
const routeInput = document.getElementById("route");
const directionInput = document.getElementById("direction");
const loadButton = document.getElementById("load");
const status = document.getElementById("status");
const schedule = document.getElementById("schedule");

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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  }[character]));
}

function mapsUrl(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address || "")}`;
}

async function loadSchedule() {
  loadButton.disabled = true;
  status.textContent = "Daten werden geladen…";
  schedule.innerHTML = "";
  const url = new URL(GAS_URL);
  Object.entries({ fn: "driver_schedule", from: fromInput.value, to: toInput.value, route: routeInput.value, direction: directionInput.value, secret: API_SECRET, _ts: Date.now() }).forEach(([key, value]) => url.searchParams.set(key, value));
  try {
    const response = await fetch(url, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok || result.ok === false) throw new Error(result.error || "API-Fehler");
    const visibleDays = renderSchedule(result.days || []);
    status.textContent = visibleDays ? "" : "Für diesen Zeitraum sind keine zukünftigen Fahrten geplant.";
  } catch (error) {
    status.textContent = `Fehler beim Laden: ${error.message}`;
  } finally {
    loadButton.disabled = false;
  }
}

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
                ${point.students.map((student) => `<span class="student">${escapeHtml(student.name)}</span>`).join("")}
                ${point.phone ? `<a class="call-link" href="tel:${encodeURIComponent(point.phone)}" aria-label="Punkt anrufen">☎</a>` : ""}
              </div>
            </div>`).join("")}
          </div>
        </details>`).join("")}
    </section>`).join("") || '<div class="empty">Keine zukünftigen Fahrten.</div>';
  return visibleDays.length;
}

loadButton.addEventListener("click", loadSchedule);
setDefaultPeriod();
loadSchedule();
