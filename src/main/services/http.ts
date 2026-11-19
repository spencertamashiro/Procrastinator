// Request helpers shared by every network service. The transport (net.ts in the app, a
// fake in tests) decides where a request may go; these add status checks, parsing and
// the short messages shown in Settings.

import type { Egress } from './egress';
import { ParseTimeoutError } from './icsParser';

export interface SafeRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Who may receive this request, including after redirects (egress.ts). Default: 'credentialed'. */
  egress?: Egress;
  /** 'manual' hands a redirect back instead of following it; 'error' fails on any redirect. */
  redirect?: 'follow' | 'manual' | 'error';
  timeoutMs?: number;
  maxBytes?: number;
}

export type FetchFn = (url: string, init?: SafeRequestInit) => Promise<Response>;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** A request stopped because of where it would have gone; the message says why, for the user. */
export class BlockedRequestError extends Error {}

/** Status, headers and body text, whatever the status. */
export async function request(fetchFn: FetchFn, url: string, init: SafeRequestInit = {}): Promise<{ ok: boolean; status: number; text: string; headers: Headers }> {
  const res = await fetchFn(url, init);
  return { ok: res.ok, status: res.status, text: await res.text(), headers: res.headers };
}

export async function fetchText(fetchFn: FetchFn, url: string, init: SafeRequestInit = {}): Promise<{ text: string; headers: Headers }> {
  const res = await fetchFn(url, init);
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new HttpError(res.status, `Request failed with status ${res.status}`);
  }
  return { text: await res.text(), headers: res.headers };
}

export async function fetchJson(fetchFn: FetchFn, url: string, init: SafeRequestInit = {}): Promise<{ json: unknown; headers: Headers }> {
  const { text, headers } = await fetchText(fetchFn, url, init);
  try {
    return { json: JSON.parse(text) as unknown, headers };
  } catch {
    throw new Error('The service returned something that was not JSON.');
  }
}

const WEB_ADDRESS = /\b(?:https?|webcals?|wss?):\/\/[^\s"'<>]+/gi;

/**
 * Keeps only the scheme and host of every web address in `text`. Paths and queries can
 * hold secrets (a private calendar feed's address works like a password), and error
 * messages end up in logs and in the saved sync status.
 */
export function redactUrls(text: string): string {
  return text.replace(WEB_ADDRESS, (m) => {
    try {
      const u = new URL(m);
      return `${u.protocol}//${u.host}/…`;
    } catch {
      return '[address]';
    }
  });
}

const OFFLINE = /ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ERR_CONNECTION|ERR_ADDRESS_UNREACHABLE|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|fetch failed|network/i;

/** A short message for the Settings screen. Never contains a full web address. */
export function describeError(err: unknown): string {
  if (err instanceof HttpError) {
    if (err.status === 401 || err.status === 403) return 'Sign-in was rejected. Check the credentials and connect again.';
    if (err.status === 404) return 'Not found. Check the address.';
    if (err.status === 429) return 'The service is rate-limiting requests. It will be retried later.';
    return `The service answered with an error (${err.status}).`;
  }
  if (err instanceof BlockedRequestError) return redactUrls(err.message);
  if (err instanceof ParseTimeoutError) return err.message; // a slow file, not a slow network
  const message = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  if (/TimeoutError|AbortError|timed out/i.test(message)) return 'The request timed out. Showing the saved copy.';
  if (OFFLINE.test(message)) return 'Offline. Showing the saved copy.';
  if (/ERR_CERT|ERR_SSL/i.test(message)) return 'The secure connection could not be verified, so nothing was loaded.';
  return redactUrls(err instanceof Error ? err.message : 'Something went wrong.').slice(0, 300);
}
