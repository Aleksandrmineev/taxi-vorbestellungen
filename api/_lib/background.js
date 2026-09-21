// Фоновая работа после ответа клиенту (Vercel waitUntil). Вне Vercel (тесты, локально) просто запускает промис.
import { waitUntil } from "@vercel/functions";

const tracked = new Set();

export function background(promise) {
  const task = Promise.resolve(promise).catch((error) => {
    console.error("background task failed:", error?.message || error);
  });
  tracked.add(task);
  task.finally(() => tracked.delete(task));
  try { waitUntil(task); } catch (_) { /* нет контекста Vercel */ }
  return task;
}

// Для тестов: дождаться всех фоновых задач.
export async function settleBackground() {
  while (tracked.size) await Promise.all([...tracked]);
}
