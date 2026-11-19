// iCalendar (.ics) parsing: calendar feeds from Google/Apple/anything else, CalDAV
// objects from iCloud, and the Canvas calendar feed (whose assignments are recognised
// by their UID and returned separately).
//
// The text comes from servers the app does not control, so the work done on one file is
// capped (ICS_LIMITS) and all text is clipped. In the app this runs on a worker thread
// with a deadline (main/services/icsParser.ts), because a single impossible repeat rule
// can keep ical.js searching forever inside one step, where no counter here can stop it.

import ICAL from 'ical.js';
import { clip, LIMITS, shortId, webUrl } from './sanitize';
import { addDays, dayKey, parseDayKey } from './time';
import type { Assignment, CalEvent } from './types';

type Time = InstanceType<typeof ICAL.Time>;
type Component = InstanceType<typeof ICAL.Component>;
type IcalEvent = InstanceType<typeof ICAL.Event>;
type Recur = InstanceType<typeof ICAL.Recur>;

/** How much work one file may cost. Hitting a limit leaves events out and sets `truncated`. */
export const ICS_LIMITS = {
  /** Recurrence steps across the whole file. */
  steps: 250_000,
  /** Recurrence steps for any one repeating event. */
  stepsPerSeries: 20_000,
  /** Events plus assignments returned. */
  items: 10_000,
};

export interface IcsOptions {
  sourceId: string;
  calendar?: string;
  rangeStart: number;
  rangeEnd: number;
  limits?: Partial<typeof ICS_LIMITS>;
  /** Walk every series from its first occurrence instead of skipping ahead (tests compare the two). */
  fullWalk?: boolean;
}

export interface IcsResult {
  events: CalEvent[];
  assignments: Assignment[];
  calendarName?: string;
  /** A limit was reached, so some occurrences are missing. */
  truncated?: boolean;
  /** Events that could not be read and were left out. */
  skipped?: number;
}

const MAX_NOTES = 280;
const DAY_MS = 86_400_000;
const pad = (n: number): string => String(n).padStart(2, '0');
const dateKey = (t: Time): string => `${t.year}-${pad(t.month)}-${pad(t.day)}`;

/** Offset (ms) by which `tzid` is ahead of UTC at the given instant. */
function zoneOffset(utcMs: number, tzid: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tzid,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(utcMs);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Wall-clock time in an IANA zone -> epoch ms, or null when the zone name is unknown. */
export function wallTimeToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tzid: string): number | null {
  try {
    const guess = Date.UTC(y, mo - 1, d, h, mi, s);
    const first = guess - zoneOffset(guess, tzid);
    return guess - zoneOffset(first, tzid);
  } catch {
    return null; // not an IANA zone name
  }
}

function toMs(t: Time, tzid: string | undefined): number {
  if (t.isDate) return parseDayKey(dateKey(t));
  const zoneId = t.zone?.tzid;
  if (zoneId === 'UTC') return Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  if (tzid && !ICAL.TimezoneService.has(tzid)) {
    // The file names a zone but does not define it; resolve it with the platform's zone data.
    const ms = wallTimeToUtc(t.year, t.month, t.day, t.hour, t.minute, t.second, tzid);
    if (ms !== null) return ms;
  }
  return t.toJSDate().getTime();
}

function tzidOf(comp: Component, prop: string): string | undefined {
  const p = comp.getFirstProperty(prop);
  const v = p?.getParameter('tzid');
  return typeof v === 'string' ? v : undefined;
}

function text(comp: Component, name: string): string {
  const v = comp.getFirstPropertyValue(name);
  return v === null || v === undefined ? '' : String(v).trim();
}

/**
 * Where to start expanding a daily or weekly series so the walk begins just before the
 * window rather than at the first occurrence, which can be years back. The start moves
 * by whole repeat periods (keeping the weekday and wall-clock time), so every occurrence
 * from there on is the same. Null when that cannot be guaranteed.
 */
function skipAhead(event: IcalEvent, rangeStart: number, tzid: string | undefined): Time | null {
  const comp = event.component;
  if (comp.hasProperty('rdate')) return null;
  const rules = comp.getAllProperties('rrule');
  if (rules.length !== 1) return null;
  const rule = rules[0].getFirstValue() as Recur;
  // COUNT is counted from the real first occurrence, so the walk must start there.
  if (rule.count || (rule.freq !== 'DAILY' && rule.freq !== 'WEEKLY')) return null;
  const periodDays = (rule.freq === 'WEEKLY' ? 7 : 1) * Math.max(1, rule.interval || 1);
  const start = event.startDate;
  const startMs = toMs(start, tzid);
  const spanMs = Math.max(0, event.duration.toSeconds() * 1000);
  // Land at least one full period (plus the event's length) before the window, so the
  // first occurrence produced, which ical.js always takes from the start, ends before it.
  const targetMs = rangeStart - spanMs - periodDays * DAY_MS;
  const periods = Math.floor((targetMs - startMs) / (periodDays * DAY_MS));
  if (!(periods >= 1)) return null;
  const from = start.clone();
  from.adjust(periods * periodDays, 0, 0, 0);
  return from;
}

const isRepeating = (master: Component | undefined): boolean => !!master && (master.hasProperty('rrule') || master.hasProperty('rdate'));

const CANVAS_ASSIGNMENT_UID = /^event-assignment-(override-)?(\d+)$/;

/**
 * Parses iCalendar text and returns the events (recurrences expanded) that overlap
 * [rangeStart, rangeEnd). Throws when the text is not valid iCalendar.
 */
export function parseIcs(input: string, o: IcsOptions): IcsResult {
  const limits = { ...ICS_LIMITS, ...o.limits };
  const parsed = ICAL.parse(input);
  const roots: unknown[] = Array.isArray(parsed) && Array.isArray(parsed[0]) ? parsed : [parsed];
  const result: IcsResult = { events: [], assignments: [] };
  const seen = new Set<string>();
  let steps = 0;
  let skipped = 0;
  const full = (): boolean => result.events.length + result.assignments.length >= limits.items;

  // ical.js keeps time zones in one global registry; one file's definitions must not
  // change how the next file's times are read.
  ICAL.TimezoneService.reset();
  try {
    for (const jcal of roots) {
      const root = new ICAL.Component(jcal as never);
      for (const tz of root.getAllSubcomponents('vtimezone')) {
        try {
          ICAL.TimezoneService.register(tz);
        } catch {
          // A zone without a usable TZID; times that name it fall back to the platform's zone data.
        }
      }
      const calName = clip(text(root, 'x-wr-calname'), LIMITS.calendar);
      if (calName && !result.calendarName) result.calendarName = calName;
      const calendar = o.calendar ?? calName;

      const emit = (comp: Component, start: Time, end: Time, uid: string, recurring: boolean): void => {
        if (full()) {
          result.truncated = true;
          return;
        }
        if (text(comp, 'status').toUpperCase() === 'CANCELLED') return;
        const allDay = start.isDate;
        let s: number;
        let e: number;
        if (allDay) {
          s = parseDayKey(dateKey(start));
          e = parseDayKey(dateKey(end));
          if (e <= s) e = addDays(s, 1);
          if (e <= o.rangeStart || s >= o.rangeEnd) return;
        } else {
          s = toMs(start, tzidOf(comp, 'dtstart'));
          e = toMs(end, tzidOf(comp, 'dtend') ?? tzidOf(comp, 'dtstart'));
          if (e < s) e = s;
          if (e < o.rangeStart || s >= o.rangeEnd) return;
        }
        const rawTitle = clip(text(comp, 'summary'), LIMITS.title) ?? '(untitled)';
        const url = webUrl(text(comp, 'url'));

        const canvas = CANVAS_ASSIGNMENT_UID.exec(uid);
        if (canvas) {
          const m = /^(.*?)\s*\[([^\]]+)\]\s*$/.exec(rawTitle);
          const key = `canvas:${canvas[1] ? 'assignment-override' : 'assignment'}:${canvas[2]}`;
          if (seen.has(key)) return;
          seen.add(key);
          result.assignments.push({
            key,
            sourceId: o.sourceId,
            title: m ? m[1] : rawTitle,
            course: m ? clip(m[2], LIMITS.course) : undefined,
            dueAt: allDay ? dateKey(start) : new Date(s).toISOString(),
            allDay,
            url,
            submitted: false,
            type: 'assignment',
          });
          return;
        }

        const seriesKey = `${o.sourceId}:${uid}`;
        const startText = allDay ? dateKey(start) : new Date(s).toISOString();
        const key = recurring ? `${seriesKey}@${startText}` : seriesKey;
        if (seen.has(key)) return;
        seen.add(key);
        const notes = text(comp, 'description');
        result.events.push({
          key,
          seriesKey,
          sourceId: o.sourceId,
          calendar,
          title: rawTitle,
          start: startText,
          end: allDay ? dayKey(e) : new Date(e).toISOString(),
          allDay,
          recurring: recurring || undefined,
          location: clip(text(comp, 'location'), LIMITS.location),
          url,
          notes: notes ? notes.slice(0, MAX_NOTES) : undefined,
        });
      };

      const emitOverride = (ex: Component, uid: string): void => {
        const ev = new ICAL.Event(ex);
        if (ev.startDate) emit(ex, ev.startDate, ev.endDate ?? ev.startDate, uid, true);
      };

      const groups = new Map<string, { master?: Component; exceptions: Component[] }>();
      let anon = 0;
      for (const ve of root.getAllSubcomponents('vevent')) {
        const uid = shortId(text(ve, 'uid') || `no-uid-${anon++}-${text(ve, 'summary').slice(0, 40)}`);
        let g = groups.get(uid);
        if (!g) {
          g = { exceptions: [] };
          groups.set(uid, g);
        }
        if (ve.hasProperty('recurrence-id')) g.exceptions.push(ve);
        else if (!g.master) g.master = ve;
      }

      // One-off events first, so the limits only ever cut repeating series short.
      const ordered = [...groups].sort(([, a], [, b]) => Number(isRepeating(a.master)) - Number(isRepeating(b.master)));
      for (const [uid, g] of ordered) {
        if (full()) {
          result.truncated = true;
          break;
        }
        try {
          if (!g.master) {
            // Already-expanded occurrences (CalDAV `expand`), or exceptions whose master is absent.
            for (const ex of g.exceptions) emitOverride(ex, uid);
            continue;
          }
          const event = new ICAL.Event(g.master);
          if (!event.startDate) continue;
          for (const ex of g.exceptions) event.relateException(ex);
          if (!event.isRecurring()) {
            emit(g.master, event.startDate, event.endDate ?? event.startDate, uid, false);
            continue;
          }
          // Overrides first: the walk may never reach their slot (before a skipped-ahead start,
          // or after the window) although they were moved into the window; and when one is
          // moved onto another occurrence's start (the same key), it wins however the series
          // is walked. The walk skips them as repeats when it reaches their slot.
          for (const ex of g.exceptions) emitOverride(ex, uid);
          const tzid = tzidOf(g.master, 'dtstart');
          const from = o.fullWalk ? null : skipAhead(event, o.rangeStart, tzid);
          const it = event.iterator(from ?? undefined);
          for (let n = 0; ; n++) {
            if (n >= limits.stepsPerSeries || steps >= limits.steps) {
              result.truncated = true;
              break;
            }
            steps++;
            const next = it.next();
            if (!next) break;
            // Judge the window's end by the occurrence's slot in the series, not where an
            // override moved it, so one occurrence moved far ahead doesn't end the series early.
            if (toMs(next, tzid) >= o.rangeEnd) break;
            if (full()) {
              result.truncated = true; // more of this series fell inside the window
              break;
            }
            const occ = event.getOccurrenceDetails(next);
            emit(occ.item.component, occ.startDate, occ.endDate, uid, true);
          }
        } catch {
          skipped++;
        }
      }
    }
  } finally {
    ICAL.TimezoneService.reset();
  }
  if (skipped) result.skipped = skipped;
  // Emission order depends on how each series was walked; hand them back in time order.
  const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  result.events.sort((a, b) => order(a.start, b.start) || order(a.key, b.key));
  return result;
}

/**
 * The address to fetch for a calendar link, or null when it is not a usable web address.
 * webcal:// and http:// become https:// (the address itself works like a password, so it
 * is never sent unencrypted), and addresses with a user name or password are refused.
 */
export function normalizeFeedUrl(raw: string): string | null {
  let trimmed = raw.trim().replace(/^(webcals?|https?):\/\//i, 'https://');
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    // No scheme given: accept it only when it starts like a domain name (school.edu/...).
    if (!/^[^\s/?#]+\.[^\s/?#]+/.test(trimmed)) return null;
    trimmed = `https://${trimmed}`;
  }
  if (trimmed.length > LIMITS.url) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname) return null;
    return u.toString();
  } catch {
    return null;
  }
}
