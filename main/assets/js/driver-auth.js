(function () {
  const form = document.getElementById("driverLoginForm");
  if (!form) return;
  const GAS_PROXY = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "https://taxi-vorbestellungen.vercel.app/api/gas"
    : "/api/gas";
  const API_SECRET = "102030";
  const TOKEN_KEY = "mt:driver-session";
  const GUEST_KEY = "mt:driver-auth-skipped";
  const AUTH_KEY = "mt:driver-authenticated";
  const LAST_TAXI_KEY = "mt:last-driver-taxi";
  const driverAuth = document.getElementById("driverAuth");
  const message = document.getElementById("driverAuthMessage");
  const error = document.getElementById("driverLoginError");
  const button = document.getElementById("driverLoginButton");
  const taxiInput = document.getElementById("driverTaxiNumber");
  const pinInput = document.getElementById("driverPin");
  const nameInput = document.getElementById("driverName");
  const surnameInput = document.getElementById("driverSurname");
  const nameField = document.getElementById("driverNameField");
  const surnameField = document.getElementById("driverSurnameField");
  const actions = document.getElementById("driverAuthActions");
  const appGrid = document.getElementById("appGrid");
  const mainHeader = document.getElementById("mainHeader");
  const mainTitle = document.getElementById("mainTitle");
  const mainSubtitle = document.getElementById("mainSubtitle");
  const mainFooter = document.getElementById("mainFooter");
  const logoutButton = document.getElementById("driverLogoutButton");
  const showLogin = document.getElementById("showLoginButton");
  const showRegister = document.getElementById("showRegisterButton");
  const back = document.getElementById("driverAuthBack");
  const skip = document.getElementById("skipDriverAuthButton");
  let mode = "login";

  function readSession() {
    try {
      const value = JSON.parse(localStorage.getItem(TOKEN_KEY) || "null");
      return value && value.expiresAt > Date.now() ? value : null;
    } catch (_) { return null; }
  }

  function setLoggedIn(session) {
    const driver = session.driver || {};
    const hour = new Date().getHours();
    const greeting = hour < 5 ? "Guten Abend" : hour < 12 ? "Guten Morgen" : hour < 18 ? "Guten Tag" : "Guten Abend";
    const driverName = [driver.name, driver.surname].filter(Boolean).join(" ") || "Fahrer";
    document.body.classList.remove("driver-auth-locked");
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: session.token, expiresAt: Date.now() + Number(session.expiresInSec || 0) * 1000, driver }));
    localStorage.setItem(AUTH_KEY, "1");
    if (driver.id) localStorage.setItem("mt:lastDriver", driver.id);
    if (driver.taxiNumber) localStorage.setItem("taxi-current-driver", driver.taxiNumber);
    driverAuth.classList.add("is-authenticated");
    message.textContent = `Willkommen, ${[driver.name, driver.surname].filter(Boolean).join(" ") || "Fahrer"} · Taxi ${driver.taxiNumber || ""}`;
    mainTitle.textContent = `${greeting}, ${driverName}!`;
    mainSubtitle.textContent = "Deine zentrale Startseite";
    logoutButton.hidden = false;
    form.hidden = true;
    actions.hidden = true;
    driverAuth.hidden = true;
    appGrid.hidden = false;
    mainHeader.hidden = false;
    mainTitle.hidden = false;
    mainSubtitle.hidden = true;
    mainFooter.hidden = false;
    error.hidden = true;
  }

  function openForm(nextMode) {
    mode = nextMode;
    actions.hidden = true;
    form.hidden = false;
    nameField.hidden = mode !== "register";
    surnameField.hidden = mode !== "register";
    nameInput.required = mode === "register";
    surnameInput.required = mode === "register";
    button.textContent = mode === "register" ? "Registrieren" : "Anmelden";
    taxiInput.value = localStorage.getItem(LAST_TAXI_KEY) || taxiInput.value;
    pinInput.autocomplete = mode === "register" ? "new-password" : "current-password";
    message.textContent = mode === "register" ? "Taxi-Nr., Name und PIN eingeben. Bereits registrierte Fahrer werden nicht doppelt angelegt." : "Taxi-Nr. und PIN eingeben.";
    error.hidden = true;
    taxiInput.focus();
  }

  function closeForm() {
    form.hidden = true;
    actions.hidden = false;
    error.hidden = true;
    message.textContent = "Bitte anmelden oder als neuer Fahrer registrieren.";
  }

  function continueWithoutLogin() {
    localStorage.setItem(GUEST_KEY, "1");
    document.body.classList.remove("driver-auth-locked");
    driverAuth.hidden = true;
    appGrid.hidden = false;
    mainHeader.hidden = false;
    mainTitle.hidden = false;
    mainSubtitle.hidden = false;
    mainFooter.hidden = false;
    logoutButton.hidden = false;
    logoutButton.querySelector("span").textContent = "Anmelden";
    logoutButton.setAttribute("aria-label", "Anmelden");
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(GUEST_KEY);
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem("mt:lastDriver");
    localStorage.removeItem("taxi-current-driver");
    window.location.reload();
  }

  function hasGuestAccess() {
    if (localStorage.getItem(GUEST_KEY) === "1") return true;
    // Совместимость со старой версией, где пропуск хранился только в вкладке.
    if (sessionStorage.getItem(GUEST_KEY) === "1") {
      localStorage.setItem(GUEST_KEY, "1");
      return true;
    }
    return false;
  }

  function hasAppAccess() {
    return readSession() || localStorage.getItem(AUTH_KEY) === "1" || hasGuestAccess();
  }

  const existing = readSession();
  if (existing) setLoggedIn(existing);
  else if (hasAppAccess()) continueWithoutLogin();
  else {
    appGrid.hidden = true;
    mainHeader.hidden = true;
    mainTitle.hidden = true;
    mainSubtitle.hidden = true;
    mainFooter.hidden = true;
    logoutButton.hidden = true;
    driverAuth.hidden = false;
    document.body.classList.add("driver-auth-locked");
  }

  showLogin.addEventListener("click", () => openForm("login"));
  showRegister.addEventListener("click", () => openForm("register"));
  back.addEventListener("click", closeForm);
  skip.addEventListener("click", continueWithoutLogin);
  logoutButton.addEventListener("click", logout);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    error.hidden = true;
    localStorage.setItem(LAST_TAXI_KEY, taxiInput.value.trim());
    button.disabled = true;
    button.textContent = mode === "register" ? "Registrierung …" : "Anmeldung …";
    try {
      const response = await fetch(GAS_PROXY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: mode === "register" ? "driver_register" : "driver_login", secret: API_SECRET, taxiNumber: taxiInput.value.trim(), name: nameInput.value.trim(), surname: surnameInput.value.trim(), pin: pinInput.value }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false || !data.token) throw new Error(data.error || "invalid_credentials");
      setLoggedIn(data);
    } catch (err) {
      const errorCode = String(err.message || "").replace(/^Error:\s*/i, "");
      const errors = {
        invalid_registration: "Bitte Taxi-Nr. (2–3 Ziffern), Vorname, Nachname und eine PIN mit genau 4 Ziffern prüfen.",
        driver_already_registered: "Diese Taxi-Nr. ist bereits registriert. Bitte anmelden.",
        driver_inactive: "Diese Taxi-Nr. ist derzeit deaktiviert. Bitte Support kontaktieren.",
        drivers_schema_not_ready: "Die Fahrer-Tabelle ist noch nicht für die Registrierung vorbereitet. Bitte Support kontaktieren.",
      };
      error.textContent = mode === "register"
        ? (errors[errorCode] || `Registrierung nicht möglich: ${errorCode || "unbekannter Fehler"}.`)
        : "Anmeldung fehlgeschlagen. Taxi-Nr. und PIN prüfen.";
      error.hidden = false;
      button.disabled = false;
      button.textContent = mode === "register" ? "Registrieren" : "Anmelden";
    }
  });
})();
