// === Audio manager: system tone for send + file sounds for message/order ===

let AC = null;
let _ready = false;

const sounds = {
  message: new Audio("./assets/sounds/message.mp3"),
  order: new Audio("./assets/sounds/order.mp3"),
};

Object.values(sounds).forEach((a) => {
  a.volume = 1.0;
  a.preload = "auto";
});

function ensureAudioCtx() {
  if (!AC) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    AC = new Ctor();
  }
  if (AC.state === "suspended") AC.resume().catch(() => {});
  return AC;
}

function unlockAudio() {
  if (_ready) return;
  ensureAudioCtx();
  Object.values(sounds).forEach((a) => {
    try {
      a.play().catch(() => {});
      a.pause();
      a.currentTime = 0;
    } catch {}
  });
  _ready = true;
  console.log("🔊 Audio ready");
}

// Простая система активации после первого жеста
export function ensureUserGestureListeners() {
  const once = () => unlockAudio();
  ["click", "keydown", "touchstart", "pointerdown"].forEach((ev) =>
    document.addEventListener(ev, once, { once: true, passive: true })
  );
}

// 🔇 Удалили кнопку: оставляем no-op для совместимости
export function insertEnableButton() {
  // no-op; кнопка больше не нужна
}

export function isAudioReady() {
  return _ready;
}

/* ====== system tone for SEND ====== */
function envTone({
  freq = 600,
  type = "triangle",
  dur = 0.12,
  attack = 0.005,
  decay = 0.08,
  gain = 0.1,
  when = 0,
}) {
  const ac = ensureAudioCtx();
  if (!ac) return;
  const t0 = ac.currentTime + when;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + Math.max(attack + decay, dur));
}

export function playSend() {
  if (!_ready) return;
  envTone({ freq: 520, type: "triangle", gain: 0.12, dur: 0.08 });
  envTone({ freq: 740, type: "triangle", gain: 0.09, dur: 0.1, when: 0.05 });
}

export function playReceive() {
  if (_ready) sounds.message.play().catch(() => {});
}

export function playOrder() {
  if (_ready) sounds.order.play().catch(() => {});
}
