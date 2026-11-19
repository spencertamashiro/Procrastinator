// The skip-ahead in parseIcs starts long-running daily and weekly series just before the
// window instead of at their first occurrence. These tests check it changes nothing: for
// many generated series (intervals, weekday filters, end dates, excluded dates, moved and
// renamed occurrences, time zones with daylight saving, all-day events, events that last
// several days) the result must equal a full walk from the first occurrence.

import { describe, expect, it } from 'vitest';
import { parseIcs, type IcsOptions, type IcsResult } from '../src/shared/ics';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const pad = (n: number): string => String(n).padStart(2, '0');

/** Small seeded generator (mulberry32), so a failure can be reproduced. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NEW_YORK = [
  'BEGIN:VTIMEZONE',
  'TZID:America/New_York',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0500',
  'TZOFFSETTO:-0400',
  'TZNAME:EDT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0400',
  'TZOFFSETTO:-0500',
  'TZNAME:EST',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
].join('\r\n');

/** utc: ...Z; floating: no zone; newYork: TZID defined in the file; berlin: TZID left to the platform's zone data. */
type Zone = 'utc' | 'floating' | 'newYork' | 'berlin';
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

// Wall-clock times are written as UTC-based milliseconds and formatted field by field.
const ymd = (wall: number): string => {
  const d = new Date(wall);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
};
const ymdhms = (wall: number): string => {
  const d = new Date(wall);
  return `${ymd(wall)}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00`;
};

function timeProp(name: string, wall: number, zone: Zone, allDay: boolean): string {
  if (allDay) return `${name};VALUE=DATE:${ymd(wall)}`;
  if (zone === 'utc') return `${name}:${ymdhms(wall)}Z`;
  if (zone === 'newYork') return `${name};TZID=America/New_York:${ymdhms(wall)}`;
  if (zone === 'berlin') return `${name};TZID=Europe/Berlin:${ymdhms(wall)}`;
  return `${name}:${ymdhms(wall)}`;
}

function calendar(zone: Zone, events: string[][]): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//procrastinator tests//EN'];
  if (zone === 'newYork') lines.push(NEW_YORK);
  for (const e of events) lines.push('BEGIN:VEVENT', ...e, 'END:VEVENT');
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

interface Case {
  label: string;
  text: string;
  rangeStart: number;
  rangeEnd: number;
}

function makeCase(r: () => number, n: number): Case {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const allDay = r() < 0.2;
  const zone: Zone = allDay ? 'floating' : pick(['utc', 'floating', 'newYork', 'berlin'] as const);
  const weekly = r() < 0.5;
  const interval = 1 + Math.floor(r() * 3);
  const period = (weekly ? 7 : 1) * interval * DAY;

  // Series start: 2021 to early 2026. Window: somewhere in 2026, one week to four months long.
  const startDay = Date.UTC(2021, 0, 1) + Math.floor(r() * (5 * 365 + 60)) * DAY;
  const start = allDay ? startDay : startDay + Math.floor(r() * 24) * HOUR + pick([0, 15, 30, 45]) * 60_000;
  const rangeStart = Date.UTC(2026, 0, 1) + Math.floor(r() * 300) * DAY + Math.floor(r() * 24) * HOUR;
  const rangeEnd = rangeStart + (7 + Math.floor(r() * 110)) * DAY;
  const length = allDay ? (1 + Math.floor(r() * 3)) * DAY : pick([15, 30, 60, 90, 240, 600, 25 * 60, 3 * 24 * 60]) * 60_000;

  let rule = `FREQ=${weekly ? 'WEEKLY' : 'DAILY'};INTERVAL=${interval}`;
  let byDay: string[] = [];
  if (r() < 0.5) {
    byDay = WEEKDAYS.filter(() => r() < 0.45);
    if (byDay.length) rule += `;BYDAY=${byDay.join(',')}`;
  }
  if (r() < 0.3) {
    const until = rangeStart + Math.floor((r() - 0.3) * 90) * DAY;
    rule += `;UNTIL=${allDay ? ymd(until) : `${ymdhms(until)}${zone === 'floating' ? '' : 'Z'}`}`;
  }

  const uid = `series-${n}@tests`;
  // Slots on the series' own rhythm (k periods after the start); real occurrences unless a weekday filter excludes them.
  const slot = (k: number): number => start + k * period;
  const inWindow = Math.max(1, Math.ceil((rangeStart - start) / period));
  const master = [
    `UID:${uid}`,
    'DTSTAMP:20260101T000000Z',
    timeProp('DTSTART', start, zone, allDay),
    r() < 0.5 ? timeProp('DTEND', start + length, zone, allDay) : `DURATION:${allDay ? `P${length / DAY}D` : `PT${length / 60_000}M`}`,
    `RRULE:${rule}`,
    `SUMMARY:Series ${n}`,
  ];
  for (let i = 0; i < 3; i++) if (r() < 0.4) master.push(timeProp('EXDATE', slot(inWindow + Math.floor(r() * 12) - 2), zone, allDay));

  const events = [master];
  const override = (from: number, to: number, title: string): void => {
    events.push([
      `UID:${uid}`,
      'DTSTAMP:20260101T000000Z',
      timeProp('RECURRENCE-ID', from, zone, allDay),
      timeProp('DTSTART', to, zone, allDay),
      timeProp('DTEND', to + length, zone, allDay),
      `SUMMARY:${title}`,
    ]);
  };
  const windowSpan = rangeEnd - rangeStart;
  const intoWindow = (): number => {
    const t = rangeStart + Math.floor(r() * (windowSpan / HOUR)) * HOUR;
    return allDay ? t - (t % DAY) : t;
  };
  if (r() < 0.5) override(slot(1 + Math.floor(r() * 5)), intoWindow(), 'Moved from the past'); // long before the window
  if (r() < 0.4) override(slot(inWindow + Math.floor(r() * 4)), slot(inWindow) - 400 * DAY, 'Moved out'); // inside, moved away
  if (r() < 0.4) override(slot(inWindow + 1 + Math.floor(r() * 4)), slot(inWindow + 1 + Math.floor(r() * 4)), 'Renamed'); // same slot or a neighbour
  if (r() < 0.3) override(slot(inWindow + Math.ceil(windowSpan / period) + 2), intoWindow(), 'Moved from after'); // after the window

  return {
    label: `#${n} ${rule} ${zone}${allDay ? ' all-day' : ''} start=${ymdhms(start)} window=${new Date(rangeStart).toISOString()}+${Math.round(windowSpan / DAY)}d byDay=${byDay.join(',')}`,
    text: calendar(zone, events),
    rangeStart,
    rangeEnd,
  };
}

const summary = (r: IcsResult): string[] => r.events.map((e) => `${e.key} | ${e.start} | ${e.end} | ${e.title}`).sort();

function compare(c: Case): { fast: IcsResult; full: IcsResult } {
  const options: IcsOptions = { sourceId: 'feed:t', rangeStart: c.rangeStart, rangeEnd: c.rangeEnd };
  const full = parseIcs(c.text, { ...options, fullWalk: true, limits: { steps: 1e8, stepsPerSeries: 1e8 } });
  // A per-series budget a full walk from 2021 would exceed: passing it shows the skip-ahead was used.
  const fast = parseIcs(c.text, { ...options, limits: { stepsPerSeries: 400 } });
  return { fast, full };
}

describe('skipping ahead in long daily and weekly series', () => {
  it('gives the same events as a full walk for generated series', () => {
    const r = random(20261115);
    let compared = 0;
    for (let n = 0; n < 250; n++) {
      const c = makeCase(r, n);
      const { fast, full } = compare(c);
      expect(full.truncated, c.label).toBeUndefined();
      expect(fast.truncated, c.label).toBeUndefined();
      expect(fast.skipped, c.label).toBeUndefined();
      expect(summary(fast), c.label).toEqual(summary(full));
      compared += full.events.length;
    }
    // Guard against comparing empty results.
    expect(compared).toBeGreaterThan(2000);
  }, 120_000);

  it('shows an occurrence moved from years ago into the window', () => {
    const text = calendar('utc', [
      ['UID:daily@t', 'DTSTART:20200106T090000Z', 'DTEND:20200106T100000Z', 'RRULE:FREQ=DAILY', 'SUMMARY:Standup'],
      ['UID:daily@t', 'RECURRENCE-ID:20200107T090000Z', 'DTSTART:20260512T150000Z', 'DTEND:20260512T160000Z', 'SUMMARY:Moved'],
    ]);
    const { fast, full } = compare({ label: 'moved', text, rangeStart: Date.UTC(2026, 4, 11), rangeEnd: Date.UTC(2026, 4, 18) });
    expect(summary(fast)).toEqual(summary(full));
    expect(fast.events.map((e) => e.start)).toContain('2026-05-12T15:00:00.000Z');
    expect(fast.events.filter((e) => e.title === 'Standup')).toHaveLength(7);
  });

  it('keeps the wall-clock time of a weekly series across a daylight-saving change', () => {
    const text = calendar('newYork', [
      ['UID:weekly@t', 'DTSTART;TZID=America/New_York:20230102T100000', 'DTEND;TZID=America/New_York:20230102T110000', 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE', 'SUMMARY:Lab'],
    ]);
    const { fast, full } = compare({ label: 'dst', text, rangeStart: Date.UTC(2026, 1, 16), rangeEnd: Date.UTC(2026, 3, 1) });
    expect(summary(fast)).toEqual(summary(full));
    const hours = new Set(fast.events.map((e) => new Date(e.start).getUTCHours()));
    expect(hours).toEqual(new Set([15, 14])); // 10:00 EST, then 10:00 EDT after March 8
    for (const e of fast.events) {
      const local = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date(e.start));
      expect(local).toBe('10');
    }
  });

  it('includes a multi-day occurrence that began before the window', () => {
    const text = calendar('utc', [
      ['UID:weekend@t', 'DTSTART:20220107T180000Z', 'DTEND:20220110T180000Z', 'RRULE:FREQ=WEEKLY', 'SUMMARY:Weekend away'],
    ]);
    const { fast, full } = compare({ label: 'span', text, rangeStart: Date.UTC(2026, 2, 1), rangeEnd: Date.UTC(2026, 2, 8) });
    expect(summary(fast)).toEqual(summary(full));
    expect(fast.events.map((e) => e.start)).toEqual(['2026-02-27T18:00:00.000Z', '2026-03-06T18:00:00.000Z']);
  });
});
