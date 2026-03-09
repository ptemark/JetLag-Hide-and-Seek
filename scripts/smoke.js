#!/usr/bin/env node
/**
 * smoke.js — Smoke tests against a live staging deployment.
 *
 * Fires a small set of HTTP assertions to prove the staging tier is healthy
 * before production deploys are allowed to proceed.
 *
 * Usage:
 *   SMOKE_TEST_URL=https://... node scripts/smoke.js
 *   SMOKE_TEST_URL=https://... STAGING_GAME_SERVER_URL=https://... node scripts/smoke.js
 *
 * Exits 0 on success, 1 on any failure.
 */

import { fileURLToPath } from 'url';

/**
 * Run all smoke checks against the provided URLs.
 *
 * @param {string} baseUrl         - Serverless/frontend base URL (e.g. Vercel preview).
 * @param {string|undefined} gameServerUrl - Managed game-server base URL (optional).
 * @param {Function} fetchFn       - fetch implementation (injectable for tests).
 * @returns {{ results: Array, passed: number, failed: number }}
 */
export async function runSmokeChecks(baseUrl, gameServerUrl, fetchFn = fetch) {
  const results = [];

  async function check(label, fn) {
    try {
      await fn();
      results.push({ label, ok: true });
    } catch (err) {
      results.push({ label, ok: false, error: err.message });
    }
  }

  async function get(url) {
    return fetchFn(url, { signal: AbortSignal.timeout(10_000) });
  }

  // ── Serverless / frontend tier ────────────────────────────────────────────
  await check('Frontend SPA responds with 200', async () => {
    const res = await get(`${baseUrl}/`);
    if (res.status !== 200) {
      throw new Error(`Expected 200, got ${res.status}`);
    }
  });

  await check('Admin endpoint requires auth (401)', async () => {
    const res = await get(`${baseUrl}/api/admin`);
    if (res.status !== 401) {
      throw new Error(`Expected 401, got ${res.status}`);
    }
  });

  await check('Unknown API route returns 404', async () => {
    const res = await get(`${baseUrl}/api/__smoke_nonexistent__`);
    if (res.status !== 404) {
      throw new Error(`Expected 404, got ${res.status}`);
    }
  });

  // ── Managed game-server tier (optional) ──────────────────────────────────
  if (gameServerUrl) {
    await check('Game server internal/admin reachable (200/401/503)', async () => {
      const res = await get(`${gameServerUrl}/internal/admin`);
      const acceptable = [200, 401, 503];
      if (!acceptable.includes(res.status)) {
        throw new Error(`Unexpected status ${res.status}`);
      }
    });
  }

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  return { results, passed, failed };
}

async function main() {
  const baseUrl = process.env.SMOKE_TEST_URL;
  const gameServerUrl = process.env.STAGING_GAME_SERVER_URL;

  if (!baseUrl) {
    console.warn('[smoke] SMOKE_TEST_URL not set — skipping smoke tests.');
    process.exit(0);
  }

  console.log('[smoke] Starting smoke tests…');
  console.log(`[smoke] Serverless URL : ${baseUrl}`);
  if (gameServerUrl) {
    console.log(`[smoke] Game server URL: ${gameServerUrl}`);
  }

  const { results, passed, failed } = await runSmokeChecks(baseUrl, gameServerUrl);

  for (const r of results) {
    if (r.ok) {
      console.log(`  ✓ ${r.label}`);
    } else {
      console.error(`  ✗ ${r.label}: ${r.error}`);
    }
  }

  console.log(`\n[smoke] ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

// Run only when invoked directly (not when imported by tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('[smoke] Unexpected error:', err);
    process.exit(1);
  });
}
