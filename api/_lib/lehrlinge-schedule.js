// Порт getLehrlingeDriverSchedule_ / getLehrlingeDriverStudents_ / getLehrlingeDriverStudentPlan_
// из source/lehrlinge_plan.gs. Работает на снапшоте из Redis, без обращения к Google Sheets.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function weekdaysBetween(from, to) {
  const start = String(from || "").trim();
  const end = String(to || "").trim();
  if (!DATE_RE.test(start) || !DATE_RE.test(end) || start > end) return [];
  const result = [];
  const cursor = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (cursor <= last) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function pointIndexById(snapshot) {
  const map = new Map();
  (snapshot.points || []).forEach((point) => map.set(String(point.id || "").trim(), point));
  return map;
}

export function getDriverStudents(snapshot) {
  const points = pointIndexById(snapshot);
  return (snapshot.students || [])
    .filter((student) => student.id && String(student.active) === "1")
    .map((student) => {
      const point = points.get(student.pointId) || {};
      const result = { id: student.id, name: student.name, pointId: student.pointId };
      if (point.id) {
        result.address = String(point.name || "");
        result.route = String(point.route || "");
        result.time = String(point.arrival_time || "");
      }
      return result;
    });
}

// plan: Map "date|studentId" -> { status, note, updated_by, updated_at }
export function planToItems(plan, from, to, studentId) {
  const start = String(from || "").trim();
  const end = String(to || "").trim();
  const items = [];
  const holidays = new Set();
  plan.forEach((row, key) => {
    const [date, id] = key.split("|");
    if (!DATE_RE.test(date) || (start && date < start) || (end && date > end)) return;
    if (studentId && id !== studentId) {
      if (row.note === "holiday") holidays.add(date);
      return;
    }
    items.push({
      date,
      student_id: id,
      status: row.status,
      note: row.note || "",
      updated_by: row.updated_by || "",
      updated_at: row.updated_at || "",
    });
    if (row.note === "holiday") holidays.add(date);
  });
  items.sort((a, b) => (a.date + "|" + a.student_id < b.date + "|" + b.student_id ? -1 : 1));
  return { items, holidays: [...holidays].sort() };
}

export function getDriverStudentPlan(snapshot, plan, studentId, from, to, driver) {
  const wanted = String(studentId || "").trim().toLowerCase();
  const student = getDriverStudents(snapshot).find((item) => item.id === wanted);
  if (!student) throw new Error("student_not_found");
  const { items, holidays } = planToItems(plan, from, to, wanted);
  return { driver, student, items, holidays };
}

const rides = (status, direction) =>
  direction === "morning" ? status === "both" || status === "out" : status === "both" || status === "back";

export function getDriverSchedule(snapshot, plan, { from, to, route, direction }) {
  const start = String(from || "").trim();
  const end = String(to || "").trim();
  const selectedRoute = String(route || "all").trim();
  const directions = direction === "all" ? ["morning", "evening"] : [direction === "evening" ? "evening" : "morning"];

  const { holidays } = planToItems(plan, start, end);
  const holidaySet = new Set(holidays);

  const studentsByPoint = {};
  (snapshot.students || []).forEach((student) => {
    if (!student.id || !student.pointId || String(student.active) !== "1") return;
    (studentsByPoint[student.pointId] ||= []).push({ id: student.id, name: student.name });
  });

  const dates = weekdaysBetween(start, end);
  const daysByDate = {};

  (snapshot.points || []).forEach((point, pointIndex) => {
    const pointId = String(point.id || "").trim();
    const pointRoute = String(point.route || "").trim();
    if (!pointId || String(point.active || "") !== "1" || !studentsByPoint[pointId]) return;
    if (selectedRoute !== "all" && pointRoute !== selectedRoute) return;

    directions.forEach((dir) => {
      const studentsByDate = {};
      const cancellationsByDate = {};
      dates.forEach((date) => {
        const students = [];
        const cancelled = [];
        studentsByPoint[pointId].forEach((student) => {
          const item = plan.get(date + "|" + student.id);
          const status = item ? item.status : undefined;
          if (holidaySet.has(date) && !item) return;
          const goes = rides(status || "both", dir);
          if (goes) {
            students.push(student);
          } else if (item && item.updated_by && item.updated_by !== "pdf_seed") {
            cancelled.push(student);
          }
        });
        if (students.length) studentsByDate[date] = students;
        if (cancelled.length) {
          cancellationsByDate[date] = cancelled.map((student) => {
            const item = plan.get(date + "|" + student.id);
            return {
              id: student.id,
              name: student.name,
              address: String(point.name || "").trim(),
              updatedBy: item?.updated_by || "",
              updatedAt: item?.updated_at || "",
              note: item?.note || "",
            };
          });
        }
      });

      new Set([...Object.keys(studentsByDate), ...Object.keys(cancellationsByDate)]).forEach((date) => {
        const day = (daysByDate[date] ||= {});
        const routeKey = pointRoute + "|" + dir;
        const entry = (day[routeKey] ||= { route: pointRoute, direction: dir, points: [], cancellations: [] });
        if (studentsByDate[date]) {
          entry.points.push({
            pointId,
            address: String(point.name || "").trim(),
            url: String(point.url || "").trim(),
            phone: String(point.phone || "").trim(),
            order: pointIndex,
            students: studentsByDate[date].map((student) => {
              const item = plan.get(date + "|" + student.id);
              return {
                ...student,
                status: item ? item.status : holidaySet.has(date) ? "none" : "both",
                updatedBy: item?.updated_by || "",
                updatedAt: item?.updated_at || "",
                note: item?.note || "",
              };
            }),
          });
        }
        if (cancellationsByDate[date]) entry.cancellations.push(...cancellationsByDate[date]);
      });
    });
  });

  const days = Object.keys(daysByDate).sort().map((date) => ({
    date,
    routes: Object.keys(daysByDate[date])
      .sort((a, b) => {
        const [routeA, dirA] = a.split("|");
        const [routeB, dirB] = b.split("|");
        return Number(routeA) - Number(routeB) || (dirA === "morning" ? -1 : 1) - (dirB === "morning" ? -1 : 1);
      })
      .map((routeKey) => {
        const entry = daysByDate[date][routeKey];
        entry.points.sort((a, b) => (entry.direction === "evening" ? b.order - a.order : a.order - b.order));
        entry.count = entry.points.reduce((total, point) => total + point.students.length, 0);
        return entry;
      }),
  }));

  return { from: start, to: end, direction: direction === "all" ? "all" : directions[0], days };
}
