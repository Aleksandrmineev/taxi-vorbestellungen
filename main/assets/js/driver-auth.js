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
  const showReset = document.getElementById("showResetButton");
  const back = document.getElementById("driverAuthBack");
  const skip = document.getElementById("skipDriverAuthButton");
  const resetForm = document.getElementById("driverPinResetForm");
  const resetBack = document.getElementById("resetAuthBack");
  const resetButton = document.getElementById("resetPinButton");
  const resetError = document.getElementById("resetError");
  const resetHint = document.getElementById("resetHint");
  const resetTaxi = document.getElementById("resetTaxiNumber");
  const resetCode = document.getElementById("resetCode");
  const resetPin = document.getElementById("resetPin");
  const resetCodeField = document.getElementById("resetCodeField");
  const resetPinField = document.getElementById("resetPinField");
  const resetTaxiField = document.getElementById("resetTaxiField");
  const driverPhoneField = document.getElementById("driverPhoneField");
  const driverPhone = document.getElementById("driverPhone");
  let mode = "login";
  let popupTimer;

  const popup = document.createElement("div");
  popup.className = "driver-auth-popup";
  popup.setAttribute("role", "status");
  popup.setAttribute("aria-live", "polite");
  document.body.appendChild(popup);

  function showPopup(text, type) {
    clearTimeout(popupTimer);
    popup.textContent = text;
    popup.className = `driver-auth-popup is-visible is-${type}`;
    popupTimer = setTimeout(() => { popup.className = "driver-auth-popup"; }, 3200);
  }

  function readSession() {
    try {
      const value = JSON.parse(localStorage.getItem(TOKEN_KEY) || "null");
      if (!value?.token) return null;
      if (!Number(value.expiresAt)) {
        value.expiresAt = Date.now() + 365 * 24 * 60 * 60 * 1000;
        localStorage.setItem(TOKEN_KEY, JSON.stringify(value));
      }
      return value.expiresAt > Date.now() ? value : null;
    } catch (_) { return null; }
  }

  function setLoggedIn(session) {
    const driver = session.driver || {};
    const hour = new Date().getHours();
    const greeting = hour < 5 ? "Guten Abend" : hour < 12 ? "Guten Morgen" : hour < 18 ? "Guten Tag" : "Guten Abend";
    const driverName = [driver.name, driver.surname].filter(Boolean).join(" ") || "Fahrer";
    document.body.classList.remove("driver-auth-locked");
    const expiresInSec = Number(session.expiresInSec);
    const sessionTtl = Number.isFinite(expiresInSec) && expiresInSec > 0 ? expiresInSec : 365 * 24 * 60 * 60;
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: session.token, expiresAt: Date.now() + sessionTtl * 1000, driver }));
    localStorage.setItem(AUTH_KEY, "1");
    if (driver.id) localStorage.setItem("mt:lastDriver", driver.id);
    if (driver.taxiNumber) localStorage.setItem("taxi-current-driver", driver.taxiNumber);
    driverAuth.classList.add("is-authenticated");
    message.textContent = `Willkommen, ${[driver.name, driver.surname].filter(Boolean).join(" ") || "Fahrer"} · Taxi ${driver.taxiNumber || ""}`;
    mainTitle.textContent = `${greeting}, ${driverName}!`;
    mainSubtitle.textContent = "Deine zentrale Startseite";
    logoutButton.hidden = false;
    form.hidden = true;
    resetForm.hidden = true;
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
    driverPhoneField.hidden = mode !== "register";
    nameInput.required = mode === "register";
    surnameInput.required = mode === "register";
    driverPhone.required = mode === "register";
    button.textContent = mode === "register" ? "Registrieren" : "Anmelden";
    taxiInput.value = localStorage.getItem(LAST_TAXI_KEY) || taxiInput.value;
    pinInput.autocomplete = mode === "register" ? "new-password" : "current-password";
    message.textContent = mode === "register" ? "Taxi-Nr., Name, Telefon und PIN eingeben. Bereits registrierte Fahrer werden nicht doppelt angelegt." : "Taxi-Nr. und PIN eingeben.";
    error.hidden = true;
    taxiInput.focus();
  }

  function closeForm() {
    form.hidden = true;
    resetForm.hidden = true;
    actions.hidden = false;
    error.hidden = true;
    message.textContent = "Bitte anmelden oder als neuer Fahrer registrieren.";
  }

  function openResetForm() {
    actions.hidden = true;
    form.hidden = true;
    resetForm.hidden = false;
    resetTaxi.value = localStorage.getItem(LAST_TAXI_KEY) || "";
    resetCode.value = "";
    resetPin.value = "";
    resetCode.disabled = true;
    resetPin.disabled = true;
    resetCodeField.hidden = true;
    resetPinField.hidden = true;
    resetTaxiField.hidden = false;
    resetButton.textContent = "SMS-Code anfordern";
    resetHint.textContent = "Zuerst SMS-Code anfordern. Danach Code und neuen PIN eingeben.";
    resetError.hidden = true;
    message.textContent = "PIN per SMS zurücksetzen";
    resetTaxi.focus();
  }

  function continueWithoutLogin() {
    sessionStorage.setItem(GUEST_KEY, "1");
    localStorage.removeItem(GUEST_KEY);
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
    sessionStorage.removeItem(GUEST_KEY);
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem("mt:lastDriver");
    localStorage.removeItem("taxi-current-driver");
    window.location.reload();
  }

  function hasGuestAccess() {
    return sessionStorage.getItem(GUEST_KEY) === "1";
  }

  function hasAppAccess() {
    // Guest access is intentionally temporary and must never unlock the app on a new load.
    return Boolean(readSession());
  }

  function lockApp() {
    appGrid.hidden = true;
    mainHeader.hidden = true;
    mainTitle.hidden = true;
    mainSubtitle.hidden = true;
    mainFooter.hidden = true;
    logoutButton.hidden = true;
    driverAuth.hidden = false;
    document.body.classList.add("driver-auth-locked");
  }

  function syncAccess() {
    const session = readSession();
    if (session) setLoggedIn(session);
    else if (hasGuestAccess()) continueWithoutLogin();
    else lockApp();
  }

  syncAccess();
  window.addEventListener("pageshow", syncAccess);

  showLogin.addEventListener("click", () => openForm("login"));
  showRegister.addEventListener("click", () => openForm("register"));
  showReset.addEventListener("click", openResetForm);
  back.addEventListener("click", closeForm);
  resetBack.addEventListener("click", closeForm);
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
        body: JSON.stringify({ action: mode === "register" ? "driver_register" : "driver_login", secret: API_SECRET, taxiNumber: taxiInput.value.trim(), name: nameInput.value.trim(), surname: surnameInput.value.trim(), phone: driverPhone.value.trim(), pin: pinInput.value }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false || !data.token) throw new Error(data.error || "invalid_credentials");
      setLoggedIn(data);
    } catch (err) {
      const errorCode = String(err.message || "").replace(/^Error:\s*/i, "");
      const errors = {
        invalid_registration: "Bitte Taxi-Nr., Vorname, Nachname, Telefonnummer und PIN mit genau 4 Ziffern prüfen.",
        invalid_reset_data: "Bitte Taxi-Nr., Telefonnummer und PIN prüfen.",
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

  resetForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!resetForm.reportValidity()) return;
    resetError.hidden = true;
    resetButton.disabled = true;
    resetButton.classList.add("is-loading");
    try {
      const action = resetCode.disabled ? "driver_pin_request" : "driver_pin_reset";
      const payload = { action, secret: API_SECRET, taxiNumber: resetTaxi.value.trim() };
      if (!resetCode.disabled) payload.code = resetCode.value.trim();
      if (!resetPin.disabled) payload.pin = resetPin.value;
      const response = await fetch(GAS_PROXY, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || "reset_failed");
      if (action === "driver_pin_request") {
        resetCode.disabled = false;
        resetPin.disabled = false;
        resetCodeField.hidden = false;
        resetPinField.hidden = false;
        resetTaxiField.hidden = true;
        resetButton.textContent = "PIN ersetzen";
        resetHint.textContent = "SMS-Code eingeben und neuen PIN festlegen.";
        showPopup(`SMS-Code wurde an ${data.maskedPhone || "die hinterlegte Nummer"} gesendet.`, "success");
        resetCode.focus();
      } else {
        setLoggedIn(data);
        showPopup("PIN wurde erfolgreich ersetzt.", "success");
      }
    } catch (err) {
      const errors = {
        invalid_reset_data: "Bitte Taxi-Nr., Telefonnummer und PIN prüfen.",
        phone_not_registered: "Diese Telefonnummer ist für die Taxi-Nr. nicht hinterlegt.",
        sms_not_configured: "SMS-Versand ist noch nicht eingerichtet. Bitte Support kontaktieren.",
        invalid_reset_code: "Der SMS-Code ist nicht korrekt.",
        reset_code_expired: "Der SMS-Code ist abgelaufen. Bitte einen neuen Code anfordern.",
        reset_code_locked: "Zu viele falsche Versuche. Bitte einen neuen Code anfordern.",
      };
      const errorCode = String(err.message || "").replace(/^Error:\s*/i, "");
      const message = errors[errorCode] || `Wiederherstellung nicht möglich: ${errorCode}`;
      resetError.textContent = message;
      resetError.hidden = true;
      showPopup(message, "error");
    } finally {
      resetButton.disabled = false;
      resetButton.classList.remove("is-loading");
    }
  });
})();
