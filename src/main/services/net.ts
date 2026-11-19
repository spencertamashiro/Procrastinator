// The only way the app talks to the network. Built on Electron's net.request (Chromium's
// network stack, so system proxy settings and certificates apply) rather than net.fetch,
// because net.fetch follows a redirect to any other server with the Authorization header
// still attached, and cannot hand a redirect back for inspection.
//
// Every request:
// - is checked against its egress policy (egress.ts) before it starts and at every redirect;
// - sends no cookies and stores none, and is never cached;
// - has a deadline, and stops reading once the reply passes a size limit.

import { net } from 'electron';
import { blockReason, redirectBlockReason } from './egress';
import { BlockedRequestError, type FetchFn } from './http';

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 12 * 1024 * 1024;

function toHeaders(raw: Record<string, string | string[]>): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(raw)) {
    try {
      for (const one of Array.isArray(v) ? v : [v]) h.append(k, one);
    } catch {
      // A header value the Headers class refuses; nothing here needs it.
    }
  }
  return h;
}

/** A Response for the body already read (statuses 204/205/304 cannot carry one). */
function makeResponse(status: number, statusText: string, headers: Headers, body: Buffer | null, url: string): Response {
  const empty = status === 204 || status === 205 || status === 304 || !body || body.length === 0;
  const res = new Response(empty ? null : new Uint8Array(body), { status, statusText, headers });
  Object.defineProperty(res, 'url', { value: url });
  return res;
}

export function createTransport(opts: { offline: () => boolean }): FetchFn {
  return (url, init = {}) =>
    new Promise<Response>((resolve, reject) => {
      if (opts.offline()) {
        reject(new Error('net::ERR_INTERNET_DISCONNECTED (simulated)'));
        return;
      }
      let original: URL;
      try {
        original = new URL(url);
      } catch {
        reject(new BlockedRequestError('That is not a web address.'));
        return;
      }
      const egress = init.egress ?? 'credentialed';
      const blocked = blockReason(egress, original);
      if (blocked) {
        reject(new BlockedRequestError(blocked));
        return;
      }
      const maxBytes = init.maxBytes ?? DEFAULT_MAX_BYTES;
      const mode = init.redirect ?? 'follow';

      const req = net.request({
        method: init.method ?? 'GET',
        url: original.href,
        redirect: 'manual',
        credentials: 'omit',
        useSessionCookies: false,
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });

      let settled = false;
      const settle = (fn: () => void, abort = false): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (abort) req.abort();
        fn();
      };
      const timer = setTimeout(() => {
        const err = new Error('The request timed out.');
        err.name = 'TimeoutError';
        settle(() => reject(err), true);
      }, init.timeoutMs ?? DEFAULT_TIMEOUT_MS);

      let current = original;
      let hops = 0;
      req.on('redirect', (status, _method, redirectUrl, responseHeaders) => {
        if (mode === 'manual') {
          // CalDAV discovery reads the Location header itself; hand the redirect back.
          settle(() => resolve(makeResponse(status, '', toHeaders(responseHeaders), null, current.href)), true);
          return;
        }
        let target: URL;
        try {
          target = new URL(redirectUrl, current);
        } catch {
          settle(() => reject(new BlockedRequestError('The service redirected to an unreadable address.')), true);
          return;
        }
        hops += 1;
        const why = mode === 'error' ? 'The service redirected the request, which is not allowed here.' : redirectBlockReason(egress, original, target, hops);
        if (why) {
          settle(() => reject(new BlockedRequestError(why)), true);
          return;
        }
        current = target;
        req.followRedirect();
      });

      req.on('response', (res) => {
        const headers = toHeaders(res.headers);
        const declared = Number(headers.get('content-length'));
        if (Number.isFinite(declared) && declared > maxBytes) {
          settle(() => reject(new Error('The response was too large to load.')), true);
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          if (settled) return;
          size += chunk.length;
          if (size > maxBytes) {
            settle(() => reject(new Error('The response was too large to load.')), true);
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => settle(() => resolve(makeResponse(res.statusCode, res.statusMessage, headers, Buffer.concat(chunks), current.href))));
        res.on('error', (err: Error) => settle(() => reject(err)));
        res.on('aborted', () => settle(() => reject(new Error('The connection was closed before the reply finished.'))));
      });

      // A 401 asking for a password is returned as-is; the app never shows a login prompt.
      req.on('login', (_authInfo, callback) => callback());
      req.on('error', (err) => settle(() => reject(err)));

      for (const [name, value] of Object.entries(init.headers ?? {})) req.setHeader(name, value);
      if (init.body !== undefined) req.write(init.body);
      req.end();
    });
}
