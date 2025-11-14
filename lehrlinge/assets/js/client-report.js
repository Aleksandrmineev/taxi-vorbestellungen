// assets/js/client-report.js
document.addEventListener("DOMContentLoaded", () => {
  const nowEl = document.getElementById("now");
  const summaryEl = document.getElementById("summary");
  const tbody = document.getElementById("tbody");
  const emptyEl = document.getElementById("empty");
  const totalFooter = document.getElementById("totalFooter");
  const totalKmEl = document.getElementById("totalKm");

  const fFrom = document.getElementById("f_from");
  const fTo = document.getElementById("f_to");
  const fRoute = document.getElementById("f_route");
  const fShift = document.getElementById("f_shift");
  const fCar = document.getElementById("f_car");
  const fLimit = document.getElementById("f_limit");

  const btnApply = document.getElementById("apply");
  const btnPrint = document.getElementById("btnPrint");

  /* ===== часы ===== */
  const fmtNow = () =>
    new Date().toLocaleString("de-AT", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  if (nowEl) {
    nowEl.textContent = fmtNow();
    setInterval(() => (nowEl.textContent = fmtNow()), 30000);
  }

  /* ===== helpers ===== */
  const safeNum = (v) => {
    if (typeof v === "number") return v;
    if (typeof v === "string") return Number(v.replace(",", ".")) || 0;
    return 0;
  };

  const asDate = (v) => {
    if (v == null || v === "") return null;
    if (v instanceof Date) return v;
    if (typeof v === "number") return new Date(v);
    const n = Number(v);
    if (!Number.isNaN(n)) return new Date(n);
    const d = new Date(v);
    return isNaN(d) ? null : d;
  };

  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

  const normalizeSeq = (v) => {
    if (v == null) return "";
    const text = String(v).replace(/\r\n?/g, "\n").trim();
    if (text.includes("\n")) {
      // "A\nB\nC" -> "A / B / C"
      return text
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .join(" / ");
    }
    return text
      .split(/(?:\s*>\s*|\s*-\s*)+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(" / ");
  };

  const shiftRank = (s) => {
    const t = String(s || "").toLowerCase();
    if (t.startsWith("nach")) return 0;
    if (t.startsWith("fr")) return 1;
    return 2;
  };

  const matchShift = (value, wanted) => {
    const w = String(wanted || "").toLowerCase();
    if (!w) return true; // Alle
    const t = String(value || "").toLowerCase();
    if (w.startsWith("fr")) return t.startsWith("fr");
    if (w.startsWith("nach")) return t.startsWith("nach");
    return true;
  };

  const startOfDay = (d) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const endOfDay = (d) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

  const dateOf = (r) => asDate(r.report_date) || asDate(r.timestamp);

  const formatDateDE = (d) =>
    d instanceof Date && !isNaN(d) ? d.toLocaleDateString("de-AT") : "—";

  /* ===== дата по умолчанию: последние 2 дня ===== */
  const initDefaultDates = () => {
    const qs = new URLSearchParams(location.search);

    const today = new Date();
    const yest = new Date(today);
    yest.setDate(today.getDate() - 1);
    const toISO = (d) =>
      new Date(d.getTime() - d.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 10);

    if (!fFrom.value) fFrom.value = qs.get("from") || toISO(yest);
    if (!fTo.value) fTo.value = qs.get("to") || toISO(today);

    if (qs.get("route") != null) fRoute.value = qs.get("route") || "";
    if (qs.get("shift") != null) fShift.value = qs.get("shift") || "";
    if (qs.get("limit") != null) fLimit.value = qs.get("limit") || fLimit.value;
    // f_car пока отложим до заполнения списка машин
  };

  initDefaultDates();

  /* ===== загрузка и рендер ===== */
  async function loadAndRender() {
    tbody.innerHTML = "";
    emptyEl.hidden = true;
    totalFooter.hidden = true;
    summaryEl.textContent = "Lade Bericht…";

    try {
      const from = fFrom.value || "";
      const to = fTo.value || "";
      const limit = Number(fLimit.value) || 300;
      const routeValue = fRoute?.value || "";
      const shiftValue = fShift?.value || "";
      const carValue = fCar?.value || "";

      const items = await API.getRecentSubmissions({
        from,
        to,
        limit,
        route: routeValue || "",
      });

      const fromD = from ? startOfDay(asDate(from)) : null;
      const toD = to ? endOfDay(asDate(to)) : null;

      let rows = (Array.isArray(items) ? items : []).filter((r) => {
        const d = dateOf(r);
        if (!d) return false;
        if (fromD && d < fromD) return false;
        if (toD && d > toD) return false;
        if (routeValue && String(r.route) !== String(routeValue)) return false;
        if (!matchShift(r.shift, shiftValue)) return false;
        // фильтр по авто
        if (carValue) {
          const plate = String(r.car_plate || "").trim();
          const cid = String(r.car_id || "").trim();
          if (plate !== carValue && cid !== carValue) {
            return false;
          }
        }
        return true;
      });

      rows = rows
        .sort((a, b) => {
          const da = dateOf(a),
            db = dateOf(b);

          // сортировка по дате – ОТ МЕНЬШЕГО К БОЛЬШЕМУ
          if (da - db !== 0) return da - db;

          // сортировка по смене
          const sr = shiftRank(a.shift) - shiftRank(b.shift);
          if (sr !== 0) return sr;

          // сортировка по маршруту
          const ra = Number(a.route) || 9999;
          const rb = Number(b.route) || 9999;
          return ra - rb;
        })
        .slice(0, limit);

      // собрать список авто для фильтра (по текущему результату)
      const uniqueCars = new Map(); // key=id/plate, value=label
      for (const r of rows) {
        const plate = String(r.car_plate || "").trim();
        const cid = String(r.car_id || "").trim();
        const key = plate || cid;
        if (!key) continue;
        const label = plate || cid;
        if (!uniqueCars.has(key)) uniqueCars.set(key, label);
      }
      // обновляем селект авто (но не трогаем текущее значение, если есть)
      const prevCar =
        fCar.value || new URLSearchParams(location.search).get("car") || "";
      fCar.innerHTML =
        '<option value="">Alle Autos</option>' +
        Array.from(uniqueCars.entries())
          .map(
            ([key, label]) =>
              `<option value="${esc(key)}"${
                key === prevCar ? " selected" : ""
              }>${esc(label)}</option>`
          )
          .join("");

      const count = rows.length;
      if (!count) {
        tbody.innerHTML = "";
        emptyEl.hidden = false;
        totalFooter.hidden = true;
        summaryEl.textContent = "Keine Einträge im gewählten Zeitraum.";
        return;
      }

      let totalKmRaw = 0;

      const trs = rows
        .map((r) => {
          const d = dateOf(r);
          const dateStr = formatDateDE(d);
          const shiftTxt = (r.shift ?? "").toString().trim() || "—";
          const routeTxt = (r.route ?? "—").toString().trim();
          const carText = (r.car_plate || r.car_id || "—").toString().trim();

          const kmRaw = safeNum(r.total_km);
          totalKmRaw += kmRaw;
          const kmRounded = Math.round(kmRaw);

          const strecke = normalizeSeq(r.sequence_names || r.sequence || "");

          return `
          <tr class="row-meta">
            <td>${esc(dateStr)}</td>
            <td>${esc(shiftTxt)}</td>
            <td>${esc(routeTxt)}</td>
            <td>${esc(carText)}</td>
            <td>${kmRounded}</td>
          </tr>
          <tr class="row-strecke">
            <td colspan="5">${esc(strecke)}</td>
          </tr>
        `;
        })
        .join("");

      tbody.innerHTML = trs;
      emptyEl.hidden = true;

      const totalKmRounded = Math.round(totalKmRaw);
      totalKmEl.textContent = `${totalKmRounded} km`;
      totalFooter.hidden = false;

      /* ===== шапка-резюме ===== */
      const periodStr =
        from && to
          ? `${from} – ${to}`
          : from
          ? `ab ${from}`
          : to
          ? `bis ${to}`
          : "gesamter Zeitraum";

      const routeStr = routeValue ? `Route ${routeValue}` : "alle Routen";
      const shiftStr = shiftValue || "alle Zeiten";
      const carStr = prevCar
        ? `Auto: ${
            Array.from(uniqueCars.values()).find(
              (lbl, idx) => Array.from(uniqueCars.keys())[idx] === prevCar
            ) || prevCar
          }`
        : "alle Autos";

      summaryEl.textContent = `Zeitraum: ${periodStr} • ${routeStr} • ${shiftStr} • ${carStr} • Fahrten: ${count} • Gesamt: ${totalKmRounded} km`;
    } catch (e) {
      console.error("client-report error:", e);
      summaryEl.textContent = "Fehler beim Laden des Berichts.";
      tbody.innerHTML = "";
      emptyEl.hidden = false;
      totalFooter.hidden = true;
    }
  }

  btnApply.addEventListener("click", () => {
    // обновляем query-параметры (чтобы ссылку можно было копировать)
    const qs = new URLSearchParams();
    if (fFrom.value) qs.set("from", fFrom.value);
    if (fTo.value) qs.set("to", fTo.value);
    if (fRoute.value) qs.set("route", fRoute.value);
    if (fShift.value) qs.set("shift", fShift.value);
    if (fCar.value) qs.set("car", fCar.value);
    if (fLimit.value) qs.set("limit", fLimit.value);

    const newUrl =
      location.pathname + (qs.toString() ? "?" + qs.toString() : "");
    history.replaceState(null, "", newUrl);

    loadAndRender();
  });

  btnPrint.addEventListener("click", () => {
    window.print();
  });

  // Первичная загрузка сразу с учётом query-параметров
  loadAndRender();
});
