(() => {
  const nfMoney = new Intl.NumberFormat("de-AT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const nf1 = new Intl.NumberFormat("de-AT", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });

  const RATES = {
    base: 5,
    dayFirst: 2.9,
    dayNext: 2.8,
    nightFirst: 3.3,
    nightNext: 2.8,
    cutoff: 5,
    surcharge: 2.7, // за 1 шт.
  };

  const kmInput = document.getElementById("km");
  const totalDayEl = document.querySelector("#total-day strong");
  const totalNightEl = document.querySelector("#total-night strong");
  const fDay = document.getElementById("formula-day");
  const fNight = document.getElementById("formula-night");

  const surchargeBtn = document.getElementById("surchargeBtn");
  const surchargeCountEl = document.getElementById("surchargeCount");
  let surchargeCount = 0;

  // --- UX: автофокус и автоselect ---
  window.addEventListener("load", () => {
    kmInput.focus();
    kmInput.select();
  });
  kmInput.addEventListener("focus", () => kmInput.select());
  // Блокируем прокрутку-колёсиком на number
  kmInput.addEventListener("wheel", () => kmInput.blur(), {
    passive: true,
  });
  // Убираем минус при вводе
  kmInput.addEventListener("input", () => {
    if (kmInput.value.includes("-"))
      kmInput.value = kmInput.value.replaceAll("-", "");
    update();
  });

  // --- Zuschlag накопительно ---
  function updateSurchargeUI() {
    surchargeCountEl.textContent = `× ${surchargeCount}`;
  }
  surchargeBtn.addEventListener("click", () => {
    // +1 за клик
    surchargeCount += 1;
    updateSurchargeUI();
    update();
  });
  // по длительному нажатию (или правому клику) — сброс до 0 (удобно, но не обязательно)
  surchargeBtn.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    surchargeCount = 0;
    updateSurchargeUI();
    update();
  });
  surchargeBtn.addEventListener("dblclick", () => {
    surchargeCount = 0;
    updateSurchargeUI();
    update();
  });

  // --- математика ---
  function calcTotal(km, firstRate, nextRate) {
    const firstKm = Math.min(Math.max(km, 0), RATES.cutoff);
    const nextKm = Math.max(km - RATES.cutoff, 0);
    const total = RATES.base + firstKm * firstRate + nextKm * nextRate;
    return { total, firstKm, nextKm };
  }

  // округление к €0,10
  function roundToStep(value, step = 0.1) {
    return Math.round(value / step) * step;
  }
  const fmtMoney = (x) =>
    nfMoney.format(roundToStep(Math.round(x * 100) / 100)); // сначала до цента, потом к 10 центам
  const fmtNum = (x) => nf1.format(x);

  function update() {
    const raw = kmInput.value.replace(",", ".");
    const km = Number.parseFloat(raw);
    const kmValid = Number.isFinite(km) && km >= 0 ? km : 0;
    const addS = surchargeCount * RATES.surcharge;

    const day = calcTotal(kmValid, RATES.dayFirst, RATES.dayNext);
    const night = calcTotal(kmValid, RATES.nightFirst, RATES.nightNext);

    // итоги с округлением к 10 центам
    totalDayEl.textContent = nfMoney.format(roundToStep(day.total + addS));
    totalNightEl.textContent = nfMoney.format(roundToStep(night.total + addS));

    const sTxt = surchargeCount ? ` + 2,70 € × ${surchargeCount}` : "";
    fDay.innerHTML = `<code>Tag: ${nfMoney.format(
      RATES.base
    )} + ${nfMoney.format(RATES.dayFirst)} × ${fmtNum(
      day.firstKm
    )} km + ${nfMoney.format(RATES.dayNext)} × ${fmtNum(
      day.nextKm
    )} km${sTxt}</code>`;
    fNight.innerHTML = `<code>Nacht/Feiertag: ${nfMoney.format(
      RATES.base
    )} + ${nfMoney.format(RATES.nightFirst)} × ${fmtNum(
      night.firstKm
    )} km + ${nfMoney.format(RATES.nightNext)} × ${fmtNum(
      night.nextKm
    )} km${sTxt}</code>`;
  }

  update();
})();

(function () {
  // тема уже применена бутскриптом в <head>; здесь только кнопка
  window.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("themeToggle");
    if (!btn) return;

    const setLabel = (t) =>
      (btn.textContent = t === "dark" ? "☀️ Hell" : "🌙 Dunkel");

    // синхронизируем надпись с текущей темой
    setLabel(document.documentElement.getAttribute("data-theme") || "dark");

    btn.addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme") || "dark";
      const next = cur === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("theme", next);
      setLabel(next);
    });
  });
})();

// Кнопка назад
function goBack() {
  if (document.referrer && !document.referrer.includes(location.href)) {
    history.back();
  } else {
    // если открыто напрямую — переход на главную
    window.location.href = "/main/index.html";
  }
}
