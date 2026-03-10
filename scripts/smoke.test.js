import { describe, it, expect, vi } from 'vitest';
import { runSmokeChecks } from './smoke.js';

const BASE_URL = 'https://staging.example.com';
const GAME_SERVER_URL = 'https://game-server.staging.example.com';

// Exact-URL mock: returns the mapped status for a given full URL.
function makeFetch(statusMap) {
  return vi.fn(async url => {
    if (statusMap[url] !== undefined) return { status: statusMap[url] };
    return { status: 500 };
  });
}

// All three expected serverless URLs for convenience.
const serverlessDefaults = {
  [`${BASE_URL}/`]: 200,
  [`${BASE_URL}/api/admin`]: 401,
  [`${BASE_URL}/api/__smoke_nonexistent__`]: 404,
};

describe('runSmokeChecks — serverless tier', () => {
  it('passes when all endpoints return expected statuses', async () => {
    const fetch = makeFetch({ ...serverlessDefaults });

    const { passed, failed } = await runSmokeChecks(BASE_URL, undefined, fetch);
    expect(passed).toBe(3);
    expect(failed).toBe(0);
  });

  it('fails when frontend returns non-200', async () => {
    const fetch = makeFetch({
      [`${BASE_URL}/`]: 503,
      [`${BASE_URL}/api/admin`]: 401,
      [`${BASE_URL}/api/__smoke_nonexistent__`]: 404,
    });

    const { results, failed } = await runSmokeChecks(BASE_URL, undefined, fetch);
    expect(failed).toBe(1);
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toMatch(/Expected 200, got 503/);
  });

  it('fails when admin endpoint does not return 401', async () => {
    const fetch = makeFetch({
      [`${BASE_URL}/`]: 200,
      [`${BASE_URL}/api/admin`]: 200,
      [`${BASE_URL}/api/__smoke_nonexistent__`]: 404,
    });

    const { results, failed } = await runSmokeChecks(BASE_URL, undefined, fetch);
    expect(failed).toBe(1);
    expect(results[1].ok).toBe(false);
    expect(results[1].error).toMatch(/Expected 401 or 503, got 200/);
  });

  it('fails when unknown route does not return 404', async () => {
    const fetch = makeFetch({
      [`${BASE_URL}/`]: 200,
      [`${BASE_URL}/api/admin`]: 401,
      [`${BASE_URL}/api/__smoke_nonexistent__`]: 200,
    });

    const { results, failed } = await runSmokeChecks(BASE_URL, undefined, fetch);
    expect(failed).toBe(1);
    expect(results[2].ok).toBe(false);
    expect(results[2].error).toMatch(/Expected 404, got 200/);
  });

  it('accumulates multiple failures', async () => {
    const fetch = makeFetch({
      [`${BASE_URL}/`]: 503,
      [`${BASE_URL}/api/admin`]: 200,
      [`${BASE_URL}/api/__smoke_nonexistent__`]: 200,
    });

    const { passed, failed } = await runSmokeChecks(BASE_URL, undefined, fetch);
    expect(failed).toBe(3);
    expect(passed).toBe(0);
  });
});

describe('runSmokeChecks — game server tier', () => {
  it('skips game server checks when gameServerUrl is undefined', async () => {
    const fetch = makeFetch({ ...serverlessDefaults });

    const { results } = await runSmokeChecks(BASE_URL, undefined, fetch);
    expect(results).toHaveLength(3);
  });

  it('passes when game server internal/admin returns 200', async () => {
    const fetch = makeFetch({
      ...serverlessDefaults,
      [`${GAME_SERVER_URL}/internal/admin`]: 200,
    });

    const { passed, failed, results } = await runSmokeChecks(BASE_URL, GAME_SERVER_URL, fetch);
    expect(results).toHaveLength(4);
    expect(passed).toBe(4);
    expect(failed).toBe(0);
  });

  it('passes when game server internal/admin returns 401 (auth required)', async () => {
    const fetch = makeFetch({
      ...serverlessDefaults,
      [`${GAME_SERVER_URL}/internal/admin`]: 401,
    });

    const { passed, failed } = await runSmokeChecks(BASE_URL, GAME_SERVER_URL, fetch);
    expect(passed).toBe(4);
    expect(failed).toBe(0);
  });

  it('passes when game server internal/admin returns 503 (spun down)', async () => {
    const fetch = makeFetch({
      ...serverlessDefaults,
      [`${GAME_SERVER_URL}/internal/admin`]: 503,
    });

    const { passed, failed } = await runSmokeChecks(BASE_URL, GAME_SERVER_URL, fetch);
    expect(passed).toBe(4);
    expect(failed).toBe(0);
  });

  it('fails when game server returns unexpected status', async () => {
    const fetch = makeFetch({
      ...serverlessDefaults,
      [`${GAME_SERVER_URL}/internal/admin`]: 302,
    });

    const { results, failed } = await runSmokeChecks(BASE_URL, GAME_SERVER_URL, fetch);
    expect(failed).toBe(1);
    expect(results[3].ok).toBe(false);
    expect(results[3].error).toMatch(/Unexpected status 302/);
  });
});

describe('runSmokeChecks — fetch errors', () => {
  it('records failure when fetch throws (network error)', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const { failed, results } = await runSmokeChecks(BASE_URL, undefined, fetch);
    expect(failed).toBe(3);
    for (const r of results) {
      expect(r.ok).toBe(false);
      expect(r.error).toBe('ECONNREFUSED');
    }
  });
});
