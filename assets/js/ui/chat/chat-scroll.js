// Управление прокруткой, «прилипанием» к низу и visualViewport
const chatEl = document.getElementById("chat");
const form = document.getElementById("sendForm");
const input = document.getElementById("msg");

let shouldStickBottom = true;
let userIsReading = false;
const STICK_THRESHOLD = 32;

export const isNearBottom = (el = chatEl, t = STICK_THRESHOLD) =>
  !el ? true : el.scrollHeight - el.scrollTop - el.clientHeight < t;

export function scrollToBottomStrong({ smooth = false } = {}) {
  if (!chatEl) return;
  chatEl.scrollTo({
    top: chatEl.scrollHeight,
    behavior: smooth ? "smooth" : "auto",
  });
  requestAnimationFrame(() => {
    chatEl.scrollTop = chatEl.scrollHeight;
  });
}

export function setStickBottom(v = true) {
  shouldStickBottom = !!v;
  if (v) userIsReading = false;
}
export const getStickBottom = () => shouldStickBottom;
export const getUserIsReading = () => userIsReading;

if (chatEl) {
  let idleTimer = null;
  chatEl.addEventListener("scroll", () => {
    const near = isNearBottom(chatEl);
    shouldStickBottom = near;
    userIsReading = !near;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      userIsReading = !isNearBottom(chatEl);
    }, 150);
  });
}

/* === Высота send-бара → CSS var === */
export function updateSendbarHeightVar() {
  if (!form) return;
  const h = Math.ceil(form.getBoundingClientRect().height || 84);
  document.documentElement.style.setProperty("--sendbar-h", `${h}px`);
}

/* === Клавиатура/viewport === */
export function attachViewportGuards() {
  const handleHeights = () => {
    updateSendbarHeightVar();
    requestAnimationFrame(updateSendbarHeightVar);
  };
  window.addEventListener("load", handleHeights);
  window.addEventListener("resize", handleHeights);

  const vv = window.visualViewport;
  const onVV = () => {
    if (!vv) return handleHeights();
    const keyboardOpen = window.innerHeight - vv.height > 60;
    form?.classList.toggle("is-vv", keyboardOpen);
    handleHeights();
    if (keyboardOpen && isNearBottom(chatEl)) {
      setStickBottom(true);
      scrollToBottomStrong({ smooth: false });
    }
  };
  if (vv) {
    vv.addEventListener("resize", onVV);
    vv.addEventListener("scroll", onVV);
  }

  if (input) {
    input.addEventListener("focus", () => {
      if (isNearBottom(chatEl)) {
        setStickBottom(true);
        scrollToBottomStrong({ smooth: false });
      }
      handleHeights();
    });
    input.addEventListener("input", updateSendbarHeightVar);
  }
}
