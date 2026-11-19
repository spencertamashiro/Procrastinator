import { describe, it, expect } from 'vitest';
import ICAL from 'ical.js';
import { parseIcs, wallTimeToUtc, normalizeFeedUrl } from '../src/shared/ics';
import type { IcsOptions } from '../src/shared/ics';

const options: IcsOptions = {
  sourceId: 'feed:school',
  rangeStart: Date.parse('2026-01-01T00:00:00Z'),
  rangeEnd: Date.parse('2027-01-01T00:00:00Z'),
};
const calendar = (body: string) => `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Planner tests//EN
${body}
END:VCALENDAR`;
const event = (body: string) => `BEGIN:VEVENT
${body}
END:VEVENT`;

// ical.js keeps registered VTIMEZONE definitions across parses.
function parse(body: string, overrides: Partial<IcsOptions> = {}) {
  ICAL.TimezoneService.reset();
  try {
    return parseIcs(calendar(body), { ...options, ...overrides });
  } finally {
    ICAL.TimezoneService.reset();
  }
}

describe('parseIcs', () => {
  it('maps a single UTC event to absolute instants and a stable key', () => {
    const result = parse(event(`UID:lecture
DTSTART:20261116T180000Z
DTEND:20261116T190000Z
SUMMARY:Lecture
LOCATION:Room 3
URL:https://school.example/lecture
DESCRIPTION:Bring notes`));
    expect(result.assignments).toEqual([]);
    expect(result.events).toEqual([expect.objectContaining({
      key: 'feed:school:lecture', seriesKey: 'feed:school:lecture', sourceId: 'feed:school',
      title: 'Lecture', start: '2026-11-16T18:00:00.000Z', end: '2026-11-16T19:00:00.000Z',
      allDay: false, location: 'Room 3', url: 'https://school.example/lecture', notes: 'Bring notes',
    })]);
  });

  it.each([['20261117', '2026-11-17'], ['20261120', '2026-11-20']])(
    'preserves the exclusive all-day end %s', (end, expected) => {
      const { events } = parse(event(`UID:holiday
DTSTART;VALUE=DATE:20261116
DTEND;VALUE=DATE:${end}
SUMMARY:Holiday`));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ start: '2026-11-16', end: expected, allDay: true });
    },
  );

  it('gives an all-day event without DTEND a one-day exclusive end', () => {
    expect(parse(event(`UID:one-day
DTSTART;VALUE=DATE:20261116`)).events[0]).toMatchObject({
      start: '2026-11-16', end: '2026-11-17', allDay: true, title: '(untitled)',
    });
  });

  it('expands weekly occurrences within the range, removes EXDATE and applies an override', () => {
    const { events } = parse(`${event(`UID:weekly
DTSTART:20261102T180000Z
DTEND:20261102T190000Z
RRULE:FREQ=WEEKLY;COUNT=7
EXDATE:20261116T180000Z
SUMMARY:Regular lecture`)}
${event(`UID:weekly
RECURRENCE-ID:20261123T180000Z
DTSTART:20261123T200000Z
DTEND:20261123T213000Z
SUMMARY:Rescheduled lecture`)}`, {
      rangeStart: Date.parse('2026-11-09T18:00:00Z'),
      rangeEnd: Date.parse('2026-12-07T18:00:00Z'),
    });
    expect(events.map(({ start, end, title }) => ({ start, end, title }))).toEqual([
      { start: '2026-11-09T18:00:00.000Z', end: '2026-11-09T19:00:00.000Z', title: 'Regular lecture' },
      { start: '2026-11-23T20:00:00.000Z', end: '2026-11-23T21:30:00.000Z', title: 'Rescheduled lecture' },
      { start: '2026-11-30T18:00:00.000Z', end: '2026-11-30T19:00:00.000Z', title: 'Regular lecture' },
    ]);
    for (const e of events) {
      expect(e.key).toBe(`feed:school:weekly@${e.start}`);
      expect(e.seriesKey).toBe('feed:school:weekly');
      expect(e.recurring).toBe(true);
    }
  });

  it.each([['20260116', '2026-01-16T23:00:00.000Z'], ['20260716', '2026-07-16T22:00:00.000Z']])(
    'resolves New York wall time without VTIMEZONE on %s', (date, expected) => {
      const { events } = parse(event(`UID:no-zone
DTSTART;TZID=America/New_York:${date}T180000
DTEND;TZID=America/New_York:${date}T190000`));
      expect(events[0].start).toBe(expected);
      expect(Date.parse(events[0].end) - Date.parse(events[0].start)).toBe(3_600_000);
    },
  );

  it('uses a matching VTIMEZONE definition for New York', () => {
    const { events } = parse(`BEGIN:VTIMEZONE
TZID:America/New_York
BEGIN:STANDARD
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
END:DAYLIGHT
END:VTIMEZONE
${event(`UID:defined-zone
DTSTART;TZID=America/New_York:20261116T180000
DTEND;TZID=America/New_York:20261116T190000`)}`);
    expect(events[0]).toMatchObject({ start: '2026-11-16T23:00:00.000Z', end: '2026-11-17T00:00:00.000Z' });
  });

  it('skips cancelled events and events fully outside the range', () => {
    const { events } = parse(`${event(`UID:cancelled
DTSTART:20261116T180000Z
STATUS:CANCELLED`)}
${event(`UID:before
DTSTART:20261115T160000Z
DTEND:20261115T170000Z`)}
${event(`UID:at-end
DTSTART:20261117T000000Z
DTEND:20261117T010000Z`)}`, {
      rangeStart: Date.parse('2026-11-16T00:00:00Z'), rangeEnd: Date.parse('2026-11-17T00:00:00Z'),
    });
    expect(events).toEqual([]);
  });

  it('includes events that overlap the range start', () => {
    expect(parse(event(`UID:overlap
DTSTART:20261115T230000Z
DTEND:20261116T010000Z`), {
      rangeStart: Date.parse('2026-11-16T00:00:00Z'), rangeEnd: Date.parse('2026-11-17T00:00:00Z'),
    }).events).toHaveLength(1);
  });

  it.each([undefined, 'Chosen calendar'])('reads X-WR-CALNAME with calendar option %s', (override) => {
    const result = parse(`X-WR-CALNAME:School calendar
${event(`UID:named
DTSTART:20261116T180000Z`)}`, { calendar: override });
    expect(result.calendarName).toBe('School calendar');
    expect(result.events[0].calendar).toBe(override ?? 'School calendar');
  });

  it.each([
    ['event-assignment-123', 'canvas:assignment:123'],
    ['event-assignment-override-456', 'canvas:assignment-override:456'],
  ])('recognizes Canvas UID %s as an assignment', (uid, key) => {
    const result = parse(event(`UID:${uid}
DTSTART:20261116T180000Z
DTEND:20261116T180000Z
SUMMARY:Problem Set 6 [MATH 3A]`), { sourceId: 'canvas' });
    expect(result.events).toEqual([]);
    expect(result.assignments).toEqual([expect.objectContaining({
      key, sourceId: 'canvas', title: 'Problem Set 6', course: 'MATH 3A',
      dueAt: '2026-11-16T18:00:00.000Z', allDay: false, submitted: false, type: 'assignment',
    })]);
  });

  it('keeps an all-day Canvas due date as a local date key', () => {
    const result = parse(event(`UID:event-assignment-12
DTSTART;VALUE=DATE:20261116
SUMMARY:Read chapter [HISTORY]`));
    expect(result.assignments[0]).toMatchObject({ allDay: true, dueAt: '2026-11-16', title: 'Read chapter', course: 'HISTORY' });
  });

  it('keeps Canvas calendar events as normal events', () => {
    const result = parse(event(`UID:event-calendar-event-9
DTSTART:20261116T180000Z
SUMMARY:Office hours`), { sourceId: 'canvas' });
    expect(result.assignments).toEqual([]);
    expect(result.events[0].key).toBe('canvas:event-calendar-event-9');
  });

  it('returns each CalDAV expanded occurrence when its master is absent', () => {
    const { events } = parse(`${event(`UID:expanded
RECURRENCE-ID:20261116T180000Z
DTSTART:20261116T180000Z
DTEND:20261116T190000Z`)}
${event(`UID:expanded
RECURRENCE-ID:20261123T180000Z
DTSTART:20261123T200000Z
DTEND:20261123T210000Z`)}`);
    expect(events.map((e) => e.key)).toEqual([
      'feed:school:expanded@2026-11-16T18:00:00.000Z',
      'feed:school:expanded@2026-11-23T20:00:00.000Z',
    ]);
    expect(events.every((e) => e.seriesKey === 'feed:school:expanded' && e.recurring)).toBe(true);
  });

  it('throws on invalid iCalendar text', () => {
    expect(() => parseIcs(`this is not an iCalendar file`, options)).toThrow();
  });
});

describe('wallTimeToUtc', () => {
  it('converts a known zone to an absolute instant', () => {
    expect(wallTimeToUtc(2026, 11, 16, 18, 30, 15, 'America/New_York')).toBe(Date.parse('2026-11-16T23:30:15Z'));
  });
  it('returns null for an unknown zone', () => {
    expect(wallTimeToUtc(2026, 11, 16, 18, 0, 0, 'Unknown/Planner_Zone')).toBeNull();
  });
});

describe('normalizeFeedUrl', () => {
  it.each(['webcal', 'webcals', 'WEBCAL'])('converts %s links to https', (scheme) => {
    expect(normalizeFeedUrl(` ${scheme}://school.example/feed.ics `)).toBe('https://school.example/feed.ics');
  });
  it('accepts https links unchanged', () => {
    expect(normalizeFeedUrl('https://school.example/feed.ics')).toBe('https://school.example/feed.ics');
  });
  it.each(['http://school.example/feed.ics', 'HTTP://school.example/feed.ics', 'school.example/feed.ics'])('upgrades %s to https, since the address works like a password', (url) => {
    expect(normalizeFeedUrl(url)).toBe('https://school.example/feed.ics');
  });
  it.each([
    'ftp://school.example/feed.ics',
    'javascript:alert(1)',
    'file:///C:/feed.ics',
    'garbage',
    '',
    'https://user:secret@school.example/feed.ics',
    `https://school.example/${'a'.repeat(2100)}`,
  ])('rejects %s', (url) => {
    expect(normalizeFeedUrl(url)).toBeNull();
  });
});
