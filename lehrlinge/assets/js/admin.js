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
  };

  const dom = {
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

  function normalizeData(raw) {
    const points = Array.isArray(raw?.points)
      ? raw.points.map((p) => ({
          id: String(p?.id || "").trim(),
          name: String(p?.name || ""),
          route: String(p?.route || "1"),
          active: String(p?.active || "") === "1" ? "1" : "0",
        }))
      : [];

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

  function addPoint() {
    const route = state.routeFilter === "all" ? "1" : state.routeFilter;
    const insertAt = (() => {
      const indexes = routeScopedIndexes();
      return indexes.length ? indexes[indexes.length - 1] + 1 : state.data.points.length;
    })();
    const draft = {
      id: "",
      name: "",
      route,
      active: "1",
    };

    state.data.points.splice(insertAt, 0, draft);

    state.data.matrix.ids.splice(insertAt, 0, "");
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
            <table class="admin-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Route</th>
                  <th>Aktiv</th>
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
                            <tr data-point-index="${idx}">
                              <td><input class="is-id" type="text" data-field="id" value="${esc(p.id)}" /></td>
                              <td><input class="is-name" type="text" data-field="name" value="${esc(p.name)}" /></td>
                              <td>
                                <select data-field="route">
                                  <option value="1"${p.route === "1" ? " selected" : ""}>1</option>
                                  <option value="2"${p.route === "2" ? " selected" : ""}>2</option>
                                </select>
                              </td>
                              <td>
                                <select data-field="active">
                                  <option value="1"${p.active === "1" ? " selected" : ""}>Ja</option>
                                  <option value="0"${p.active === "0" ? " selected" : ""}>Nein</option>
                                </select>
                              </td>
                              <td>
                                <div class="admin-row-actions">
                                  <button type="button" class="btn" data-action="up">↑</button>
                                  <button type="button" class="btn" data-action="down">↓</button>
                                  <button type="button" class="btn" data-action="delete">Löschen</button>
                                </div>
                              </td>
                            </tr>
                          `;
                        })
                        .join("")
                    : `<tr><td colspan="5" class="admin-empty">Keine Punkte in dieser Ansicht.</td></tr>`
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
          } else {
            state.data.points[index][field] = value;
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

  function render() {
    renderStatus();
    if (state.activeTab === "points") renderPoints();
    if (state.activeTab === "matrix") renderMatrix();
    if (state.activeTab === "drivers") renderDrivers();
    if (state.activeTab === "cars") renderCars();
  }

  async function load() {
    dom.statusText.textContent = "Lade Daten…";
    const data = await window.loadAdminData();
    state.data = normalizeData(data);
    ensureMatrixIntegrity();
    setDirty(false);
    renderStatus("Daten geladen");
    render();
  }

  async function save() {
    state.saving = true;
    renderStatus("Speichere Änderungen…");
    try {
      ensureMatrixIntegrity();
      await window.saveAdminData(state.data);
      state.dirty = false;
      renderStatus("Änderungen gespeichert");
      render();
    } catch (err) {
      console.error("admin save failed", err);
      renderStatus(`Fehler beim Speichern: ${err?.message || err}`);
      alert(`Fehler beim Speichern: ${err?.message || err}`);
    } finally {
      state.saving = false;
      renderStatus();
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

  window.addEventListener("beforeunload", (e) => {
    if (!state.dirty) return;
    e.preventDefault();
    e.returnValue = "";
  });

  load().catch((err) => {
    console.error("admin load failed", err);
    renderStatus(`Fehler beim Laden: ${err?.message || err}`);
  });
});
