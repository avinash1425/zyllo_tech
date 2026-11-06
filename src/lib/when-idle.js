const AFTER_LOAD_MS = 1500;

// Resolves a moment after the page has loaded, once the browser is idle, for startup work
// that should not compete with the first paint and the hero image.
export function whenIdle() {
  return new Promise((resolve) => {
    const schedule = () => {
      const idle = () => {
        if (window.requestIdleCallback) window.requestIdleCallback(resolve, { timeout: 1000 });
        else resolve();
      };
      setTimeout(idle, AFTER_LOAD_MS);
    };
    if (document.readyState === "complete") schedule();
    else window.addEventListener("load", schedule, { once: true });
  });
}
