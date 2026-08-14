/** Minimal — videoya hiç dokunma (nudge yayını kare kare bozuyordu). */
(() => {
  try {
    Object.defineProperty(Navigator.prototype, 'webdriver', {
      get: () => undefined,
      configurable: true,
    });
  } catch (_) {}

  if (!window.chrome) window.chrome = {};
  if (!window.chrome.runtime) {
    window.chrome.runtime = { connect: () => undefined, sendMessage: () => undefined };
  }
})();
