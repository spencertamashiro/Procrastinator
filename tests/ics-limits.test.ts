import { describe, it, expect, vi } from 'vitest';
import ICAL from 'ical.js';
import { parseIcs, type IcsOptions } from '../src/shared/ics';
import { LIMITS } from '../src/shared/sanitize';
import { MAX_KEY_LENGTH } from '../src/main/actions';

const options: IcsOptions = { sourceId: 'feed:test', rangeStart: Date.parse('2026-11-16T00:00:00Z'),
  rangeEnd: Date.parse('2026-11-19T00:00:00Z') };
const calendar = (body: string) => `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Security tests//EN\n${body}\nEND:VCALENDAR`;
const event = (uid: string, extra = '', start = '20261116T120000Z') =>
  `BEGIN:VEVENT\nUID:${uid}\nDTSTART:${start}\nDURATION:PT1H\nSUMMARY:${uid}\n${extra}\nEND:VEVENT`;

describe('parseIcs work limits', () => {
  it('sets truncated when a single series fills the item limit', () => {
    const result = parseIcs(calendar(event('repeat', 'RRULE:FREQ=DAILY')), { ...options, limits: { items: 2 } });
    expect(result.events).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });
  it.each([{ stepsPerSeries: 1 }, { steps: 1 }])('sets truncated for recurrence budget %j', (limits) => {
    const result = parseIcs(calendar(event('repeat', 'RRULE:FREQ=DAILY')), { ...options, limits });
    expect(result.events).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });
  it('shares the step budget across series', () => {
    const result = parseIcs(calendar(`${event('first', 'RRULE:FREQ=DAILY;COUNT=1')}\n${event('second', 'RRULE:FREQ=DAILY')}`),
      { ...options, limits: { steps: 2 } });
    expect(result.events.map((e) => e.title)).toEqual(['first']);
    expect(result.truncated).toBe(true);
  });
  it('keeps one-off events before series even when the series appears first', () => {
    const result = parseIcs(calendar(`${event('repeat', 'RRULE:FREQ=DAILY')}\n${event('one-off')}`),
      { ...options, limits: { items: 1 } });
    expect(result.events.map((e) => e.title)).toEqual(['one-off']);
    expect(result.truncated).toBe(true);
  });
  it('counts a VEVENT expansion failure and keeps the other events', () => {
    // Both parts parse, but ical.js rejects their combination when constructing an iterator.
    const iterator = vi.spyOn(ICAL.Event.prototype, 'iterator');
    try {
      const result = parseIcs(calendar(`${event('broken', 'RRULE:FREQ=MONTHLY;BYWEEKNO=1;BYMONTHDAY=1')}\n${event('good')}`), options);
      expect(iterator.mock.results.some((r) => r.type === 'throw')).toBe(true);
      expect(result.skipped).toBe(1);
      expect(result.events.map((e) => e.title)).toEqual(['good']);
    } finally {
      iterator.mockRestore();
    }
  });
  it('skips ahead from 1970 and returns every day in the 2026 window', () => {
    const result = parseIcs(calendar(event('old', 'RRULE:FREQ=DAILY', '19700101T120000Z')), options);
    expect(result.events.map((e) => e.start)).toEqual([
      '2026-11-16T12:00:00.000Z', '2026-11-17T12:00:00.000Z', '2026-11-18T12:00:00.000Z',
    ]);
    expect(result.truncated ?? false).toBe(false);
  });
  it('truncates the same old daily series when fullWalk disables skipping ahead', () => {
    const result = parseIcs(calendar(event('old', 'RRULE:FREQ=DAILY', '19700101T120000Z')), { ...options, fullWalk: true });
    expect(result.truncated).toBe(true);
    expect(result.events).toEqual([]);
  });
  it('returns with truncated for an unbounded hourly series from 2000', () => {
    const result = parseIcs(calendar(event('hourly', 'RRULE:FREQ=HOURLY', '20000101T120000Z')), options);
    expect(result.truncated).toBe(true);
    expect(result.events).toEqual([]);
  }, 3000);
});

describe('parseIcs time zone isolation', () => {
  it('does not reuse a previous file’s custom New York offset', () => {
    const zone = `BEGIN:VTIMEZONE
TZID:America/New_York
BEGIN:STANDARD
DTSTART:19700101T000000
TZOFFSETFROM:+0500
TZOFFSETTO:+0500
TZNAME:Wrong fixed offset
END:STANDARD
END:VTIMEZONE`;
    const meeting = `BEGIN:VEVENT
UID:meeting
DTSTART;TZID=America/New_York:20261116T120000
DTEND;TZID=America/New_York:20261116T130000
SUMMARY:Meeting
END:VEVENT`;
    expect(parseIcs(calendar(`${zone}\n${meeting}`), options).events[0].start).toBe('2026-11-16T07:00:00.000Z');
    expect(parseIcs(calendar(meeting), options).events[0].start).toBe('2026-11-16T17:00:00.000Z');
  });
});

describe('parseIcs outside text limits', () => {
  it('clips summary, location and calendar name', () => {
    const long = 'x'.repeat(5000);
    const body = event('long').replace('SUMMARY:long', `SUMMARY:${long}\nLOCATION:${long}`);
    const result = parseIcs(calendar(`X-WR-CALNAME:${long}\n${body}`), options);
    expect(result.events[0]).toMatchObject({ title: long.slice(0, LIMITS.title), location: long.slice(0, LIMITS.location),
      calendar: long.slice(0, LIMITS.calendar) });
    expect(result.calendarName).toBe(long.slice(0, LIMITS.calendar));
  });
  it('drops a javascript event URL', () => {
    expect(parseIcs(calendar(event('unsafe', 'URL:javascript:alert(1)')), options).events[0].url).toBeUndefined();
  });
  it('keeps an https event URL', () => {
    expect(parseIcs(calendar(event('safe', 'URL:https://example.com/event')), options).events[0].url).toBe('https://example.com/event');
  });
  it('bounds the key built from a 5000-character UID', () => {
    const result = parseIcs(calendar(event('x'.repeat(5000))), options);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].key.length).toBeLessThanOrEqual(MAX_KEY_LENGTH);
    expect(result.events[0].seriesKey.length).toBeLessThanOrEqual(MAX_KEY_LENGTH);
  });
});
