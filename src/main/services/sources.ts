// One function per outside service. Each takes the transport (and, for calendar files, the
// parser) so it can be exercised without the network. Nothing here ever writes to a remote
// calendar or to Canvas: every request is a read.
//
// Each request names its egress policy (egress.ts): requests carrying a token stay on the
// origin they were sent to, the Apple password only ever goes to iCloud, and public data
// (feeds, weather) may not redirect into the local network.

import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createDAVClient } from 'tsdav';
import { mapPlannerItems, nextLink, plannerUrl } from '../../shared/canvas';
import { eventsUrl, GOOGLE_SCOPES, mapCalendarList, mapGoogleEvents } from '../../shared/google';
import type { IcsResult } from '../../shared/ics';
import { addDays, dayKey } from '../../shared/time';
import { forecastUrl, geocodeUrl, mapForecast, mapPlaces } from '../../shared/weather';
import type { Assignment, CalendarRef, CalEvent, Place, TempUnit, WeatherCache } from '../../shared/types';
import { fetchJson, fetchText, HttpError, request, type FetchFn } from './http';
import { parseOne, type IcsParser } from './icsParser';

export interface Range {
  start: number;
  end: number;
}

// ------------------------------------------------------------------ weather

export async function fetchWeather(fetchFn: FetchFn, place: Place, units: TempUnit): Promise<WeatherCache> {
  const { json } = await fetchJson(fetchFn, forecastUrl(place, units), { egress: 'public' });
  const now = Date.now();
  return mapForecast(json, place, units, new Date(now).toISOString(), dayKey(addDays(now, -1)));
}

export async function searchPlaces(fetchFn: FetchFn, query: string): Promise<Place[]> {
  const { json } = await fetchJson(fetchFn, geocodeUrl(query), { egress: 'public', maxBytes: 1024 * 1024 });
  return mapPlaces(json);
}

// ------------------------------------------------------------------ .ics feeds

export async function fetchFeed(fetchFn: FetchFn, parser: IcsParser, url: string, sourceId: string, name: string, range: Range): Promise<IcsResult> {
  const { text } = await fetchText(fetchFn, url, { egress: 'public', headers: { Accept: 'text/calendar, text/plain;q=0.8' } });
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('That address did not return a calendar (.ics) file.');
  return parseOne(parser, text, { sourceId, calendar: name || undefined, rangeStart: range.start, rangeEnd: range.end });
}

// ------------------------------------------------------------------ Canvas

const MAX_CANVAS_PAGES = 40;

export async function fetchCanvas(fetchFn: FetchFn, baseUrl: string, token: string, range: Range): Promise<Assignment[]> {
  const origin = new URL(baseUrl).origin;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const out = new Map<string, Assignment>();
  let url: string | null = plannerUrl(baseUrl, range.start, range.end);
  for (let page = 0; url && page < MAX_CANVAS_PAGES; page++) {
    // The token is only ever sent to the Canvas host the user entered (the transport also
    // refuses to follow a redirect anywhere else).
    if (new URL(url).origin !== origin) break;
    const { json, headers: resHeaders } = await fetchJson(fetchFn, url, { headers, egress: 'credentialed' });
    for (const a of mapPlannerItems(json, baseUrl)) out.set(a.key, a);
    url = nextLink(resHeaders.get('link'));
  }
  return [...out.values()];
}

// ------------------------------------------------------------------ Google

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  /** Epoch ms. */
  expires_at: number;
}

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE = 'https://oauth2.googleapis.com/revoke';
const AUTH_TIMEOUT_MS = 4 * 60_000;

const b64url = (buf: Buffer): string => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

async function tokenRequest(fetchFn: FetchFn, body: Record<string, string>, previous?: GoogleTokens): Promise<GoogleTokens> {
  // The body carries the client secret and the code or refresh token, so the request may not
  // be redirected anywhere else (egress 'credentialed').
  const res = await request(fetchFn, GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
    egress: 'credentialed',
    maxBytes: 64 * 1024,
  });
  let json: unknown = null;
  try {
    json = JSON.parse(res.text);
  } catch {
    // reported below
  }
  if (!res.ok || !isRecord(json) || typeof json.access_token !== 'string') {
    // An expired or revoked refresh token (common for apps in Google's "Testing" mode).
    if (isRecord(json) && json.error === 'invalid_grant') throw new HttpError(401, 'Google sign-in has expired or was revoked.');
    const detail = isRecord(json) && typeof json.error_description === 'string' ? json.error_description.slice(0, 200) : `status ${res.status}`;
    throw new HttpError(res.status === 200 ? 400 : res.status, `Google did not issue a token (${detail}).`);
  }
  return {
    access_token: json.access_token,
    refresh_token: typeof json.refresh_token === 'string' ? json.refresh_token : previous?.refresh_token,
    expires_at: Date.now() + (typeof json.expires_in === 'number' ? json.expires_in : 3600) * 1000,
  };
}

const DONE_PAGE = `<!doctype html><meta charset="utf-8"><title>Procrastinator</title>
<body style="font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#0d0c14;color:#eeecf8">
<div style="text-align:center"><h1 style="font-weight:400">Connected</h1><p>You can close this tab and return to Procrastinator.</p></div>`;

/**
 * OAuth 2.0 for desktop apps: opens the system browser, receives the code on a
 * loopback port, and exchanges it using PKCE. Read-only calendar scopes only.
 */
export async function googleAuthorize(
  fetchFn: FetchFn,
  clientId: string,
  clientSecret: string | null,
  openBrowser: (url: string) => void,
): Promise<GoogleTokens> {
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(16));

  const server = http.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Sign-in was not finished in time.')), AUTH_TIMEOUT_MS);
      server.on('request', (req, res) => {
        const url = new URL(req.url ?? '/', redirectUri);
        if (url.pathname !== '/') {
          res.writeHead(404).end();
          return;
        }
        const got = url.searchParams.get('code');
        const err = url.searchParams.get('error');
        if (url.searchParams.get('state') !== state || (!got && !err)) {
          res.writeHead(400, { 'Content-Type': 'text/plain' }).end('Unexpected request.');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(DONE_PAGE);
        clearTimeout(timer);
        if (got) resolve(got);
        else reject(new Error(`Google sign-in was cancelled (${String(err).slice(0, 60)}).`));
      });
      const q = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: GOOGLE_SCOPES,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        access_type: 'offline',
        prompt: 'consent',
      });
      openBrowser(`${GOOGLE_AUTH}?${q}`);
    });
    const body: Record<string, string> = {
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    };
    if (clientSecret) body.client_secret = clientSecret;
    return await tokenRequest(fetchFn, body);
  } finally {
    server.close();
  }
}

export async function googleRefresh(fetchFn: FetchFn, clientId: string, clientSecret: string | null, tokens: GoogleTokens): Promise<GoogleTokens> {
  if (!tokens.refresh_token) throw new HttpError(401, 'Google sign-in has expired.');
  const body: Record<string, string> = { grant_type: 'refresh_token', client_id: clientId, refresh_token: tokens.refresh_token };
  if (clientSecret) body.client_secret = clientSecret;
  return tokenRequest(fetchFn, body, tokens);
}

/** Tells Google to cancel the grant (best effort), so a disconnected app holds no live access. */
export async function googleRevoke(fetchFn: FetchFn, tokens: GoogleTokens): Promise<void> {
  const token = tokens.refresh_token ?? tokens.access_token;
  await request(fetchFn, GOOGLE_REVOKE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }).toString(),
    egress: 'credentialed',
    timeoutMs: 10_000,
    maxBytes: 64 * 1024,
  });
}

export async function googleCalendars(fetchFn: FetchFn, accessToken: string, previous: CalendarRef[]): Promise<CalendarRef[]> {
  const { json } = await fetchJson(fetchFn, 'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250', {
    headers: { Authorization: `Bearer ${accessToken}` },
    egress: 'credentialed',
  });
  return mapCalendarList(json, previous);
}

export async function googleEvents(fetchFn: FetchFn, accessToken: string, calendar: CalendarRef, range: Range): Promise<CalEvent[]> {
  const out: CalEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const { json } = await fetchJson(fetchFn, eventsUrl(calendar.id, range.start, range.end, pageToken), {
      headers: { Authorization: `Bearer ${accessToken}` },
      egress: 'credentialed',
    });
    out.push(...mapGoogleEvents(json, calendar));
    pageToken = isRecord(json) && typeof json.nextPageToken === 'string' ? json.nextPageToken : undefined;
    if (!pageToken) break;
  }
  return out;
}

// ------------------------------------------------------------------ Apple iCloud (CalDAV)

const ICLOUD_CALDAV = 'https://caldav.icloud.com';
/** Calendar objects are parsed in batches of this many per worker run. */
const ICLOUD_PARSE_BATCH = 400;
const ICLOUD_MAX_EVENTS = 20_000;

/**
 * tsdav (the CalDAV client) with every request routed through the transport under the
 * `icloud` policy. That covers the absolute addresses iCloud's own replies point to (the
 * calendar home lives on another iCloud host), so the Apple password can only reach iCloud.
 */
export function icloudFetch(fetchFn: FetchFn): typeof globalThis.fetch {
  return async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = init.body;
    if (body !== undefined && body !== null && typeof body !== 'string') throw new TypeError('Unsupported request body for CalDAV.');
    return fetchFn(url, {
      method: init.method,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: body ?? undefined,
      egress: 'icloud',
      redirect: init.redirect === 'manual' ? 'manual' : init.redirect === 'error' ? 'error' : 'follow',
      timeoutMs: 30_000,
      maxBytes: 24 * 1024 * 1024,
    });
  };
}

type DavClient = Awaited<ReturnType<typeof createDAVClient>>;

async function icloudClient(fetchFn: FetchFn, username: string, appPassword: string): Promise<DavClient> {
  try {
    return await createDAVClient({
      serverUrl: ICLOUD_CALDAV,
      credentials: { username, password: appPassword },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
      fetch: icloudFetch(fetchFn),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/401|403|unauthor|Invalid credentials/i.test(message)) {
      throw new HttpError(401, 'Apple rejected the sign-in. Use your Apple Account email and an app-specific password.');
    }
    throw err;
  }
}

function davName(displayName: unknown, fallback: string): string {
  return typeof displayName === 'string' && displayName.trim() ? displayName.trim().slice(0, 100) : fallback;
}

/** Signs in and returns the account's event calendars and their events. Reads only. */
export async function fetchICloud(
  fetchFn: FetchFn,
  parser: IcsParser,
  username: string,
  appPassword: string,
  previous: CalendarRef[],
  range: Range,
): Promise<{ calendars: CalendarRef[]; events: CalEvent[]; truncated: boolean; skipped: number }> {
  const client = await icloudClient(fetchFn, username, appPassword);
  const all = await client.fetchCalendars();
  const eventCalendars = all.filter((c) => !c.components || c.components.includes('VEVENT')).slice(0, 100);
  const prior = new Map(previous.map((c) => [c.id, c.enabled]));
  const calendars: CalendarRef[] = eventCalendars.map((c, i) => ({
    id: c.url,
    name: davName(c.displayName, `Calendar ${i + 1}`),
    enabled: prior.get(c.url) ?? true,
  }));
  const events: CalEvent[] = [];
  let truncated = false;
  let skipped = 0;
  for (const cal of eventCalendars) {
    const ref = calendars.find((c) => c.id === cal.url);
    if (!ref?.enabled) continue;
    const objects = await client.fetchCalendarObjects({
      calendar: cal,
      timeRange: { start: new Date(range.start).toISOString(), end: new Date(range.end).toISOString() },
      expand: true,
    });
    const texts = objects.map((o) => o.data).filter((d): d is string => typeof d === 'string' && d.includes('BEGIN:VCALENDAR'));
    for (let i = 0; i < texts.length; i += ICLOUD_PARSE_BATCH) {
      const jobs = texts.slice(i, i + ICLOUD_PARSE_BATCH).map((text) => ({
        text,
        options: { sourceId: 'icloud', calendar: ref.name, rangeStart: range.start, rangeEnd: range.end },
      }));
      for (const outcome of await parser(jobs)) {
        if (!outcome.ok) {
          skipped++;
          continue;
        }
        events.push(...outcome.result.events);
        if (outcome.result.truncated) truncated = true;
        skipped += outcome.result.skipped ?? 0;
      }
      if (events.length >= ICLOUD_MAX_EVENTS) break;
    }
    if (events.length >= ICLOUD_MAX_EVENTS) {
      truncated = true;
      break;
    }
  }
  return { calendars, events: events.slice(0, ICLOUD_MAX_EVENTS), truncated, skipped };
}
