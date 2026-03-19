import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWithTimeout, FETCH_TIMEOUT_MS } from './api.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('fetchWithTimeout', () => {
  it('throws "Request timed out" when fetch does not resolve before the timeout', async () => {
    vi.useFakeTimers();

    // Mock fetch that honours the AbortSignal so aborting rejects the promise.
    vi.stubGlobal('fetch', vi.fn((_url, opts) =>
      new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The user aborted a request.', 'AbortError'));
        });
      }),
    ));

    // Race the fetch against the timer advance so the rejection is always
    // handled — avoiding the "PromiseRejectionHandledWarning" Vitest emits
    // when a rejection exists before the catch handler is attached.
    const [result] = await Promise.allSettled([
      fetchWithTimeout('/api/test'),
      vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS + 1),
    ]);

    expect(result.status).toBe('rejected');
    expect(result.reason.message).toBe('Request timed out');
  });

  it('resolves normally and leaves no dangling timer when fetch resolves before the timeout', async () => {
    const mockResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(mockResponse)));

    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    const res = await fetchWithTimeout('/api/test');

    expect(res.status).toBe(200);
    // clearTimeout must have been called once to cancel the abort timer.
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
  });
});
