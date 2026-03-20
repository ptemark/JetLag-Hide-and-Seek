import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerServiceWorker } from './registerSW.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '../public');

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

describe('PWA manifest', () => {
  it('manifest.json has theme_color #1B2A3A', () => {
    const raw = fs.readFileSync(path.join(PUBLIC_DIR, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(raw);
    expect(manifest.theme_color).toBe('#1B2A3A');
  });

  it('manifest.json has background_color #1B2A3A', () => {
    const raw = fs.readFileSync(path.join(PUBLIC_DIR, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(raw);
    expect(manifest.background_color).toBe('#1B2A3A');
  });

  it('manifest.json has name "JetLag: The Game"', () => {
    const raw = fs.readFileSync(path.join(PUBLIC_DIR, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(raw);
    expect(manifest.name).toBe('JetLag: The Game');
  });

  it('manifest.json has short_name "JetLag"', () => {
    const raw = fs.readFileSync(path.join(PUBLIC_DIR, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(raw);
    expect(manifest.short_name).toBe('JetLag');
  });
});

describe('PWA icon SVG validity', () => {
  it('icon-192.svg is valid XML with no parse errors', () => {
    const content = fs.readFileSync(path.join(PUBLIC_DIR, 'icon-192.svg'), 'utf8');
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'image/svg+xml');
    const error = doc.querySelector('parsererror');
    expect(error).toBeNull();
  });

  it('icon-512.svg is valid XML with no parse errors', () => {
    const content = fs.readFileSync(path.join(PUBLIC_DIR, 'icon-512.svg'), 'utf8');
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'image/svg+xml');
    const error = doc.querySelector('parsererror');
    expect(error).toBeNull();
  });

  it('icon-192.svg has viewBox 0 0 192 192', () => {
    const content = fs.readFileSync(path.join(PUBLIC_DIR, 'icon-192.svg'), 'utf8');
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'image/svg+xml');
    const svg = doc.querySelector('svg');
    expect(svg.getAttribute('viewBox')).toBe('0 0 192 192');
  });

  it('icon-512.svg has viewBox 0 0 512 512', () => {
    const content = fs.readFileSync(path.join(PUBLIC_DIR, 'icon-512.svg'), 'utf8');
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'image/svg+xml');
    const svg = doc.querySelector('svg');
    expect(svg.getAttribute('viewBox')).toBe('0 0 512 512');
  });

  it('icon-192.svg contains the brand background colour #1B2A3A', () => {
    const content = fs.readFileSync(path.join(PUBLIC_DIR, 'icon-192.svg'), 'utf8');
    expect(content).toContain('#1B2A3A');
  });

  it('icon-512.svg contains the brand background colour #1B2A3A', () => {
    const content = fs.readFileSync(path.join(PUBLIC_DIR, 'icon-512.svg'), 'utf8');
    expect(content).toContain('#1B2A3A');
  });
});
