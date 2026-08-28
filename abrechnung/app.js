const STORAGE_KEY = "taxi-journal-v1";
const CURRENT_DRIVER_KEY = "taxi-current-driver";

const $ = (selector) => document.querySelector(selector);
const money = new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" });
const number = new Intl.NumberFormat("de-AT", { maximumFractionDigits: 2 });

const legacyStorage = {
  load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { profiles: {} };
    } catch {
      return { profiles: {} };
    }
  },
};

const legacyDb = legacyStorage.load();
let db = { profiles: {} };
let currentDriver = localStorage.getItem(CURRENT_DRIVER_KEY) || sessionStorage.getItem(CURRENT_DRIVER_KEY);
if (currentDriver) localStorage.setItem(CURRENT_DRIVER_KEY, currentDriver);
let pendingReport = null;

const GAS_PROXY = "/api/gas";
const API_SECRET = "102030";

async function api(path, options = {}) {
  const method = options.method || "GET";
  const body = options.body ? JSON.parse(options.body) : {};
  const token = String(options.headers?.Authorization || "").replace(/^Bearer\s+/i, "");
  let requestMethod = "POST";
  let payload = { secret: API_SECRET };
  let query = null;

  const profileMatch = path.match(/^\/api\/profiles\/([^/]+)$/);
  const carsMatch = path.match(/^\/api\/profiles\/([^/]+)\/cars$/);
  const reportMatch = path.match(/^\/api\/admin\/reports\/([^/]+)$/);
  const clearMatch = path.match(/^\/api\/admin\/profiles\/([^/]+)\/clear$/);

  if (method === "GET" && profileMatch) {
    requestMethod = "GET";
    query = { fn: "shift_profile", driver: decodeURIComponent(profileMatch[1]), secret: API_SECRET };
  } else if (method === "GET" && path === "/api/admin/profiles") {
    requestMethod = "GET";
    query = { fn: "shift_admin_data", adminToken: token, secret: API_SECRET };
  } else if (method === "POST" && path === "/api/admin/login") {
    payload = { action: "shift_admin_login", secret: API_SECRET, ...body };
  } else if (method === "POST" && path === "/api/profiles") {
    payload = { action: "shift_profile_save", secret: API_SECRET, ...body };
  } else if (method === "POST" && carsMatch) {
    payload = { action: "shift_car_save", secret: API_SECRET, driverNumber: decodeURIComponent(carsMatch[1]), ...body };
  } else if (method === "POST" && path === "/api/reports") {
    payload = { action: "shift_report_save", secret: API_SECRET, ...body };
  } else if (method === "PUT" && reportMatch) {
    payload = { action: "shift_admin_report_save", secret: API_SECRET, adminToken: token, reportId: decodeURIComponent(reportMatch[1]), ...body };
  } else if (method === "DELETE" && reportMatch) {
    payload = { action: "shift_admin_report_delete", secret: API_SECRET, adminToken: token, reportId: decodeURIComponent(reportMatch[1]) };
  } else if (method === "POST" && clearMatch) {
    payload = { action: "shift_admin_clear", secret: API_SECRET, adminToken: token, driverNumber: decodeURIComponent(clearMatch[1]), ...body };
  } else {
    throw new Error(`Unbekannte API-Route: ${method} ${path}`);
  }

  const url = query ? `${GAS_PROXY}?${new URLSearchParams(query)}` : GAS_PROXY;
  const response = await fetch(url, requestMethod === "GET" ? { method: "GET" } : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data.error || "Serverfehler");
    error.status = data.error === "not_found" ? 404 : response.status;
    throw error;
  }
  return data;
}

async function fetchProfile(driver) {
  try {
    return (await api(`/api/profiles/${encodeURIComponent(driver)}`)).profile;
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function migrateLegacyProfile(driver) {
  const legacy = legacyDb.profiles?.[driver];
  if (!legacy || localStorage.getItem(`taxi-migrated-${driver}`)) return;
  for (const car of legacy.cars || []) {
    await api(`/api/profiles/${encodeURIComponent(driver)}/cars`, { method: "POST", body: JSON.stringify({ car }) });
  }
  for (const report of legacy.reports || []) {
    await api("/api/reports", { method: "POST", body: JSON.stringify({ report: { ...report, driverNumber: driver } }) });
  }
  if (legacy.reports?.length) localStorage.setItem(`taxi-recognized-${driver}`, "1");
  localStorage.setItem(`taxi-migrated-${driver}`, "1");
}

function isRecognizedDriver() {
  return Boolean(currentDriver && localStorage.getItem(`taxi-recognized-${currentDriver}`));
}

function localDateTime(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function amount(id) {
  return Number($(id).value) || 0;
}

function activeProfile() {
  return db.profiles[currentDriver];
}

function totalDifference() {
  return (Number(activeProfile()?.carryoverBalance) || 0) + (activeProfile()?.reports || []).reduce((sum, report) => sum + (Number(report.difference) || 0), 0);
}

function renderCars(selected) {
  const select = $("#car");
  const cars = activeProfile()?.cars || [];
  select.innerHTML = cars.length
    ? cars.map((car) => `<option value="${escapeHtml(car)}">${escapeHtml(car)}</option>`).join("")
    : '<option value="">Kennzeichen hinzufügen</option>';
  select.value = selected && cars.includes(selected) ? selected : (activeProfile()?.lastCar || cars[0] || "");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function setGreeting() {
  const hour = new Date().getHours();
  const word = hour < 5 ? "Gute Nacht" : hour < 12 ? "Guten Morgen" : hour < 18 ? "Guten Tag" : "Guten Abend";
  const name = activeProfile()?.name?.trim();
  $("#greeting").textContent = `${word}, ${name || `№${currentDriver}`}`;
}

function resetForm() {
  $("#reportForm").reset();
  $("#reportDate").value = localDateTime();
  $("#hours").value = "11";
  const reports = activeProfile()?.reports || [];
  const lastShiftType = reports.at(-1)?.shiftType;
  const defaultShiftType = lastShiftType || (new Date().getHours() >= 5 && new Date().getHours() < 17 ? "day" : "night");
  $("#dayShift").checked = defaultShiftType === "day";
  $("#nightShift").checked = defaultShiftType === "night";
  renderCars();
  renderPreviousDifference();
  const lastNumber = Number(reports.at(-1)?.reportNumber);
  if (Number.isFinite(lastNumber)) $("#reportNumber").value = String(lastNumber + 1);
  updateCalculation();
}

function renderPreviousDifference() {
  const profile = activeProfile();
  const hasBalanceHistory = isRecognizedDriver() && (Boolean(profile?.reports?.length) || Math.abs(Number(profile?.carryoverBalance) || 0) > 0.005);
  const panel = $("#previousDifference");
  panel.hidden = !hasBalanceHistory;
  if (!hasBalanceHistory) return;
  const difference = totalDifference();
  $("#previousDifferenceValue").textContent = `${difference > 0 ? "+" : ""}${money.format(difference)}`;
  $("#previousDifferenceValue").style.color = difference > 0.005 ? "var(--green)" : difference < -0.005 ? "var(--red)" : "var(--ink)";
}

function updatePrivateVisibility() {
  const profile = activeProfile();
  const hasHistory = isRecognizedDriver() && (Boolean(profile?.reports?.length) || Math.abs(Number(profile?.carryoverBalance) || 0) > 0.005);
  $("#insights").hidden = !hasHistory;
  if (!hasHistory) $("#previousDifference").hidden = true;
}

async function showApp() {
  if (currentDriver && !db.profiles[currentDriver]) {
    try {
      const profile = await fetchProfile(currentDriver);
      if (profile) db.profiles[currentDriver] = profile;
    } catch {
      $("#authError").textContent = "Server nicht erreichbar. Bitte erneut versuchen.";
    }
  }
  if (!currentDriver || !db.profiles[currentDriver]) {
    currentDriver = null;
    $("#authView").hidden = false;
    $("#reportView").hidden = true;
    return;
  }
  if (!db.profiles[currentDriver].name?.trim()) {
    $("#loginDriver").value = currentDriver;
    $("#authView").hidden = false;
    $("#reportView").hidden = true;
    return;
  }
  $("#authView").hidden = true;
  $("#reportView").hidden = false;
  setGreeting();
  resetForm();
  updatePrivateVisibility();
  renderStats();
}

function updateCalculation() {
  const expected = amount("#sales") - amount("#expenses") - amount("#voucher") - amount("#qr") - amount("#terminal");
  const actual = amount("#actualCash");
  const difference = actual - expected;
  $("#expectedCash").textContent = money.format(expected);
  $("#difference").textContent = `${difference > 0 ? "+" : ""}${money.format(difference)}`;
  $("#differenceRow").className = `difference-row ${difference > 0.005 ? "positive" : difference < -0.005 ? "negative" : "neutral"}`;
  return { expected, actual, difference };
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthStats(reports, date) {
  const selected = reports.filter((report) => monthKey(new Date(report.date)) === monthKey(date));
  const sales = selected.reduce((sum, report) => sum + report.sales, 0);
  const hours = selected.reduce((sum, report) => sum + report.hours, 0);
  return { count: selected.length, average: selected.length ? sales / selected.length : 0, hours };
}

function renderStats() {
  const reports = activeProfile()?.reports || [];
  const now = new Date();
  const previousDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const current = monthStats(reports, now);
  const previous = monthStats(reports, previousDate);
  $("#historyCount").textContent = String(reports.length);
  const monthName = new Intl.DateTimeFormat("de-AT", { month: "long" }).format(now);
  $("#insightsTitle").textContent = monthName[0].toUpperCase() + monthName.slice(1);
  $("#currentAverage").textContent = money.format(current.average).replace(",00", "");
  $("#previousAverage").textContent = `Vormonat: ${money.format(previous.average).replace(",00", "")}`;
  $("#currentHours").textContent = `${number.format(current.hours)} Std.`;
  $("#previousHours").textContent = `Vormonat: ${number.format(previous.hours)} Std.`;

  if (previous.average > 0) {
    const change = ((current.average - previous.average) / previous.average) * 100;
    $("#trendBadge").textContent = `${change >= 0 ? "↑" : "↓"} ${Math.abs(change).toFixed(0)}%`;
    $("#trendBadge").style.background = change >= 0 ? "var(--lime)" : "color-mix(in oklab, var(--red) 18%, var(--card))";
  } else {
    $("#trendBadge").textContent = current.count ? `${current.count} Schichten` : "—";
  }

  if (!current.count) $("#motivation").textContent = "Nach dem ersten Bericht erscheint hier Ihr Fortschritt.";
  else if (current.average >= previous.average && previous.count) $("#motivation").textContent = "Guter Trend: Der durchschnittliche Umsatz steigt.";
  else $("#motivation").textContent = `${current.count} ${current.count === 1 ? "Schicht" : "Schichten"} in diesem Monat.`;
}

function renderHistory() {
  const reports = [...(activeProfile()?.reports || [])].reverse();
  let runningTotal = Number(activeProfile()?.carryoverBalance) || 0;
  $("#historyBody").innerHTML = reports.map((report) => {
    const difference = Number(report.difference) || 0;
    runningTotal += difference;
    const date = new Intl.DateTimeFormat("de-AT", { dateStyle: "short", timeStyle: "short" }).format(new Date(report.date));
    const cellMoney = (value) => money.format(Number(value) || 0);
    return `<tr>
      <td>${escapeHtml(date)}</td>
      <td>${report.shiftType === "night" ? "Nacht" : "Tag"}</td>
      <td>${escapeHtml(number.format(Number(report.hours) || 0))}</td>
      <td>${escapeHtml(report.car || "—")}</td>
      <td>${escapeHtml(report.reportNumber || "—")}</td>
      <td>${cellMoney(report.sales)}</td>
      <td>${cellMoney(report.expenses)}</td>
      <td>${cellMoney(report.voucher)}</td>
      <td>${cellMoney(report.qr)}</td>
      <td>${cellMoney(report.terminal)}</td>
      <td>${cellMoney(report.expectedCash)}</td>
      <td>${cellMoney(report.actualCash)}</td>
      <td class="${difference > 0.005 ? "positive" : difference < -0.005 ? "negative" : ""}">${difference > 0 ? "+" : ""}${cellMoney(difference)}</td>
    </tr>`;
  }).join("");
  $("#historyTotal").textContent = `${runningTotal > 0 ? "+" : ""}${money.format(runningTotal)}`;
  $("#historyTotal").style.color = runningTotal > 0.005 ? "var(--green)" : runningTotal < -0.005 ? "var(--red)" : "var(--ink)";
}

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const driver = $("#loginDriver").value.trim();
  const name = $("#loginName").value.trim();
  if (!/^[\p{L}\p{N}._-]{1,24}$/u.test(driver)) {
    $("#authError").textContent = "Fahrer-Nr. prüfen.";
    return;
  }
  if (!name) {
    $("#authError").textContent = "Bitte Namen eingeben.";
    return;
  }
  try {
    const result = await api("/api/profiles", { method: "POST", body: JSON.stringify({ driverNumber: driver, name }) });
    db.profiles[driver] = result.profile;
    currentDriver = driver;
    await migrateLegacyProfile(driver);
    db.profiles[driver] = await fetchProfile(driver);
    localStorage.setItem(CURRENT_DRIVER_KEY, driver);
    $("#authError").textContent = "";
    showApp();
  } catch {
    $("#authError").textContent = "Verbindung konnte nicht hergestellt werden.";
  }
});

$("#reportForm").addEventListener("input", updateCalculation);
$("#reportForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!$("#car").value) {
    $("#saveMessage").textContent = "Bitte zuerst ein Fahrzeug hinzufügen.";
    $("#carDialog").showModal();
    return;
  }
  const calculation = updateCalculation();
  pendingReport = {
    id: crypto.randomUUID(),
    driverNumber: currentDriver,
    date: new Date($("#reportDate").value).toISOString(),
    shiftType: document.querySelector('[name="shiftType"]:checked').value,
    hours: amount("#hours"),
    car: $("#car").value,
    reportNumber: $("#reportNumber").value.trim(),
    sales: amount("#sales"), expenses: amount("#expenses"), voucher: amount("#voucher"),
    qr: amount("#qr"), terminal: amount("#terminal"),
    expectedCash: calculation.expected, actualCash: calculation.actual, difference: calculation.difference,
    savedAt: new Date().toISOString(),
  };
  renderConfirmation(pendingReport);
  $("#confirmDialog").showModal();
});

function renderConfirmation(report) {
  const line = (label, value, className = "") => `<div class="${className}"><dt>${label}</dt><dd>${value}</dd></div>`;
  const reportDifference = Number(report.difference) || 0;
  const balanceAfterSave = totalDifference() + reportDifference;
  const formattedDate = new Intl.DateTimeFormat("de-AT", { dateStyle: "short", timeStyle: "short" }).format(new Date(report.date));
  $("#confirmSummary").innerHTML = `<dl>
    ${line("Fahrer", `${escapeHtml(activeProfile().name)} · Nr. ${escapeHtml(currentDriver)}`)}
    ${line("Datum / Schicht", `${escapeHtml(formattedDate)} · ${report.shiftType === "night" ? "Nacht" : "Tag"} · ${escapeHtml(number.format(report.hours))} Std.`)}
    ${line("Fahrzeug / Bericht-Nr.", `${escapeHtml(report.car)} · ${escapeHtml(report.reportNumber)}`)}
    ${line("Umsatz", money.format(report.sales))}
    ${line("Ausgaben", money.format(report.expenses))}
    ${line("Gutschein / QR / Bankomat", `${money.format(report.voucher)} / ${money.format(report.qr)} / ${money.format(report.terminal)}`)}
    ${line("Bar laut Abrechnung", money.format(report.expectedCash))}
    ${line("Tatsächlich abgegeben", money.format(report.actualCash))}
    ${line("Differenz dieser Schicht", `${reportDifference > 0 ? "+" : ""}${money.format(reportDifference)}`)}
    ${isRecognizedDriver() ? line("Saldo nach dem Speichern", `${balanceAfterSave > 0 ? "+" : ""}${money.format(balanceAfterSave)}`, "confirm-total") : ""}
  </dl>`;
}

$("#confirmReportButton").addEventListener("click", async () => {
  if (!pendingReport) return;
  const report = pendingReport;
  try {
    const result = await api("/api/reports", { method: "POST", body: JSON.stringify({ report }) });
    db.profiles[currentDriver] = result.profile;
    localStorage.setItem(`taxi-recognized-${currentDriver}`, "1");
  } catch {
    $("#confirmDialog").close();
    $("#saveMessage").textContent = "Bericht konnte nicht gespeichert werden. Verbindung prüfen.";
    return;
  }
  updatePrivateVisibility();
  renderPreviousDifference();
  renderStats();
  const accumulatedDifference = totalDifference();
  const balanceMeaning = accumulatedDifference > 0.005
    ? "Mehr als berechnet abgegeben."
    : accumulatedDifference < -0.005
      ? "Weniger als berechnet abgegeben."
      : "Alles stimmt überein.";
  $("#saveMessage").textContent = `Gespeichert. Saldo inklusive früherer Schichten: ${accumulatedDifference > 0 ? "+" : ""}${money.format(accumulatedDifference)}. ${balanceMeaning}`;
  pendingReport = null;
  $("#confirmDialog").close();
  setTimeout(() => {
    resetForm();
  }, 1800);
});

function closeConfirmation() {
  pendingReport = null;
  $("#confirmDialog").close();
}

$("#editReportButton").addEventListener("click", closeConfirmation);
$("#closeConfirm").addEventListener("click", closeConfirmation);

$("#addCarButton").addEventListener("click", () => $("#carDialog").showModal());
$("#cancelCar").addEventListener("click", () => $("#carDialog").close());
$("#carForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const car = $("#newCar").value.trim().toUpperCase();
  if (!car) return;
  try {
    const result = await api(`/api/profiles/${encodeURIComponent(currentDriver)}/cars`, { method: "POST", body: JSON.stringify({ car }) });
    activeProfile().cars = result.cars;
    activeProfile().lastCar = car;
  } catch {
    $("#saveMessage").textContent = "Fahrzeug konnte nicht gespeichert werden.";
    return;
  }
  renderCars(car);
  $("#newCar").value = "";
  $("#carDialog").close();
});

$("#menuButton").addEventListener("click", () => {
  const menu = $("#menu");
  menu.hidden = !menu.hidden;
  $("#menuButton").setAttribute("aria-expanded", String(!menu.hidden));
});

$("#logoutButton").addEventListener("click", () => {
  localStorage.removeItem(CURRENT_DRIVER_KEY);
  sessionStorage.removeItem(CURRENT_DRIVER_KEY);
  currentDriver = null;
  $("#menu").hidden = true;
  $("#loginDriver").value = "";
  $("#loginName").value = "";
  showApp();
});

$("#loginDriver").addEventListener("input", () => {
  const driver = $("#loginDriver").value.trim();
  const knownName = db.profiles[driver]?.name;
  $("#loginName").value = knownName || "";
});

$("#historyButton").addEventListener("click", () => {
  renderHistory();
  $("#historyDialog").showModal();
});
$("#closeHistory").addEventListener("click", () => $("#historyDialog").close());

$("#exportButton").addEventListener("click", () => {
  const payload = { version: 1, exportedAt: new Date().toISOString(), driverNumber: currentDriver, profile: activeProfile() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `taxi-report-${currentDriver}-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  $("#menu").hidden = true;
});

$("#importInput").addEventListener("change", async (event) => {
  try {
    const data = JSON.parse(await event.target.files[0].text());
    if (!data.profile?.reports || !Array.isArray(data.profile.reports)) throw new Error();
    await api("/api/profiles", { method: "POST", body: JSON.stringify({ driverNumber: currentDriver, name: data.profile.name || activeProfile().name }) });
    for (const car of data.profile.cars || []) await api(`/api/profiles/${encodeURIComponent(currentDriver)}/cars`, { method: "POST", body: JSON.stringify({ car }) });
    for (const report of data.profile.reports) await api("/api/reports", { method: "POST", body: JSON.stringify({ report: { ...report, driverNumber: currentDriver } }) });
    db.profiles[currentDriver] = await fetchProfile(currentDriver);
    renderCars();
    updatePrivateVisibility();
    renderStats();
    $("#saveMessage").textContent = "Daten importiert.";
  } catch {
    $("#saveMessage").textContent = "Datei konnte nicht importiert werden.";
  }
  event.target.value = "";
  $("#menu").hidden = true;
});

let editingReport = null;

function adminHeaders() {
  return { Authorization: `Bearer ${sessionStorage.getItem("taxi-admin-token") || ""}` };
}

async function loadAdminProfiles() {
  const result = await api("/api/admin/profiles", { headers: adminHeaders() });
  db.profiles = result.profiles;
}

async function openAdmin() {
  try {
    await loadAdminProfiles();
    renderAdmin();
    $("#adminDialog").showModal();
  } catch {
    sessionStorage.removeItem("taxi-admin-token");
    $("#adminLoginDialog").showModal();
  }
}

function renderAdmin(preferredDriver) {
  const profiles = Object.entries(db.profiles);
  const reports = profiles.flatMap(([, profile]) => profile.reports || []);
  $("#adminDriversCount").textContent = String(profiles.length);
  $("#adminReportsCount").textContent = String(reports.length);
  $("#adminSalesTotal").textContent = money.format(reports.reduce((sum, report) => sum + (Number(report.sales) || 0), 0)).replace(",00", "");
  $("#adminHoursTotal").textContent = `${number.format(reports.reduce((sum, report) => sum + (Number(report.hours) || 0), 0))} Std.`;

  const select = $("#adminDriverSelect");
  const previous = preferredDriver || select.value || currentDriver;
  select.innerHTML = profiles.map(([driver, profile]) => `<option value="${escapeHtml(driver)}">${escapeHtml(profile.name || "Ohne Namen")} · Nr. ${escapeHtml(driver)}</option>`).join("");
  if (db.profiles[previous]) select.value = previous;
  renderAdminDriver();
}

function renderAdminDriver() {
  const driver = $("#adminDriverSelect").value;
  const profile = db.profiles[driver];
  if (!profile) {
    $("#adminReportsBody").innerHTML = '<tr><td colspan="7">Keine Fahrer</td></tr>';
    return;
  }
  const reports = [...(profile.reports || [])].reverse();
  const balance = (Number(profile.carryoverBalance) || 0) + reports.reduce((sum, report) => sum + (Number(report.difference) || 0), 0);
  $("#adminDriverBalance").textContent = `Saldo: ${balance > 0 ? "+" : ""}${money.format(balance)}`;
  $("#adminDriverReports").textContent = `${reports.length} Berichte`;
  $("#adminReportsBody").innerHTML = reports.length ? reports.map((report) => {
    const difference = Number(report.difference) || 0;
    const date = new Intl.DateTimeFormat("de-AT", { dateStyle: "short", timeStyle: "short" }).format(new Date(report.date));
    return `<tr>
      <td>${escapeHtml(date)}</td><td>${escapeHtml(report.reportNumber || "—")}</td><td>${escapeHtml(report.car || "—")}</td>
      <td>${money.format(Number(report.sales) || 0)}</td><td>${money.format(Number(report.actualCash) || 0)}</td>
      <td class="${difference > 0.005 ? "positive" : difference < -0.005 ? "negative" : ""}">${difference > 0 ? "+" : ""}${money.format(difference)}</td>
      <td><button type="button" data-edit-report="${escapeHtml(report.id)}">Bearbeiten</button></td>
    </tr>`;
  }).join("") : '<tr><td colspan="7">Keine Berichte</td></tr>';
}

async function refreshAfterAdminChange(driver) {
  await loadAdminProfiles();
  renderAdmin(driver);
  if (driver === currentDriver) {
    updatePrivateVisibility();
    renderPreviousDifference();
    renderStats();
  }
}

$("#adminButton").addEventListener("click", () => {
  $("#menu").hidden = true;
  if (sessionStorage.getItem("taxi-admin-token")) openAdmin();
  else $("#adminLoginDialog").showModal();
});

$("#adminLoginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const result = await api("/api/admin/login", { method: "POST", body: JSON.stringify({ login: $("#adminLogin").value, password: $("#adminPassword").value }) });
    sessionStorage.setItem("taxi-admin-token", result.token);
  } catch {
    $("#adminLoginError").textContent = "Benutzername oder Passwort falsch.";
    return;
  }
  $("#adminLoginError").textContent = "";
  $("#adminPassword").value = "";
  $("#adminLoginDialog").close();
  openAdmin();
});

$("#closeAdminLogin").addEventListener("click", () => $("#adminLoginDialog").close());
$("#closeAdmin").addEventListener("click", () => $("#adminDialog").close());
$("#adminDriverSelect").addEventListener("change", renderAdminDriver);

$("#adminReportsBody").addEventListener("click", (event) => {
  const button = event.target.closest("[data-edit-report]");
  if (!button) return;
  const driver = $("#adminDriverSelect").value;
  const report = db.profiles[driver]?.reports?.find((item) => item.id === button.dataset.editReport);
  if (!report) return;
  editingReport = { driver, id: report.id };
  $("#editDate").value = localDateTime(new Date(report.date));
  $("#editShift").value = report.shiftType;
  $("#editHours").value = report.hours;
  $("#editCar").value = report.car;
  $("#editReportNumber").value = report.reportNumber;
  $("#editSales").value = report.sales;
  $("#editExpenses").value = report.expenses;
  $("#editVoucher").value = report.voucher;
  $("#editQr").value = report.qr;
  $("#editTerminal").value = report.terminal;
  $("#editActualCash").value = report.actualCash;
  $("#adminEditDialog").showModal();
});

$("#adminEditForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!editingReport) return;
  const report = db.profiles[editingReport.driver]?.reports?.find((item) => item.id === editingReport.id);
  if (!report) return;
  const value = (id) => Number($(id).value) || 0;
  Object.assign(report, {
    date: new Date($("#editDate").value).toISOString(), shiftType: $("#editShift").value,
    hours: value("#editHours"), car: $("#editCar").value.trim().toUpperCase(), reportNumber: $("#editReportNumber").value.trim(),
    sales: value("#editSales"), expenses: value("#editExpenses"), voucher: value("#editVoucher"), qr: value("#editQr"), terminal: value("#editTerminal"), actualCash: value("#editActualCash"),
    editedAt: new Date().toISOString(),
  });
  report.expectedCash = report.sales - report.expenses - report.voucher - report.qr - report.terminal;
  report.difference = report.actualCash - report.expectedCash;
  const driver = editingReport.driver;
  try {
    await api(`/api/admin/reports/${encodeURIComponent(report.id)}`, { method: "PUT", headers: adminHeaders(), body: JSON.stringify({ report }) });
  } catch {
    alert("Änderungen konnten nicht gespeichert werden.");
    return;
  }
  editingReport = null;
  $("#adminEditDialog").close();
  await refreshAfterAdminChange(driver);
});

$("#closeAdminEdit").addEventListener("click", () => { editingReport = null; $("#adminEditDialog").close(); });
$("#deleteSingleReport").addEventListener("click", async () => {
  if (!editingReport || !confirm("Diesen Bericht unwiderruflich löschen?")) return;
  const { driver, id } = editingReport;
  try {
    await api(`/api/admin/reports/${encodeURIComponent(id)}`, { method: "DELETE", headers: adminHeaders() });
  } catch {
    alert("Bericht konnte nicht gelöscht werden.");
    return;
  }
  editingReport = null;
  $("#adminEditDialog").close();
  await refreshAfterAdminChange(driver);
});

$("#clearKeepBalance").addEventListener("click", async () => {
  const driver = $("#adminDriverSelect").value;
  const profile = db.profiles[driver];
  if (!profile || !confirm(`Alle Berichte von Fahrer Nr. ${driver} löschen, den aktuellen Saldo aber behalten?`)) return;
  try {
    await api(`/api/admin/profiles/${encodeURIComponent(driver)}/clear`, { method: "POST", headers: adminHeaders(), body: JSON.stringify({ keepBalance: true }) });
    await refreshAfterAdminChange(driver);
  } catch { alert("Berichte konnten nicht gelöscht werden."); }
});

$("#clearEverything").addEventListener("click", async () => {
  const driver = $("#adminDriverSelect").value;
  const profile = db.profiles[driver];
  if (!profile || !confirm(`Alle Berichte von Fahrer Nr. ${driver} löschen und den Saldo auf null setzen? Dies kann nicht rückgängig gemacht werden.`)) return;
  try {
    await api(`/api/admin/profiles/${encodeURIComponent(driver)}/clear`, { method: "POST", headers: adminHeaders(), body: JSON.stringify({ keepBalance: false }) });
    await refreshAfterAdminChange(driver);
  } catch { alert("Berichte konnten nicht gelöscht werden."); }
});

showApp();
