function getData(route) {
  const ss = SpreadsheetApp.getActive();
  const shP = ss.getSheetByName("Points"); // id | name | route | active
  const shM = ss.getSheetByName("Matrix"); // distance matrix
  const shD = ss.getSheetByName("Drivers"); // id | name | active
  const shC = ss.getSheetByName("Cars"); // CarId | Kennzeichen

  // ----- Points (для списка и для имен при сохранении)
  const P = shP.getDataRange().getValues(); // [ [id,name,route,active], ... ]
  const points = P.slice(1)
    .filter((r) => String(r[2]) === String(route) && String(r[3]) === "1")
    .map((r) => ({ id: String(r[0]), name: r[1] }));

  // словарь id->name (для submit, чтобы писать имена)
  const pointNameById = {};
  P.slice(1).forEach((r) => (pointNameById[String(r[0])] = r[1]));

  // ----- Drivers
  let drivers = [];
  if (shD) {
    const D = shD.getDataRange().getValues(); // id | name | active
    drivers = D.slice(1)
      .filter((r) => String(r[2]) === "1")
      .map((r) => ({ id: String(r[0]), name: r[1] }));
  }

  // ----- Cars (Kennzeichen)
  let cars = [];
  if (shC) {
    const C = shC.getDataRange().getValues(); // CarId | Kennzeichen
    cars = C.slice(1)
      .filter((r) => String(r[0]).trim() !== "")
      .map((r) => ({
        id: String(r[0]),
        plate: String(r[1] || ""),
      }));
  }

  // ----- Matrix -> dist[from][to]
  const lastCol = shM.getLastColumn(),
    lastRow = shM.getLastRow();
  const headTo = shM
    .getRange(1, 2, 1, lastCol - 1)
    .getValues()[0]
    .map(String);
  const headFrom = shM
    .getRange(2, 1, lastRow - 1, 1)
    .getValues()
    .flat()
    .map(String);
  const body = shM.getRange(2, 2, lastRow - 1, lastCol - 1).getValues();

  const dist = {};
  headFrom.forEach((from, i) => {
    dist[from] = {};
    headTo.forEach((to, j) => (dist[from][to] = body[i][j]));
  });

  return { points, dist, drivers, pointNameById, cars };
}

function submit(
  route,
  sequence,
  totalKm,
  driverId,
  driverName,
  shift,
  reportDate,
  carId,
  carPlate
) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName("Submissions") || ss.insertSheet("Submissions");

  // 1) Заголовки и их порядок (не ломаем существующий порядок)
  const REQUIRED = [
    "timestamp",
    "route",
    "driver_id",
    "driver_name",
    "report_date",
    "shift",
    "car_id",
    "car_plate",
    "sequence",
    "sequence_names",
    "total_km",
  ];
  let head = [];

  if (sh.getLastRow() === 0) {
    sh.appendRow(REQUIRED);
    head = REQUIRED.slice();
  } else {
    head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    // добавим недостающие колонки в конец, если их не было
    REQUIRED.forEach((name) => {
      if (head.indexOf(name) === -1) {
        sh.getRange(1, head.length + 1).setValue(name);
        head.push(name);
      }
    });
  }

  // 2) Подготовим данные
  const seq = Array.isArray(sequence)
    ? sequence
    : String(sequence || "")
        .split(">")
        .filter(Boolean);

  const nameById = getPointNameMap_();

  // id-шники храним как раньше через ">"
  const sequenceStr = seq.join(">");

  // ИМЕНА — теперь построчно
  const sequenceNamesStr = seq
    .map((id) => (nameById[String(id)] || String(id)).trim())
    .filter(Boolean)
    .join("\n");

  // Нормализуем дату отчёта (YYYY-MM-DD -> Date при полуночи локального дня)
  let repDate = null;
  if (reportDate) {
    const parts = String(reportDate).split("-"); // yyyy-mm-dd
    if (parts.length === 3) {
      repDate = new Date(
        Number(parts[0]),
        Number(parts[1]) - 1,
        Number(parts[2])
      );
    }
  }

  // карта CarId -> Kennzeichen
  const carMap = getCarPlateMap_();
  const normalizedCarId = carId || "";
  const resolvedPlate = normalizedCarId
    ? carMap[String(normalizedCarId)] || carPlate || ""
    : carPlate || "";

  const payload = {
    timestamp: new Date(),
    route: Number(route),
    driver_id: driverId || "",
    driver_name: driverName || "",
    report_date: repDate, // Дата
    shift: shift || "", // Früh/Nachmittag
    car_id: normalizedCarId,
    car_plate: resolvedPlate,
    sequence: sequenceStr, // id через ">"
    sequence_names: sequenceNamesStr, // Имена построчно
    total_km: Number(totalKm || 0),
  };

  // 3) Соберём строку по текущему порядку head
  const row = new Array(head.length).fill("");
  head.forEach((col, i) => {
    if (payload.hasOwnProperty(col)) row[i] = payload[col];
  });

  sh.appendRow(row);
  return payload;
}

// Хелпер: карта id точки -> имя (для sequence_names)
function getPointNameMap_() {
  const ss = SpreadsheetApp.getActive();
  const shP = ss.getSheetByName("Points");
  const map = {};
  if (shP) {
    const P = shP.getDataRange().getValues();
    P.slice(1).forEach((r) => (map[String(r[0])] = r[1]));
  }
  return map;
}

// Хелпер: карта CarId -> Kennzeichen
function getCarPlateMap_() {
  const ss = SpreadsheetApp.getActive();
  const shC = ss.getSheetByName("Cars");
  const map = {};
  if (shC) {
    const values = shC.getDataRange().getValues();
    values.slice(1).forEach((r) => {
      const id = String(r[0] || "").trim();
      const plate = String(r[1] || "").trim();
      if (id) map[id] = plate;
    });
  }
  return map;
}

function getRecentSubmissions(route, limit) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName("Submissions");
  if (!sh) return [];
  const values = sh.getDataRange().getValues();
  const head = values[0];
  const idx = {
    timestamp: head.indexOf("timestamp"),
    route: head.indexOf("route"),
    driver_id: head.indexOf("driver_id"),
    driver_name: head.indexOf("driver_name"),
    shift: head.indexOf("shift"),
    report_date: head.indexOf("report_date"),
    car_id: head.indexOf("car_id"),
    car_plate: head.indexOf("car_plate"),
    sequence: head.indexOf("sequence"),
    sequence_names: head.indexOf("sequence_names"),
    total_km: head.indexOf("total_km"),
  };
  const rows = values.slice(1).map((r, i) => ({
    row_num: i + 2,
    timestamp: r[idx.timestamp],
    route: r[idx.route],
    driver_id: r[idx.driver_id],
    driver_name: r[idx.driver_name],
    shift: r[idx.shift],
    report_date: r[idx.report_date],
    car_id: r[idx.car_id],
    car_plate: r[idx.car_plate],
    sequence: r[idx.sequence],
    sequence_names: r[idx.sequence_names],
    total_km: r[idx.total_km],
  }));

  const filtered = route
    ? rows.filter((x) => String(x.route) === String(route))
    : rows;

  filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return filtered.slice(0, limit || 4);
}

function getAdminData_() {
  const ss = SpreadsheetApp.getActive();
  const shP = ss.getSheetByName("Points");
  const shM = ss.getSheetByName("Matrix");
  const shD = ss.getSheetByName("Drivers");
  const shC = ss.getSheetByName("Cars");

  const points = shP
    ? shP
        .getDataRange()
        .getValues()
        .slice(1)
        .filter((r) => String(r[0] || "").trim() !== "")
        .map((r) => ({
          id: String(r[0] || "").trim(),
          name: String(r[1] || ""),
          route: String(r[2] || ""),
          active: String(r[3] || "") === "1" ? "1" : "0",
        }))
    : [];

  const drivers = shD
    ? shD
        .getDataRange()
        .getValues()
        .slice(1)
        .filter((r) => String(r[0] || "").trim() !== "")
        .map((r) => ({
          id: String(r[0] || "").trim(),
          name: String(r[1] || ""),
          active: String(r[2] || "") === "1" ? "1" : "0",
        }))
    : [];

  const cars = shC
    ? shC
        .getDataRange()
        .getValues()
        .slice(1)
        .filter((r) => String(r[0] || "").trim() !== "")
        .map((r) => ({
          id: String(r[0] || "").trim(),
          plate: String(r[1] || ""),
        }))
    : [];

  const matrix = readMatrixSheet_(shM);

  return { points, drivers, cars, matrix };
}

function saveAdminData_(body) {
  const payload = parseAdminPayload_(body);

  validateAdminPayload_(payload);

  const ss = SpreadsheetApp.getActive();
  writeSheetRows_(
    ss,
    "Points",
    ["id", "name", "route", "active"],
    payload.points.map((p) => [p.id, p.name, p.route, p.active])
  );
  writeSheetRows_(
    ss,
    "Drivers",
    ["id", "name", "active"],
    payload.drivers.map((d) => [d.id, d.name, d.active])
  );
  writeSheetRows_(
    ss,
    "Cars",
    ["CarId", "Kennzeichen"],
    payload.cars.map((c) => [c.id, c.plate])
  );
  writeMatrixSheet_(ss, payload.matrix);

  return {
    points: payload.points.length,
    drivers: payload.drivers.length,
    cars: payload.cars.length,
    matrix: payload.matrix.ids.length,
    savedAt: new Date(),
  };
}

function parseAdminPayload_(body) {
  const readJson = (value, fallback) => {
    if (typeof value !== "string" || !value.trim()) return fallback;
    try {
      return JSON.parse(value);
    } catch (err) {
      throw new Error("Invalid JSON in admin payload: " + err);
    }
  };

  const points = normalizePoints_(readJson(body.points, []));
  const drivers = normalizeDrivers_(readJson(body.drivers, []));
  const cars = normalizeCars_(readJson(body.cars, []));
  const matrix = normalizeMatrix_(readJson(body.matrix, {}));

  return { points, drivers, cars, matrix };
}

function normalizePoints_(list) {
  return (Array.isArray(list) ? list : []).map((item) => ({
    id: String(item?.id || "").trim(),
    name: String(item?.name || "").trim(),
    route: String(item?.route || "").trim(),
    active: String(item?.active || "") === "1" ? "1" : "0",
  }));
}

function normalizeDrivers_(list) {
  return (Array.isArray(list) ? list : []).map((item) => ({
    id: String(item?.id || "").trim(),
    name: String(item?.name || "").trim(),
    active: String(item?.active || "") === "1" ? "1" : "0",
  }));
}

function normalizeCars_(list) {
  return (Array.isArray(list) ? list : []).map((item) => ({
    id: String(item?.id || "").trim(),
    plate: String(item?.plate || "").trim(),
  }));
}

function normalizeMatrix_(matrix) {
  const ids = Array.isArray(matrix?.ids)
    ? matrix.ids.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  const rows = Array.isArray(matrix?.rows) ? matrix.rows : [];

  return {
    ids: ids,
    rows: ids.map((_, i) =>
      ids.map((__, j) => {
        const val = rows?.[i]?.[j];
        if (val === "" || val == null) return "";
        const num = Number(val);
        return Number.isFinite(num) ? num : "";
      })
    ),
  };
}

function validateAdminPayload_(payload) {
  const pointIds = {};
  payload.points.forEach((p) => {
    if (!p.id) throw new Error("Point id is required");
    if (!p.name) throw new Error("Point name is required for " + p.id);
    if (!p.route) throw new Error("Point route is required for " + p.id);
    if (pointIds[p.id]) throw new Error("Duplicate point id: " + p.id);
    pointIds[p.id] = true;
  });

  const driverIds = {};
  payload.drivers.forEach((d) => {
    if (!d.id) throw new Error("Driver id is required");
    if (!d.name) throw new Error("Driver name is required for " + d.id);
    if (driverIds[d.id]) throw new Error("Duplicate driver id: " + d.id);
    driverIds[d.id] = true;
  });

  const carIds = {};
  payload.cars.forEach((c) => {
    if (!c.id) throw new Error("Car id is required");
    if (carIds[c.id]) throw new Error("Duplicate car id: " + c.id);
    carIds[c.id] = true;
  });

  const expectedIds = payload.points.map((p) => p.id);
  if (payload.matrix.ids.length !== expectedIds.length) {
    throw new Error("Matrix size does not match points count");
  }
  payload.matrix.ids.forEach((id, i) => {
    if (id !== expectedIds[i]) {
      throw new Error("Matrix order must match points order at position " + (i + 1));
    }
  });
}

function readMatrixSheet_(shM) {
  if (!shM || shM.getLastRow() < 2 || shM.getLastColumn() < 2) {
    return { ids: [], rows: [] };
  }

  const lastCol = shM.getLastColumn();
  const lastRow = shM.getLastRow();
  const ids = shM
    .getRange(1, 2, 1, lastCol - 1)
    .getValues()[0]
    .map((v) => String(v || "").trim())
    .filter(Boolean);
  const body = shM.getRange(2, 2, lastRow - 1, lastCol - 1).getValues();

  return {
    ids: ids,
    rows: ids.map((_, i) =>
      ids.map((__, j) => {
        const val = body?.[i]?.[j];
        if (val === "" || val == null) return "";
        const num = Number(val);
        return Number.isFinite(num) ? num : "";
      })
    ),
  };
}

function writeSheetRows_(ss, name, header, rows) {
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clearContents();
  sh.getRange(1, 1, 1, header.length).setValues([header]);
  if (rows.length) {
    sh.getRange(2, 1, rows.length, header.length).setValues(rows);
  }
}

function writeMatrixSheet_(ss, matrix) {
  const sh = ss.getSheetByName("Matrix") || ss.insertSheet("Matrix");
  sh.clearContents();

  if (!matrix.ids.length) {
    sh.getRange(1, 1).setValue("from/to");
    return;
  }

  const grid = [["from/to"].concat(matrix.ids)];
  matrix.ids.forEach((id, i) => {
    grid.push([id].concat(matrix.rows[i] || []));
  });

  sh.getRange(1, 1, grid.length, grid[0].length).setValues(grid);
}
