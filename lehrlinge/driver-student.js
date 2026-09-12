const GAS_URL = "https://script.google.com/macros/s/AKfycbwS88JTgj1NVqhGAaMKi3MXxTawF9zA6mkG6avgxmIj8c61_20EjNZdY0_0U6kKor29/exec";
const API_SECRET = "102030";
const qs = new URLSearchParams(location.search);
const studentId = String(qs.get("studentId") || "").toLowerCase();
const from = document.getElementById("from");
const to = document.getElementById("to");
const load = document.getElementById("load");
const save = document.getElementById("save");
const trips = document.getElementById("trips");
const status = document.getElementById("status");
const changes = new Map();
let data = null;
let toastTimer;

const session = (() => {
  try { return JSON.parse(localStorage.getItem("mt:driver-session") || "null"); }
  catch (_) { return null; }
})();

const toast = document.createElement("div");
toast.className = "save-toast";
toast.setAttribute("role", "status");
toast.setAttribute("aria-live", "polite");
document.body.appendChild(toast);

function showToast(message, type) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `save-toast ${type} show`;
  toastTimer = setTimeout(() => { toast.className = "save-toast"; }, 2600);
}

function key(date) { return `${date}|${studentId}`; }
function today() { return new Date().toISOString().slice(0, 10); }
function endDate() {
  const date = new Date();
  date.setDate(date.getDate() + 4);
  return date.toISOString().slice(0, 10);
}

function viennaToday() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function cutoffOpen(date, direction) {
  const currentDate = viennaToday();
  if (date > currentDate) return true;
  if (date < currentDate) return false;
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Vienna", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  return direction === "out" ? hour < 3 : hour < 12;
}

function friendlyError(error) {
  const message = String(error?.message || error || "Unbekannter Fehler");
  if (message.includes("morning_cutoff_passed")) return "Die Hinfahrt kann nicht mehr geändert werden (Frist: 03:00).";
  if (message.includes("evening_cutoff_passed")) return "Die Rückfahrt kann nicht mehr geändert werden (Frist: 12:00).";
  return message;
}

function render() {
  const byDate = Object.fromEntries((data.items || []).map(item => [item.date, item]));
  const dates = [];
  for (let date = new Date(`${from.value}T12:00:00`); date <= new Date(`${to.value}T12:00:00`); date.setDate(date.getDate() + 1)) {
    if (date.getDay() !== 0 && date.getDay() !== 6) dates.push(date.toISOString().slice(0, 10));
  }

  trips.innerHTML = dates.map(date => {
    const item = changes.get(key(date)) || byDate[date] || { status: "none" };
    const out = item.status === "both" || item.status === "out";
    const back = item.status === "both" || item.status === "back";
    const outOpen = cutoffOpen(date, "out");
    const backOpen = cutoffOpen(date, "back");
    return `<div class="trip"><div class="trip-date">${new Date(`${date}T12:00:00`).toLocaleDateString("de-AT", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" })}</div><button class="${out ? "active" : "off"}${outOpen ? "" : " cutoff"}" data-date="${date}" data-dir="out" ${outOpen ? "" : "disabled title=\"Änderung für Hinfahrt nicht mehr möglich\""}>${out ? "✓ Hin" : "× Hin"}</button><button class="${back ? "active" : "off"}${backOpen ? "" : " cutoff"}" data-date="${date}" data-dir="back" ${backOpen ? "" : "disabled title=\"Änderung für Rückfahrt nicht mehr möglich\""}>${back ? "✓ Rück" : "× Rück"}</button></div>`;
  }).join("") || "<p class='status'>Keine Werktage im Zeitraum.</p>";

  trips.querySelectorAll("button").forEach(button => button.addEventListener("click", () => {
    const date = button.dataset.date;
    const current = changes.get(key(date)) || byDate[date] || { status: "none" };
    let out = current.status === "both" || current.status === "out";
    let back = current.status === "both" || current.status === "back";
    if (button.dataset.dir === "out") out = !out;
    else back = !back;
    changes.set(key(date), { date, student_id: studentId, status: out && back ? "both" : out ? "out" : back ? "back" : "none", note: current.note || "" });
    render();
  }));
}

async function loadPlan() {
  if (!session?.token) {
    status.textContent = "Bitte zuerst als Fahrer anmelden.";
    return;
  }
  load.disabled = true;
  status.textContent = "Daten werden geladen…";
  const url = new URL(GAS_URL);
  Object.entries({ fn: "driver_student_plan", driverToken: session.token, studentId, from: from.value, to: to.value, secret: API_SECRET, _ts: Date.now() }).forEach(([key, value]) => url.searchParams.set(key, value));
  try {
    const response = await fetch(url, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok || result.ok === false) throw Error(result.error || "API-Fehler");
    data = result;
    document.getElementById("studentName").textContent = result.student.name;
    document.getElementById("studentMeta").textContent = [result.student.route && `Route ${result.student.route}`, result.student.address, result.student.time].filter(Boolean).join(" · ");
    render();
    status.textContent = "";
  } catch (error) {
    status.textContent = `Fehler: ${error.message}`;
  } finally {
    load.disabled = false;
  }
}

save.addEventListener("click", async () => {
  if (!changes.size) {
    showToast("Keine Änderungen vorhanden.", "error");
    return;
  }

  save.disabled = true;
  save.classList.add("is-saving");
  save.textContent = "Speichern…";
  status.textContent = "Änderungen werden gespeichert…";

  try {
    const body = new URLSearchParams({
      action: "driver_plan_save",
      driverToken: session.token,
      rows: JSON.stringify([...changes.values()]),
      holidays: JSON.stringify(data.holidays || []),
      updatedBy: `driver:${session.driver?.taxiNumber || session.driver?.id || "unknown"}`,
      secret: API_SECRET,
    });
    const response = await fetch(GAS_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }, body });
    const result = await response.json();
    if (!response.ok || result.ok === false) throw Error(result.error || "Speichern fehlgeschlagen");
    changes.clear();
    showToast("Änderungen gespeichert", "success");
    await loadPlan();
  } catch (error) {
    const message = friendlyError(error);
    status.textContent = `Fehler beim Speichern: ${message}`;
    showToast(`Speichern fehlgeschlagen: ${message}`, "error");
  } finally {
    save.disabled = false;
    save.classList.remove("is-saving");
    save.textContent = "Änderungen speichern";
  }
});

from.value = qs.get("from") || today();
to.value = qs.get("to") || endDate();
load.addEventListener("click", loadPlan);
loadPlan();
