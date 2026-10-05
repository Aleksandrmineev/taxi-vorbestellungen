// ===== Google Apps Script endpoint (общий с Lehrlinge) =====
const GS_ENDPOINT =
  "https://script.google.com/macros/s/AKfycbwS88JTgj1NVqhGAaMKi3MXxTawF9zA6mkG6avgxmIj8c61_20EjNZdY0_0U6kKor29/exec";
const API_SECRET_QR = "102030";

// Тихая отправка записи в Google Sheets (лист QR_Zahlungen)
async function sendToSheet(entry) {
  try {
    const params = new URLSearchParams();
    params.set("action", "qr_payment");
    params.set("secret", API_SECRET_QR);

    params.set("ts", entry.ts);
    params.set("driver", entry.driver || "");
    params.set("fare", String(entry.fare ?? ""));
    params.set("tip", String(entry.tip ?? ""));
    params.set("total", String(entry.total ?? ""));
    params.set("method", entry.method || "QR");
    params.set("iban", entry.iban || "");

    const res = await fetch(GS_ENDPOINT, {
      method: "POST",
      body: params, // БЕЗ headers → simple request, без CORS preflight
    });
    const data = await res.json().catch(() => null);
    return Boolean(res.ok && data && data.ok);
  } catch (err) {
    console.error("QR payment → Sheet error", err);
    return false;
  }
}

// Taxi-Nr. des angemeldeten Fahrers (Login auf der Startseite), sonst "".
function loggedInDriverNo() {
  try {
    const session = JSON.parse(localStorage.getItem("mt:driver-session") || "null");
    if (!session?.token || !(Number(session.expiresAt) > Date.now())) return "";
    const digits = String(session.driver?.taxiNumber || "").replace(/\D/g, "").slice(-2);
    return digits ? digits.padStart(2, "0") : "";
  } catch (_) {
    return "";
  }
}

// ===== Основная логика страницы QR-Zahlung =====
(() => {
  // --- 1. DOM-элементы ---
  const elDriver = document.getElementById("driverNo");
  const elFare = document.getElementById("fare");
  const elPay = document.getElementById("payTotal"); // Gesamtbetrag inkl. Trinkgeld
  const elTipInfo = document.getElementById("tipInfo");
  const confirmBtn = document.getElementById("confirmPay");
  const ibanBtn = document.getElementById("ibanBtn");
  const bankDialog = document.getElementById("bankDialog");
  const qrBox = document.getElementById("qr");
  const elRecent = document.getElementById("qrRecent");
  const recentBox = document.getElementById("qrRecentBox"); // Akkordeon: lädt erst beim Aufklappen

  // Защита: если это не страница QR-Zahlung → выходим, чтобы не падать
  if (
    !elDriver ||
    !elFare ||
    !elPay ||
    !elTipInfo ||
    !qrBox ||
    !confirmBtn
  ) {
    console.warn(
      "[QR] main.js: необходимые элементы не найдены — инициализация QR-Zahlung пропущена."
    );
    return;
  }

  // --- 2. Константы и LocalStorage ---
  const LS = {
    driver: "taxapp.driverNo",
  };

  // Angemeldet: Fahrer-Nr. kommt aus dem Login, das Feld entfällt. Sonst (Gast) wie bisher eintippen.
  const sessionDriver = loggedInDriverNo();
  if (sessionDriver) {
    elDriver.value = sessionDriver;
    document.getElementById("driverField")?.setAttribute("hidden", "");
  } else {
    elDriver.value = localStorage.getItem(LS.driver) || "";
  }

  // --- 3. Helpers: parse/format/round ---
  const nfEUR = new Intl.NumberFormat("de-AT", {
    style: "currency",
    currency: "EUR",
  });

  const toNumber = (v) => {
    if (typeof v !== "string") v = String(v ?? "");
    v = v.replace(/\s/g, "").replace(",", ".");
    const n = parseFloat(v);
    return isFinite(n) ? n : 0;
  };

  const toMoney = (n) => nfEUR.format(n);
  const two = (n) => Math.round(n * 100) / 100;

  // Betrag → Eingabefeld mit Komma
  const toInput = (n) => String(two(n)).replace(".", ",");

  let saving = false; // Bestätigung läuft
  let savedKey = ""; // zuletzt bestätigte Fahrer|Summe
  // Jede Betrag-Eingabe setzt Gesamt neu: +5 %, auf ganze € aufgerundet. Danach darf der Fahrer Gesamt ändern.
  const defaultTotal = (fare) => (fare > 0 ? Math.ceil(fare * 1.05) : 0);

  // Zahlbetrag = Gesamt, aber nie unter dem Taxameter-Betrag; Trinkgeld = Differenz.
  function amounts() {
    const fare = two(toNumber(elFare.value));
    const entered = two(toNumber(elPay.value));
    const total = Math.max(fare, entered);
    return { fare, total, tip: two(total - fare), tooLow: entered < fare };
  }

  // --- 4. UX фокус/выделение сумм ---
  function selectAll(e) {
    const el = e.target;
    requestAnimationFrame(() => {
      el.select?.();
      setTimeout(() => {
        try {
          el.setSelectionRange(0, el.value.length);
        } catch {}
      }, 0);
    });
  }

  elDriver.addEventListener("focus", selectAll);
  elFare.addEventListener("focus", selectAll);
  elPay.addEventListener("focus", selectAll);

  // На мобильных устройствах повторный focus внутри пользовательского
  // касания помогает открыть клавиатуру, если autofocus только поставил курсор.
  elFare.addEventListener("pointerdown", () => {
    elFare.focus({ preventScroll: true });
    elFare.select?.();
  });

  // Enter в сумме → в «Чаевые»
  elFare.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      elPay.focus();
      elPay.select?.();
    }
  });

  // --- 5. Загрузка последних платежей ---
  async function fetchQrRecent(limit = 5) {
    if (!elRecent || !GS_ENDPOINT) return;
    if (recentBox && !recentBox.open) return;

    elRecent.innerHTML =
      '<div class="qr-recent__loading">Daten werden geladen …</div>';

    try {
      const url = `${GS_ENDPOINT}?fn=qr_recent&limit=${encodeURIComponent(
        limit
      )}&secret=${encodeURIComponent(API_SECRET_QR)}`;

      const res = await fetch(url);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const items = data.items || [];
      renderQrRecent(items);
    } catch (err) {
      console.error("qr_recent error", err);
      elRecent.innerHTML =
        '<div class="qr-recent__loading qr-recent__loading--error">Fehler beim Laden der Daten.</div>';
    }
  }

  function renderQrRecent(items) {
    if (!elRecent) return;
    if (!items.length) {
      elRecent.textContent = "Noch keine Daten.";
      return;
    }

    const nf = new Intl.NumberFormat("de-AT", {
      style: "currency",
      currency: "EUR",
    });

    const rows = items.map((it) => {
      const dt =
        it.timestamp instanceof Date ? it.timestamp : new Date(it.timestamp);

      const date = dt.toLocaleDateString("de-AT", {
        day: "2-digit",
        month: "2-digit",
      });
      const time = dt.toLocaleTimeString("de-AT", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const dtLabel = `${date} ${time}`;

      const fareVal = Number(it.fare || 0);
      const tipVal = Number(it.tip || 0);
      const totalVal = fareVal + tipVal;

      const totalFormatted = nf.format(totalVal);
      const parts =
        `(${fareVal.toFixed(2).replace(".", ",")} + ` +
        `${tipVal.toFixed(2).replace(".", ",")})`;

      const driver = it.driver || "00";

      return `
        <div class="qr-recent__item">
          <div class="qr-recent__line">
            <span class="qr-recent__datetime">${dtLabel}</span>
            <span class="qr-recent__driver">№ ${driver}</span>
            <span class="qr-recent__amount">
              ${totalFormatted}
              <span class="qr-recent__parts">${parts}</span>
            </span>
          </div>
        </div>
      `;
    });

    elRecent.innerHTML = rows.join("");
  }

  recentBox?.addEventListener("toggle", () => {
    if (recentBox.open) fetchQrRecent(5);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      fetchQrRecent(5);
    }
  });

  window.addEventListener("focus", () => {
    fetchQrRecent(5);
  });

  // --- 6. Пересчёт ---

  function recalc() {
    const { fare, total, tip, tooLow } = amounts();

    elTipInfo.textContent = tooLow
      ? `Gesamt ist kleiner als der Betrag – es gilt ${toMoney(fare)}`
      : `davon Trinkgeld: ${toMoney(tip)}`;
    elTipInfo.classList.toggle("is-warn", tooLow);

    const epc = QrPay.buildEpcString(total, elDriver.value);
    QrPay.renderQR(qrBox, epc);

    // nach dem Bestätigen gesperrt, bis sich der Betrag ändert (kein doppelter Eintrag)
    const key = `${elDriver.value}|${total}`;
    confirmBtn.disabled = saving || key === savedKey || !(total > 0 && /^\d{1,2}$/.test(elDriver.value.trim()));
    if (bankDialog?.open) fillBankDialog();
  }

  // --- 8. Сохранение номера водителя ---
  elDriver.addEventListener("input", () => {
    const clean = elDriver.value.replace(/\D/g, "").slice(0, 2);
    elDriver.value = clean;
    localStorage.setItem(LS.driver, clean);
    recalc();
  });

  // --- 9. Пересчёт при изменении сумм ---
  // neue Eingabe = neue Fahrt: Bestätigen wieder erlauben, auch bei gleichem Betrag
  [elFare, elPay].forEach((el) => el.addEventListener("input", () => { savedKey = ""; }));

  ["input", "change"].forEach((evt) => {
    elFare.addEventListener(evt, () => {
      elPay.value = toInput(defaultTotal(toNumber(elFare.value)));
      recalc();
    });

    elPay.addEventListener(evt, recalc);
  });

  // --- 10. Мини-тост ---
  const toast = document.createElement("div");
  toast.className = "toast";
  document.body.appendChild(toast);

  function showToast(text) {
    toast.textContent = text;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2000);
  }

  // --- 12. Zahlung bestätigen: nur in die Tabelle, Anzeige unter „Letzte Zahlungen“ ---
  confirmBtn.addEventListener("click", async () => {
    const { fare, total, tip } = amounts();
    const key = `${elDriver.value}|${total}`;

    saving = true;
    recalc();
    const ok = await sendToSheet({
      ts: new Date().toISOString(),
      driver: elDriver.value || "00",
      fare,
      tip,
      total,
      method: "QR",
      iban: QrPay.RECEIVER.iban,
    });
    saving = false;
    if (ok) savedKey = key;
    recalc();
    showToast(ok ? `Zahlung ${toMoney(total)} gespeichert` : "Speichern fehlgeschlagen – bitte nochmal");
    if (ok) fetchQrRecent(10);
  });

  // --- 12b. IBAN-Popup mit allen Überweisungsdaten ---
  const ibanGrouped = (iban) => iban.replace(/(.{4})/g, "$1 ").trim();
  function bankValues() {
    const { total } = amounts();
    return {
      name: QrPay.RECEIVER.name,
      iban: QrPay.RECEIVER.iban,
      bic: QrPay.RECEIVER.bic,
      amount: total.toFixed(2).replace(".", ","),
      vz: `Taxi Murtal - Fahrer ${elDriver.value || "00"}`,
    };
  }
  function fillBankDialog() {
    const v = bankValues();
    const shown = { ...v, iban: ibanGrouped(v.iban), amount: `€ ${v.amount}` };
    bankDialog.querySelectorAll("[data-field]").forEach((el) => {
      el.textContent = shown[el.dataset.field] ?? "";
    });
  }
  // Anleitung-Popup: wo man in der Bank-App scannt
  const scanDialog = document.getElementById("scanDialog");
  document.getElementById("scanHelpBtn")?.addEventListener("click", () => scanDialog?.showModal());
  scanDialog?.addEventListener("click", (e) => {
    if (e.target === scanDialog || e.target.closest("[data-close]")) scanDialog.close();
  });

  if (ibanBtn && bankDialog) {
    ibanBtn.addEventListener("click", () => {
      fillBankDialog();
      bankDialog.showModal();
    });
    bankDialog.addEventListener("click", async (e) => {
      if (e.target === bankDialog || e.target.closest("[data-close]")) {
        bankDialog.close();
        return;
      }
      const btn = e.target.closest("[data-copy]");
      if (!btn) return;
      try {
        await navigator.clipboard.writeText(bankValues()[btn.dataset.copy] || "");
        showToast("Kopiert");
      } catch {
        showToast("Kopieren fehlgeschlagen");
      }
    });
  }

  // --- 13. Стартовое состояние ---
  if (!elDriver.value) elDriver.value = "00";
  elFare.value = elFare.value || "0,00";

  elPay.value = toInput(defaultTotal(toNumber(elFare.value)));

  recalc();
  window.addEventListener("load", recalc);
  fetchQrRecent(5);
})();

