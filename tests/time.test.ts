import { describe, it, expect } from 'vitest';
import {
  addDays, addMonths, atMinutes, dayKey, dayRange, fmtDuration, fmtHour,
  fmtRangeTitle, fromLocalInput, isSameDay, minutesIntoDay, monthGrid,
  parseClock, parseDayKey, rangeFor, shiftAnchor, startOfDay, startOfWeek,
  toLocalInput, weekRange,
} from '../src/shared/time';

const local = (month: number, day: number, hour = 0, minute = 0) =>
  new Date(2026, month - 1, day, hour, minute).getTime();

describe('local calendar ranges', () => {
  it.each([0, 1] as const)('starts a week on weekday %i at midnight', (first) => {
    expect(startOfWeek(local(1, 7, 15), first)).toBe(local(1, first === 0 ? 4 : 5));
    const sunday = local(1, 4, 12);
    expect(startOfWeek(sunday, first)).toBe(first === 0 ? local(1, 4) : new Date(2025, 11, 29).getTime());
  });

  it.each(['calendar', 'rolling'] as const)('builds seven days with an exclusive end for %s weeks', (mode) => {
    const range = weekRange(local(1, 7, 15), mode, 1);
    const start = local(1, mode === 'calendar' ? 5 : 7);
    expect(range.start).toBe(start);
    expect(range.days).toEqual(Array.from({ length: 7 }, (_, i) => addDays(start, i)));
    expect(range.end).toBe(addDays(start, 7));
    expect(range.days).not.toContain(range.end);
  });

  it('rolling weeks start on the anchor day regardless of the week-start setting', () => {
    expect(weekRange(local(1, 7, 23), 'rolling', 0)).toEqual(weekRange(local(1, 7, 23), 'rolling', 1));
    expect(weekRange(local(1, 7, 23), 'rolling', 0).start).toBe(local(1, 7));
  });

  it.each([0, 1] as const)('month grids have 42 days and cover every date for week start %i', (first) => {
    for (const month of [2, 3, 8, 12]) {
      const grid = monthGrid(local(month, 15), first);
      expect(grid.days).toHaveLength(42);
      expect(new Date(grid.start).getDay()).toBe(first);
      expect(grid.end).toBe(addDays(grid.start, 42));
      const last = new Date(2026, month, 0).getDate();
      for (let day = 1; day <= last; day++) expect(grid.days).toContain(local(month, day));
    }
  });

  it('dispatches ranges by view', () => {
    const anchor = local(1, 7, 14);
    expect(dayRange(anchor)).toEqual({ start: local(1, 7), end: local(1, 8), days: [local(1, 7)] });
    expect(rangeFor('day', anchor, 'rolling', 1)).toEqual(dayRange(anchor));
    expect(rangeFor('week', anchor, 'rolling', 1)).toEqual(weekRange(anchor, 'rolling', 1));
    expect(rangeFor('month', anchor, 'calendar', 0)).toEqual(monthGrid(anchor, 0));
  });
});

describe('date arithmetic and inputs', () => {
  it('clamps month additions without losing local time, including leap years and backwards shifts', () => {
    expect(addMonths(local(1, 31, 13, 45), 1)).toBe(local(2, 28, 13, 45));
    expect(addMonths(new Date(2024, 0, 31, 13).getTime(), 1)).toBe(new Date(2024, 1, 29, 13).getTime());
    expect(addMonths(local(3, 31), -1)).toBe(local(2, 28));
    expect(addMonths(local(1, 31), 2)).toBe(local(3, 31));
  });

  it('round trips padded local day keys to midnight', () => {
    expect(dayKey(local(2, 3, 23, 59))).toBe('2026-02-03');
    expect(parseDayKey(dayKey(local(2, 3, 23, 59)))).toBe(local(2, 3));
    expect(dayKey(parseDayKey('2024-02-29'))).toBe('2024-02-29');
  });

  it.each([1, -1] as const)('shifts each view in direction %i', (dir) => {
    const anchor = local(1, 15, 10, 30);
    expect(shiftAnchor(anchor, 'day', dir)).toBe(local(1, 15 + dir, 10, 30));
    expect(shiftAnchor(anchor, 'week', dir)).toBe(local(1, 15 + 7 * dir, 10, 30));
    expect(shiftAnchor(anchor, 'month', dir)).toBe(new Date(2026, dir, 1).getTime());
  });

  it('round trips datetime-local values with minute precision', () => {
    const instant = local(6, 18, 17, 9);
    expect(toLocalInput(instant)).toBe('2026-06-18T17:09');
    expect(fromLocalInput(toLocalInput(instant))).toBe(instant);
    expect(fromLocalInput('not a date')).toBeNaN();
    expect(fromLocalInput('')).toBeNaN();
  });

  it('uses local day boundaries and wall-clock minutes', () => {
    expect(startOfDay(local(6, 18, 17, 9))).toBe(local(6, 18));
    expect(isSameDay(local(6, 18), local(6, 18, 23, 59))).toBe(true);
    expect(isSameDay(local(6, 18), local(6, 19))).toBe(false);
    expect(minutesIntoDay(local(6, 18, 17, 9))).toBe(1029);
    expect(atMinutes(local(6, 18, 12), 1029)).toBe(local(6, 18, 17, 9));
    expect(addDays(local(3, 7, 12), 1)).toBe(local(3, 8, 12));
  });
});

describe('formatting', () => {
  it.each([[0, '0 min'], [-5, '0 min'], [44.6, '45 min'], [60, '1 h'], [90, '1 h 30 min'], [120, '2 h']])(
    'formats %s minutes as %s', (minutes, expected) => expect(fmtDuration(Number(minutes))).toBe(expected),
  );

  it('formats midnight, noon and afternoon in 12-hour and 24-hour time', () => {
    expect([0, 8, 12, 23].map((h) => fmtHour(h, true))).toEqual(['12 AM', '8 AM', '12 PM', '11 PM']);
    expect([0, 8, 12, 23].map((h) => fmtHour(h, false))).toEqual(['00:00', '08:00', '12:00', '23:00']);
  });

  it('formats same-month, cross-month and cross-year ranges using the last included day', () => {
    expect(fmtRangeTitle(weekRange(local(1, 5), 'rolling', 1), 'week', local(1, 5)))
      .toEqual({ main: 'January 5 – 11', year: '2026' });
    expect(fmtRangeTitle(weekRange(local(1, 29), 'rolling', 1), 'week', local(1, 29)))
      .toEqual({ main: 'Jan 29 – Feb 4', year: '2026' });
    expect(fmtRangeTitle(weekRange(local(12, 29), 'rolling', 1), 'week', local(12, 29)))
      .toEqual({ main: 'Dec 29 – Jan 4', year: '2027' });
    expect(fmtRangeTitle(monthGrid(local(1, 15), 1), 'month', local(1, 15))).toEqual({ main: 'January', year: '2026' });
    expect(fmtRangeTitle(dayRange(local(1, 5)), 'day', local(1, 5))).toEqual({ main: 'Monday, January 5', year: '2026' });
  });

  it.each([['09:05', 545], [' 7:30 ', 450], ['23:59', 1439], ['99:99', 1439], ['7:3', 0], ['bad', 0], ['', 0]])(
    'parses clock %s', (clock, expected) => expect(parseClock(String(clock))).toBe(expected),
  );
});
