import { describe, it, expect } from 'vitest';
import { checkAdminAuth } from './auth.js';

const VALID_KEY = 'super-secret-admin-key';

// ---------------------------------------------------------------------------
// Unconfigured key
// ---------------------------------------------------------------------------

describe('checkAdminAuth — unconfigured key', () => {
  it('returns 503 when adminApiKey is empty string', () => {
    const result = checkAdminAuth({ authorization: `Bearer ${VALID_KEY}` }, '');
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    expect(result.error).toMatch(/not configured/i);
  });

  it('returns 503 when adminApiKey is undefined', () => {
    const result = checkAdminAuth({ authorization: `Bearer ${VALID_KEY}` }, undefined);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
  });

  it('returns 503 when adminApiKey is null', () => {
    const result = checkAdminAuth({ authorization: `Bearer ${VALID_KEY}` }, null);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// Missing or malformed Authorization header
// ---------------------------------------------------------------------------

describe('checkAdminAuth — missing/malformed header', () => {
  it('returns 401 when Authorization header is absent', () => {
    const result = checkAdminAuth({}, VALID_KEY);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.error).toBe('Unauthorized');
  });

  it('returns 401 when Authorization header is empty string', () => {
    const result = checkAdminAuth({ authorization: '' }, VALID_KEY);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  it('returns 401 when Authorization is Basic scheme', () => {
    const result = checkAdminAuth({ authorization: 'Basic dXNlcjpwYXNz' }, VALID_KEY);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  it('returns 401 when Authorization is "Bearer" with no token', () => {
    const result = checkAdminAuth({ authorization: 'Bearer' }, VALID_KEY);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  it('returns 401 when headers object is null', () => {
    const result = checkAdminAuth(null, VALID_KEY);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  it('returns 401 when headers object is undefined', () => {
    const result = checkAdminAuth(undefined, VALID_KEY);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Wrong token
// ---------------------------------------------------------------------------

describe('checkAdminAuth — wrong token', () => {
  it('returns 401 for a completely wrong token', () => {
    const result = checkAdminAuth({ authorization: 'Bearer wrong-key' }, VALID_KEY);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.error).toBe('Unauthorized');
  });

  it('returns 401 for a token that is a prefix of the real key', () => {
    const result = checkAdminAuth({ authorization: `Bearer ${VALID_KEY.slice(0, 5)}` }, VALID_KEY);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  it('returns 401 for a token that is the real key plus extra characters', () => {
    const result = checkAdminAuth({ authorization: `Bearer ${VALID_KEY}extra` }, VALID_KEY);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  it('returns 401 for empty token (Bearer with trailing space only)', () => {
    const result = checkAdminAuth({ authorization: 'Bearer ' }, VALID_KEY);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Valid token
// ---------------------------------------------------------------------------

describe('checkAdminAuth — valid token', () => {
  it('returns ok:true for correct token (lowercase authorization header)', () => {
    const result = checkAdminAuth({ authorization: `Bearer ${VALID_KEY}` }, VALID_KEY);
    expect(result.ok).toBe(true);
    expect(result.status).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it('returns ok:true for correct token (capitalized Authorization header)', () => {
    const result = checkAdminAuth({ Authorization: `Bearer ${VALID_KEY}` }, VALID_KEY);
    expect(result.ok).toBe(true);
  });

  it('works with a single-character key', () => {
    const result = checkAdminAuth({ authorization: 'Bearer x' }, 'x');
    expect(result.ok).toBe(true);
  });

  it('works with a long key containing special characters', () => {
    const key = 'abc123!@#$%^&*()-_=+[]{}|;:,.<>?/~`';
    const result = checkAdminAuth({ authorization: `Bearer ${key}` }, key);
    expect(result.ok).toBe(true);
  });
});
