import { Api } from "../api.js?v=20260904-3";
import { pad2, dateForRepeat, hhmmFromISO, formatDateFromISO } from "../utils/time.js";
import { telHref } from "../utils/phone.js";
import { promptReason } from "./dialog.js";

export function initTodoList({ fillForm }) {
  const todoList = document.getElementById("todoList");
  const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  const formatUntil = (value) => {
    const date = new Date(value);
    if (isNaN(date.getTime())) return String(value).slice(0, 10);
    return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.${date.getFullYear()}`;
  };
  const formatListDate = (iso) => {
    const date = new Date(iso);
    const human = formatDateFromISO(iso);
    const today = new Date();
    return date.toDateString() === today.toDateString() ? `Heute ${human}` : human;
  };
  const removeRow = (el) => { el.style.opacity = "0"; el.style.transform = "translateY(4px)"; setTimeout(() => el.remove(), 220); };

  async function load(hours = 24 * 366) {
    todoList.innerHTML = '<div class="item">Laden…</div>';
    const res = await Api.todos(hours).catch((err) => ({ ok: false, error: String(err) }));
    if (!res.ok) { todoList.innerHTML = `<div class="item">Fehler: ${esc(res.error)}</div>`; return; }
    const items = (res.items || []).filter((it) => it.status !== "done" && it.status !== "cancelled").sort((a, b) => new Date(a.start_iso) - new Date(b.start_iso));
    // Eine wiederkehrende Serie wird als eine Zeile dargestellt. So bleibt
    // sie sichtbar und zeigt immer den nächsten noch offenen Termin.
    const grouped = new Map();
    items.forEach((it) => {
      const key = it.series_id ? `series:${it.series_id}` : `order:${it.order_id || it.id}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(it);
    });
    const visible = [...grouped.values()].map((group) => {
      const item = group[0];
      return Object.assign({}, item, { _seriesCount: group.length });
    });
    let lastDate = "";
    todoList.innerHTML = visible.map((it) => {
      const date = formatListDate(it.start_iso);
      const heading = date !== lastDate ? `<h3 class="order-date-heading">${esc(date)}</h3>` : "";
      lastDate = date;
      const st = new Date(it.start_iso);
      const time = `${pad2(st.getHours())}:${pad2(st.getMinutes())}`;
      const { display, href } = telHref(it.phone);
      const phone = display ? `<a href="${esc(href)}">${esc(display)}</a>` : "Ohne Telefonnummer";
      const repeat = it.rrule ? `${it.rrule === "DAILY" ? "Jeden Tag" : it.rrule === "BIWEEKLY" ? "Alle 2 Wochen" : "Jede Woche"}${it.until ? ` · bis ${formatUntil(it.until)}` : ""}` : "";
      const secondary = [it.message || "Keine Adresse / Notiz", it.type || "Bestellung", `${it.duration_min || 0} Min.`, repeat].filter(Boolean).join(" · ");
      return `${heading}<div class="order-row item" data-order-id="${esc(it.order_id || "")}" data-series-id="${esc(it.series_id || "")}" data-type="${esc(it.type || "Orts")}" data-dur="${esc(it.duration_min || "15")}" data-phone="${esc(display || "")}" data-message="${esc(it.message || "")}" data-rrule="${esc(it.rrule || "")}" data-until="${esc(it.until || "")}" data-start="${esc(it.start_iso)}"><div class="order-row__info"><div class="order-row__primary"><strong class="order-row__time">${esc(time)}</strong><span class="order-row__phone">${phone}</span></div><div class="order-row__secondary">${esc(secondary)}</div></div><div class="order-row__actions"><button class="order-action todo-repeat" type="button" title="Als neue Vorbestellung kopieren" aria-label="Kopieren"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0 2 2v10a2 2 0 0 1-2 2H8" fill="none" stroke="currentColor" stroke-width="1.7"/></svg><small>Kopieren</small></button><button class="order-action todo-cancel" type="button" title="Vorbestellung stornieren" aria-label="Stornieren"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg><small>Stornieren</small></button></div></div>`;
    }).join("") || '<div class="item">Keine aktiven Vorbestellungen.</div>';
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
    todoList.querySelectorAll(".order-row[data-start]").forEach((row) => {
      if ((row.dataset.start || "").slice(0, 10) === todayKey) row.classList.add("order-row--today");
    });
  }
  todoList.addEventListener("click", async (event) => {
    const btn = event.target.closest("button");
    const item = btn?.closest(".order-row");
    const row = event.target.closest(".order-row");
    if (!row) return;
    if (!btn) {
      const start = row.dataset.start || "";
      fillForm({ id: row.dataset.orderId, date: start.slice(0, 10), time: hhmmFromISO(start), type: row.dataset.type, duration_min: row.dataset.dur, phone: row.dataset.phone, message: row.dataset.message, rrule: row.dataset.rrule, until: row.dataset.until });
      return;
    }
    if (!item) return;
    if (btn.classList.contains("todo-repeat")) { fillForm({ date: dateForRepeat(item.dataset.start), time: hhmmFromISO(item.dataset.start), type: item.dataset.type, duration_min: item.dataset.dur, phone: item.dataset.phone, message: item.dataset.message }); return; }
    if (!btn.classList.contains("todo-cancel") || !item.dataset.orderId) return;
    const seriesId = item.dataset.seriesId || "";
    const reason = await promptReason({
      title: "Bestellung stornieren",
      message: seriesId ? "Was soll storniert werden?" : "Grund (optional):",
      placeholder: "z. B. Kunde hat abgesagt …",
      okText: "Stornieren",
      reasons: seriesId ? ["Nur diesen Auftrag stornieren", "Alle Aufträge dieser Serie stornieren"] : undefined,
    });
    if (reason === null) return;
    const allSeries = reason === "Alle Aufträge dieser Serie stornieren";
    const result = await Api.updateStatus(item.dataset.orderId, "cancelled", seriesId ? "Serie storniert" : reason, allSeries).catch((err) => ({ ok: false, error: String(err) }));
    if (result.ok) removeRow(item);
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  return { load };
}
