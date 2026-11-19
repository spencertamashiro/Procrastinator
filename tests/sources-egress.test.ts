// The transport enforces each policy, but only if callers name the right one. These tests
// pin the callers: iCloud traffic always uses the 'icloud' policy (including requests tsdav
// makes on its own), and the Canvas token never follows a "next page" link to another origin.

import { describe, expect, it, vi } from 'vitest';
import { parseIcs } from '../src/shared/ics';
import type { FetchFn, SafeRequestInit } from '../src/main/services/http';
import { inlineParser } from '../src/main/services/icsParser';
import { fetchCanvas, fetchICloud, icloudFetch } from '../src/main/services/sources';

interface Call {
  url: string;
  init: SafeRequestInit;
}

function recorder(answer: (url: string) => Response): { fetchFn: FetchFn; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetchFn: async (url, init = {}) => {
      calls.push({ url, init });
      return answer(url);
    },
  };
}

describe('icloudFetch', () => {
  it('sends every request under the icloud policy with method, headers, body and redirect mode intact', async () => {
    const { fetchFn, calls } = recorder(() => new Response('ok'));
    const fetch = icloudFetch(fetchFn);
    const headers = new Headers({ Depth: '1', Authorization: 'Basic dTpw' });
    await fetch('https://caldav.icloud.com/', { method: 'PROPFIND', headers, body: '<propfind/>', redirect: 'manual' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://caldav.icloud.com/');
    expect(calls[0].init).toMatchObject({ egress: 'icloud', method: 'PROPFIND', body: '<propfind/>', redirect: 'manual' });
    expect(calls[0].init.headers).toEqual({ depth: '1', authorization: 'Basic dTpw' });
  });

  it('cannot be talked into another policy by the caller', async () => {
    const { fetchFn, calls } = recorder(() => new Response('ok'));
    await icloudFetch(fetchFn)(new URL('https://p01-caldav.icloud.com/x'), { egress: 'public' } as RequestInit);
    expect(calls[0].init.egress).toBe('icloud');
    expect(calls[0].init.redirect).toBe('follow');
  });

  it('accepts a Request-like input and refuses a body that is not text', async () => {
    const { fetchFn, calls } = recorder(() => new Response('ok'));
    const fetch = icloudFetch(fetchFn);
    await fetch(new Request('https://p02-caldav.icloud.com/cal/'));
    expect(calls[0].url).toBe('https://p02-caldav.icloud.com/cal/');
    await expect(fetch('https://caldav.icloud.com/', { method: 'PUT', body: new Uint8Array([1]) })).rejects.toThrow(TypeError);
  });

  it('routes the requests tsdav makes during sign-in through the transport', async () => {
    // Tripwire: a request that skipped the transport would go to the global fetch instead,
    // and tsdav's discovery step could swallow its failure.
    const globalFetch = vi.fn(() => {
      throw new Error('global fetch used');
    });
    vi.stubGlobal('fetch', globalFetch);
    try {
      const { fetchFn, calls } = recorder(() => new Response('denied', { status: 401 }));
      const now = Date.UTC(2026, 10, 15);
      await expect(fetchICloud(fetchFn, inlineParser(parseIcs), 'me@example.com', 'abcd-efgh-ijkl-mnop', [], { start: now, end: now + 86_400_000 })).rejects.toThrow();
      expect(globalFetch).not.toHaveBeenCalled();
      expect(calls.length).toBeGreaterThan(0);
      for (const c of calls) {
        expect(c.init.egress).toBe('icloud');
        expect(new URL(c.url).hostname).toMatch(/(^|\.)icloud\.com$/);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('fetchCanvas pagination', () => {
  const base = 'https://canvas.school.example';
  const range = { start: Date.UTC(2026, 10, 1), end: Date.UTC(2026, 11, 1) };
  const page = (next: string | null): Response =>
    new Response('[]', { status: 200, headers: next ? { Link: `<${next}>; rel="next"` } : {} });

  it('follows next links on the same Canvas origin', async () => {
    const { fetchFn, calls } = recorder((url) => (url.includes('page=2') ? page(null) : page(`${base}/api/v1/planner/items?page=2`)));
    await fetchCanvas(fetchFn, base, 'TOKEN', range);
    expect(calls.map((c) => new URL(c.url).origin)).toEqual([base, base]);
    for (const c of calls) expect(c.init).toMatchObject({ egress: 'credentialed', headers: { Authorization: 'Bearer TOKEN' } });
  });

  it('does not send the token to a next link on another origin', async () => {
    const { fetchFn, calls } = recorder(() => page('https://evil.example/api/v1/planner/items?page=2'));
    await fetchCanvas(fetchFn, base, 'TOKEN', range);
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).origin).toBe(base);
  });
});
