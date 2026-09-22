// Redis-Verbindung (REDIS_URL) für die Bestellungen: eine Verbindung pro Funktionsinstanz, Timeout, ein Wiederholungsversuch.
import { createClient } from "redis";

const COMMAND_TIMEOUT_MS = 5000;
let clientPromise = null;
let injectedClient = null;

export function __setRedisClientForTests(client) {
  injectedClient = client;
  clientPromise = null;
}

async function connect() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("store_not_configured");
  const client = createClient({
    url,
    socket: { connectTimeout: COMMAND_TIMEOUT_MS, reconnectStrategy: (attempt) => (attempt > 2 ? false : attempt * 100) },
  });
  client.on("error", () => {});
  await client.connect();
  return client;
}

function getClient() {
  if (injectedClient) return Promise.resolve(injectedClient);
  if (!clientPromise) {
    clientPromise = connect().catch((error) => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}

function withTimeout(promise) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("store_unavailable")), COMMAND_TIMEOUT_MS); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function run(operation) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await withTimeout(getClient().then(operation));
    } catch (error) {
      if (error.message === "store_not_configured") throw error;
      const stale = clientPromise;
      clientPromise = null;
      if (stale) stale.then((client) => client.destroy?.() ?? client.disconnect?.()).catch(() => {});
      if (attempt === 1) throw new Error("store_unavailable");
    }
  }
  throw new Error("store_unavailable");
}

export const parse = (value) => (typeof value === "string" ? JSON.parse(value) : value);
