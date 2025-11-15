// ===== Google Apps Script endpoint (общий с Lehrlinge) =====
const GS_ENDPOINT =
  "https://script.google.com/macros/s/AKfycbxpGn11PT70usKYe0xE7S28FlwNIrJhXXEzaeK022VPZx7RObBEMvjq4ghpewnRyPGa/exec";
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

    await fetch(GS_ENDPOINT, {
      method: "POST",
      body: params, // БЕЗ headers → simple request, без CORS preflight
    });
  } catch (err) {
    console.error("QR payment → Sheet error", err);
  }
}

// ===== Основная логика страницы QR-Zahlung =====
(() => {
  // --- 1. DOM-элементы ---
  const elDriver = document.getElementById("driverNo");
  const elFare = document.getElementById("fare");
  const elTip = document.getElementById("tip");
  const elTotal = document.getElementById("totalEuro");
  const elVZ = document.getElementById("vzPreview");
  const tipBtns = document.querySelectorAll(".tipbtn");
  const sendWA = document.getElementById("sendWA");
  const copyBtn = document.getElementById("copySummary");
  const tipClear = document.getElementById("tipClear");
  const qrBox = document.getElementById("qr");
  const elRecent = document.getElementById("qrRecent");

  // Защита: если это не страница QR-Zahlung → выходим, чтобы не падать
  if (
    !elDriver ||
    !elFare ||
    !elTip ||
    !elTotal ||
    !elVZ ||
    !qrBox ||
    !sendWA ||
    !copyBtn
  ) {
    console.warn(
      "[QR] main.js: необходимые элементы не найдены — инициализация QR-Zahlung пропущена."
    );
    return;
  }

  // --- 2. Константы и LocalStorage ---
  const DEFAULT_WA = "436506367662"; // +43 650 6367662 без плюса

  const LS = {
    driver: "taxapp.driverNo",
    waBoss: "taxapp.whatsAppBoss",
  };

  if (!localStorage.getItem(LS.waBoss)) {
    localStorage.setItem(LS.waBoss, DEFAULT_WA);
  }

  // Восстановление номера водителя
  elDriver.value = localStorage.getItem(LS.driver) || "";

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

  // tip → строка в input с запятой
  const tipToInput = (tip) => String(two(tip)).replace(".", ",");

  // === авто-режим чаевых (+5% → итог вверх до целого) ===
  let autoTip = true; // пока пользователь не вмешался, считаем автоматически
  function computeDefault5UpTip(fare) {
    const targetTotal = Math.ceil(fare * 1.05); // +5%, затем итог до целого €
    return two(Math.max(0, targetTotal - fare));
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

  elFare.addEventListener("focus", selectAll);
  elTip.addEventListener("focus", selectAll);

  window.addEventListener("DOMContentLoaded", () => {
    if (document.activeElement !== elFare) {
      elFare.focus();
      elFare.select?.();
    }
  });

  // Enter в сумме → в «Чаевые»
  elFare.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      elTip.focus();
      elTip.select?.();
    }
  });

  // --- 5. Загрузка последних платежей ---
  async function fetchQrRecent(limit = 5) {
    if (!elRecent || !GS_ENDPOINT) return;

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

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      fetchQrRecent(5);
    }
  });

  window.addEventListener("focus", () => {
    fetchQrRecent(5);
  });

  // --- 6. VZ-превью + пересчёт ---
  function updateVzPreview(driverNo) {
    elVZ.textContent = `Taxi Murtal – Fahrer ${driverNo || "00"}`;
  }

  function recalc() {
    const fare = toNumber(elFare.value);
    const tip = toNumber(elTip.value);
    const total = two(fare + tip);

    elTotal.textContent = toMoney(total);
    updateVzPreview(elDriver.value);

    const epc = QrPay.buildEpcString(total, elDriver.value);
    QrPay.renderQR(qrBox, epc);

    sendWA.disabled = !(total > 0 && /^\d{1,2}$/.test(elDriver.value.trim()));
  }

  // --- 7. Логика tip-buttons ---
  function computeTipByKind(kind) {
    const fare = toNumber(elFare.value);

    const m = /^(\+)?(\d{1,2})%(?:up)?$/.exec(
      String(kind).toLowerCase().replace(/\s+/g, "")
    );
    if (m) {
      const p = Number(m[2]) / 100;
      const targetTotal = Math.ceil(fare * (1 + p));
      return two(Math.max(0, targetTotal - fare));
    }

    switch (kind) {
      case "0":
        return 0;
      case "round1": {
        const targetTotal = Math.ceil(fare);
        return two(Math.max(0, targetTotal - fare));
      }
      case "round1+1": {
        const targetTotal = Math.ceil(fare) + 1;
        return two(Math.max(0, targetTotal - fare));
      }
      case "round5": {
        const targetTotal = Math.ceil(fare / 5) * 5;
        return two(Math.max(0, targetTotal - fare));
      }
      case "10%up": {
        const targetTotal = Math.ceil(fare * 1.1);
        return two(Math.max(0, targetTotal - fare));
      }
      case "15%up": {
        const targetTotal = Math.ceil(fare * 1.15);
        return two(Math.max(0, targetTotal - fare));
      }
      default:
        if (/^\d+(\.\d+)?$/.test(kind)) return two(parseFloat(kind));
        return toNumber(elTip.value) || 0;
    }
  }

  tipBtns.forEach((btn) => {
    if (btn === tipClear) return;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      autoTip = false;
      const kind = getTipKindFromBtn(e.currentTarget);
      const tip = computeTipByKind(kind);
      elTip.value = tipToInput(tip);
      recalc();
    });
  });

  tipClear?.addEventListener(
    "click",
    () => {
      autoTip = false;
      elTip.value = "0";
      recalc();
    },
    { passive: true }
  );

  elTip.addEventListener("input", () => {
    autoTip = false;
  });

  // --- 8. Сохранение номера водителя ---
  elDriver.addEventListener("input", () => {
    const clean = elDriver.value.replace(/\D/g, "").slice(0, 2);
    elDriver.value = clean;
    localStorage.setItem(LS.driver, clean);
    recalc();
  });

  // --- 9. Пересчёт при изменении сумм ---
  ["input", "change"].forEach((evt) => {
    elFare.addEventListener(evt, () => {
      const fare = toNumber(elFare.value);
      if (autoTip) {
        const tip = computeDefault5UpTip(fare);
        elTip.value = tipToInput(tip);
      }
      recalc();
    });

    elTip.addEventListener(evt, recalc);
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

  // --- 11. Копирование сводки ---
  copyBtn.addEventListener("click", async () => {
    const fare = toNumber(elFare.value);
    const tip = toNumber(elTip.value);
    const total = two(fare + tip);

    const now = new Date();
    const date = now.toLocaleDateString("de-AT");
    const time = now.toLocaleTimeString("de-AT", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const txt = [
      "MurtalTaxi – QR-Zahlung",
      `Fahrer: ${elDriver.value || "00"}`,
      `Datum/Zeit: ${date} ${time}`,
      `Betrag (Taxameter): ${toMoney(fare)}`,
      `Trinkgeld: ${toMoney(tip)}`,
      `Gesamt: ${toMoney(total)}`,
      `Methode: QR (SEPA)`,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(txt);
      showToast("Zusammenfassung kopiert");
    } catch {
      showToast("Kopieren fehlgeschlagen");
    }
  });

  // --- 12. Отправка в WhatsApp + запись в таблицу ---
  const getBossWa = () => localStorage.getItem(LS.waBoss) || DEFAULT_WA;

  sendWA.addEventListener("click", async () => {
    const fare = toNumber(elFare.value);
    const tip = toNumber(elTip.value);
    const total = two(fare + tip);

    const now = new Date();
    const date = now.toLocaleDateString("de-AT");
    const time = now.toLocaleTimeString("de-AT", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const msg = [
      "MurtalTaxi – QR-Zahlung",
      `Fahrer: ${elDriver.value || "00"}`,
      `Datum/Zeit: ${date} ${time}`,
      `Betrag (Taxameter): ${toMoney(fare)}`,
      `Trinkgeld: ${toMoney(tip)}`,
      `Gesamt: ${toMoney(total)}`,
      `Methode: QR (SEPA)`,
    ].join("\n");

    const url = `https://wa.me/${getBossWa()}?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank", "noopener");

    const entry = {
      ts: new Date().toISOString(),
      driver: elDriver.value || "00",
      fare: two(fare),
      tip: two(tip),
      total: two(total),
      method: "QR",
      iban: "AT932081500043192756",
    };

    await sendToSheet(entry);
    await new Promise((resolve) => setTimeout(resolve, 400));
    fetchQrRecent(10);
  });

  // --- 13. Стартовое состояние ---
  if (!elDriver.value) elDriver.value = "00";
  elFare.value = elFare.value || "0,00";

  autoTip = true;
  {
    const fare0 = toNumber(elFare.value);
    elTip.value = tipToInput(computeDefault5UpTip(fare0));
  }

  recalc();
  window.addEventListener("load", recalc);
  fetchQrRecent(5);
})();

// ===== Вспомогательная функция для tip-buttons (глобальная) =====
function getTipKindFromBtn(el) {
  return (el.dataset.tip || el.textContent || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}
