// Lightweight audio helper for Chat: init + tones + optional enable button

let AC = null;
let _ready = false; // был ли пользовательский жест
let _buttonInserted = false;

function _getAudioContext() {
  if (!AC) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    AC = new Ctor();
  }
  if (AC.state === "suspended") {
    AC.resume().catch(() => {});
  }
  return AC;
}

function _envTone({
  freq = 600,
  type = "sine",
  dur = 0.12,
  attack = 0.005,
  decay = 0.08,
  gain = 0.08,
  when = 0,
}) {
  const ac = _getAudioContext();
  if (!ac || !_ready) {
    // fallback: лёгкая вибрация (мобилки)
    try {
      navigator.vibrate && navigator.vibrate(40);
    } catch {}
    return;
  }
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

export function isAudioReady() {
  return _ready;
}

export function ensureUserGestureListeners() {
  // Первый ЖЕСТ → включаем звук
  const once = () => {
    _ready = true;
    _getAudioContext();
    hideEnableButton();
  };
  ["click", "keydown", "touchstart", "pointerdown"].forEach((ev) => {
    document.addEventListener(ev, once, { once: true, passive: true });
  });
}

export function insertEnableButton(containerSelector = ".chat-header") {
  if (_buttonInserted) return;
  const container = document.querySelector(containerSelector) || document.body;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "btn-sound";
  btn.className = "pill";
  btn.textContent = "Ton aktivieren";
  btn.style.marginLeft = "8px";
  btn.addEventListener("click", () => {
    try {
      _ready = true;
      _getAudioContext();
      hideEnableButton();
    } catch {}
  });
  container.appendChild(btn);
  _buttonInserted = true;
}

export function hideEnableButton() {
  const b = document.getElementById("btn-sound");
  if (b && b.parentNode) b.parentNode.removeChild(b);
  _buttonInserted = false;
}

/* ===== Tones ===== */
export function playSend() {
  _envTone({
    freq: 520,
    type: "triangle",
    gain: 0.07,
    attack: 0.005,
    decay: 0.07,
    dur: 0.1,
    when: 0,
  });
  _envTone({
    freq: 740,
    type: "triangle",
    gain: 0.06,
    attack: 0.005,
    decay: 0.08,
    dur: 0.12,
    when: 0.06,
  });
}
export function playReceive() {
  _envTone({
    freq: 540,
    type: "sine",
    gain: 0.07,
    attack: 0.003,
    decay: 0.09,
    dur: 0.1,
    when: 0,
  });
}
export function playOrder() {
  _envTone({
    freq: 420,
    type: "sine",
    gain: 0.08,
    attack: 0.004,
    decay: 0.12,
    dur: 0.14,
    when: 0,
  });
  _envTone({
    freq: 880,
    type: "sine",
    gain: 0.07,
    attack: 0.004,
    decay: 0.14,
    dur: 0.16,
    when: 0.1,
  });
}
