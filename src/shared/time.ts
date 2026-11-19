// Local-time date helpers. Days are always the user's wall-clock days, so every
// "add a day" goes through Date setters rather than adding 24 hours (DST-safe).

import type { RangeMode, ViewMode } from './types';

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

const LOCALE = 'en-US';
const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addDays(ms: number, n: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/** Same day-of-month n months later, clamped to the month's length. */
export function addMonths(ms: number, n: number): number {
  const d = new Date(ms);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d.getTime();
}

export function startOfMonth(ms: number): number {
  const d = new Date(startOfDay(ms));
  d.setDate(1);
  return d.getTime();
}

export function startOfWeek(ms: number, weekStartsOn: 0 | 1): number {
  const d = new Date(startOfDay(ms));
  const diff = (d.getDay() - weekStartsOn + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d.getTime();
}

/** Local YYYY-MM-DD. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midnight for a YYYY-MM-DD key. */
export function parseDayKey(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).getTime();
}

export function isSameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}

export function minutesIntoDay(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

/** The instant on `dayStart`'s calendar day at `minutes` past local midnight. */
export function atMinutes(dayStart: number, minutes: number): number {
  const d = new Date(dayStart);
  d.setHours(0, minutes, 0, 0);
  return d.getTime();
}

/** "HH:mm" -> minutes past midnight (0 when malformed). */
export function parseClock(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return 0;
  return Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2]));
}

export interface DateRange {
  /** Inclusive start (local midnight). */
  start: number;
  /** Exclusive end (local midnight). */
  end: number;
  /** Local midnight of every day in the range. */
  days: number[];
}

function span(start: number, count: number): DateRange {
  const days = Array.from({ length: count }, (_, i) => addDays(start, i));
  return { start, end: addDays(start, count), days };
}

export function weekRange(anchor: number, mode: RangeMode, weekStartsOn: 0 | 1): DateRange {
  return span(mode === 'rolling' ? startOfDay(anchor) : startOfWeek(anchor, weekStartsOn), 7);
}

export function dayRange(anchor: number): DateRange {
  return span(startOfDay(anchor), 1);
}

/** Six full weeks covering the anchor's month. */
export function monthGrid(anchor: number, weekStartsOn: 0 | 1): DateRange {
  return span(startOfWeek(startOfMonth(anchor), weekStartsOn), 42);
}

export function rangeFor(view: ViewMode, anchor: number, mode: RangeMode, weekStartsOn: 0 | 1): DateRange {
  if (view === 'day') return dayRange(anchor);
  if (view === 'month') return monthGrid(anchor, weekStartsOn);
  return weekRange(anchor, mode, weekStartsOn);
}

export function shiftAnchor(anchor: number, view: ViewMode, dir: 1 | -1): number {
  if (view === 'month') return addMonths(startOfMonth(anchor), dir);
  return addDays(anchor, view === 'week' ? 7 * dir : dir);
}

// ---------------------------------------------------------------- formatting

const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const id = JSON.stringify(options);
  let f = cache.get(id);
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALE, options);
    cache.set(id, f);
  }
  return f;
}

export function fmtTime(ms: number, hour12: boolean): string {
  return fmt({ hour: 'numeric', minute: '2-digit', hour12 }).format(ms);
}

/** Label for an hour row: "8 AM" or "08:00". */
export function fmtHour(hour: number, hour12: boolean): string {
  if (!hour12) return `${pad(hour)}:00`;
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${hour < 12 ? 'AM' : 'PM'}`;
}

export function fmtWeekday(ms: number, style: 'short' | 'long' = 'short'): string {
  return fmt({ weekday: style }).format(ms);
}

export function fmtMonth(ms: number, style: 'short' | 'long' = 'long'): string {
  return fmt({ month: style }).format(ms);
}

/** "Sat, Nov 14" */
export function fmtDayShort(ms: number): string {
  return fmt({ weekday: 'short', month: 'short', day: 'numeric' }).format(ms);
}

/** "Saturday, November 14" */
export function fmtDayLong(ms: number): string {
  return fmt({ weekday: 'long', month: 'long', day: 'numeric' }).format(ms);
}

/** "45 min", "1 h", "1 h 30 min" */
export function fmtDuration(totalMin: number): string {
  const min = Math.max(0, Math.round(totalMin));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** A deadline relative to now: "today 5:00 PM", "tomorrow 9:00 AM", "Thu 6:00 PM", "Nov 20, 6:00 PM". */
export function fmtWhen(ms: number, now: number, hour12: boolean): string {
  const diffDays = Math.round((startOfDay(ms) - startOfDay(now)) / DAY);
  const time = fmtTime(ms, hour12);
  if (diffDays === 0) return `today ${time}`;
  if (diffDays === 1) return `tomorrow ${time}`;
  if (diffDays === -1) return `yesterday ${time}`;
  if (diffDays > 1 && diffDays < 7) return `${fmtWeekday(ms)} ${time}`;
  return `${fmt({ month: 'short', day: 'numeric' }).format(ms)}, ${time}`;
}

export function fmtRangeTitle(range: DateRange, view: ViewMode, anchor: number): { main: string; year: string } {
  if (view === 'month') {
    return { main: fmtMonth(anchor), year: String(new Date(anchor).getFullYear()) };
  }
  if (view === 'day') {
    return { main: fmtDayLong(range.start), year: String(new Date(range.start).getFullYear()) };
  }
  const first = new Date(range.start);
  const last = new Date(addDays(range.end, -1));
  const year = String(last.getFullYear());
  if (first.getMonth() === last.getMonth()) {
    return { main: `${fmtMonth(range.start)} ${first.getDate()} – ${last.getDate()}`, year };
  }
  return {
    main: `${fmtMonth(range.start, 'short')} ${first.getDate()} – ${fmtMonth(last.getTime(), 'short')} ${last.getDate()}`,
    year,
  };
}

/** Value for <input type="datetime-local">. */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  return `${dayKey(ms)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parses a datetime-local value as local time. NaN when malformed. */
export function fromLocalInput(value: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return NaN;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime();
}
