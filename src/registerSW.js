/**
 * Registers the service worker for PWA support.
 * Safe to call unconditionally — no-ops in browsers that don't support SW.
 */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.error('Service worker registration failed:', err);
    });
  });
}
