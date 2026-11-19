// Pulls every connected source into the local store. A failed source keeps its saved
// copy and records why, which is what makes the app usable offline.

import { normalizeFeedUrl } from '../shared/ics';
import { addDays } from '../shared/time';
import type { SourceStatus } from '../shared/types';
import type { Secrets } from './secrets';
import { describeError, redactUrls, type FetchFn } from './services/http';
import type { IcsParser } from './services/icsParser';
import {
  fetchCanvas,
  fetchFeed,
  fetchICloud,
  fetchWeather,
  googleCalendars,
  googleEvents,
  googleRefresh,
  type GoogleTokens,
  type Range,
} from './services/sources';
import type { Store } from './store';

const WEATHER_FRESH_MS = 30 * 60_000;

/** What one source's sync brought in, and anything worth telling the user about it. */
interface Pulled {
  count: number;
  warning?: string;
}

/** The note shown when limits or unreadable entries left events out of a calendar. */
export function partialWarning(truncated: boolean, skipped: number): string | undefined {
  const parts: string[] = [];
  if (truncated) parts.push('This calendar is unusually large, so some repeating events were left out.');
  if (skipped > 0) parts.push(`${skipped} ${skipped === 1 ? 'event' : 'events'} could not be read and ${skipped === 1 ? 'was' : 'were'} left out.`);
  return parts.length ? parts.join(' ') : undefined;
}

export const SECRET = {
  googleTokens: 'google.tokens',
  googleClientSecret: 'google.clientSecret',
  icloudPassword: 'icloud.password',
  canvasToken: 'canvas.token',
  feed: (id: string): string => `feed.${id}`,
};

export class SyncService {
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(
    private readonly store: Store,
    private readonly secrets: Secrets,
    private readonly fetchFn: FetchFn,
    private readonly parser: IcsParser,
  ) {}

  range(): Range {
    const now = Date.now();
    const s = this.store.data.settings.sync;
    return { start: addDays(now, -s.keepPastDays), end: addDays(now, s.horizonDays) };
  }

  /** Sources that are configured right now. */
  sources(): string[] {
    const { settings } = this.store.data;
    const out: string[] = [];
    if (settings.weather.place) out.push('weather');
    if (this.secrets.has(SECRET.googleTokens)) out.push('google');
    if (this.secrets.has(SECRET.icloudPassword)) out.push('icloud');
    if (this.secrets.has(SECRET.canvasToken)) out.push('canvas');
    for (const f of settings.feeds) out.push(`feed:${f.id}`);
    return out;
  }

  async syncAll(force = false): Promise<void> {
    await Promise.all(this.sources().map((s) => this.sync(s, force)));
    this.store.update(() => this.store.prune(Date.now()));
  }

  /** Syncs one source; concurrent calls for the same source share one run. */
  sync(source: string, force = false): Promise<void> {
    const running = this.inflight.get(source);
    if (running) return running;
    const run = this.run(source, force).finally(() => this.inflight.delete(source));
    this.inflight.set(source, run);
    return run;
  }

  private setStatus(source: string, patch: Partial<SourceStatus>): void {
    this.store.update((d) => {
      const next = { ...d.sync[source], ...patch };
      if (next.lastError === undefined) delete next.lastError;
      if (next.warning === undefined) delete next.warning;
      d.sync[source] = next;
    });
  }

  private async run(source: string, force: boolean): Promise<void> {
    this.setStatus(source, { syncing: true });
    try {
      const { count, warning } = await this.pull(source, force);
      this.setStatus(source, { syncing: false, lastSync: new Date().toISOString(), lastError: undefined, warning, count });
    } catch (err) {
      // Messages can carry addresses, and a private feed's address works like a password.
      console.warn(`[sync] ${source} failed:`, redactUrls(err instanceof Error ? err.message : String(err)));
      this.setStatus(source, { syncing: false, lastError: describeError(err) });
    }
  }

  private async pull(source: string, force: boolean): Promise<Pulled> {
    if (source === 'weather') return this.pullWeather(force);
    if (source === 'google') return this.pullGoogle();
    if (source === 'icloud') return this.pullICloud();
    if (source === 'canvas') return this.pullCanvas();
    if (source.startsWith('feed:')) return this.pullFeed(source.slice(5));
    throw new Error(`Unknown source "${source}"`);
  }

  private async pullWeather(force: boolean): Promise<Pulled> {
    const { place, units } = this.store.data.settings.weather;
    if (!place) throw new Error('Choose a location first.');
    const cache = this.store.data.weather;
    const samePlace = cache && cache.place.lat === place.lat && cache.place.lon === place.lon && cache.units === units;
    if (!force && samePlace && Date.now() - Date.parse(cache.fetchedAt) < WEATHER_FRESH_MS) return { count: cache.days.length };
    const fresh = await fetchWeather(this.fetchFn, place, units);
    this.store.update((d) => {
      d.weather = fresh;
    });
    return { count: fresh.days.length };
  }

  private async pullGoogle(): Promise<Pulled> {
    const raw = await this.secrets.get(SECRET.googleTokens);
    if (!raw) throw new Error('Google is not connected.');
    const clientId = this.store.data.settings.google.clientId;
    let tokens = JSON.parse(raw) as GoogleTokens;
    if (tokens.expires_at < Date.now() + 60_000) {
      tokens = await googleRefresh(this.fetchFn, clientId, await this.secrets.get(SECRET.googleClientSecret), tokens);
      await this.secrets.set(SECRET.googleTokens, JSON.stringify(tokens));
    }
    const calendars = await googleCalendars(this.fetchFn, tokens.access_token, this.store.data.settings.google.calendars);
    const range = this.range();
    const lists = await Promise.all(calendars.filter((c) => c.enabled).map((c) => googleEvents(this.fetchFn, tokens.access_token, c, range)));
    const events = lists.flat();
    this.store.update((d) => {
      d.settings.google.calendars = calendars;
      d.events = d.events.filter((e) => e.sourceId !== 'google').concat(events);
    });
    return { count: events.length };
  }

  private async pullICloud(): Promise<Pulled> {
    const password = await this.secrets.get(SECRET.icloudPassword);
    const { username, calendars: previous } = this.store.data.settings.icloud;
    if (!password || !username) throw new Error('iCloud is not connected.');
    const { calendars, events, truncated, skipped } = await fetchICloud(this.fetchFn, this.parser, username, password, previous, this.range());
    this.store.update((d) => {
      d.settings.icloud.calendars = calendars;
      d.events = d.events.filter((e) => e.sourceId !== 'icloud').concat(events);
    });
    return { count: events.length, warning: partialWarning(truncated, skipped) };
  }

  private async pullCanvas(): Promise<Pulled> {
    const token = await this.secrets.get(SECRET.canvasToken);
    const baseUrl = this.store.data.settings.canvas.baseUrl;
    if (!token || !baseUrl) throw new Error('Canvas is not connected.');
    const assignments = await fetchCanvas(this.fetchFn, baseUrl, token, this.range());
    const keys = new Set(assignments.map((a) => a.key));
    this.store.update((d) => {
      // The API knows whether work was submitted, so it wins over a feed copy of the same assignment.
      d.assignments = d.assignments.filter((a) => a.sourceId !== 'canvas' && !keys.has(a.key)).concat(assignments);
    });
    return { count: assignments.length };
  }

  private async pullFeed(id: string): Promise<Pulled> {
    const feed = this.store.data.settings.feeds.find((f) => f.id === id);
    const stored = await this.secrets.get(SECRET.feed(id));
    if (!feed || !stored) throw new Error('This feed is no longer configured.');
    // Feeds saved by older versions may be http://; the address is a secret, so it is upgraded.
    const url = normalizeFeedUrl(stored);
    if (!url) throw new Error('This feed’s address is no longer accepted. Remove it and add it again.');
    const sourceId = `feed:${id}`;
    const result = await fetchFeed(this.fetchFn, this.parser, url, sourceId, feed.name, this.range());
    this.store.update((d) => {
      const fromApi = new Set(d.assignments.filter((a) => a.sourceId === 'canvas').map((a) => a.key));
      d.events = d.events.filter((e) => e.sourceId !== sourceId).concat(result.events);
      d.assignments = d.assignments
        .filter((a) => a.sourceId !== sourceId)
        .concat(result.assignments.filter((a) => !fromApi.has(a.key)));
    });
    return { count: result.events.length + result.assignments.length, warning: partialWarning(!!result.truncated, result.skipped ?? 0) };
  }

  /** Forgets a source's cached data and status. */
  dropSource(sourceId: string): void {
    this.store.update((d) => {
      d.events = d.events.filter((e) => e.sourceId !== sourceId);
      d.assignments = d.assignments.filter((a) => a.sourceId !== sourceId);
      delete d.sync[sourceId];
    });
  }
}
