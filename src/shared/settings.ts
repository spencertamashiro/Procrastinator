// The one place settings are checked: on every change sent by the window, and when the
// saved file is read. Every field must have the expected type and range, or the previous
// (or default) value is kept, so nothing malformed reaches the rest of the app.

import { normalizeBaseUrl } from './canvas';
import type { CalendarRef, Feed, Place, Settings } from './types';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function oneOf<T extends string | number>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

function int(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;
}

const clock = (v: unknown, fallback: string): string => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : fallback);

function text(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s ? s.slice(0, max) : undefined;
}

function place(v: unknown): Place | null {
  if (!isRecord(v)) return null;
  const name = text(v.name, 100);
  const { lat, lon } = v;
  if (!name || typeof lat !== 'number' || typeof lon !== 'number') return null;
  if (!(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) return null;
  const out: Place = { name, lat, lon };
  const region = text(v.region, 100);
  const country = text(v.country, 100);
  if (region) out.region = region;
  if (country) out.country = country;
  return out;
}

function calendars(v: unknown, fallback: CalendarRef[]): CalendarRef[] {
  if (!Array.isArray(v)) return fallback;
  const out: CalendarRef[] = [];
  const ids = new Set<string>();
  for (const c of v.slice(0, 250)) {
    if (!isRecord(c) || typeof c.id !== 'string' || !c.id || c.id.length > 1024 || ids.has(c.id)) continue;
    ids.add(c.id);
    out.push({ id: c.id, name: text(c.name, 100) ?? c.id.slice(0, 100), enabled: bool(c.enabled, true) });
  }
  return out;
}

function feeds(v: unknown, fallback: Feed[]): Feed[] {
  if (!Array.isArray(v)) return fallback;
  const out: Feed[] = [];
  for (const f of v.slice(0, 100)) {
    if (!isRecord(f) || typeof f.id !== 'string' || !/^[\w-]{1,40}$/.test(f.id)) continue;
    out.push({ id: f.id, name: text(f.name, 60) ?? 'Calendar', host: text(f.host, 253) ?? '' });
  }
  return out;
}

/** A Google OAuth client ID looks like 1234-abc.apps.googleusercontent.com. */
const clientId = (v: unknown, fallback: string): string => (typeof v === 'string' && v.length <= 200 && /^[\w.-]*$/.test(v.trim()) ? v.trim() : fallback);

function baseUrl(v: unknown, fallback: string): string {
  if (v === '') return '';
  return typeof v === 'string' ? (normalizeBaseUrl(v) ?? fallback) : fallback;
}

/** `input` checked field by field; anything missing or malformed takes the value from `fallback`. */
export function sanitizeSettings(input: unknown, fallback: Settings): Settings {
  const s = isRecord(input) ? input : {};
  const sub = (key: string): Record<string, unknown> => {
    const v = s[key];
    return isRecord(v) ? v : {};
  };
  const f = fallback;
  const weather = sub('weather');
  const canvas = sub('canvas');
  const google = sub('google');
  const icloud = sub('icloud');
  const sync = sub('sync');
  const notify = sub('notify');
  return {
    theme: oneOf(s.theme, ['system', 'light', 'dark'] as const, f.theme),
    view: oneOf(s.view, ['month', 'week', 'day'] as const, f.view),
    rangeMode: oneOf(s.rangeMode, ['calendar', 'rolling'] as const, f.rangeMode),
    weekStartsOn: oneOf(s.weekStartsOn, [0, 1] as const, f.weekStartsOn),
    hour12: bool(s.hour12, f.hour12),
    density: oneOf(s.density, ['comfortable', 'compact'] as const, f.density),
    keepInTray: bool(s.keepInTray, f.keepInTray),
    launchAtLogin: bool(s.launchAtLogin, f.launchAtLogin),
    weather: {
      place: weather.place === null ? null : (place(weather.place) ?? f.weather.place),
      units: oneOf(weather.units, ['fahrenheit', 'celsius'] as const, f.weather.units),
    },
    canvas: {
      baseUrl: baseUrl(canvas.baseUrl, f.canvas.baseUrl),
      defaultEffortMin: int(canvas.defaultEffortMin, 5, 24 * 60, f.canvas.defaultEffortMin),
      showSubmitted: bool(canvas.showSubmitted, f.canvas.showSubmitted),
    },
    google: {
      clientId: clientId(google.clientId, f.google.clientId),
      calendars: calendars(google.calendars, f.google.calendars),
    },
    icloud: {
      username: typeof icloud.username === 'string' && icloud.username.length <= 320 ? icloud.username.trim() : f.icloud.username,
      calendars: calendars(icloud.calendars, f.icloud.calendars),
    },
    feeds: feeds(s.feeds, f.feeds),
    sync: {
      auto: bool(sync.auto, f.sync.auto),
      intervalMin: int(sync.intervalMin, 5, 24 * 60, f.sync.intervalMin),
      keepPastDays: int(sync.keepPastDays, 1, 365, f.sync.keepPastDays),
      horizonDays: int(sync.horizonDays, 14, 366, f.sync.horizonDays),
    },
    notify: {
      enabled: bool(notify.enabled, f.notify.enabled),
      headsUpMin: int(notify.headsUpMin, 15, 24 * 60, f.notify.headsUpMin),
      bufferPct: int(notify.bufferPct, 0, 200, f.notify.bufferPct),
      respectSleep: bool(notify.respectSleep, f.notify.respectSleep),
      sleepStart: clock(notify.sleepStart, f.notify.sleepStart),
      sleepEnd: clock(notify.sleepEnd, f.notify.sleepEnd),
      dailyDigest: bool(notify.dailyDigest, f.notify.dailyDigest),
      digestTime: clock(notify.digestTime, f.notify.digestTime),
    },
    categories: Array.isArray(s.categories)
      ? [...new Set(s.categories.map((c) => (typeof c === 'string' ? c.trim().slice(0, 40) : '')).filter(Boolean))].slice(0, 30)
      : f.categories,
  };
}

/**
 * The window may switch known calendars on and off, but never add, remove or rename one:
 * which calendars exist comes from the account itself.
 */
export function toggleOnly(known: CalendarRef[], requested: CalendarRef[]): CalendarRef[] {
  const wanted = new Map(requested.map((c) => [c.id, c.enabled]));
  return known.map((c) => ({ ...c, enabled: wanted.get(c.id) ?? c.enabled }));
}
