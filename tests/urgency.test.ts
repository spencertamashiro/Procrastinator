import { describe, it, expect } from 'vitest';
import {
  analyze, buildDigest, freeMinutes, isSleeping, latestStart, mergeIntervals,
  pickReminders, reminderId, sleepIntervals, workItems,
} from '../src/shared/urgency';
import type { Analysis, UrgencyOptions, WorkItem } from '../src/shared/urgency';
import type { PlannerItem } from '../src/shared/items';
import { fmtTime, MIN } from '../src/shared/time';

const local = (day: number, hour = 0, minute = 0) => new Date(2026, 0, day, hour, minute).getTime();
const now = local(5, 9);
const options: UrgencyOptions = { bufferPct: 0, headsUpMin: 60, startNowMin: 10, sleep: null };
const work = (patch: Partial<WorkItem> = {}): WorkItem => ({
  key: 'task:1', title: 'Study', kind: 'task', deadline: local(5, 12), effortMin: 60, important: false, ...patch,
});
const analysis = (patch: Partial<Analysis> = {}): Analysis => ({
  ...work(), needMin: 60, queuedMin: 0, freeMin: 180, slackMin: 120,
  startBy: local(5, 11), level: 'ok', ...patch,
});
const sleep = { startMin: 22 * 60, endMin: 7 * 60 };
const reminderOptions = { finalMin: 5, hour12: true };

describe('availability', () => {
  it('sorts and merges overlapping, contained and touching intervals without mutating inputs', () => {
    const intervals = [{ start: 10, end: 20 }, { start: 0, end: 5 }, { start: 4, end: 12 }, { start: 6, end: 7 }, { start: 20, end: 25 }, { start: 30, end: 35 }, { start: 40, end: 40 }, { start: 50, end: 49 }];
    const original = intervals.map((i) => ({ ...i }));
    expect(mergeIntervals(intervals)).toEqual([{ start: 0, end: 25 }, { start: 30, end: 35 }]);
    expect(intervals).toEqual(original);
    expect(mergeIntervals([])).toEqual([]);
  });

  it('clips crossing-midnight sleep windows at both ends of a range', () => {
    expect(sleepIntervals(local(5, 23), local(7, 6), sleep)).toEqual([
      { start: local(5, 23), end: local(6, 7) },
      { start: local(6, 22), end: local(7, 6) },
    ]);
    expect(sleepIntervals(local(5, 6), local(5, 8), sleep)).toEqual([{ start: local(5, 6), end: local(5, 7) }]);
  });

  it('supports same-day sleep and disabled or empty sleep windows', () => {
    expect(sleepIntervals(local(5), local(6), { startMin: 60, endMin: 120 })).toEqual([{ start: local(5, 1), end: local(5, 2) }]);
    expect(sleepIntervals(local(5), local(6), null)).toEqual([]);
    expect(sleepIntervals(local(5), local(6), { startMin: 60, endMin: 60 })).toEqual([]);
  });

  it('subtracts busy time and sleep once, including their overlaps', () => {
    const busy = [
      { start: local(5, 5), end: local(5, 8) },
      { start: local(5, 9), end: local(5, 10) },
      { start: local(5, 9, 30), end: local(5, 10, 30) },
      { start: local(5, 11), end: local(5, 13) },
    ];
    expect(freeMinutes(local(5, 6), local(5, 12), busy, sleep)).toBe(90);
    expect(freeMinutes(now, now, [], null)).toBe(0);
    expect(freeMinutes(now + MIN, now, [], null)).toBe(0);
  });

  it('walks backwards across a busy block and returns before now when work cannot fit', () => {
    const busy = [{ start: local(5, 10), end: local(5, 11) }];
    expect(latestStart(now, local(5, 12), 90, busy, null)).toBe(local(5, 9, 30));
    expect(latestStart(now, local(5, 12), 150, busy, null)).toBe(local(5, 8, 30));
    expect(latestStart(now, local(5, 12), 0, busy, null)).toBe(local(5, 12));
    expect(latestStart(local(5, 21), local(6, 8), 90, [], sleep)).toBe(local(5, 21, 30));
  });

  it('detects sleep at inclusive starts and exclusive ends for both window types', () => {
    expect(isSleeping(local(5, 22), sleep)).toBe(true);
    expect(isSleeping(local(6, 6, 59), sleep)).toBe(true);
    expect(isSleeping(local(6, 7), sleep)).toBe(false);
    expect(isSleeping(local(5, 12), sleep)).toBe(false);
    expect(isSleeping(local(5, 1), { startMin: 60, endMin: 120 })).toBe(true);
    expect(isSleeping(local(5, 2), { startMin: 60, endMin: 120 })).toBe(false);
    expect(isSleeping(now, null)).toBe(false);
  });
});

describe('workload analysis', () => {
  it('orders by deadline, breaks ties by key, buffers and accumulates queued work', () => {
    const input = [work({ key: 'b', deadline: local(5, 13), effortMin: 40 }), work({ key: 'c', effortMin: 31 }), work({ key: 'a', effortMin: 20 })];
    const result = analyze(now, input, [], { ...options, bufferPct: 25 });
    expect(result.map((a) => a.key)).toEqual(['a', 'c', 'b']);
    expect(result.map((a) => a.needMin)).toEqual([25, 39, 50]);
    expect(result.map((a) => a.queuedMin)).toEqual([0, 25, 64]);
    expect(result.map((a) => a.slackMin)).toEqual([155, 116, 126]);
    expect(result[2].startBy).toBe(local(5, 11, 6));
    expect(input.map((a) => a.key)).toEqual(['b', 'c', 'a']);
  });

  it.each([
    [121, 'ok'], [120, 'soon'], [71, 'soon'], [70, 'now'], [60, 'now'], [59, 'behind'], [0, 'overdue'], [-1, 'overdue'],
  ] as const)('classifies a 60-minute task due in %i minutes as %s', (until, level) => {
    const [result] = analyze(now, [work({ deadline: now + until * MIN })], [], options);
    expect(result.level).toBe(level);
  });

  it('doubles the heads-up window for important items', () => {
    expect(analyze(now, [work()], [], options)[0].level).toBe('ok');
    expect(analyze(now, [work({ important: true })], [], options)[0].level).toBe('soon');
  });

  it('accounts for busy events and sleep in analysis availability and latest start', () => {
    const [result] = analyze(local(5, 6), [work({ deadline: local(5, 10), effortMin: 60 })], [{ start: local(5, 8), end: local(5, 9) }], { ...options, sleep });
    expect(result).toMatchObject({ freeMin: 120, slackMin: 60, startBy: local(5, 9), level: 'soon' });
  });

  it('does not enqueue overdue work ahead of upcoming tasks', () => {
    const result = analyze(now, [work({ key: 'overdue', deadline: now }), work()], [], options);
    expect(result[0]).toMatchObject({ level: 'overdue', queuedMin: 0, freeMin: 0, slackMin: -60, startBy: now - 60 * MIN });
    expect(result[1].queuedMin).toBe(0);
  });

  it('extracts unfinished unmuted work, deduplicates keys and clamps negative effort', () => {
    const base: PlannerItem = { key: 'task', seriesKey: 'task', kind: 'task', source: 'local', title: 'Study', allDay: false, start: now, end: local(5, 12), deadline: local(5, 12), effortMin: -5, important: true, muted: false, done: false, recurring: false };
    expect(workItems([
      base, base, { ...base, key: 'done', done: true }, { ...base, key: 'muted', muted: true },
      { ...base, key: 'event', kind: 'event' }, { ...base, key: 'no-deadline', deadline: undefined },
      { ...base, key: 'assignment', kind: 'assignment', effortMin: undefined },
    ])).toEqual([
      { key: 'task', title: 'Study', kind: 'task', deadline: local(5, 12), effortMin: 0, important: true },
      { key: 'assignment', title: 'Study', kind: 'assignment', deadline: local(5, 12), effortMin: 0, important: true },
    ]);
  });
});

describe('reminders and digests', () => {
  it('escalates soon to now to final once each using the fired map', () => {
    const deadline = local(5, 12);
    const fired: Record<string, number> = {};
    const id = reminderId({ key: 'task:1', deadline });
    expect(id).toBe(`task:1|${deadline}`);
    for (const [time, level, stage, rank] of [
      [local(5, 10), 'soon', 'soon', 1], [local(5, 11), 'now', 'now', 2], [local(5, 11, 56), 'behind', 'final', 3],
    ] as const) {
      const current = analysis({ deadline, level });
      const reminders = pickReminders([current], fired, time, reminderOptions);
      expect(reminders).toHaveLength(1);
      expect(reminders[0]).toMatchObject({ id, itemKey: 'task:1', stage, rank });
      expect(reminders[0].title).toContain('Study');
      expect(reminders[0].body).toContain('1 h');
      fired[id] = reminders[0].rank;
      expect(pickReminders([current], fired, time, reminderOptions)).toEqual([]);
    }
    expect(pickReminders([analysis({ level: 'soon' })], fired, now, reminderOptions)).toEqual([]);
  });

  it('respects preexisting ranks and treats a changed deadline as a new reminder', () => {
    const current = analysis({ level: 'now' });
    const fired = { [reminderId(current)]: 3 };
    expect(pickReminders([current], fired, now, reminderOptions)).toEqual([]);
    expect(pickReminders([{ ...current, deadline: current.deadline + MIN }], fired, now, reminderOptions)).toHaveLength(1);
    expect(pickReminders([analysis({ level: 'behind' })], {}, now, reminderOptions)[0].stage).toBe('now');
  });

  it('does not fire for overdue items or ok items outside the final window', () => {
    expect(pickReminders([analysis({ level: 'overdue', deadline: now - MIN }), analysis()], {}, now, reminderOptions)).toEqual([]);
  });

  // The last reminder is about the clock, not the workload: anything still unfinished
  // gets one "due in N min" nudge inside the final window, even when it would fit easily.
  it('sends the final reminder for an ok item inside the final window, and nothing before it', () => {
    const relaxed = { ...options, headsUpMin: 1, startNowMin: 0 };
    const [far] = analyze(now, [work({ deadline: now + 6 * 60 * MIN, effortMin: 1 })], [], relaxed);
    expect(far.level).toBe('ok');
    expect(pickReminders([far], {}, now, reminderOptions)).toEqual([]);

    const [close] = analyze(now, [work({ deadline: now + 4 * MIN, effortMin: 1 })], [], relaxed);
    expect(close.level).toBe('ok');
    const fired = pickReminders([close], {}, now, reminderOptions);
    expect(fired.map((r) => r.stage)).toEqual(['final']);
    expect(pickReminders([close], { [fired[0].id]: fired[0].rank }, now, reminderOptions)).toEqual([]);
  });

  it('builds a digest of today only, totals effort, and names the tightest item', () => {
    const digest = buildDigest([
      analysis({ title: 'Loose', effortMin: 30 }),
      analysis({ title: 'Tight', effortMin: 45, slackMin: -10, level: 'behind', startBy: now - MIN }),
      analysis({ title: 'Tomorrow', deadline: local(6) }),
      analysis({ title: 'Overdue', level: 'overdue', deadline: now - MIN }),
    ], now, true);
    expect(digest).toEqual({ title: 'Today: 2 due · about 1 h 15 min of work', body: `Tightest: Tight, start by ${fmtTime(now, true)}.` });
    expect(buildDigest([], now, false)).toBeNull();
    expect(buildDigest([analysis({ deadline: local(6) }), analysis({ level: 'overdue' })], now, false)).toBeNull();
  });
});
