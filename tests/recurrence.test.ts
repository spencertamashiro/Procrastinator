import { describe, it, expect } from 'vitest';
import { occurrencesInRange } from '../src/shared/recurrence';
import { dayKey, MIN } from '../src/shared/time';
import type { Task, RecurrenceFreq } from '../src/shared/types';

const local = (month: number, day: number, hour = 0) => new Date(2026, month - 1, day, hour).getTime();
const iso = (month: number, day: number, hour = 0) => new Date(local(month, day, hour)).toISOString();
const task = (patch: Partial<Task> = {}): Task => ({
  id: 'task:study', title: 'Study', durationMin: 60,
  preferredDue: iso(1, 5, 12), finalDeadline: iso(1, 5, 14), createdAt: iso(1, 1), ...patch,
});

describe('occurrencesInRange', () => {
  it('returns a one-off in range with its original id and excludes it outside the range', () => {
    expect(occurrencesInRange(task(), local(1, 5), local(1, 6))).toEqual([
      { key: 'task:study', preferredDue: local(1, 5, 12), finalDeadline: local(1, 5, 14) },
    ]);
    expect(occurrencesInRange(task(), local(1, 6), local(1, 7))).toEqual([]);
    expect(occurrencesInRange(task(), local(1, 1), local(1, 2))).toEqual([]);
  });

  it.each([
    ['daily', [5, 6, 7, 8, 9, 10, 11]],
    ['weekly', [5, 12, 19]],
    ['biweekly', [5, 19]],
    ['weekdays', [5, 6, 7, 8, 9]],
  ] satisfies [RecurrenceFreq, number[]][])('expands %s with local dates and occurrence keys', (freq, dates) => {
    const end = freq === 'weekly' || freq === 'biweekly' ? local(1, 20) : local(1, 12);
    const occurrences = occurrencesInRange(task({ recurrence: { freq } }), local(1, 5), end);
    expect(occurrences.map((o) => o.preferredDue)).toEqual(dates.map((day) => local(1, day, 12)));
    expect(occurrences.map((o) => o.key)).toEqual(dates.map((day) => `task:study@${dayKey(local(1, day))}`));
  });

  it('expands monthly from the original day and clamps short months without drift', () => {
    const occurrences = occurrencesInRange(task({
      preferredDue: iso(1, 31, 12), finalDeadline: iso(1, 31, 14), recurrence: { freq: 'monthly' },
    }), local(1, 1), local(4, 1));
    expect(occurrences.map((o) => o.preferredDue)).toEqual([local(1, 31, 12), local(2, 28, 12), local(3, 31, 12)]);
  });

  it('includes every occurrence on the until date, but none after it', () => {
    const occurrences = occurrencesInRange(task({ recurrence: { freq: 'daily', until: '2026-01-07' } }), local(1, 1), local(1, 10));
    expect(occurrences.map((o) => o.key)).toEqual(['task:study@2026-01-05', 'task:study@2026-01-06', 'task:study@2026-01-07']);
    expect(occurrencesInRange(task({ recurrence: { freq: 'daily', until: '2026-01-04' } }), local(1, 1), local(1, 10))).toEqual([]);
  });

  it('preserves the exact due-to-deadline gap for every repeated occurrence', () => {
    const original = task({ preferredDue: iso(3, 6, 12), finalDeadline: iso(3, 7, 14), recurrence: { freq: 'daily' } });
    const occurrences = occurrencesInRange(original, local(3, 6), local(3, 12));
    expect(occurrences.length).toBeGreaterThan(1);
    for (const occurrence of occurrences) {
      expect(occurrence.finalDeadline - occurrence.preferredDue).toBe(Date.parse(original.finalDeadline) - Date.parse(original.preferredDue));
    }
  });

  it.each([undefined, { freq: 'daily' as const, until: '2026-01-05' }])('includes deadline-only intersections for recurrence %j', (recurrence) => {
    const original = task({ finalDeadline: iso(1, 7, 14), recurrence });
    const occurrences = occurrencesInRange(original, local(1, 7), local(1, 8));
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].preferredDue).toBeLessThan(local(1, 7));
    expect(occurrences[0].finalDeadline).toBe(local(1, 7, 14));
  });

  it('includes work blocks that overlap the range even when the due time is beyond its end', () => {
    const due = local(1, 5, 12);
    expect(occurrencesInRange(task(), due - 30 * MIN, due - 15 * MIN)).toHaveLength(1);
    expect(occurrencesInRange(task(), due - 120 * MIN, due - 60 * MIN)).toEqual([]);
  });

  it('ignores invalid dates and skips weekends even if a weekday series begins on Saturday', () => {
    expect(occurrencesInRange(task({ preferredDue: 'bad' }), local(1, 1), local(2, 1))).toEqual([]);
    expect(occurrencesInRange(task({ finalDeadline: 'bad' }), local(1, 1), local(2, 1))).toEqual([]);
    const occurrences = occurrencesInRange(task({ preferredDue: iso(1, 10, 12), finalDeadline: iso(1, 10, 14), recurrence: { freq: 'weekdays' } }), local(1, 10), local(1, 14));
    expect(occurrences.map((o) => dayKey(o.preferredDue))).toEqual(['2026-01-12', '2026-01-13']);
  });
});
