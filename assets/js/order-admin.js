import { Api } from "./api.js";

const $ = (id) => document.getElementById(id);
const tokenKey = "vorbestellungen_admin_token";
const showSettings = async () => {
  try {
    const res = await Api.orderAdminSettings();
    $("dayPhone1").value = res.settings?.dayPhone1 || res.settings?.dayPhone || "";
    $("dayPhone2").value = res.settings?.dayPhone2 || "";
    $("nightPhone1").value = res.settings?.nightPhone1 || res.settings?.nightPhone || "";
    $("nightPhone2").value = res.settings?.nightPhone2 || "";
    $("loginView").hidden = true;
    $("settingsView").hidden = false;
  } catch (err) {
    sessionStorage.removeItem(tokenKey);
    $("loginError").textContent = String(err.message || err);
  }
};

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("loginError").textContent = "";
  try { await Api.adminLogin($("adminPassword").value); await showSettings(); }
  catch (err) { $("loginError").textContent = String(err.message || err); }
});

$("settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("settingsStatus").textContent = "Speichern…";
  try {
    await Api.saveOrderAdminSettings({ dayPhone1: $("dayPhone1").value, dayPhone2: $("dayPhone2").value, nightPhone1: $("nightPhone1").value, nightPhone2: $("nightPhone2").value });
    $("settingsStatus").textContent = "Gespeichert.";
  } catch (err) { $("settingsStatus").textContent = String(err.message || err); }
});

$("logoutBtn").addEventListener("click", () => { sessionStorage.removeItem(tokenKey); location.reload(); });
if (sessionStorage.getItem(tokenKey)) showSettings();
