// In-Memory-Ersatz für den node-redis-Client (nur die verwendeten Befehle).
export function makeFakeRedis() {
  const kv = new Map();
  const options = [];
  const state = { down: false };
  const hashOf = (key) => { if (!kv.has(key)) kv.set(key, new Map()); return kv.get(key); };
  const commands = {
    get: (key) => kv.get(key) ?? null,
    set: (key, value, opts) => {
      if (opts?.NX && kv.has(key)) return null;
      kv.set(key, String(value));
      options.push({ key, ...opts });
      return "OK";
    },
    del: (key) => (kv.delete(key) ? 1 : 0),
    incr: (key) => { const v = Number(kv.get(key) || 0) + 1; kv.set(key, String(v)); return v; },
    expire: () => 1,
    hGetAll: (key) => Object.fromEntries(kv.get(key) || []),
    hLen: (key) => kv.get(key)?.size || 0,
    hSet: (key, fieldOrFields, value) => {
      const fields = typeof fieldOrFields === "object" ? fieldOrFields : { [fieldOrFields]: value };
      Object.entries(fields).forEach(([f, v]) => hashOf(key).set(f, String(v)));
      return Object.keys(fields).length;
    },
    hDel: (key, fields) => [].concat(fields).reduce((n, f) => n + (kv.get(key)?.delete(f) ? 1 : 0), 0),
  };
  const guard = (fn) => async (...args) => { if (state.down) throw new Error("connection refused"); return fn(...args); };
  const client = {
    ...Object.fromEntries(Object.entries(commands).map(([name, fn]) => [name, guard(fn)])),
    multi() {
      const queue = [];
      const tx = { exec: guard(() => queue.map(([n, a]) => commands[n](...a))) };
      Object.keys(commands).forEach((name) => { tx[name] = (...args) => { queue.push([name, args]); return tx; }; });
      return tx;
    },
    destroy() {},
  };
  return { client, kv, options, state };
}
