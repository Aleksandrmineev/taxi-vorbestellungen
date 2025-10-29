// Data/loop-слой: первый фулл-фетч, поллинг, звуки входящих, подписка на пуш

import { deviceId, state, loadIncremental, fullRefresh } from "./chat-core.js";
import { render, setStickBottom } from "./chat-view.js";
import { playReceive, playOrder } from "./chat-audio.js";
import { registerAndSubscribePush } from "./push-client.js";

/* ===== Push on first gesture ===== */
const VAPID_PUBLIC_KEY =
  "BHvHS0aMhtznjKjI5rtAji6clhHeCWRERV5hH-nS1o3TIbuxqAvNWsHdi4dMCqaCnU5avg1e0pD7t90PPZr7oK0";

let didAskPush = false;
["click", "keydown", "touchstart", "pointerdown"].forEach((ev) => {
  document.addEventListener(
    ev,
    async () => {
      if (didAskPush) return;
      didAskPush = true;
      try {
        await registerAndSubscribePush({
          vapidPublicKey: VAPID_PUBLIC_KEY,
          userName: state.displayName || "",
        });
        console.log("Push subscribed");
      } catch (e) {
        console.warn("Push subscribe failed", e);
      }
    },
    { once: true, passive: true }
  );
});

document.getElementById("btn-push")?.addEventListener("click", async () => {
  const r = await registerAndSubscribePush({
    vapidPublicKey: VAPID_PUBLIC_KEY,
    userName: state.displayName || "",
  });
  alert(
    r.ok ? "Уведомления включены" : "Не удалось: " + (r.error || "unknown")
  );
});

/* helper: близко ли мы к низу? */
const chatEl = document.getElementById("chat");
const nearBottom = () => {
  if (!chatEl) return true;
  const gap = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight;
  return gap < 32;
};

/* ===== Init + Polling ===== */
export async function initLoop() {
  // первый фулл-фетч — с защитой
  try {
    await fullRefresh();
  } catch (e) {
    console.warn("fullRefresh() failed:", e);
  }
  // всегда отрисуем текущее состояние (даже если фулл-фетч упал)
  render();
  if (nearBottom()) setStickBottom(true);

  let didInitialPoll = false;

  setInterval(async () => {
    let newItems = [];
    try {
      newItems = await loadIncremental();
    } catch (e) {
      console.warn("loadIncremental() failed:", e);
      // даже при ошибке — подержим DOM актуальным (фильтры/локальные сообщения)
      render();
      return;
    }

    // звуки и «приклейка» только при входящих
    if (Array.isArray(newItems) && newItems.length && didInitialPoll) {
      const incoming = newItems.filter((m) => {
        const mine =
          (m.device && m.device === deviceId) ||
          (!m.device && (m.author || "") === state.displayName);
        return !mine;
      });
      if (incoming.length) {
        const hasOrder = incoming.some(
          (m) => m.type === "order_created" || m.is_order === true
        );
        hasOrder ? playOrder() : playReceive();
        if (nearBottom()) setStickBottom(true);
      }
    }

    // РЕНДЕРИМ ВСЕГДА: чтобы не «терять» список при временных сбоях
    render();

    didInitialPoll = true;
  }, 3000);
}
