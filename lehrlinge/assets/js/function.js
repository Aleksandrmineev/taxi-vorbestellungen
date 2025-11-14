// function.js
(function () {
  const App = (window.App = window.App || {});

  // === Форматтеры и утилиты (кэш) ===========================================
  App.fmt = App.fmt || {};
  App.fmt.num =
    App.fmt.num || new Intl.NumberFormat("de-AT", { maximumFractionDigits: 1 });
  App.fmt.date =
    App.fmt.date || new Intl.DateTimeFormat("de-AT", { dateStyle: "medium" });
  App.fmt.dateTime =
    App.fmt.dateTime ||
    new Intl.DateTimeFormat("de-AT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  // Единые хелперы форматирования
  App.formatKm = (v) =>
    Number.isFinite(Number(v))
      ? App.nf
        ? App.nf.format(Number(v))
        : App.fmt.num.format(Number(v))
      : "—";
  App.fmtDate = (dt) =>
    dt instanceof Date && !Number.isNaN(dt.getTime())
      ? App.fmt.date.format(dt)
      : "—";
  App.fmtDateTime = (dt) =>
    dt instanceof Date && !Number.isNaN(dt.getTime())
      ? App.fmt.dateTime.format(dt)
      : "—";

  // Безопасный парсер дат
  function parseDateSafe(src) {
    const s = typeof src === "string" ? src.trim() : src;
    if (!s) return null;

    // ISO: YYYY-MM-DD или YYYY-MM-DDTHH:mm[:ss]
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + "T00:00:00");
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return new Date(s);

    // DD.MM.YYYY[ HH:MM]
    if (/^\d{2}\.\d{2}\.\d{4}/.test(s)) {
      const [d, m, y] = s.slice(0, 10).split(".");
      const time = s.slice(11).trim(); // может быть пусто
      return new Date(`${y}-${m}-${d}T${time || "00:00"}`);
    }

    const t = Date.parse(s);
    return Number.isNaN(t) ? null : new Date(t);
  }

  // === UI helpers (ожидают App.dom / App.state / App.nf от main.js) =========

  // Тумблер темы
  App.initThemeToggle = function () {
    const html = document.documentElement;
    const btn = App?.dom?.themeBtn;
    if (!btn) return;

    const saved = localStorage.getItem("theme");
    html.dataset.theme = saved === "light" || saved === "dark" ? saved : "dark";
    updateIcon();

    btn.addEventListener("click", () => {
      html.dataset.theme = html.dataset.theme === "light" ? "dark" : "light";
      localStorage.setItem("theme", html.dataset.theme);
      updateIcon();
    });

    function updateIcon() {
      btn.textContent = html.dataset.theme === "light" ? "☀️" : "🌙";
    }
  };

  // Сегодняшняя дата в поле
  App.setReportDateToday = function () {
    const el = App?.dom?.dateEl;
    if (!el) return;
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    el.value = `${y}-${m}-${day}`;
  };

  // Часы в топбаре
  App.tickNow = function () {
    if (!App?.dom?.nowEl) return;
    App.dom.nowEl.textContent = App.fmt.dateTime.format(new Date());
  };

  // Рендер списка точек (старт — все включены; дальше — восстановление последнего выбора)
  App.render = function () {
    const { list, drvSel } = App.dom || {};
    const { points, route } = App.state || {};
    if (!list) return;

    const PFX = "mt:points";
    const lastDriverLS = localStorage.getItem("mt:lastDriver") || "";
    const driver = (drvSel && drvSel.value) || lastDriverLS || "d_any";
    const key = (d) => `${PFX}:r${route || "1"}:d${d}`;

    const readSaved = () => {
      const tryKeys = [key(driver)];
      if (lastDriverLS && lastDriverLS !== driver)
        tryKeys.push(key(lastDriverLS));
      tryKeys.push(key("d_any"));
      for (const k of tryKeys) {
        try {
          const arr = JSON.parse(localStorage.getItem(k) || "null");
          if (Array.isArray(arr)) return new Set(arr.map(String));
        } catch {}
      }
      return null;
    };

    const savedSet = readSaved();
    const isChecked = (id) => (savedSet ? savedSet.has(String(id)) : true);

    list.innerHTML = (points || [])
      .map(
        (p) => `
  <div class="row" data-id="${p.id}">
    <input class="chk" type="checkbox" data-point-id="${p.id}"${
          isChecked(p.id) ? " checked" : ""
        } aria-label="Einbeziehen">
    <div class="badge" title="Zum Verschieben gedrückt halten">${p.id}</div>
    <div class="name">${p.name}</div>
    <div class="leg"></div>
  </div>`
      )
      .join("");

    list.querySelectorAll(".row").forEach((row) => {
      const ch = row.querySelector(".chk");
      row.classList.toggle("off", !ch.checked);
    });

    const idOf = (el) => {
      const row = el.closest ? el.closest(".row") : el;
      const chk = el.matches?.(".chk") ? el : row?.querySelector(".chk");
      return (
        chk?.getAttribute("data-point-id") ||
        row?.dataset?.id ||
        chk?.value ||
        chk?.id ||
        chk?.name ||
        ""
      );
    };

    const saveCurrent = () => {
      const ids = [...list.querySelectorAll('.chk[type="checkbox"]')]
        .filter((b) => b.checked)
        .map(idOf)
        .filter(Boolean);
      const json = JSON.stringify(ids);
      const k1 = key(driver);
      const k2 = key("d_any");
      localStorage.setItem(k1, json);
      if (k2 !== k1) localStorage.setItem(k2, json);
    };

    // 👉 Экспортируем, чтобы вызывать перед сменой маршрута
    App.savePointsSelection = saveCurrent;

    if (!list._persistBound) {
      list.addEventListener(
        "change",
        (e) => {
          const t = e.target;
          if (
            !(t instanceof HTMLInputElement) ||
            t.type !== "checkbox" ||
            !t.classList.contains("chk")
          )
            return;
          t.closest(".row")?.classList.toggle("off", !t.checked);
          App.updateTotal?.();
          saveCurrent();
        },
        true
      );
      list._persistBound = true;
    }

    // DnD как раньше...
    list.querySelectorAll(".badge").forEach((badge) => {
      let dragging = null,
        startY = 0,
        ph = null,
        ghostH = 0;
      const onMove = (e) => {
        if (!dragging) return;
        const y = e.touches ? e.touches[0].clientY : e.clientY;
        const dy = y - startY;
        dragging.style.transform = `translateY(${dy}px)`;
        const rows = [...list.querySelectorAll(".row:not(.drag)")];
        const mid = dragging.getBoundingClientRect().top + ghostH / 2 + dy;
        let target = null;
        for (const r of rows) {
          const rect = r.getBoundingClientRect();
          if (mid < rect.top + rect.height / 2) {
            target = r;
            break;
          }
        }
        if (!target) list.appendChild(ph);
        else list.insertBefore(ph, target);
      };
      const endDrag = () => {
        if (!dragging) return;
        dragging.classList.remove("drag");
        dragging.style.transform = "";
        if (ph) {
          list.insertBefore(dragging, ph);
          ph.remove();
        }
        ph = null;
        dragging = null;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", endDrag);
        App.updateTotal?.();
        saveCurrent();
      };
      badge.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        try {
          e.target.setPointerCapture(e.pointerId);
        } catch {}
        const row = e.target.closest(".row");
        dragging = row;
        startY = e.clientY;
        ghostH = row.offsetHeight;
        row.classList.add("drag");
        ph = document.createElement("div");
        const cs = getComputedStyle(row);
        ph.style.height = ghostH + "px";
        ph.style.margin = cs.margin;
        ph.style.border = "1px dashed var(--line)";
        ph.style.borderRadius = cs.borderRadius;
        ph.style.background = "transparent";
        list.insertBefore(ph, row.nextSibling);
        window.addEventListener("pointermove", onMove, { passive: true });
        window.addEventListener("pointerup", endDrag, { once: true });
      });
    });

    // если сохранения ещё не было — зафиксируем стартовое «все включены»
    if (!savedSet) App.savePointsSelection();

    App.updateTotal?.();
  };

  // Селекты водителей: не зависят от Route, помним глобально последний выбор
  App.renderDrivers = function () {
    const drivers = (App.state && App.state.drivers) || [];
    // поддержим несколько селектов водителя
    const selects = Array.from(
      document.querySelectorAll("select#driver, select[data-driver]")
    );
    if (!selects.length) return;

    // 1) определяем, что ставить как выбранное
    const saved = localStorage.getItem("mt:lastDriver") || "";
    // если в каком-то селекте уже есть значение (например, до перерендеринга) — приоритет current
    const current = selects.find((s) => s && s.value)?.value || "";
    const prefer = current || saved || ""; // глобальный выбор, НЕ зависящий от Route

    // 2) рендерим опции во все селекты одинаково
    const optionsHtml =
      '<option value="">—</option>' +
      drivers
        .map((d) => `<option value="${String(d.id)}">${d.name}</option>`)
        .join("");

    selects.forEach((sel) => {
      sel.innerHTML = optionsHtml;

      // проставляем prefer, если такая опция существует
      const hasPrefer = Array.from(sel.options).some((o) => o.value === prefer);
      if (hasPrefer) {
        sel.value = prefer;
      } else if (
        saved &&
        Array.from(sel.options).some((o) => o.value === saved)
      ) {
        // fallback к сохранённому, если current отсутствует в новом списке
        sel.value = saved;
      } else {
        // иначе оставляем пусто
        sel.value = "";
      }
    });

    // 3) если удалось выбрать что-то осмысленное — сразу обновим localStorage (глобально)
    const finalVal = selects[0]?.value || "";
    if (finalVal) localStorage.setItem("mt:lastDriver", finalVal);

    // 4) оповестим остальной код (если нужно что-то дорендерить)
    window.dispatchEvent(new CustomEvent("drivers:loaded"));
  };

  // Селект Kennzeichen (машины)
  App.renderCars = function () {
    const cars = (App.state && App.state.cars) || [];
    const sel = document.getElementById("car");
    if (!sel) return;

    const STORAGE_KEY = "mt:lastCar";
    const saved = localStorage.getItem(STORAGE_KEY) || "";

    const optionsHtml =
      '<option value="">—</option>' +
      cars
        .map(
          (c) =>
            `<option value="${String(c.id)}">${
              c.plate || String(c.id)
            }</option>`
        )
        .join("");

    sel.innerHTML = optionsHtml;

    // восстановление выбора
    if (
      saved &&
      Array.from(sel.options).some((o) => String(o.value) === String(saved))
    ) {
      sel.value = saved;
    } else {
      sel.value = "";
    }

    if (!sel._carBound) {
      sel.addEventListener("change", () => {
        const v = sel.value;
        if (v) {
          localStorage.setItem(STORAGE_KEY, v);
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      });
      sel._carBound = true;
    }
  };

  // Текущая последовательность включённых
  App.currentSeq = function () {
    const list = App?.dom?.list;
    if (!list) return [];
    return [...list.querySelectorAll(".row")]
      .filter((r) => r.querySelector(".chk").checked)
      .map((r) => r.dataset.id);
  };

  // Сумма расстояний
  App.calcTotal = function (seq) {
    const dist = (App.state && App.state.dist) || {};
    let s = 0;
    for (let i = 0; i < seq.length - 1; i++) {
      const a = seq[i],
        b = seq[i + 1];
      const val = dist?.[a]?.[b];
      if (val == null) return NaN; // нет данных — показываем "—"
      s += Number(val || 0);
    }
    return s;
  };

  App.updateTotal = function () {
    const seq = App.currentSeq();
    const km = App.calcTotal(seq);
    if (App?.dom?.total) {
      App.dom.total.textContent = Number.isFinite(km) ? App.formatKm(km) : "—";
    }
    App.updateLegs();
  };

  App.updateLegs = function () {
    const dist = (App.state && App.state.dist) || {};
    const list = App?.dom?.list;
    if (!list) return;

    let prevId = null;
    const rows = [...list.querySelectorAll(".row")];
    for (const row of rows) {
      const legEl = row.querySelector(".leg");
      const checked = row.querySelector(".chk").checked;
      const curId = row.dataset.id;

      if (!checked) {
        legEl.textContent = "";
        continue;
      }
      if (!prevId) {
        legEl.textContent = "0 km";
      } else {
        const d = dist?.[prevId]?.[curId];
        legEl.textContent =
          d == null || d === "" ? "—" : `${App.formatKm(d)} km`;
      }
      prevId = curId;
    }
  };

  // Карточка «отправлено»
  App.renderConfirmation = function (p) {
    const box = App?.dom?.confirmBox;
    if (!box || !p || typeof p !== "object") {
      if (box) box.style.display = "none";
      return;
    }
    const dtStr = App.fmtDateTime(parseDateSafe(p.timestamp));
    const carText = p.car_plate || p.car_id || "—";

    box.style.display = "block";
    box.innerHTML = `
  <div class="card">
    <h3>Gesendet</h3>
    <div class="kv">
      <div><span>Datum:</span> <b>${dtStr}</b></div>
      <div><span>Route:</span> <b>${p.route ?? "—"}</b></div>
      <div><span>Fahrer:</span> <b>${p.driver_name || "—"}</b></div>
      <div><span>Auto:</span> <b>${carText}</b></div>
      <div><span>Zeit:</span> <b>${p.shift || "—"}</b></div>
      <div><span>km:</span> <b>${App.formatKm(p.total_km)}</b></div>
    </div>
    <div class="seq">${p.sequence_names || p.sequence || ""}</div>
  </div>`;
  };

  // Блок недавних отправок
  App.renderRecent = function (recent) {
    const box = App?.dom?.recentBox;
    if (!box) return;

    const items = (Array.isArray(recent) ? recent : [])
      .map((it) => {
        // дата из возможных полей
        const rawDate =
          it?.date ??
          it?.ts ??
          it?.timestamp ??
          it?.reportDate ??
          it?.created_at;
        const dt = parseDateSafe(rawDate);
        if (!dt) return null;

        const route = String(it?.route ?? it?.r ?? "—");
        const km = Number(it?.totalKm ?? it?.km ?? 0);
        const driver = it?.driverName ?? it?.driver ?? "—";

        // смена: если это ISO-время — скрываем
        const shiftRaw = it?.shift ?? it?.time ?? "";
        const shift = /T\d{2}:\d{2}/.test(String(shiftRaw))
          ? "—"
          : shiftRaw || "—";

        return { dt, route, km, driver, shift };
      })
      .filter(Boolean)
      .sort((a, b) => b.dt - a.dt)
      .slice(0, 4);

    if (!items.length) {
      box.innerHTML = "<div class='muted'>Noch keine Einträge</div>";
      return;
    }

    box.innerHTML = items
      .map(
        (r) => `
<div class="recent__item">
  <div class="recent__meta">${App.fmtDateTime(r.dt)}</div>
  <div class="recent__row"><b>Route:</b> ${r.route} · <b>KM:</b> ${App.formatKm(
          r.km
        )}</div>
  <div class="recent__row"><b>Fahrer:</b> ${r.driver} · <b>Schicht:</b> ${
          r.shift
        }</div>
</div>`
      )
      .join("");
  };

  // Всплывашка
  App.showToast = function (p) {
    if (!p || typeof p !== "object") return;
    const dtStr = App.fmtDateTime(parseDateSafe(p.timestamp));
    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = `
<div><b>Gesendet</b> — ${dtStr}, Route ${p.route ?? "—"},
${p.driver_name || "—"}, ${p.shift || "—"}, ${App.formatKm(p.total_km)} km</div>
<div class="seq">${p.sequence_names || p.sequence || ""}</div>`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 6000);
  };

  // Безопасный отступ под нижний блок
  App.setFooterSafe = function () {
    const footer = document.querySelector(".bottom");
    const safe = footer ? footer.offsetHeight + 24 : 140;
    document.documentElement.style.setProperty("--footer-safe", safe + "px");
    document.body.style.paddingBottom = safe + "px";
  };
})();
