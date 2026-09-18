// assets/js/recent.js
document.addEventListener("DOMContentLoaded", () => {
  const listEl = document.getElementById("list") || document.body;
  const nowEl = document.getElementById("now");
  const fFrom = document.getElementById("f_from");
  const fTo = document.getElementById("f_to");
  const fRoute = document.getElementById("f_route"); // фильтр по маршруту
  const fShift = document.getElementById("f_shift"); // фильтр по времени (Früh/Nachmittag)
  const apply = document.getElementById("apply");
  const statusEl = document.getElementById("reportStatus");
  const deleteDialog = document.getElementById("deleteReportDialog");
  const deleteText = document.getElementById("deleteReportText");
  const deleteError = document.getElementById("deleteReportError");
  const deleteClose = document.getElementById("deleteReportClose");
  const deleteConfirm = document.getElementById("deleteReportConfirm");
  const editDialog = document.getElementById("editReportDialog");
  const editForm = document.getElementById("editReportForm");
  const editDate = document.getElementById("editReportDate");
  const editShift = document.getElementById("editReportShift");
  const editRoute = document.getElementById("editReportRoute");
  const editError = document.getElementById("editReportError");
  const editClose = document.getElementById("editReportClose");
  const editSave = document.getElementById("editReportSave");
  let pendingDeletion = null;
  let pendingEdit = null;
  let canManageReports = false;
  let loadVersion = 0;
  const unavailableMessage = "Bearbeiten und Löschen sind erst nach Aktualisierung des GAS-Web-Apps verfügbar.";
  if (!getDriverSession()) {
    statusEl.innerHTML = 'Zum Löschen von Duplikaten bitte zuerst auf der <a href="../main/index.html">Startseite</a> als Fahrer anmelden.';
  }

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

  /* ===== по умолчанию: последние 2 дня ===== */
  const today = new Date();
  const yest = new Date(today);
  yest.setDate(today.getDate() - 1);
  const toISO = (d) =>
    new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10);
  if (!fFrom.value) fFrom.value = toISO(yest);
  if (!fTo.value) fTo.value = toISO(today);

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

  function normalizeSeq(v) {
    if (v == null) return "";
    const text = String(v).replace(/\r\n?/g, "\n").trim();
    if (text.includes("\n")) return text;
    return text
      .split(/(?:\s*>\s*|\s*-\s*)+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .join("\n");
  }

  // сортировка смен: сначала Nachmittag, затем Früh
  const shiftRank = (s) => {
    const t = String(s || "").toLowerCase();
    if (t.startsWith("nach")) return 0;
    if (t.startsWith("fr")) return 1;
    return 2;
  };

  // проверка попадания смены под фильтр
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

  /* ===== загрузка и рендер ===== */
  async function loadAndRender() {
    const version = ++loadVersion;
    listEl.innerHTML = '<p class="meta">Lade…</p>';
    try {
      const from = fFrom.value || "";
      const to = fTo.value || "";
      const routeValue = fRoute?.value || ""; // "","1","2",…
      const shiftValue = fShift?.value || ""; // "","Früh","Nachmittag"

      const [items, capabilities] = await Promise.all([
        API.getRecentSubmissions({
          from,
          to,
          limit: 10000,
          route: routeValue || "",
        }),
        getReportManagementCapabilities().catch(() => null),
      ]);
      if (version !== loadVersion) return;
      canManageReports = capabilities?.edit === true && capabilities?.deleteDuplicate === true && capabilities?.deleteMode === "mark";
      if (getDriverSession() && !canManageReports) {
        statusEl.textContent = unavailableMessage;
      } else if (statusEl.textContent === unavailableMessage) {
        statusEl.textContent = "";
      }

      const fromD = from ? startOfDay(asDate(from)) : null;
      const toD = to ? endOfDay(asDate(to)) : null;
      const dateOf = (r) => asDate(r.report_date) || asDate(r.timestamp);

      const filteredRows = (Array.isArray(items) ? items : [])
        .filter((r) => {
          const d = dateOf(r);
          if (!d) return false;
          if (fromD && d < fromD) return false;
          if (toD && d > toD) return false;
          if (routeValue && String(r.route) !== String(routeValue))
            return false;
          if (fShift && !matchShift(r.shift, shiftValue)) return false;
          return true;
        })
        .sort((a, b) => {
          const da = dateOf(a),
            db = dateOf(b);
          if (db - da !== 0) return db - da; // дата (убыв.)
          const sr = shiftRank(a.shift) - shiftRank(b.shift);
          if (sr !== 0) return sr; // смена: N > F
          const ra = Number(a.route) || 9999,
            rb = Number(b.route) || 9999;
          return ra - rb; // Route (возр.)
        });

      const rows = filteredRows;

      if (!rows.length) {
        listEl.innerHTML = '<p style="opacity:.7">Keine Einträge</p>';
        return;
      }

      listEl.innerHTML = rows
        .map((r, idx) => {
          try {
            const repDate = dateOf(r);
            const dateStr = repDate ? repDate.toLocaleDateString("de-AT") : "—";
            const shiftTxt = (r.shift ?? "").toString().trim();
            const km = safeNum(r.total_km).toFixed(1);
            const routeTxt = (r.route ?? "—").toString().trim();

            let seqBlock = "";
            if (r.sequence_names) {
              const text = normalizeSeq(r.sequence_names);
              if (text) {
                seqBlock = `<div class="meta" style="margin-top:8px; white-space:pre-line;">${esc(
                  text
                )}</div>`;
              }
            }

            const carText = r.car_plate || r.car_id || "—";
            const editTime = asDate(r.edited_at);
            const editDay = editTime?.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit" }).replace(/\.$/, "");
            const editHour = editTime?.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
            const editLabel = `${r.edited_by_driver_name || ""}${editTime ? ` · ${editDay} · ${editHour}` : ""}`;
            const editFullLabel = `Bearbeitet von ${r.edited_by_driver_name || ""}${editTime ? ` am ${editTime.toLocaleDateString("de-AT")} um ${editHour}` : ""}`;
            const editNote = r.edited_by_driver_name
              ? `<div class="report-edited" aria-label="${esc(editFullLabel)}" title="${esc(editFullLabel)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z"/><path d="m14.5 7.5 3 3"/></svg><span class="report-edited__text">${esc(editLabel)}</span></div>`
              : "";
            const reportKey = [toISO(repDate), shiftTxt.toLowerCase(), routeTxt].join("|");

            return `
              <article class="card${r.duplicate ? " is-duplicate" : ""}" role="listitem" aria-label="Bericht">
                <h3>${esc(dateStr)} • ${esc(shiftTxt || "—")} • Route ${esc(
              routeTxt
            )}</h3>
                ${r.duplicate ? `<span class="duplicate-label">Duplikat (${esc(r.duplicate_count)} Berichte) · bitte prüfen</span>` : ""}
            
                <div class="meta" style="border-bottom:1px solid rgba(0,0,0,0.15);padding-bottom:4px;margin-bottom:8px;">
                  № ${esc(r.row_num)}
                  • ${esc(r.driver_name || "—")}
                  • Auto: ${esc(carText)}
                  • ${esc(km)} km
                </div>
                ${editNote}
            
                ${seqBlock}
                ${canManageReports && getDriverSession() ? `<div class="report-actions"><button class="btn report-edit" type="button" data-row="${esc(r.row_num)}" data-timestamp="${esc(asDate(r.timestamp)?.getTime() ?? "")}" data-key="${esc(reportKey)}" data-date="${esc(toISO(repDate))}" data-shift="${esc(shiftTxt)}" data-route="${esc(routeTxt)}" aria-label="Bericht Nr. ${esc(r.row_num)} bearbeiten" title="Bericht bearbeiten"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z"/><path d="m14.5 7.5 3 3"/></svg></button>${r.duplicate ? `<button class="btn report-delete" type="button" data-row="${esc(r.row_num)}" data-timestamp="${esc(asDate(r.timestamp)?.getTime() ?? "")}" aria-label="Bericht Nr. ${esc(r.row_num)} zur Löschung markieren" title="Zur Löschung markieren"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m3 0-1 15H6L5 6m5 4v7m4-7v7"/></svg></button>` : ""}</div>` : ""}
              </article>
            `;
          } catch (err) {
            console.error("Render item failed at index", idx, err, r);
            return "";
          }
        })
        .join("");
    } catch (e) {
      if (version !== loadVersion) return;
      console.error("recent error:", e);
      listEl.innerHTML = '<p style="color:#b00">Fehler beim Laden</p>';
    }
  }

  apply.addEventListener("click", loadAndRender);
  listEl.addEventListener("click", (event) => {
    const editButton = event.target.closest(".report-edit");
    if (editButton) {
      pendingEdit = { row: editButton.dataset.row, timestamp: editButton.dataset.timestamp, expectedKey: editButton.dataset.key };
      editDate.value = editButton.dataset.date;
      editShift.value = editButton.dataset.shift;
      editRoute.value = editButton.dataset.route;
      editError.hidden = true;
      editError.textContent = "";
      editDialog.showModal();
      return;
    }
    const button = event.target.closest(".report-delete");
    if (!button) return;
    const card = button.closest(".card");
    const title = card?.querySelector("h3")?.textContent || "diesen Bericht";
    pendingDeletion = { row: button.dataset.row, timestamp: button.dataset.timestamp, button };
    deleteText.textContent = `Bericht ${title} (Nr. ${button.dataset.row}) zur Löschung markieren und aus den Berichten ausblenden? Die Markierung kann in der Tabelle entfernt werden.`;
    deleteError.hidden = true;
    deleteError.textContent = "";
    deleteDialog.showModal();
  });
  deleteClose.addEventListener("click", () => deleteDialog.close());
  deleteDialog.addEventListener("cancel", (event) => {
    if (deleteConfirm.disabled) event.preventDefault();
  });
  deleteDialog.addEventListener("close", () => { pendingDeletion = null; });
  deleteConfirm.addEventListener("click", async () => {
    if (!pendingDeletion) return;
    const { row, timestamp, button } = pendingDeletion;
    deleteConfirm.disabled = true;
    deleteClose.disabled = true;
    deleteConfirm.textContent = "Wird markiert…";
    try {
      await deleteDuplicateReport(row, timestamp);
      deleteDialog.close();
      statusEl.textContent = "Bericht zur Löschung markiert und ausgeblendet.";
      await loadAndRender();
    } catch (error) {
      deleteError.textContent = "Löschen fehlgeschlagen: " + (error.message || error);
      deleteError.hidden = false;
      if (String(error.message || error).includes("driver_auth_required")) {
        localStorage.removeItem("mt:driver-session");
        deleteDialog.close();
        statusEl.innerHTML = 'Die Fahreranmeldung ist abgelaufen. Bitte auf der <a href="../main/index.html">Startseite</a> erneut anmelden.';
        await loadAndRender();
      }
      button.disabled = false;
    } finally {
      deleteConfirm.disabled = false;
      deleteClose.disabled = false;
      deleteConfirm.textContent = "Ja, markieren";
    }
  });
  editClose.addEventListener("click", () => editDialog.close());
  editDialog.addEventListener("cancel", (event) => {
    if (editSave.disabled) event.preventDefault();
  });
  editDialog.addEventListener("close", () => { pendingEdit = null; });
  editForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!pendingEdit) return;
    const { row, timestamp, expectedKey } = pendingEdit;
    editSave.disabled = true;
    editClose.disabled = true;
    editSave.textContent = "Speichert…";
    try {
      await editReport(row, timestamp, expectedKey, {
        reportDate: editDate.value,
        shift: editShift.value,
        route: editRoute.value,
      });
      editDialog.close();
      statusEl.textContent = "Bericht gespeichert.";
      await loadAndRender();
    } catch (error) {
      editError.textContent = "Speichern fehlgeschlagen: " + (error.message || error);
      editError.hidden = false;
      if (String(error.message || error).includes("driver_auth_required")) {
        localStorage.removeItem("mt:driver-session");
        editDialog.close();
        statusEl.innerHTML = 'Die Fahreranmeldung ist abgelaufen. Bitte auf der <a href="../main/index.html">Startseite</a> erneut anmelden.';
        await loadAndRender();
      }
    } finally {
      editSave.disabled = false;
      editClose.disabled = false;
      editSave.textContent = "Speichern";
    }
  });
  loadAndRender();
});
