import { describe, it, expect, vi } from 'vitest';
import { redactUrls, describeError, request, fetchText, fetchJson, HttpError, BlockedRequestError,
  type FetchFn, type SafeRequestInit } from '../src/main/services/http';
import { ParseTimeoutError } from '../src/main/services/icsParser';

describe('redactUrls', () => {
  it.each(['http', 'https', 'webcal', 'webcals', 'ws', 'wss'])('retains only scheme and host for %s', (scheme) => {
    expect(redactUrls(`${scheme}://user:password@example.com:8443/private/feed?token=secret#fragment`))
      .toBe(`${scheme}://example.com:8443/\u2026`);
  });
  it('redacts several addresses in one message', () => {
    expect(redactUrls('Failed https://a.example/secret?q=token and webcal://u:p@b.example/private then wss://c.example/token'))
      .toBe('Failed https://a.example/\u2026 and webcal://b.example/\u2026 then wss://c.example/\u2026');
  });
  it('keeps text without addresses', () => expect(redactUrls('Try again later.')).toBe('Try again later.'));
});

describe('describeError', () => {
  it('says a calendar was too slow to read, not that the network timed out', () => {
    // Found by the packaged-build probe: the name "ParseTimeoutError" matched the network timeout check.
    expect(describeError(new ParseTimeoutError())).toBe(new ParseTimeoutError().message);
    expect(describeError(new ParseTimeoutError())).not.toMatch(/request timed out/);
  });
  it.each([
    [401, 'Sign-in was rejected. Check the credentials and connect again.'],
    [403, 'Sign-in was rejected. Check the credentials and connect again.'],
    [404, 'Not found. Check the address.'],
    [429, 'The service is rate-limiting requests. It will be retried later.'],
    [500, 'The service answered with an error (500).'],
  ] as const)('describes HTTP %s', (status, message) => {
    expect(describeError(new HttpError(status, 'private details'))).toBe(message);
  });
  it('redacts the URL in a blocked request error', () => {
    expect(describeError(new BlockedRequestError('Blocked https://user:password@example.com/private?token=secret')))
      .toBe('Blocked https://example.com/\u2026');
  });
  it.each(['TimeoutError', 'AbortError'])('describes %s as a timeout', (name) => {
    const error = new Error('Stopped');
    error.name = name;
    expect(describeError(error)).toBe('The request timed out. Showing the saved copy.');
  });
  it('describes an offline transport error', () => {
    expect(describeError(new Error('net::ERR_INTERNET_DISCONNECTED'))).toBe('Offline. Showing the saved copy.');
  });
  it('describes a certificate error', () => {
    expect(describeError(new Error('net::ERR_CERT_AUTHORITY_INVALID'))).toBe('The secure connection could not be verified, so nothing was loaded.');
  });
  it('redacts secret feed URLs and bounds plain error messages', () => {
    const message = describeError(new Error(`Cannot read https://user:password@example.com/private-feed?token=secret ${'x'.repeat(500)}`));
    expect(message).toContain('https://example.com/\u2026');
    for (const secret of ['user', 'password', 'private-feed', 'token', 'secret']) expect(message).not.toContain(secret);
    expect(message.length).toBeLessThanOrEqual(300);
  });
  it('handles a non-Error value', () => expect(describeError({ reason: 'unknown' })).toBe('Something went wrong.'));
});

describe('HTTP helpers', () => {
  it.each([400, 401, 404, 500])('fetchText throws HttpError for HTTP %s', async (status) => {
    const fetch: FetchFn = vi.fn(async () => new Response('failure', { status }));
    const failure = fetchText(fetch, 'https://example.com');
    await expect(failure).rejects.toBeInstanceOf(HttpError);
    await expect(failure).rejects.toMatchObject({ status });
  });
  it('request returns non-2xx status, headers and body without throwing', async () => {
    const fetch: FetchFn = vi.fn(async () => new Response('failure', { status: 503, headers: { 'x-test': 'value' } }));
    const result = await request(fetch, 'https://example.com');
    expect(result).toMatchObject({ ok: false, status: 503, text: 'failure' });
    expect(result.headers.get('x-test')).toBe('value');
  });
  it('fetchJson gives a friendly invalid JSON error', async () => {
    const fetch: FetchFn = vi.fn(async () => new Response('{broken'));
    await expect(fetchJson(fetch, 'https://example.com')).rejects.toThrow('The service returned something that was not JSON.');
  });
  it.each(['request', 'fetchText', 'fetchJson'] as const)('%s passes the original init and headers to the transport', async (name) => {
    const fetch = vi.fn<FetchFn>(async () => new Response('{"ok":true}', { headers: { 'x-test': 'value' } }));
    const init: SafeRequestInit = { egress: 'public', headers: { Authorization: 'Bearer test' }, method: 'POST',
      body: 'body', redirect: 'manual', timeoutMs: 50, maxBytes: 1024 };
    const result = await ({ request, fetchText, fetchJson })[name](fetch, 'https://example.com/feed', init);
    expect(fetch).toHaveBeenCalledExactlyOnceWith('https://example.com/feed', init);
    expect(fetch.mock.calls[0][1]).toBe(init);
    expect(fetch.mock.calls[0][1]?.headers).toBe(init.headers);
    expect(result.headers.get('x-test')).toBe('value');
    if (name === 'fetchJson') expect(result).toHaveProperty('json', { ok: true });
    else expect(result).toHaveProperty('text', '{"ok":true}');
  });
});
