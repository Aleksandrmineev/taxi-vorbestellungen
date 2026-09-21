/* plan-selection.js — Vorauswahl der Punkte laut Fahrtenplan.
 * Statt der Punkte des letzten Berichts werden die Punkte angehakt, die im nächsten Fahrtenplan
 * für die Route stehen (Früh = Hinfahrt, Nachmittag = Rückfahrt). */
(function () {
  const DIRECTION_BY_SHIFT = { "Früh": "morning", "Nachmittag": "evening" };

  function directionForShift(shift) {
    return DIRECTION_BY_SHIFT[String(shift || "")] || "morning";
  }

  // days: Antwort von /api/lehrlinge/schedule (aufsteigend nach Datum); points: Punkte der Route auf der Seite.
  // Rückgabe: { ids: Set<String>, date, direction } oder null, wenn es keinen passenden Plan gibt.
  function planPointSelection({ days, route, points, direction, today }) {
    const ordered = (Array.isArray(days) ? days : [])
      .filter((day) => day && day.date && (!today || day.date >= today))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    for (const day of ordered) {
      const entries = (day.routes || []).filter((entry) => String(entry.route) === String(route));
      if (!entries.length) continue;
      // bevorzugt die passende Fahrtrichtung, sonst die andere (besser als gar keine Vorauswahl)
      const preferred = entries.filter((entry) => entry.direction === direction);
      const chosen = preferred.length ? preferred : entries;
      const planIds = new Set();
      chosen.forEach((entry) => (entry.points || []).forEach((point) => planIds.add(String(point.pointId))));

      const ids = new Set();
      (Array.isArray(points) ? points : []).forEach((point) => {
        if (planIds.has(String(point.id)) || (point.storage_id != null && planIds.has(String(point.storage_id)))) {
          ids.add(String(point.id));
        }
      });
      if (ids.size) return { ids, date: day.date, direction: preferred.length ? direction : chosen[0].direction };
    }
    return null;
  }

  window.PlanSelection = { planPointSelection, directionForShift };
})();
