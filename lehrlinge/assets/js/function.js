// function.js
(function () {
  const App = (window.App = window.App || {});

  // Экранирует данные из Google Sheets перед вставкой в HTML.
  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function makeShortCode(name, used) {
    const letters = String(name || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z]/g, "");
    const base = (letters + "PUN").slice(0, 3);
    if (!used.has(base)) return base;
    for (let number = 1; number <= 9; number += 1) {
      const candidate = base.slice(0, 2) + number;
      if (!used.has(candidate)) return candidate;
    }
    return base.slice(0, 2) + (used.size + 1);
  }

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

  // Рендер списка точек. Начальное состояние берётся из последнего отчёта.
  App.render = function () {
    const { list, drvSel } = App.dom || {};
    const { points, route } = App.state || {};
    if (!list) return;

    const showAll = !!App.dom.showAllPoints?.checked;

    const savedSet = App.state.pointSelection instanceof Set
      ? App.state.pointSelection
      : App.state.lastReportSelection instanceof Set
        ? App.state.lastReportSelection
        : null;
    const shortCodes = new Set();
    const isRequired = (p, index, allPoints) =>
      p?.required === true || index === 0 || index >= allPoints.length - 2;
    const isChecked = (p) => savedSet ? savedSet.has(String(p.id)) : true;

    list.innerHTML = (points || [])
      .map(
        (p, index, allPoints) => {
          const shortCode = String(p.short_code || "").trim() || makeShortCode(p.name, shortCodes);
          shortCodes.add(shortCode);
          const phoneHref = safeTelUrl(p.phone);
          const contactName = String(p.contact_name || "").trim();
          const contact = phoneHref
            ? `<a href="${phoneHref}" class="point-contact__link">${
                esc(contactName || p.phone)
              }</a>`
            : contactName
              ? `<span class="point-contact__text">${esc(contactName)}</span>`
              : "";

          return `
  <div class="row${isRequired(p, index, allPoints) ? " row--required" : ""}" data-id="${String(p.id || "")}"${
          !showAll && isRequired(p, index, allPoints) ? ' hidden aria-hidden="true"' : ""
        }>
    <input class="chk" type="checkbox" data-point-id="${esc(p.id)}"${
          isChecked(p, index, allPoints) ? " checked" : ""
        }${isRequired(p, index, allPoints) ? " disabled" : ""} aria-label="Einbeziehen">
    <div class="badge" title="Zum Verschieben gedrückt halten">${esc(shortCode)}</div>
    <div class="name">
      <div class="point-address">
        <span>${
          p.url
            ? `<a href="${safeHttpUrl(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.name)}</a>`
            : esc(p.name)
        }</span>
      </div>
      ${contact || p.arrival_time ? `<div class="point-contact" aria-label="Telefonkontakt">
        ${contact ? `<svg class="point-contact__icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.62 2.63a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.85.29 1.73.5 2.63.62A2 2 0 0 1 22 16.92Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>${contact}` : ""}
        ${p.arrival_time ? `<span class="point-time">${esc(p.arrival_time)}</span>` : ""}
      </div>` : ""}
    </div>
    <div class="leg"></div>
  </div>`;
        }
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
      App.state.pointSelection = new Set(ids.map(String));
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

    App.updateTotal?.();
  };

  function safeHttpUrl(value) {
    try {
      const url = new URL(String(value || "").trim());
      return /^https?:$/.test(url.protocol)
        ? url.href.replace(/"/g, "&quot;")
        : "#";
    } catch {
      return "#";
    }
  }

  function safeTelUrl(value) {
    const phone = String(value || "").trim();
    const normalized = phone.replace(/[^\d+;,#*]/g, "");
    return normalized ? `tel:${encodeURIComponent(normalized)}` : "";
  }

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
      if (box) {
        box.hidden = true;
        box.innerHTML = "";
      }
      return;
    }
    const dtStr = App.fmtDateTime(parseDateSafe(p.timestamp));
    const carText = p.car_plate || p.car_id || "—";

    box.hidden = false;
    box.innerHTML = `
  <div class="confirm-modal__dialog card" role="dialog" aria-modal="true" aria-label="Gesendet">
    <button type="button" class="confirm-modal__close" data-confirm-close aria-label="Schließen">✕</button>
    <h3>Gesendet</h3>
    <div class="seq"><b>Danke!</b></div>
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
