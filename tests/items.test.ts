import { describe, it, expect } from 'vitest';
import { allDayFor, buildItems, busyIntervals, deadlineMarkers, hiddenTester, layoutDay } from '../src/shared/items';
import type { DataSlice, PlannerItem } from '../src/shared/items';
import { defaultSettings } from '../src/shared/defaults';
import { normalizeTitle } from '../src/shared/similarity';
import { MIN } from '../src/shared/time';
import type { Assignment, CalEvent, Task } from '../src/shared/types';

const local = (day: number, hour = 0, minute = 0) => new Date(2026, 0, day, hour, minute).getTime();
const iso = (day: number, hour = 0) => new Date(local(day, hour)).toISOString();
const event = (patch: Partial<CalEvent> = {}): CalEvent => ({
  key: 'event:1', seriesKey: 'series:1', sourceId: 'google', calendar: 'Work',
  title: 'Meeting', start: iso(5, 9), end: iso(5, 10), allDay: false, ...patch,
});
const assignment = (patch: Partial<Assignment> = {}): Assignment => ({
  key: 'canvas:assignment:1', sourceId: 'canvas', title: 'Problem Set 6', course: 'Math',
  dueAt: iso(5, 15), allDay: false, submitted: false, type: 'assignment', ...patch,
});
const task = (patch: Partial<Task> = {}): Task => ({
  id: 'task:1', title: 'Study', durationMin: 90, preferredDue: iso(5, 12),
  finalDeadline: iso(5, 18), createdAt: iso(1), category: 'School', ...patch,
});
const data = (patch: Partial<DataSlice> = {}): DataSlice => ({
  tasks: [], events: [], assignments: [], overlay: {}, suppressed: { ids: [], rules: [] },
  settings: defaultSettings(), ...patch,
});
const item = (key: string, start: number, end: number, patch: Partial<PlannerItem> = {}): PlannerItem => ({
  key, seriesKey: key, kind: 'event', source: 'local', title: key, start, end,
  allDay: false, important: false, muted: false, done: false, recurring: false, ...patch,
});
const build = (state: DataSlice) => buildItems(state, local(5), local(6));

describe('buildItems', () => {
  it('maps and sorts events, assignments and tasks into planner items', () => {
    const items = build(data({ events: [event({ location: 'Office', url: 'https://example.com', notes: 'Agenda' })], assignments: [assignment()], tasks: [task()] }));
    expect(items.map((i) => i.kind)).toEqual(['event', 'task', 'assignment']);
    expect(items[0]).toMatchObject({ key: 'event:1', seriesKey: 'series:1', source: 'google', subtitle: 'Work', scope: 'Work', start: local(5, 9), end: local(5, 10), location: 'Office', notes: 'Agenda', url: 'https://example.com' });
    expect(items[1]).toMatchObject({ key: 'task:1', seriesKey: 'task:1', taskId: 'task:1', source: 'local', subtitle: 'School', start: local(5, 10, 30), end: local(5, 12), due: local(5, 12), deadline: local(5, 18), effortMin: 90 });
    expect(items[2]).toMatchObject({ key: 'canvas:assignment:1', source: 'canvas', subtitle: 'Math', scope: 'Math', start: local(5, 14), end: local(5, 15), due: local(5, 15), deadline: local(5, 15), effortMin: 60 });
  });

  it('reads important and muted from series keys and task completion from occurrence keys', () => {
    const state = data({ events: [event()], tasks: [task({ recurrence: { freq: 'daily' } })], overlay: {
      'series:1': { important: true, muted: true },
      'task:1': { important: true, muted: true, done: true },
      'task:1@2026-01-05': { done: true },
    } });
    const items = buildItems(state, local(5), local(7));
    expect(items.find((i) => i.key === 'event:1')).toMatchObject({ important: true, muted: true, done: false });
    expect(items.find((i) => i.key === 'task:1@2026-01-05')).toMatchObject({ important: true, muted: true, done: true, recurring: true });
    expect(items.find((i) => i.key === 'task:1@2026-01-06')).toMatchObject({ important: true, muted: true, done: false });
  });

  it('marks submitted and locally completed assignments done and filters submitted ones by settings', () => {
    const state = data({ assignments: [assignment({ submitted: true }), assignment({ key: 'local-done' })], overlay: { 'local-done': { done: true, important: true, muted: true } } });
    expect(build(state).map((i) => i.done)).toEqual([true, true]);
    state.settings.canvas.showSubmitted = false;
    expect(build(state)).toHaveLength(1);
    expect(build(state)[0]).toMatchObject({ key: 'local-done', done: true, important: true, muted: true });
  });

  it('applies per-item effort overrides to assignment and task work-block starts', () => {
    const items = build(data({ tasks: [task()], assignments: [assignment()], overlay: {
      'task:1': { effortMin: 120 }, 'canvas:assignment:1': { effortMin: 30 },
    } }));
    expect(items.find((i) => i.kind === 'task')).toMatchObject({ effortMin: 120, start: local(5, 10), end: local(5, 12) });
    expect(items.find((i) => i.kind === 'assignment')).toMatchObject({ effortMin: 30, start: local(5, 14, 30), end: local(5, 15) });
  });

  it('suppresses a single occurrence without suppressing its series', () => {
    const items = buildItems(data({ tasks: [task({ recurrence: { freq: 'daily' } })], suppressed: {
      ids: [{ key: 'task:1@2026-01-05', title: 'Study', kind: 'task', at: iso(1) }], rules: [],
    } }), local(5), local(7));
    expect(items.map((i) => i.key)).toEqual(['task:1@2026-01-06']);
  });

  it('suppress rules hide similar titles only for the same kind and scope', () => {
    const items = build(data({
      assignments: [assignment(), assignment({ key: 'physics', course: 'Physics' }), assignment({ key: 'quiz', title: 'Quiz 6' })],
      events: [event({ title: 'Problem Set 12', calendar: 'Math' })],
      suppressed: { ids: [], rules: [{ id: 'rule:1', pattern: normalizeTitle('Problem Set 1'), kind: 'assignment', scope: 'Math', sample: 'Problem Set 1', at: iso(1) }] },
    }));
    expect(items.map((i) => i.key).sort()).toEqual(['event:1', 'physics', 'quiz']);
  });

  it('handles exclusive all-day ends and all-day assignments due at the end of their local day', () => {
    const items = build(data({ events: [event({ allDay: true, start: '2026-01-05', end: '2026-01-07' })], assignments: [assignment({ allDay: true, dueAt: '2026-01-05' })] }));
    expect(items.find((i) => i.kind === 'event')).toMatchObject({ allDay: true, start: local(5), end: local(7) });
    expect(items.find((i) => i.kind === 'assignment')).toMatchObject({ allDay: true, start: local(5), end: local(6), due: local(6) - MIN, deadline: local(6) - MIN });
    expect(allDayFor(items, local(6)).map((i) => i.kind)).toEqual(['event']);
    expect(allDayFor(items, local(7))).toEqual([]);
    expect(layoutDay(items, local(5))).toEqual([]);
  });

  it('repairs empty all-day spans and gives short timed events a 20-minute block', () => {
    const items = build(data({ events: [
      event({ allDay: true, start: '2026-01-05', end: '2026-01-05' }),
      event({ key: 'short', end: iso(5, 9) }),
    ] }));
    expect(items.find((i) => i.key === 'event:1')?.end).toBe(local(6));
    expect(items.find((i) => i.key === 'short')?.end).toBe(local(5, 9, 20));
  });

  it('excludes invalid dates and events outside the half-open range', () => {
    expect(build(data({ events: [event({ start: 'bad' }), event({ start: iso(4, 22), end: iso(5) }), event({ start: iso(6), end: iso(6, 1) })], assignments: [assignment({ dueAt: 'bad' })] }))).toEqual([]);
  });

  it('retains a task whose work is earlier but deadline falls in the displayed range', () => {
    expect(build(data({ tasks: [task({ preferredDue: iso(4, 12) })] }))[0]).toMatchObject({ due: local(4, 12), deadline: local(5, 18) });
  });

  it('allows an unscoped suppress rule to cover different scopes', () => {
    const hidden = hiddenTester({ ids: [], rules: [{ id: 'rule', pattern: 'meeting #', kind: 'event', sample: 'Meeting 1', at: iso(1) }] });
    expect(hidden({ key: 'a', title: 'Meeting 2', kind: 'event', scope: 'Work' })).toBe(true);
    expect(hidden({ key: 'b', title: 'Meeting 3', kind: 'event', scope: 'Personal' })).toBe(true);
    expect(hidden({ key: 'c', title: 'Meeting 3', kind: 'assignment' })).toBe(false);
  });
});

describe('day layout and derived intervals', () => {
  it('separates overlapping columns and shares the cluster column count', () => {
    const placed = layoutDay([
      item('a', local(5, 9), local(5, 11)), item('b', local(5, 10), local(5, 12)),
      item('c', local(5, 10, 30), local(5, 11, 30)),
    ], local(5));
    expect(placed.map((p) => p.col)).toEqual([0, 1, 2]);
    expect(placed.map((p) => p.cols)).toEqual([3, 3, 3]);
  });

  it('keeps isolated blocks at one column and reuses columns once blocks end', () => {
    const placed = layoutDay([
      item('a', local(5, 9), local(5, 10)), item('b', local(5, 9, 30), local(5, 10, 30)),
      item('c', local(5, 10), local(5, 11)), item('isolated', local(5, 13), local(5, 14)),
      item('touching', local(5, 14), local(5, 15)),
    ], local(5));
    expect(placed.map((p) => [p.col, p.cols])).toEqual([[0, 2], [1, 2], [0, 2], [0, 1], [0, 1]]);
  });

  it('clips across midnight and marks continuation in each direction', () => {
    const placed = layoutDay([
      item('before', local(4, 23), local(5, 1)), item('after', local(5, 23), local(6, 1)),
      item('whole', local(4, 23), local(6, 1)),
    ], local(5));
    expect(placed.find((p) => p.item.key === 'before')).toMatchObject({ top: 0, height: 60, continuesBefore: true, continuesAfter: false });
    expect(placed.find((p) => p.item.key === 'after')).toMatchObject({ top: 1380, height: 60, continuesBefore: false, continuesAfter: true });
    expect(placed.find((p) => p.item.key === 'whole')).toMatchObject({ top: 0, height: 1440, continuesBefore: true, continuesAfter: true });
  });

  it('ignores non-touching and all-day blocks and keeps short blocks within the day', () => {
    const placed = layoutDay([
      item('ended', local(4, 23), local(5)), item('later', local(6), local(6, 1)),
      item('all', local(5), local(6), { allDay: true }), item('tiny', local(5, 23, 55), local(6)),
    ], local(5));
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({ top: 1416, height: 24, continuesBefore: false, continuesAfter: false });
  });

  it('creates deadline markers only for unfinished tasks with distinct deadlines in the day', () => {
    const base = item('task', local(5, 10), local(5, 11), { kind: 'task', due: local(5, 11), deadline: local(5, 18) });
    const midnight = { ...base, key: 'midnight', deadline: local(5) };
    expect(deadlineMarkers([
      base, midnight, { ...base, key: 'done', done: true }, { ...base, deadline: base.due },
      { ...base, deadline: local(6) }, { ...base, deadline: local(4, 23) },
      { ...base, kind: 'assignment' }, { ...base, deadline: undefined },
    ], local(5))).toEqual([{ item: base, at: 1080 }, { item: midnight, at: 0 }]);
  });

  it('busy intervals include only unmuted timed events', () => {
    const base = item('busy', local(5, 9), local(5, 10));
    expect(busyIntervals([base, { ...base, muted: true }, { ...base, allDay: true }, { ...base, kind: 'task' }, { ...base, kind: 'assignment' }]))
      .toEqual([{ start: local(5, 9), end: local(5, 10) }]);
  });
});
