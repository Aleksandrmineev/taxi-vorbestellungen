document.addEventListener("DOMContentLoaded", () => {
  const state = {
    activeTab: "points",
    routeFilter: "1",
    dirty: false,
    saving: false,
    data: {
      points: [],
      drivers: [],
      cars: [],
      matrix: { ids: [], rows: [] },
    },
    schedule: {
      from: "2026-09-14",
      to: "2026-09-18",
      route: "all",
      student: "all",
      holidays: new Set(),
      values: {},
      dirty: false,
    },
  };

  const dom = {
    authPanel: document.getElementById("authPanel"),
    adminApp: document.getElementById("adminApp"),
    loginForm: document.getElementById("loginForm"),
    loginBtn: document.getElementById("loginBtn"),
    logoutBtn: document.getElementById("logoutBtn"),
    authStatus: document.getElementById("authStatus"),
    passwordInput: document.getElementById("adminPassword"),
    saveBtn: document.getElementById("saveBtn"),
    reloadBtn: document.getElementById("reloadBtn"),
    routeFilter: document.getElementById("routeFilter"),
    statusText: document.getElementById("statusText"),
    countsText: document.getElementById("countsText"),
    dirtyText: document.getElementById("dirtyText"),
    tabs: Array.from(document.querySelectorAll("[data-tab]")),
    panels: {
      points: document.getElementById("tab-points"),
      matrix: document.getElementById("tab-matrix"),
      drivers: document.getElementById("tab-drivers"),
      cars: document.getElementById("tab-cars"),
      schedule: document.getElementById("tab-schedule"),
    },
  };

  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  function setDirty(flag = true) {
    state.dirty = !!flag;
    renderStatus();
  }

  function shortCodeFromName(name, used) {
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

  function normalizeData(raw) {
    const points = Array.isArray(raw?.points)
      ? raw.points.map((p) => ({
          id: String(p?.id || "").trim(),
          name: String(p?.name || ""),
          route: String(p?.route || "1"),
          active: String(p?.active || "") === "1" ? "1" : "0",
          url: String(p?.url || ""),
          contact_name: String(p?.contact_name || ""),
          phone: String(p?.phone || ""),
          arrival_time: String(p?.arrival_time || ""),
          lehrling_id: String(p?.lehrling_id || "").trim(),
          lehrling_name: String(p?.lehrling_name || ""),
          lehrling_has_pin: p?.lehrling_has_pin === true,
          lehrling_pin: "",
          auto_id: false,
        }))
      : [];

    const shortCodes = new Set();
    points.forEach((point) => {
      point.short_code = shortCodeFromName(point.name, shortCodes);
      shortCodes.add(point.short_code);
    });

    const drivers = Array.isArray(raw?.drivers)
      ? raw.drivers.map((d) => ({
          id: String(d?.id || "").trim(),
          name: String(d?.name || ""),
          active: String(d?.active || "") === "1" ? "1" : "0",
        }))
      : [];

    const cars = Array.isArray(raw?.cars)
      ? raw.cars.map((c) => ({
          id: String(c?.id || "").trim(),
          plate: String(c?.plate || ""),
        }))
      : [];

    const matrixIds = Array.isArray(raw?.matrix?.ids)
      ? raw.matrix.ids.map((id) => String(id || "").trim())
      : [];
    const matrixRows = Array.isArray(raw?.matrix?.rows) ? raw.matrix.rows : [];

    const byId = new Map();
    matrixIds.forEach((id, i) => {
      byId.set(id, matrixRows[i] || []);
    });

    const ids = points.map((p) => p.id);
    const rows = ids.map((fromId) =>
      ids.map((toId, colIdx) => {
        const srcRow = byId.get(fromId);
        const oldCol = matrixIds.indexOf(toId);
        const value = oldCol >= 0 ? srcRow?.[oldCol] : "";
        if (value === "" || value == null) return "";
        const num = Number(String(value).replace(",", "."));
        return Number.isFinite(num) ? num : "";
      })
    );

    return { points, drivers, cars, matrix: { ids, rows } };
  }

  function ensureMatrixIntegrity() {
    const ids = state.data.points.map((p) => p.id);
    const rows = Array.isArray(state.data.matrix?.rows) ? state.data.matrix.rows : [];

    while (rows.length < ids.length) rows.push(new Array(ids.length).fill(""));
    while (rows.length > ids.length) rows.pop();

    rows.forEach((row, rowIndex) => {
      while (row.length < ids.length) row.push("");
      while (row.length > ids.length) row.pop();
      rows[rowIndex] = row.map((value) => {
        if (value === "" || value == null) return "";
        const num = Number(String(value).replace(",", "."));
        return Number.isFinite(num) ? num : "";
      });
    });

    state.data.matrix = { ids, rows };
  }

  function renderStatus(message) {
    if (message) {
      dom.statusText.textContent = message;
    }
    dom.countsText.textContent = [
      `${state.data.points.length} Punkte`,
      `${state.data.drivers.length} Fahrer`,
      `${state.data.cars.length} Autos`,
      `${state.data.matrix.ids.length} Matrix`,
    ].join(" · ");
    dom.dirtyText.textContent = state.dirty
      ? "Ungespeicherte Änderungen"
      : "Alles gespeichert";
    dom.saveBtn.disabled = state.saving;
    dom.reloadBtn.disabled = state.saving;
    dom.saveBtn.textContent = state.saving ? "Speichere…" : "Alles speichern";
  }

  function setAuthenticated(flag) {
    dom.authPanel.hidden = !!flag;
    dom.adminApp.hidden = !flag;
    if (!flag) {
      dom.authStatus.textContent = "Nicht eingeloggt";
      dom.passwordInput.value = "";
    }
  }

  function setAuthStatus(message) {
    dom.authStatus.textContent = message;
  }

  function isAuthError(err) {
    return String(err?.message || err || "").includes("admin_auth_required");
  }

  function setTab(tab) {
    state.activeTab = tab;
    dom.tabs.forEach((btn) =>
      btn.setAttribute("aria-pressed", btn.dataset.tab === tab ? "true" : "false")
    );
    Object.entries(dom.panels).forEach(([name, panel]) => {
      panel.hidden = name !== tab;
    });
    const routeOnly = tab === "points" || tab === "matrix";
    dom.routeFilter.disabled = !routeOnly;
    render();
  }

  function routeScopedIndexes() {
    const list = [];
    state.data.points.forEach((p, idx) => {
      if (state.routeFilter === "all" || p.route === state.routeFilter) {
        list.push(idx);
      }
    });
    return list;
  }

  function nextPointId() {
    const used = new Set(state.data.points.map((p) => String(p.id || "").trim()));
    let number = 1;
    while (used.has(`P${String(number).padStart(3, "0")}`)) number += 1;
    return `P${String(number).padStart(3, "0")}`;
  }

  function autoPointId(name, currentIndex) {
    const letters = String(name || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-ZÄÖÜ]/g, "");
    const base = (letters + "PUN").slice(0, 3);
    const used = new Set(
      state.data.points
        .map((p, index) => (index === currentIndex ? "" : String(p.id || "").trim()))
        .filter(Boolean)
    );
    if (!used.has(base)) return base;
    for (let number = 1; number <= 9; number += 1) {
      const candidate = base.slice(0, 2) + number;
      if (!used.has(candidate)) return candidate;
    }
    return base.slice(0, 2) + (used.size + 1);
  }

  function addPoint() {
    const route = state.routeFilter === "all" ? "1" : state.routeFilter;
    const insertAt = (() => {
      const indexes = routeScopedIndexes();
      return indexes.length ? indexes[indexes.length - 1] + 1 : state.data.points.length;
    })();
    const draft = {
      id: nextPointId(),
      name: "",
      url: "",
      contact_name: "",
      phone: "",
      arrival_time: "",
      auto_id: true,
      route,
      active: "1",
    };

    state.data.points.splice(insertAt, 0, draft);

    state.data.matrix.ids.splice(insertAt, 0, draft.id);
    state.data.matrix.rows.forEach((row) => row.splice(insertAt, 0, ""));
    state.data.matrix.rows.splice(
      insertAt,
      0,
      new Array(state.data.points.length).fill("")
    );
    ensureMatrixIntegrity();
    setDirty();
    render();
  }

  function movePoint(index, direction) {
    const scoped = routeScopedIndexes();
    const pos = scoped.indexOf(index);
    const target = scoped[pos + direction];
    if (pos === -1 || target == null) return;

    const moveItem = (arr, from, to) => {
      const [item] = arr.splice(from, 1);
      arr.splice(to, 0, item);
    };

    moveItem(state.data.points, index, target);
    moveItem(state.data.matrix.ids, index, target);

    const row = state.data.matrix.rows.splice(index, 1)[0];
    state.data.matrix.rows.splice(target, 0, row);

    state.data.matrix.rows.forEach((r) => {
      const [cell] = r.splice(index, 1);
      r.splice(target, 0, cell);
    });
    ensureMatrixIntegrity();
    setDirty();
    render();
  }

  function deletePoint(index) {
    state.data.points.splice(index, 1);
    state.data.matrix.ids.splice(index, 1);
    state.data.matrix.rows.splice(index, 1);
    state.data.matrix.rows.forEach((row) => row.splice(index, 1));
    ensureMatrixIntegrity();
    setDirty();
    render();
  }

  function renderPoints() {
    const indexes = routeScopedIndexes();
    const html = `
      <div class="admin-grid admin-grid--split">
        <article class="card">
          <h3>Punkt hinzufügen</h3>
          <div class="admin-form">
            <div class="admin-note">
              Neue Punkte werden am Ende der aktuellen Route eingefügt. Danach kannst du sie mit ↑ und ↓ verschieben.
            </div>
            <button type="button" class="btn" id="addPointBtn">Neuen Punkt anlegen</button>
          </div>
        </article>
        <article class="card">
          <h3>Punkte</h3>
          <div class="admin-note">
            Reihenfolge der Zeilen entspricht der Reihenfolge im Bericht und der Matrix.
          </div>
          <div class="admin-table-wrap">
            <table class="admin-table admin-table--points">
              <thead>
                <tr>
                  <th>Zeit</th>
                  <th>Punkt / Kontakt</th>
                  <th>Ankunft / Route / Aktiv</th>
                  <th>Aktionen</th>
                </tr>
              </thead>
              <tbody>
                ${
                  indexes.length
                    ? indexes
                        .map((idx) => {
                          const p = state.data.points[idx];
                          return `
                            <tr class="admin-point-row" data-point-index="${idx}">
                              <td rowspan="2"><input type="time" data-field="arrival_time" value="${esc(p.arrival_time)}" title="Ankunftszeit" aria-label="Ankunftszeit" /></td>
                              <td>
                                <div class="admin-point-stack">
                                  <div class="admin-point-code">${esc(p.short_code || p.id)}</div>
                                  <input class="is-name" type="text" data-field="name" value="${esc(p.name)}" placeholder="Adresse / Punkt" />
                                  <input type="url" data-field="url" value="${esc(p.url)}" placeholder="Adress-Link: https://…" />
                                </div>
                              </td>
                              <td rowspan="2">
                                <div class="admin-point-stack">
                                  <select data-field="route">
                                    <option value="1"${p.route === "1" ? " selected" : ""}>Route 1</option>
                                    <option value="2"${p.route === "2" ? " selected" : ""}>Route 2</option>
                                  </select>
                                  <select data-field="active">
                                    <option value="1"${p.active === "1" ? " selected" : ""}>Aktiv: Ja</option>
                                    <option value="0"${p.active === "0" ? " selected" : ""}>Aktiv: Nein</option>
                                  </select>
                                </div>
                              </td>
                              <td rowspan="2">
                                <div class="admin-row-actions">
                                  <button type="button" class="btn" data-action="up">↑</button>
                                  <button type="button" class="btn" data-action="down">↓</button>
                                  <button type="button" class="btn" data-action="delete">Löschen</button>
                                </div>
                              </td>
                            </tr>
                            <tr class="admin-point-row admin-point-row--contact" data-point-index="${idx}">
                              <td>
                                <div class="admin-point-contact-fields">
                                  <input type="text" data-field="contact_name" value="${esc(p.contact_name || p.lehrling_name)}" placeholder="Lehrling" />
                                  <input type="tel" data-field="phone" value="${esc(p.phone)}" placeholder="Telefon: +43 …" />
                                  <input type="password" data-field="lehrling_pin" value="" inputmode="numeric" maxlength="4" placeholder="PIN (4 Ziffern)" />
                                  <span class="admin-pin-status">${p.lehrling_has_pin ? "PIN gesetzt" : "PIN nicht gesetzt"}</span>
                                </div>
                              </td>
                            </tr>
                          `;
                        })
                        .join("")
                    : `<tr><td colspan="4" class="admin-empty">Keine Punkte in dieser Ansicht.</td></tr>`
                }
              </tbody>
            </table>
          </div>
        </article>
      </div>
    `;

    dom.panels.points.innerHTML = html;

    const addBtn = document.getElementById("addPointBtn");
    addBtn?.addEventListener("click", addPoint);

    dom.panels.points.querySelectorAll("[data-point-index]").forEach((row) => {
      const index = Number(row.dataset.pointIndex);
      row.querySelectorAll("[data-field]").forEach((input) => {
        input.addEventListener("input", () => {
          const field = input.dataset.field;
          const value = input.value;
          if (field === "id") {
            state.data.points[index].id = value.trim();
            state.data.matrix.ids[index] = value.trim();
            ensureMatrixIntegrity();
          } else if (field === "name") {
            state.data.points[index][field] = value;
            if (state.data.points[index].auto_id && value.trim()) {
              const id = autoPointId(value, index);
              state.data.points[index].id = id;
              state.data.matrix.ids[index] = id;
              row.querySelector('[data-field="id"]').value = id;
            }
          } else {
            state.data.points[index][field] = value;
            if (field === "contact_name") state.data.points[index].lehrling_name = value;
          }
          setDirty();
          if (field === "route") render();
        });
        input.addEventListener("change", () => {
          if (input.dataset.field === "route") render();
        });
      });

      row.querySelectorAll("[data-action]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const action = btn.dataset.action;
          if (action === "up") movePoint(index, -1);
          if (action === "down") movePoint(index, 1);
          if (action === "delete") deletePoint(index);
        });
      });
    });
  }

  function renderMatrix() {
    const indexes = routeScopedIndexes();
    const ids = indexes.map((idx) => state.data.points[idx]?.id || "");

    if (!ids.length) {
      dom.panels.matrix.innerHTML = `<article class="card"><div class="admin-empty">Keine Punkte für diese Route.</div></article>`;
      return;
    }

    const header = ids.map((id) => `<th>${esc(id || "—")}</th>`).join("");
    const body = indexes
      .map((rowIdx, visibleRowIdx) => {
        const rowId = ids[visibleRowIdx];
        const cells = indexes
          .map((colIdx) => {
            const value = state.data.matrix.rows?.[rowIdx]?.[colIdx] ?? "";
            return `
              <td>
                <input
                  class="is-km"
                  type="number"
                  step="0.1"
                  data-row="${rowIdx}"
                  data-col="${colIdx}"
                  value="${esc(value)}"
                />
              </td>
            `;
          })
          .join("");

        return `<tr><th>${esc(rowId || "—")}</th>${cells}</tr>`;
      })
      .join("");

    dom.panels.matrix.innerHTML = `
      <article class="card">
        <h3>Matrix</h3>
        <div class="admin-note">
          Sichtbar sind nur Punkte der aktuellen Route. Änderungen werden in der globalen Matrix gespeichert.
        </div>
        <div class="admin-table-wrap">
          <table class="admin-table admin-table--matrix">
            <thead>
              <tr>
                <th>Von \ Nach</th>
                ${header}
              </tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      </article>
    `;

    dom.panels.matrix.querySelectorAll("input[data-row]").forEach((input) => {
      input.addEventListener("input", () => {
        const row = Number(input.dataset.row);
        const col = Number(input.dataset.col);
        const raw = input.value.trim();
        state.data.matrix.rows[row][col] =
          raw === "" ? "" : Number(raw.replace(",", "."));
        setDirty();
      });
    });
  }

  function renderDrivers() {
    dom.panels.drivers.innerHTML = `
      <article class="card">
        <div class="admin-table-actions">
          <h3>Fahrer</h3>
          <button type="button" class="btn" id="addDriverBtn">Fahrer hinzufügen</button>
        </div>
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Aktiv</th>
                <th>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              ${
                state.data.drivers.length
                  ? state.data.drivers
                      .map(
                        (d, index) => `
                          <tr data-driver-index="${index}">
                            <td><input class="is-id" type="text" data-field="id" value="${esc(d.id)}" /></td>
                            <td><input class="is-name" type="text" data-field="name" value="${esc(d.name)}" /></td>
                            <td>
                              <select data-field="active">
                                <option value="1"${d.active === "1" ? " selected" : ""}>Ja</option>
                                <option value="0"${d.active === "0" ? " selected" : ""}>Nein</option>
                              </select>
                            </td>
                            <td>
                              <div class="admin-row-actions">
                                <button type="button" class="btn" data-action="delete">Löschen</button>
                              </div>
                            </td>
                          </tr>
                        `
                      )
                      .join("")
                  : `<tr><td colspan="4" class="admin-empty">Keine Fahrer vorhanden.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </article>
    `;

    document.getElementById("addDriverBtn")?.addEventListener("click", () => {
      state.data.drivers.push({ id: "", name: "", active: "1" });
      setDirty();
      renderDrivers();
    });

    dom.panels.drivers.querySelectorAll("[data-driver-index]").forEach((row) => {
      const index = Number(row.dataset.driverIndex);
      row.querySelectorAll("[data-field]").forEach((input) => {
        input.addEventListener("input", () => {
          state.data.drivers[index][input.dataset.field] = input.value;
          setDirty();
        });
      });
      row.querySelector('[data-action="delete"]')?.addEventListener("click", () => {
        state.data.drivers.splice(index, 1);
        setDirty();
        renderDrivers();
      });
    });
  }

  function renderCars() {
    dom.panels.cars.innerHTML = `
      <article class="card">
        <div class="admin-table-actions">
          <h3>Autos</h3>
          <button type="button" class="btn" id="addCarBtn">Auto hinzufügen</button>
        </div>
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead>
              <tr>
                <th>CarId</th>
                <th>Kennzeichen</th>
                <th>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              ${
                state.data.cars.length
                  ? state.data.cars
                      .map(
                        (c, index) => `
                          <tr data-car-index="${index}">
                            <td><input class="is-id" type="text" data-field="id" value="${esc(c.id)}" /></td>
                            <td><input class="is-name" type="text" data-field="plate" value="${esc(c.plate)}" /></td>
                            <td>
                              <div class="admin-row-actions">
                                <button type="button" class="btn" data-action="delete">Löschen</button>
                              </div>
                            </td>
                          </tr>
                        `
                      )
                      .join("")
                  : `<tr><td colspan="3" class="admin-empty">Keine Autos vorhanden.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </article>
    `;

    document.getElementById("addCarBtn")?.addEventListener("click", () => {
      state.data.cars.push({ id: "", plate: "" });
      setDirty();
      renderCars();
    });

    dom.panels.cars.querySelectorAll("[data-car-index]").forEach((row) => {
      const index = Number(row.dataset.carIndex);
      row.querySelectorAll("[data-field]").forEach((input) => {
        input.addEventListener("input", () => {
          state.data.cars[index][input.dataset.field] = input.value;
          setDirty();
        });
      });
      row.querySelector('[data-action="delete"]')?.addEventListener("click", () => {
        state.data.cars.splice(index, 1);
        setDirty();
        renderCars();
      });
    });
  }

  let demoStudents = [
    ["oliver", "Oliver Kreuzer", "Schulgasse 25a", "1"],
    ["leon", "Leon Jocham", "Rainergasse 13", "1"],
    ["patrick", "Patrick Hasler", "Ostwerkgasse 8a", "1"],
    ["sebastian", "Sebastian Pirker", "Dinsendorferweg 5", "1"],
    ["marcel", "Marcel Feistl", "Hochwiesenweg 6", "1"],
    ["marie", "Marie Kaltenegger", "Pusterwald 22", "2"],
    ["fabian", "Fabian Gruber", "Falbweg 7c", "2"],
    ["elias", "Elias Führer", "Wiesenweg 15a", "2"],
    ["niklas", "Niklas Jocham", "Schwarzenbergsiedlung 47", "2"],
    ["jakob", "Jakob Pichler", "Mauterndorf 57", "2"],
    ["lukas", "Lukas Kaiser", "Zistl 9", "2"],
  ].map(([id, name, address, route]) => ({ id, name, address, route }));
  let scheduleBaseline = new Map();

  async function loadScheduleFixture() {
    try {
      const response = await fetch("../student-portal/data/schedule.json", { cache: "no-store" });
      const fixture = await response.json();
      const pointsById = new Map((fixture.points || []).map((point) => [point.id, point]));
      demoStudents = fixture.students.map((student) => ({
        ...(pointsById.get(student.pointId) || {}),
        ...student,
        id: student.id,
      }));
      scheduleBaseline = new Map(
        fixture.days.map((day) => [day.date, new Set(day.active || [])])
      );
      fixture.days.forEach((day) => {
        const active = new Set(day.active || []);
        fixture.students.forEach((student) => {
          const key = `${student.id}|${day.date}`;
          if (!state.schedule.values[key]) {
            state.schedule.values[key] = active.has(student.id) ? "both" : "none";
          }
        });
      });
    } catch (error) {
      console.warn("Schedule fixture unavailable; using demo data", error);
    }
  }

  async function loadLiveSchedule() {
    if (typeof window.loadLehrlingePlan !== "function") return false;
    try {
      const result = await window.loadLehrlingePlan(state.schedule.from, state.schedule.to);
      const liveStudents = state.data.points
        .filter((point) => point.lehrling_id && (point.lehrling_name || point.contact_name))
        .map((point) => ({
          id: point.lehrling_id,
          name: point.lehrling_name || point.contact_name,
          address: point.name,
          route: point.route,
          pointId: point.id,
        }));
      if (liveStudents.length) demoStudents = liveStudents;
      state.schedule.values = {};
      (result.items || []).forEach((item) => {
        state.schedule.values[`${item.student_id}|${item.date}`] = item.status;
      });
      state.schedule.holidays = new Set(result.holidays || []);
      state.schedule.dirty = false;
      return true;
    } catch (error) {
      console.warn("Live Fahrtenplan unavailable; using local fixture", error);
      return false;
    }
  }

  function scheduleDates() {
    const from = new Date(`${state.schedule.from}T12:00:00`);
    const to = new Date(`${state.schedule.to}T12:00:00`);
    const dates = [];
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return dates;
    for (const date = new Date(from); date <= to; date.setDate(date.getDate() + 1)) {
      const day = date.getDay();
      const key = date.toISOString().slice(0, 10);
      if (day !== 0 && day !== 6) dates.push(key);
    }
    return dates;
  }

  function scheduleStatus(studentId, date) {
    const key = `${studentId}|${date}`;
    if (state.schedule.values[key]) return state.schedule.values[key];
    const baseline = scheduleBaseline.get(date);
    return baseline ? (baseline.has(studentId) ? "both" : "none") : "both";
  }

  function scheduleLabel(status) {
    return { both: "Hin + zurück", out: "Nur hin", back: "Nur zurück", none: "Nicht eingeplant" }[status];
  }

  function scheduleShort(status) {
    return { both: "↔", out: "→", back: "←", none: "—" }[status];
  }

  function formatScheduleDate(key) {
    return new Date(`${key}T12:00:00`).toLocaleDateString("de-AT", {
      weekday: "short", day: "2-digit", month: "2-digit",
    });
  }

  function renderSchedule() {
    const dates = scheduleDates();
    const values = state.schedule.values;
    const visibleStudents = demoStudents.filter((student) =>
      (state.schedule.route === "all" || student.route === state.schedule.route) &&
      (state.schedule.student === "all" || student.id === state.schedule.student)
    );
    const summary = dates.reduce((out, date) => {
      visibleStudents.forEach((student) => {
        const status = scheduleStatus(student.id, date);
        if (status !== "none") out.passengers += 1;
        if (status === "out" || status === "both") out.out += 1;
        if (status === "back" || status === "both") out.back += 1;
      });
      return out;
    }, { passengers: 0, out: 0, back: 0 });

    dom.panels.schedule.innerHTML = `
      <article class="card schedule-preview">
        <div class="schedule-heading">
          <div>
            <div class="meta">Lokale Vorschau · noch nicht gespeichert</div>
            <h3>Fahrtenplan</h3>
            <p class="admin-note">Hier testen wir die spätere Verwaltung der Lehrlinge-Abmeldungen. Die bestehende Tabelle und Google Sheets werden nicht verändert.</p>
          </div>
          <div class="schedule-summary">
            <button type="button" class="btn schedule-print-button" id="schedulePrintBtn">PDF / Drucken</button>
            <span><strong>${summary.passengers}</strong> Buchungen</span>
            <span><strong>${summary.out}</strong> Hin</span>
            <span><strong>${summary.back}</strong> Zurück</span>
          </div>
        </div>

        <div class="schedule-controls">
          <div class="schedule-controls__title">Massenänderungen</div>
          <label>Route
            <select id="scheduleRoute">
              <option value="all"${state.schedule.route === "all" ? " selected" : ""}>Alle Routen</option>
              <option value="1"${state.schedule.route === "1" ? " selected" : ""}>Route 1</option>
              <option value="2"${state.schedule.route === "2" ? " selected" : ""}>Route 2</option>
            </select>
          </label>
          <label>Lehrling
            <select id="scheduleStudent">
              <option value="all"${state.schedule.student === "all" ? " selected" : ""}>Alle Lehrlinge</option>
              ${demoStudents.map((student) => `<option value="${student.id}"${state.schedule.student === student.id ? " selected" : ""}>${esc(student.name)}</option>`).join("")}
            </select>
          </label>
          <label>Von <input id="scheduleFrom" type="date" value="${esc(state.schedule.from)}"></label>
          <label>Bis <input id="scheduleTo" type="date" value="${esc(state.schedule.to)}"></label>
          <label class="schedule-check"><input id="scheduleWeekdays" type="checkbox" checked disabled> nur Werktage</label>
          <div class="schedule-controls__actions">
            <button type="button" class="btn" data-schedule-action="both">Hin + zurück</button>
            <button type="button" class="btn" data-schedule-action="out">Nur hin</button>
            <button type="button" class="btn" data-schedule-action="back">Nur zurück</button>
            <button type="button" class="btn" data-schedule-action="none">Keine Fahrt</button>
            <button type="button" class="btn" data-schedule-action="holiday">Als Ferien markieren</button>
            <button type="button" class="btn" data-schedule-action="schoolday">Ferien entfernen</button>
          </div>
        </div>

        <div class="schedule-legend">
          <span class="schedule-pill schedule-pill--both">↔ Hin + zurück</span>
          <span class="schedule-pill schedule-pill--out">→ Nur hin</span>
          <span class="schedule-pill schedule-pill--back">← Nur zurück</span>
          <span class="schedule-pill schedule-pill--none">— Nicht eingeplant</span>
          <span class="meta">Klick auf eine Zelle wechselt den Status.</span>
        </div>

        <div class="admin-table-wrap schedule-table-wrap">
          <table class="admin-table schedule-table">
            <thead><tr><th class="schedule-date-head">Datum</th>${visibleStudents.map((student) => `<th title="${esc(student.address)}"><strong class="schedule-name">${esc(student.name)}</strong><small class="schedule-address">${esc(student.address || "Adresse nicht hinterlegt")}</small><small>Route ${esc(student.route || "—")}</small></th>`).join("")}</tr></thead>
            <tbody>
              ${dates.map((date) => `<tr><th class="schedule-date"><strong>${formatScheduleDate(date)}</strong><small>${state.schedule.holidays.has(date) ? "Ferien" : "Schultag"}</small></th>${visibleStudents.map((student) => {
                const status = scheduleStatus(student.id, date);
                return `<td><button type="button" class="schedule-cell schedule-cell--${status}" data-student="${student.id}" data-date="${date}" title="${scheduleLabel(status)}">${scheduleShort(status)}<small>${status === "both" ? "beide" : status === "out" ? "hin" : status === "back" ? "zurück" : "frei"}</small></button></td>`;
              }).join("")}</tr>`).join("")}
            </tbody>
          </table>
        </div>
      </article>
    `;

    dom.panels.schedule.querySelector("#schedulePrintBtn")?.addEventListener("click", () => window.print());
    dom.panels.schedule.querySelector("#scheduleFrom").addEventListener("change", async (event) => {
      state.schedule.from = event.target.value;
      renderSchedule();
      await loadLiveSchedule();
      renderSchedule();
    });
    dom.panels.schedule.querySelector("#scheduleTo").addEventListener("change", async (event) => {
      state.schedule.to = event.target.value;
      renderSchedule();
      await loadLiveSchedule();
      renderSchedule();
    });
    dom.panels.schedule.querySelector("#scheduleRoute").addEventListener("change", (event) => {
      state.schedule.route = event.target.value;
      renderSchedule();
    });
    dom.panels.schedule.querySelector("#scheduleStudent").addEventListener("change", (event) => {
      state.schedule.student = event.target.value;
      renderSchedule();
    });
    dom.panels.schedule.querySelectorAll("[data-schedule-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.scheduleAction;
        dates.forEach((date) => {
          if (action === "holiday") {
            state.schedule.holidays.add(date);
            visibleStudents.forEach((student) => { values[`${student.id}|${date}`] = "none"; });
          } else if (action === "schoolday") {
            state.schedule.holidays.delete(date);
            visibleStudents.forEach((student) => { values[`${student.id}|${date}`] = "both"; });
          } else {
            visibleStudents.forEach((student) => { values[`${student.id}|${date}`] = action; });
          }
        });
        state.schedule.dirty = true;
        setDirty();
        renderSchedule();
      });
    });
    dom.panels.schedule.querySelectorAll("[data-student][data-date]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = `${button.dataset.student}|${button.dataset.date}`;
        const order = ["both", "out", "back", "none"];
        values[key] = order[(order.indexOf(values[key] || "both") + 1) % order.length];
        state.schedule.dirty = true;
        setDirty();
        renderSchedule();
      });
    });
  }

  function render() {
    renderStatus();
    if (state.activeTab === "points") renderPoints();
    if (state.activeTab === "matrix") renderMatrix();
    if (state.activeTab === "drivers") renderDrivers();
    if (state.activeTab === "cars") renderCars();
    if (state.activeTab === "schedule") renderSchedule();
  }

  async function load() {
    dom.statusText.textContent = "Lade Daten…";
    try {
      await loadScheduleFixture();
      const data = await window.loadAdminData();
      state.data = normalizeData(data);
      ensureMatrixIntegrity();
      await loadLiveSchedule();
      setDirty(false);
      renderStatus("Daten geladen");
      render();
    } catch (err) {
      if (isAuthError(err)) {
        window.logoutAdmin();
        setAuthenticated(false);
        setAuthStatus("Sitzung abgelaufen. Bitte erneut einloggen.");
      }
      throw err;
    }
  }

  async function save() {
    state.saving = true;
    renderStatus("Speichere Änderungen…");
    try {
      ensureMatrixIntegrity();
      await window.saveAdminData(state.data);
      if (state.schedule.dirty && typeof window.saveLehrlingePlan === "function") {
        const rows = Object.entries(state.schedule.values).map(([key, status]) => {
          const separator = key.indexOf("|");
          return { student_id: key.slice(0, separator), date: key.slice(separator + 1), status };
        });
        await window.saveLehrlingePlan({
          rows,
          holidays: Array.from(state.schedule.holidays),
        });
        state.schedule.dirty = false;
      }
      state.data.points.forEach((point) => { point.lehrling_pin = ""; });
      state.dirty = false;
      renderStatus("Änderungen gespeichert");
      render();
    } catch (err) {
      console.error("admin save failed", err);
      if (isAuthError(err)) {
        window.logoutAdmin();
        setAuthenticated(false);
        setAuthStatus("Sitzung abgelaufen. Bitte erneut einloggen.");
      }
      renderStatus(`Fehler beim Speichern: ${err?.message || err}`);
      alert(`Fehler beim Speichern: ${err?.message || err}`);
    } finally {
      state.saving = false;
      renderStatus();
    }
  }

  async function handleLogin(password) {
    dom.loginBtn.disabled = true;
    setAuthStatus("Pruefe Passwort…");
    try {
      await window.loginAdmin(password);
      setAuthenticated(true);
      await load();
      setAuthStatus("Eingeloggt");
    } catch (err) {
      console.error("admin login failed", err);
      window.logoutAdmin();
      setAuthenticated(false);
      setAuthStatus(`Login fehlgeschlagen: ${err?.message || err}`);
      alert(`Login fehlgeschlagen: ${err?.message || err}`);
    } finally {
      dom.loginBtn.disabled = false;
    }
  }

  async function bootstrap() {
    if (!window.getAdminToken()) {
      setAuthenticated(false);
      return;
    }

    try {
      await loadScheduleFixture();
      setAuthenticated(true);
      await load();
      setAuthStatus("Eingeloggt");
    } catch (err) {
      console.error("admin bootstrap failed", err);
      window.logoutAdmin();
      setAuthenticated(false);
      setAuthStatus("Sitzung abgelaufen. Bitte erneut einloggen.");
    }
  }

  dom.tabs.forEach((btn) =>
    btn.addEventListener("click", () => setTab(btn.dataset.tab))
  );
  dom.routeFilter.addEventListener("change", () => {
    state.routeFilter = dom.routeFilter.value;
    render();
  });
  dom.reloadBtn.addEventListener("click", () => {
    if (state.dirty && !window.confirm("Ungespeicherte Änderungen verwerfen und neu laden?")) {
      return;
    }
    load().catch((err) => {
      console.error("admin load failed", err);
      renderStatus(`Fehler beim Laden: ${err?.message || err}`);
    });
  });
  dom.saveBtn.addEventListener("click", save);
  dom.logoutBtn.addEventListener("click", () => {
    if (state.dirty && !window.confirm("Ungespeicherte Aenderungen verwerfen und ausloggen?")) {
      return;
    }
    window.logoutAdmin();
    setDirty(false);
    setAuthenticated(false);
    setAuthStatus("Abgemeldet");
  });
  dom.loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const password = dom.passwordInput.value;
    handleLogin(password);
  });

  window.addEventListener("beforeunload", (e) => {
    if (!state.dirty) return;
    e.preventDefault();
    e.returnValue = "";
  });

  setAuthenticated(false);
  bootstrap();
});
