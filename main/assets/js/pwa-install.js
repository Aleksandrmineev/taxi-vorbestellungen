(() => {
  const button = document.getElementById("installAppButton");
  if (!button) return;

  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (isStandalone) return;

  const installedKey = "mt:pwa-installed";
  if (localStorage.getItem(installedKey) === "1") return;

  let deferredPrompt = null;
  // На Android кнопка появляется только после явного сигнала браузера.
  // На iPhone beforeinstallprompt не существует, поэтому оставляем кнопку
  // для перехода к инструкции, пока страница открыта в Safari.
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  button.hidden = !isIOS;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    button.hidden = false;
  });

  button.addEventListener("click", async () => {
    if (!deferredPrompt) {
      window.location.href = "./hilfe.html#app-installieren";
      return;
    }
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (choice?.outcome === "accepted") {
      localStorage.setItem(installedKey, "1");
      button.hidden = true;
    }
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    localStorage.setItem(installedKey, "1");
    button.hidden = true;
  });
})();
