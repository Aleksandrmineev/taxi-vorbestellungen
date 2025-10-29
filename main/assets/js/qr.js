(() => {
  // Константы получателя (из вашего QR)
  const RECEIVER = {
    name: "Michael Kleißner",
    iban: "AT622081500040934572",
    bic: "STSPAT2GXXX",
  };
  const DEFAULT_WA = "436506367662"; // +43 650 6367662 без плюса

  // DOM
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

  // Доп. кнопки/элементы отчёта
  const btnReport24h = document.getElementById("report24h");
  const btnClearLog = document.getElementById("clearLog");

  // LocalStorage ключи
  const LS = {
    driver: "taxapp.driverNo",
    waBoss: "taxapp.whatsAppBoss",
    log: "taxapp.shiftLog",
  };

  // Инициализация WA получателя по умолчанию
  if (!localStorage.getItem(LS.waBoss)) {
    localStorage.setItem(LS.waBoss, DEFAULT_WA);
  }

  // Восстановление номера водителя
  elDriver.value = localStorage.getItem(LS.driver) || "";

  // Утилиты чисел (принимаем запятую/точку)
  const toNumber = (v) => {
    if (typeof v !== "string") v = String(v ?? "");
    v = v.replace(/\s/g, "").replace(",", ".");
    const n = parseFloat(v);
    return isFinite(n) ? n : 0;
  };
  const toMoney = (n) =>
    new Intl.NumberFormat("de-AT", {
      style: "currency",
      currency: "EUR",
    }).format(n);
  const two = (n) => Math.round(n * 100) / 100;

  // --- авто-выделение суммы/чаевых при фокусе + автофокус на сумме ---
  function selectAll(e) {
    // двойной вызов нужен для iOS/Safari
    const el = e.target;
    requestAnimationFrame(() => {
      el.select?.();
      // безопасно на десктопе/андроиде; на iOS без setTimeout selection может не сработать
      setTimeout(() => {
        try {
          el.setSelectionRange(0, el.value.length);
        } catch {}
      }, 0);
    });
  }
  elFare.addEventListener("focus", selectAll);
  elTip.addEventListener("focus", selectAll);

  // При загрузке: поставить фокус на сумму (если пользователь ещё не редактировал)
  window.addEventListener("DOMContentLoaded", () => {
    // если элемент существует и не заблокирован — фокусируем
    if (document.activeElement !== elFare) {
      elFare.focus();
      elFare.select?.();
    }
  });

  // удобство: Enter в сумме перенесёт фокус в «Чаевые»
  elFare.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      elTip.focus();
      elTip.select?.();
    }
  });

  // Работа с локальным журналом
  function readLog() {
    try {
      return JSON.parse(localStorage.getItem(LS.log) || "[]");
    } catch {
      return [];
    }
  }
  function writeLog(list) {
    localStorage.setItem(LS.log, JSON.stringify(list));
  }
  function pruneLog() {
    const list = readLog();
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24h
    const filtered = list.filter((e) => {
      const t = Date.parse(e.ts);
      return isFinite(t) ? t >= cutoff : false;
    });
    if (filtered.length !== list.length) writeLog(filtered);
    return filtered;
  }
  function appendLog(entry) {
    const list = pruneLog(); // сперва чистим старые
    list.push(entry);
    writeLog(list);
  }
  function last24hSummary() {
    const list = pruneLog();
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    let count = 0,
      fare = 0,
      tip = 0,
      total = 0;
    for (const e of list) {
      const t = Date.parse(e.ts);
      if (!isFinite(t) || t < cutoff) continue;
      count += 1;
      fare += Number(e.fare) || 0;
      tip += Number(e.tip) || 0;
      total += Number(e.total) || 0;
    }
    return {
      count,
      fare: two(fare),
      tip: two(tip),
      total: two(total),
    };
  }

  // QR instance
  // Рендер QR через низкоуровневый генератор (автовыбор версии)
  function renderQR(text) {
    if (!window.qrcode) return; // библиотека ещё не подгрузилась
    // нек-рые Unicode символы «утяжеляют» строку, EPC можно держать ASCII
    // (это опционально, просто для лёгкости):
    const safe = text.replace(/–/g, "-"); // en-dash → дефис

    const qr = qrcode(0, "M"); // 0 = auto version, 'L'/'M'/'Q'/'H'
    qr.addData(safe);
    qr.make();

    // рисуем как <img> data: URL — совместимо со всеми браузерами
    qrBox.innerHTML = "";
    qrBox.insertAdjacentHTML("afterbegin", qr.createImgTag(6, 16));
    // 6 = scale, 16 = margin (можешь уменьшить/увеличить при желании)
  }

  // Формируем EPC/SEPA текст
  function buildEpcString(totalEUR, driverNo) {
    const amountDot = two(totalEUR).toFixed(2); // "12.34"
    const vz = `Taxi Murtal - Fahrer ${driverNo || "00"}`; // без длинного тире

    // EPC QR Code v2.1 (27 строк, UTF-8)
    return [
      "BCD", // Service tag
      "001", // Version
      "1", // Charset: UTF-8
      "SCT", // SEPA Credit Transfer
      RECEIVER.bic, // BIC
      RECEIVER.name, // Name
      RECEIVER.iban, // IBAN
      "EUR" + amountDot, // Betrag
      "", // Empty: Purpose code
      "", // Empty: Reference
      vz, // Remittance information (наш Verwendungszweck)
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "", // добиваем до 27 строк
    ].join("\n");
  }

  // Превью назначения
  function updateVzPreview(driverNo) {
    elVZ.textContent = `Taxi Murtal – Fahrer ${driverNo || "00"}`;
  }

  // Основной пересчёт
  function recalc() {
    const fare = toNumber(elFare.value);
    const tip = toNumber(elTip.value);
    const total = two(fare + tip);

    elTotal.textContent = toMoney(total);
    updateVzPreview(elDriver.value);

    // QR всегда актуализируем (даже 0.00 — для тренировки)
    const epc = buildEpcString(total, elDriver.value);
    renderQR(epc);
    // Разрешаем WA только если есть сумма и корректный номер водителя
    sendWA.disabled = !(total > 0 && /^\d{1,2}$/.test(elDriver.value.trim()));
  }

  // Быстрые кнопки чаевых
  tipBtns.forEach((btn) => {
    btn.addEventListener(
      "click",
      () => {
        const v = btn.dataset.tip;
        const fare = toNumber(elFare.value);
        if (v === undefined) return;

        if (v.endsWith && v.endsWith("%")) {
          const p = toNumber(v);
          elTip.value = two(fare * (p / 100))
            .toString()
            .replace(".", ",");
        } else if (v === "0") {
          elTip.value = "0";
        } else {
          elTip.value = v.replace(".", ",");
        }
        recalc();
      },
      { passive: true }
    );
  });
  tipClear?.addEventListener(
    "click",
    () => {
      elTip.value = "0";
      recalc();
    },
    { passive: true }
  );

  // Сохранение номера водителя
  elDriver.addEventListener("input", () => {
    const clean = elDriver.value.replace(/\D/g, "").slice(0, 2);
    elDriver.value = clean;
    localStorage.setItem(LS.driver, clean);
    recalc();
  });

  // Поля денег → автопересчёт
  ["input", "change"].forEach((evt) => {
    elFare.addEventListener(evt, recalc);
    elTip.addEventListener(evt, recalc);
  });

  // Мини-тост
  const toast = document.createElement("div");
  toast.className = "toast";
  document.body.appendChild(toast);
  function showToast(text) {
    toast.textContent = text;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2000);
  }

  // Копирование сводки
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

  // Отправка в WhatsApp
  sendWA.addEventListener("click", () => {
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

    const wa = localStorage.getItem(LS.waBoss) || DEFAULT_WA;
    const url = `https://wa.me/${wa}?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank", "noopener");

    // Локальный журнал
    appendLog({
      ts: new Date().toISOString(),
      driver: elDriver.value || "00",
      fare: two(fare),
      tip: two(tip),
      total: two(total),
      method: "QR",
    });
  });

  // Отчёт за последние 24 часа
  btnReport24h?.addEventListener("click", async () => {
    const s = last24hSummary();
    const txt = [
      "MurtalTaxi – Bericht (letzte 24 Stunden)",
      `Transaktionen: ${s.count}`,
      `Taxameter: ${toMoney(s.fare)}`,
      `Trinkgeld: ${toMoney(s.tip)}`,
      `Gesamt: ${toMoney(s.total)}`,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(txt);
      showToast("Bericht (24 h) kopiert");
    } catch {
      showToast("Bericht: Kopieren fehlgeschlagen");
    }
  });

  // Очистка лога
  btnClearLog?.addEventListener("click", () => {
    writeLog([]);
    showToast("Lokaler Log gelöscht");
  });

  // Стартовые значения и первичная очистка 24h
  pruneLog();
  if (!elDriver.value) elDriver.value = "00";
  elFare.value = elFare.value || "0,00";
  elTip.value = elTip.value || "0";
  recalc();

  // На случай загрузки QR-библиотеки через CDN-фоллбек
  window.addEventListener("load", recalc);
})();
