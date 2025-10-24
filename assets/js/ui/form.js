import { Api } from "../api.js";
import {
  todayISO,
  buildTimeOptionsHTML,
  normalizeTimeLoose,
} from "../utils/time.js";

export function initForm({ onCreated }) {
  const f = document.getElementById("f");
  const out = document.getElementById("out");

  // Standardwerte
  f.elements.date.value = todayISO();
  f.elements.type.addEventListener("change", () => {
    const dur = f.elements["duration_min"];
    if (f.elements.type.value === "KT") {
      dur.value = 120;
      dur.step = "1";
    } else {
      dur.value = 15;
      dur.step = "1";
    }
  });
  f.elements.type.dispatchEvent(new Event("change"));

  // Datalist für Zeit + weiche Normalisierung
  const timeInput = document.getElementById("time");
  const datalist = document.getElementById("time5");
  datalist.innerHTML = buildTimeOptionsHTML();
  timeInput.addEventListener("blur", () => {
    timeInput.value = normalizeTimeLoose(timeInput.value);
  });

  // === Automatische Markierung des Inhalts beim Fokus (input/textarea) ===
  document.querySelectorAll("input, textarea").forEach((el) => {
    el.addEventListener("focus", function () {
      setTimeout(() => {
        try {
          if (typeof this.select === "function") this.select();
          else if (this.setSelectionRange)
            this.setSelectionRange(0, (this.value || "").length);
        } catch (_) {}
      }, 0);
    });
    // Klick der Maus entfernt die Auswahl nicht sofort
    el.addEventListener("mouseup", (e) => e.preventDefault());
  });

  // Submit
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    timeInput.value = normalizeTimeLoose(timeInput.value);

    const fd = new FormData(f);
    const data = Object.fromEntries(fd.entries());
    data.phone = (data.phone || "").trim();

    const res = await Api.createOrder(data).catch((err) => ({
      ok: false,
      error: String(err),
    }));
    if (!res.ok) {
      out.innerHTML = `<div class="item">Fehler: ${
        res.error || "Netzwerkfehler"
      }</div>`;
      return;
    }

    const { id, conflicts, gcal_event_id } = res.data;
    const warn =
      conflicts && conflicts.length
        ? `<div class="item">Überschneidungen: ${conflicts.length}. Bitte Kalender prüfen.</div>`
        : "";
    out.innerHTML = `<div class="item"><h4>Bestellung Nr.${id} gespeichert</h4>
      <div class="sub">Ereignis: <code>${gcal_event_id}</code> — <a target="_blank" href="https://calendar.google.com/calendar/u/0/r/eventedit/${gcal_event_id}">Im Kalender öffnen</a></div>${warn}</div>`;

    localStorage.setItem("lastOrder", JSON.stringify(data));
    onCreated?.();
  });

  document.getElementById("repeatLast").addEventListener("click", () => {
    const last = JSON.parse(localStorage.getItem("lastOrder") || "{}");
    for (const [k, v] of Object.entries(last)) {
      if (k === "date" || k === "time") continue;
      if (f.elements[k]) f.elements[k].value = v;
    }
    f.elements.type.dispatchEvent(new Event("change"));
    if (!timeInput.value) timeInput.value = "08:00";
  });

  function fillForm({ date, time, type, duration_min, phone, message }) {
    if (date) f.elements.date.value = date;
    if (time) timeInput.value = normalizeTimeLoose(time);
    if (type) f.elements.type.value = type;
    if (duration_min) f.elements.duration_min.value = duration_min;
    if (phone !== undefined) f.elements.phone.value = phone || "";
    if (message !== undefined) f.elements.message.value = message || "";
    f.elements.type.dispatchEvent(new Event("change"));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return { fillForm };
}
