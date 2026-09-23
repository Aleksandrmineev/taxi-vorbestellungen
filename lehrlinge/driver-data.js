/* driver-data.js — данные Fahrtenplan для водителей.
 *
 * Основной путь: Vercel /api/lehrlinge/* (данные из Redis, авторизация по JWT).
 * Запасной путь: прямой вызов GAS со старым токеном — если Vercel/Redis недоступен или не настроен.
 * Поверх — кэш в localStorage: показываем сохранённое сразу, свежее подтягиваем в фоне.
 */
(function () {
  const GAS_URL = "https://script.google.com/macros/s/AKfycbwS88JTgj1NVqhGAaMKi3MXxTawF9zA6mkG6avgxmIj8c61_20EjNZdY0_0U6kKor29/exec";
  const API_SECRET = "102030";
  const API_BASE = ["localhost", "127.0.0.1"].includes(location.hostname) ? "https://taxi-murtal.vercel.app" : "";
  const SESSION_KEY = "mt:driver-session";
  const CACHE_PREFIX = "mt:lehrlinge:v1:";
  const DIRTY_KEY = CACHE_PREFIX + "dirty";
  const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000;

  class AuthError extends Error {
    constructor() { super("driver_auth_required"); this.name = "AuthError"; }
  }
  class UnavailableError extends Error {
    constructor(message) { super(message || "Server nicht erreichbar"); this.name = "UnavailableError"; }
  }

  /* ---------- Сессия ---------- */

  function readSession() {
    try {
      const session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      return session && (session.token || session.jwt) ? session : null;
    } catch (_) { return null; }
  }

  function writeSession(session) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (_) {}
  }

  function clearSession() {
    try {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem("mt:driver-authenticated");
    } catch (_) {}
  }

  // Обмен токена GAS на JWT (один раз для водителей, вошедших до появления JWT).
  let upgrading = null;
  function upgradeSession() {
    if (upgrading) return upgrading;
    upgrading = (async () => {
      const session = readSession();
      if (!session?.token) throw new AuthError();
      let response;
      try {
        response = await fetch(`${API_BASE}/api/lehrlinge/session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: session.token }),
        });
      } catch (_) { throw new UnavailableError(); }
      const result = await response.json().catch(() => ({}));
      if (response.status === 401) throw new AuthError();
      if (!response.ok || !result.jwt) throw new UnavailableError();
      const next = { ...session, jwt: result.jwt };
      writeSession(next);
      return next;
    })().finally(() => { upgrading = null; });
    return upgrading;
  }

  async function ensureJwt() {
    const session = readSession();
    if (!session) throw new AuthError();
    if (session.jwt) return session.jwt;
    return (await upgradeSession()).jwt;
  }

  /* ---------- Vercel API ---------- */

  async function vercelRequest(path, { method = "GET", query, body } = {}, retried = false) {
    const jwt = await ensureJwt();
    const url = new URL(`${API_BASE}/api/lehrlinge/${path}`, location.origin);
    Object.entries(query || {}).forEach(([key, value]) => url.searchParams.set(key, value));
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${jwt}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
    } catch (_) { throw new UnavailableError(); }
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) {
      // JWT отклонён: один раз пробуем получить новый по токену GAS, и только потом просим войти заново.
      if (retried) throw new AuthError();
      const session = readSession();
      if (session) writeSession({ ...session, jwt: undefined });
      return vercelRequest(path, { method, query, body }, true);
    }
    if (response.status >= 500 || response.status === 404) throw new UnavailableError(result.error);
    if (!response.ok || result.ok === false) throw new Error(result.error || "API-Fehler");
    return result;
  }

  /* ---------- Запасной путь через GAS ---------- */

  function gasAuthError() {
    // Если есть JWT, то ошибка GAS-токена ещё не значит, что водитель разлогинен.
    return readSession()?.jwt ? new UnavailableError() : new AuthError();
  }

  async function gasGet(fn, params) {
    const session = readSession();
    if (!session?.token) throw gasAuthError();
    const url = new URL(GAS_URL);
    Object.entries({ fn, driverToken: session.token, ...params, secret: API_SECRET, _ts: Date.now() })
      .forEach(([key, value]) => url.searchParams.set(key, value));
    const response = await fetch(url, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok || result.ok === false) {
      if (String(result.error || "").includes("driver_auth_required")) throw gasAuthError();
      throw new Error(result.error || "API-Fehler");
    }
    return result;
  }

  async function gasSavePlan(rows, holidays, updatedBy) {
    const session = readSession();
    if (!session?.token) throw gasAuthError();
    const body = new URLSearchParams({
      action: "driver_plan_save",
      driverToken: session.token,
      rows: JSON.stringify(rows),
      holidays: JSON.stringify(holidays || []),
      updatedBy,
      secret: API_SECRET,
    });
    const response = await fetch(GAS_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }, body });
    const result = await response.json();
    if (!response.ok || result.ok === false) {
      if (String(result.error || "").includes("driver_auth_required")) throw gasAuthError();
      throw new Error(result.error || "Speichern fehlgeschlagen");
    }
    return result;
  }

  /* ---------- Кэш ---------- */

  function readCache(key) {
    try {
      const entry = JSON.parse(localStorage.getItem(CACHE_PREFIX + key) || "null");
      if (!entry || !entry.data || Date.now() - entry.ts > MAX_CACHE_AGE_MS) return null;
      return entry;
    } catch (_) { return null; }
  }

  function writeCache(key, data) {
    try {
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ ts: Date.now(), data }));
      pruneCache(key.split(":")[0] + ":", 8);
    } catch (_) {}
  }

  function pruneCache(prefix, keep) {
    try {
      const entries = [];
      for (let i = 0; i < localStorage.length; i++) {
        const name = localStorage.key(i);
        if (!name || !name.startsWith(CACHE_PREFIX + prefix)) continue;
        let ts = 0;
        try { ts = JSON.parse(localStorage.getItem(name)).ts || 0; } catch (_) {}
        entries.push({ name, ts });
      }
      entries.sort((a, b) => b.ts - a.ts).slice(keep).forEach((entry) => localStorage.removeItem(entry.name));
    } catch (_) {}
  }

  function markDirty() { try { localStorage.setItem(DIRTY_KEY, String(Date.now())); } catch (_) {} }
  function isDirty() { try { return Boolean(localStorage.getItem(DIRTY_KEY)); } catch (_) { return false; } }
  function clearDirty() { try { localStorage.removeItem(DIRTY_KEY); } catch (_) {} }

  // Сначала кэш (мгновенно), затем свежие данные. onData(data, { cached, offline, savedAt }).
  async function cachedLoad(key, loader, onData, { useCache = true } = {}) {
    const cached = useCache ? readCache(key) : null;
    if (cached) onData(cached.data, { cached: true, offline: false, savedAt: cached.ts });
    try {
      const fresh = await loader();
      writeCache(key, fresh);
      onData(fresh, { cached: false, offline: false, savedAt: Date.now() });
      return fresh;
    } catch (error) {
      if (error.name === "AuthError" || !cached) throw error;
      onData(cached.data, { cached: true, offline: true, savedAt: cached.ts });
      return cached.data;
    }
  }

  /* ---------- Публичные функции ---------- */

  function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function defaultPeriod() {
    const today = new Date();
    const end = new Date(today);
    end.setDate(today.getDate() + 4);
    return { from: dateKey(today), to: dateKey(end) };
  }

  const scheduleKey = (p) => `schedule:${p.from}|${p.to}|${p.route}|${p.direction}`;
  const studentPlanKey = (studentId, from, to) => `student:${studentId}|${from}|${to}`;

  async function withFallback(viaVercel, viaGas) {
    try { return await viaVercel(); }
    catch (error) {
      if (error.name !== "UnavailableError") throw error;
      return viaGas();
    }
  }

  function loadSchedule(params, onData) {
    const p = { route: "all", direction: "all", ...params };
    const query = { from: p.from, to: p.to, route: p.route, direction: p.direction };
    const loader = () => withFallback(
      () => vercelRequest("schedule", { query }),
      () => gasGet("driver_schedule", query),
    );
    return cachedLoad(scheduleKey(p), loader, onData, { useCache: !isDirty() }).then((data) => { clearDirty(); return data; });
  }

  function loadStudentPlan(studentId, from, to, onData) {
    const query = { studentId, from, to };
    const loader = () => withFallback(
      () => vercelRequest("student-plan", { query }),
      () => gasGet("driver_student_plan", query),
    );
    return cachedLoad(studentPlanKey(studentId, from, to), loader, onData);
  }

  // rows: [{date, student_id, status, note}]. Возвращает ответ сервера.
  async function savePlan(rows, holidays, updatedBy) {
    const result = await withFallback(
      () => vercelRequest("plan-save", { method: "POST", body: { rows, holidays } }),
      () => gasSavePlan(rows, holidays, updatedBy),
    );
    markDirty();
    return result;
  }

  // Предзагрузка расписания за период по умолчанию (вызывается с главной Lehrlinge).
  function prefetch() {
    const run = () => {
      if (!readSession()) return;
      const period = defaultPeriod();
      loadSchedule({ ...period, route: "all", direction: "all" }, () => {}).catch(() => {});
    };
    if ("requestIdleCallback" in window) requestIdleCallback(run, { timeout: 2000 });
    else setTimeout(run, 300);
  }

  // Änderungsprotokoll: nur über Vercel (liest das Sheet über GAS), kein Cache.
  function loadPlanLog(studentId) {
    return vercelRequest("plan-log", { query: studentId ? { studentId } : {} });
  }

  function formatSyncedAt(timestamp) {
    return new Date(timestamp).toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
  }

  window.DriverData = {
    AuthError,
    readSession,
    clearSession,
    defaultPeriod,
    loadSchedule,
    loadStudentPlan,
    savePlan,
    loadPlanLog,
    studentPlanKey,
    writeCache,
    prefetch,
    formatSyncedAt,
  };
})();
