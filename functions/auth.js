/**
 * auth.js — Shared authentication helpers for serverless function handlers.
 *
 * checkAdminAuth(headers, adminApiKey)
 *   Validates a Bearer token in the Authorization header against adminApiKey.
 *   Uses a constant-time comparison to prevent timing-based token enumeration.
 *
 *   Returns:
 *     { ok: true }                                        — authenticated
 *     { ok: false, status: 503, error: string }          — auth not configured
 *     { ok: false, status: 401, error: 'Unauthorized' }  — missing/wrong token
 */

import { timingSafeEqual } from 'node:crypto';

/**
 * Compare two strings in constant time to prevent timing attacks.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeEqual(a, b) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    // Still run a comparison to keep timing consistent.
    timingSafeEqual(aBuf, Buffer.alloc(aBuf.length));
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Check the Authorization: Bearer <token> header against the expected key.
 *
 * @param {Record<string, string | string[] | undefined>} headers
 * @param {string} adminApiKey — expected secret; if empty, auth is unconfigured.
 * @returns {{ ok: boolean, status?: number, error?: string }}
 */
export function checkAdminAuth(headers, adminApiKey) {
  if (!adminApiKey) {
    return { ok: false, status: 503, error: 'admin auth not configured' };
  }

  const authHeader = headers?.authorization ?? headers?.Authorization ?? '';
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  const token = authHeader.slice('Bearer '.length);
  if (!safeEqual(token, adminApiKey)) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  return { ok: true };
}
