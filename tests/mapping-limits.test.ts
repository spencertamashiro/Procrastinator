import { describe, it, expect, vi } from 'vitest';
import { mapGoogleEvents, mapCalendarList } from '../src/shared/google';
import { mapPlannerItems } from '../src/shared/canvas';
import { mapPlaces } from '../src/shared/weather';
import { LIMITS } from '../src/shared/sanitize';
import { MAX_KEY_LENGTH } from '../src/main/actions';

const long = 'x'.repeat(5000);
const calendar = { id: 'school', name: 'School', enabled: true };
const googleEvent = (extra: Record<string, unknown> = {}) => ({ id: 'event', summary: 'Meeting',
  start: { dateTime: '2026-11-16T12:00:00Z' }, end: { dateTime: '2026-11-16T13:00:00Z' }, ...extra });
const baseUrl = 'https://canvas.example.com';
const plannerItem = (extra: Record<string, unknown> = {}) => ({ plannable_id: 2, plannable_type: 'assignment',
  plannable: { title: 'Homework', due_at: '2026-11-16T12:00:00Z' }, context_name: 'Course', ...extra });

describe('Google mapping limits', () => {
  it('clips long event summaries and locations', () => {
    expect(mapGoogleEvents({ items: [googleEvent({ summary: long, location: long })] }, calendar)[0])
      .toMatchObject({ title: long.slice(0, LIMITS.title), location: long.slice(0, LIMITS.location) });
  });
  it.each(['summary', 'summaryOverride'])('clips calendar names from %s', (field) => {
    const calendars = mapCalendarList({ items: [{ id: 'school', [field]: long }] }, []);
    expect(calendars[0].name).toBe(long.slice(0, LIMITS.calendar));
    expect(mapGoogleEvents({ items: [googleEvent()] }, calendars[0])[0].calendar).toBe(long.slice(0, LIMITS.calendar));
  });
  it('drops a javascript event link', () => {
    expect(mapGoogleEvents({ items: [googleEvent({ htmlLink: 'javascript:alert(1)' })] }, calendar)[0].url).toBeUndefined();
  });
  it.each(['event', 'calendar', 'both'])('bounds keys containing long %s ids', (which) => {
    const cal = mapCalendarList({ items: [{ id: which === 'event' ? 'school' : long, summary: 'School' }] }, [])[0];
    const result = mapGoogleEvents({ items: [googleEvent({ id: which === 'calendar' ? 'event' : long, recurringEventId: long })] }, cal);
    expect(result).toHaveLength(1);
    expect(result[0].key.length).toBeLessThanOrEqual(MAX_KEY_LENGTH);
    expect(result[0].seriesKey.length).toBeLessThanOrEqual(MAX_KEY_LENGTH);
  });
});

describe('Canvas mapping limits', () => {
  it('clips the title and course name', () => {
    expect(mapPlannerItems([plannerItem({ plannable: { title: long, due_at: '2026-11-16T12:00:00Z' }, context_name: long })], baseUrl)[0])
      .toMatchObject({ title: long.slice(0, LIMITS.title), course: long.slice(0, LIMITS.course) });
  });
  it('joins a relative event link to the base URL', () => {
    expect(mapPlannerItems([plannerItem({ html_url: '/courses/1/assignments/2' })], baseUrl)[0].url)
      .toBe('https://canvas.example.com/courses/1/assignments/2');
  });
  it.each(['javascript:alert(1)', '//evil.example/x'])('drops unsafe link %s', (html_url) => {
    expect(mapPlannerItems([plannerItem({ html_url })], baseUrl)[0].url).toBeUndefined();
  });
  it('skips an object id without coercing it', () => {
    const toString = vi.fn(() => '2');
    expect(mapPlannerItems([plannerItem({ plannable_id: { toString } })], baseUrl)).toEqual([]);
    expect(toString).not.toHaveBeenCalled();
  });
  it('bounds a key built from a long string id', () => {
    const result = mapPlannerItems([plannerItem({ plannable_id: long })], baseUrl);
    expect(result).toHaveLength(1);
    expect(result[0].key.length).toBeLessThanOrEqual(MAX_KEY_LENGTH);
  });
});

describe('weather mapping limits', () => {
  it.each([{ latitude: 91, longitude: 0 }, { latitude: -91, longitude: 0 }, { latitude: 0, longitude: 181 },
    { latitude: 0, longitude: -181 }, { latitude: NaN, longitude: 0 }, { latitude: 0, longitude: Infinity },
    { latitude: '45', longitude: 0 }])('drops invalid coordinates %j', (coordinates) => {
    expect(mapPlaces({ results: [{ name: 'Invalid', ...coordinates }] })).toEqual([]);
  });
  it('clips place, region and country names', () => {
    expect(mapPlaces({ results: [{ name: long, admin1: long, country: long, latitude: 45, longitude: 90 }] }))
      .toEqual([{ name: long.slice(0, LIMITS.place), region: long.slice(0, LIMITS.place), country: long.slice(0, LIMITS.place), lat: 45, lon: 90 }]);
  });
  it.each([undefined, null, 42, {}, []].map((name) => [name]))('drops a place without a string name: %j', (name) => {
    expect(mapPlaces({ results: [{ name, latitude: 45, longitude: 90 }] })).toEqual([]);
  });
  it('returns at most 20 valid places', () => {
    const results = Array.from({ length: 25 }, (_, i) => ({ name: `Place ${i}`, latitude: 45, longitude: 90 }));
    const mapped = mapPlaces({ results });
    expect(mapped).toHaveLength(20);
    expect(mapped.map((p) => p.name)).toEqual(results.slice(0, 20).map((p) => p.name));
  });
});
