import type { DeepPartial, Persisted, Settings } from './types';

export function defaultSettings(): Settings {
  return {
    theme: 'system',
    view: 'week',
    rangeMode: 'calendar',
    weekStartsOn: 1,
    hour12: true,
    density: 'comfortable',
    keepInTray: true,
    launchAtLogin: false,
    weather: { place: null, units: 'fahrenheit' },
    canvas: { baseUrl: '', defaultEffortMin: 60, showSubmitted: true },
    google: { clientId: '', calendars: [] },
    icloud: { username: '', calendars: [] },
    feeds: [],
    sync: { auto: true, intervalMin: 30, keepPastDays: 30, horizonDays: 120 },
    notify: {
      enabled: true,
      headsUpMin: 90,
      bufferPct: 15,
      respectSleep: true,
      sleepStart: '00:00',
      sleepEnd: '07:00',
      dailyDigest: false,
      digestTime: '08:00',
    },
    categories: ['School', 'Work', 'Personal', 'Errands'],
  };
}

export function emptyData(): Persisted {
  return {
    version: 1,
    settings: defaultSettings(),
    tasks: [],
    events: [],
    assignments: [],
    overlay: {},
    suppressed: { ids: [], rules: [] },
    weather: null,
    sync: {},
    reminders: {},
    demo: false,
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Keys that would reach an object's prototype instead of the object itself. */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Recursively merges `patch` over `base`. Arrays and primitives replace; objects merge.
 * Prototype keys are dropped at every depth, including in objects `base` does not have yet.
 */
export function mergeDeep<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (patch === undefined) return base;
  if (!isPlainObject(patch)) return patch as T;
  const out: Record<string, unknown> = isPlainObject(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || UNSAFE_KEYS.has(k)) continue;
    out[k] = mergeDeep(isPlainObject(base) ? base[k] : undefined, v as never);
  }
  return out as T;
}
