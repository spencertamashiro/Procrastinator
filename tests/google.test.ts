import { describe, it, expect } from 'vitest';
import { eventsUrl, mapCalendarList, mapGoogleEvents } from '../src/shared/google';
import type { CalendarRef } from '../src/shared/types';

const calendar: CalendarRef = { id: 'school@example.com', name: 'School', enabled: true };
function timed(id: string, extra: Record<string, unknown> = {}) {
  return { id, summary: ' Lecture ', start: { dateTime: '2026-11-16T10:00:00-08:00' },
    end: { dateTime: '2026-11-16T11:00:00-08:00' }, ...extra };
}

describe('eventsUrl', () => {
  it('encodes the calendar ID and sets expansion, ordering and absolute range parameters', () => {
    const url = new URL(eventsUrl('team/a+b@example.com', Date.parse('2026-11-16T00:00:00Z'), Date.parse('2026-11-23T00:00:00Z'), 'page +/2'));
    expect(url.pathname).toBe('/calendar/v3/calendars/team%2Fa%2Bb%40example.com/events');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      singleEvents: 'true', orderBy: 'startTime', timeMin: '2026-11-16T00:00:00.000Z',
      timeMax: '2026-11-23T00:00:00.000Z', maxResults: '1000', pageToken: 'page +/2',
    });
  });
  it('omits an absent page token', () => {
    expect(new URL(eventsUrl('primary', 0, 1000)).searchParams.has('pageToken')).toBe(false);
  });
});

describe('mapCalendarList', () => {
  it('preserves both previous enabled choices and follows selected for new calendars', () => {
    expect(mapCalendarList({ items: [
      { id: 'off', summary: 'Off', selected: true }, { id: 'on', summary: 'On', selected: false },
      { id: 'new-on', summary: 'New on', selected: true }, { id: 'new-off', summary: 'New off', selected: false },
      { id: 'default' },
    ] }, [{ id: 'off', name: 'Old off', enabled: false }, { id: 'on', name: 'Old on', enabled: true }])).toEqual([
      { id: 'off', name: 'Off', enabled: false }, { id: 'on', name: 'On', enabled: true },
      { id: 'new-on', name: 'New on', enabled: true }, { id: 'new-off', name: 'New off', enabled: false },
      { id: 'default', name: 'default', enabled: true },
    ]);
  });
  it('uses summaryOverride and filters malformed records', () => {
    expect(mapCalendarList({ items: [null, {}, { id: 42 }, { id: 'a', summary: 'Original', summaryOverride: 'My calendar' }] }, [])).toEqual([
      { id: 'a', name: 'My calendar', enabled: true },
    ]);
  });
  it.each([null, {}, { items: 'invalid' }])('returns no calendars for %j', (payload) => {
    expect(mapCalendarList(payload, [])).toEqual([]);
  });
});

describe('mapGoogleEvents', () => {
  it('maps timed events to UTC and preserves useful metadata', () => {
    expect(mapGoogleEvents({ items: [timed('lecture', { location: 'Room 3', htmlLink: 'https://calendar.google.com/event', description: 'Bring notes' })] }, calendar)).toEqual([{
      key: 'google:school@example.com:lecture', seriesKey: 'google:school@example.com:lecture', sourceId: 'google',
      calendar: 'School', title: 'Lecture', start: '2026-11-16T18:00:00.000Z', end: '2026-11-16T19:00:00.000Z',
      allDay: false, recurring: undefined, location: 'Room 3', url: 'https://calendar.google.com/event', notes: 'Bring notes',
    }]);
  });
  it('keeps all-day start and exclusive end as date keys', () => {
    const result = mapGoogleEvents({ items: [{ id: 'holiday', summary: 'Holiday', start: { date: '2026-11-16' }, end: { date: '2026-11-19' } }] }, calendar);
    expect(result[0]).toMatchObject({ allDay: true, start: '2026-11-16', end: '2026-11-19' });
  });
  it('skips cancelled events', () => {
    expect(mapGoogleEvents({ items: [timed('cancelled', { status: 'cancelled' })] }, calendar)).toEqual([]);
  });
  it('gives recurring instances distinct keys and a shared seriesKey', () => {
    const result = mapGoogleEvents({ items: [timed('instance-1', { recurringEventId: 'series' }), timed('instance-2', { recurringEventId: 'series' })] }, calendar);
    expect(result.map((e) => e.key)).toEqual(['google:school@example.com:instance-1', 'google:school@example.com:instance-2']);
    expect(result.map((e) => [e.seriesKey, e.recurring])).toEqual([
      ['google:school@example.com:series', true], ['google:school@example.com:series', true],
    ]);
  });
  it.each([undefined, '', '   '])('uses an untitled fallback for summary %s', (summary) => {
    expect(mapGoogleEvents({ items: [timed('untitled', { summary })] }, calendar)[0].title).toBe('(untitled)');
  });
  it('skips invalid starts, absent IDs and malformed records', () => {
    expect(mapGoogleEvents({ items: [null, {}, timed('bad', { start: { dateTime: 'soon' } }), timed('missing', { start: {} }), timed('no-id', { id: undefined })] }, calendar)).toEqual([]);
  });
  it('falls back to the start when a timed end is absent and caps notes', () => {
    expect(mapGoogleEvents({ items: [timed('brief', { end: undefined, description: 'x'.repeat(300) })] }, calendar)[0]).toMatchObject({
      start: '2026-11-16T18:00:00.000Z', end: '2026-11-16T18:00:00.000Z', notes: 'x'.repeat(280),
    });
  });
  it.each([null, {}, { items: 'invalid' }])('returns no events for %j', (payload) => {
    expect(mapGoogleEvents(payload, calendar)).toEqual([]);
  });
});
