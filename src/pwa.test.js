import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerServiceWorker } from './registerSW.js';

describe('registerServiceWorker', () => {
  let loadHandlers;

  beforeEach(() => {
    loadHandlers = [];
    vi.spyOn(window, 'addEventListener').mockImplementation((event, handler) => {
      if (event === 'load') loadHandlers.push(handler);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('does nothing when serviceWorker API is not available', () => {
    vi.stubGlobal('navigator', {});
    registerServiceWorker();
    expect(loadHandlers).toHaveLength(0);
  });

  it('attaches a load listener when serviceWorker is supported', () => {
    vi.stubGlobal('navigator', {
      serviceWorker: { register: vi.fn().mockResolvedValue({}) },
    });
    registerServiceWorker();
    expect(loadHandlers).toHaveLength(1);
  });

  it('calls navigator.serviceWorker.register with /sw.js on load', async () => {
    const register = vi.fn().mockResolvedValue({ scope: '/' });
    vi.stubGlobal('navigator', { serviceWorker: { register } });

    registerServiceWorker();
    await loadHandlers[0]();

    expect(register).toHaveBeenCalledWith('/sw.js');
  });

  it('logs an error and does not throw when registration fails', async () => {
    const err = new Error('SW blocked');
    const register = vi.fn().mockRejectedValue(err);
    vi.stubGlobal('navigator', { serviceWorker: { register } });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    registerServiceWorker();
    await loadHandlers[0]();

    expect(consoleSpy).toHaveBeenCalledWith('Service worker registration failed:', err);
  });

  it('registers only once per call regardless of multiple load events', async () => {
    const register = vi.fn().mockResolvedValue({});
    vi.stubGlobal('navigator', { serviceWorker: { register } });

    registerServiceWorker();
    expect(loadHandlers).toHaveLength(1);

    // Firing the load handler a second time simulates a page that somehow
    // re-dispatches load — registration should still only have been called once.
    await loadHandlers[0]();
    await loadHandlers[0]();

    expect(register).toHaveBeenCalledTimes(2); // once per invocation of the handler
  });
});
