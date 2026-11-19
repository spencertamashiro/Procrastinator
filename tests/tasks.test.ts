import { describe, it, expect } from 'vitest';
import { MAX_DURATION_MIN, normalizeUrl, toTask, validateTask } from '../src/shared/tasks';
import type { Recurrence, TaskInput } from '../src/shared/types';

const iso = (hour: number) => new Date(2026, 0, 5, hour).toISOString();
const input = (patch: Partial<TaskInput> = {}): TaskInput => ({
  title: 'Study', durationMin: 60, preferredDue: iso(12), finalDeadline: iso(14), ...patch,
});
const createdAt = iso(8);

describe('validateTask', () => {
  it('reports each missing required field', () => {
    expect(validateTask({})).toEqual({ title: 'Give the task a name.', durationMin: 'Enter how long it will take.', preferredDue: 'Pick when you would like to be done.', finalDeadline: 'Pick the final deadline.' });
  });

  it.each(['', '   '])('rejects blank title %j', (title) => {
    expect(validateTask(input({ title }))).toEqual({ title: 'Give the task a name.' });
  });

  it.each([0, -1, NaN, Infinity, -Infinity])('rejects invalid duration %s', (durationMin) => {
    expect(validateTask(input({ durationMin }))).toEqual({ durationMin: 'Enter how long it will take.' });
  });

  it('rejects estimates above one week and accepts the boundary', () => {
    expect(validateTask(input({ durationMin: MAX_DURATION_MIN + 1 }))).toEqual({ durationMin: 'Keep the estimate under a week.' });
    expect(validateTask(input({ durationMin: MAX_DURATION_MIN }))).toEqual({});
  });

  it('reports invalid preferred due and final deadline independently', () => {
    expect(validateTask(input({ preferredDue: 'bad' }))).toEqual({ preferredDue: 'Pick when you would like to be done.' });
    expect(validateTask(input({ finalDeadline: 'bad' }))).toEqual({ finalDeadline: 'Pick the final deadline.' });
  });

  it('rejects a deadline before preferred due, but allows equal instants', () => {
    expect(validateTask(input({ finalDeadline: iso(11) }))).toEqual({ finalDeadline: 'The final deadline cannot be before the preferred due date.' });
    expect(validateTask(input({ finalDeadline: iso(12) }))).toEqual({});
  });

  it('reports invalid URLs and accepts an omitted URL', () => {
    expect(validateTask(input({ url: 'javascript:alert(1)' }))).toEqual({ url: 'That does not look like a web link.' });
    expect(validateTask(input())).toEqual({});
  });
});

describe('normalizeUrl', () => {
  it.each([
    [' example.com/path ', 'https://example.com/path'],
    ['https://EXAMPLE.com', 'https://example.com/'],
    ['http://example.com', 'http://example.com/'],
    ['http://localhost:3000/path', 'http://localhost:3000/path'],
    ['', null], ['   ', null], ['ftp://example.com', null], ['mailto:a@example.com', null],
    ['javascript:alert(1)', null], ['not a url', null], ['intranet', null],
  ])('normalizes %j', (raw, expected) => expect(normalizeUrl(raw!)).toBe(expected));
});

describe('toTask', () => {
  it('trims fields, rounds effort, normalizes dates and URLs, and uses the new identity', () => {
    expect(toTask(input({ title: '  Study  ', durationMin: 60.6, category: ' School ', location: ' Library ', notes: ' Read chapter 1 ', url: ' example.com ' }), 'task:new', createdAt)).toEqual({
      id: 'task:new', title: 'Study', durationMin: 61, preferredDue: iso(12), finalDeadline: iso(14),
      category: 'School', location: 'Library', notes: 'Read chapter 1', url: 'https://example.com/', recurrence: undefined, createdAt,
    });
  });

  it('drops unsupported recurrence and malformed until while keeping a valid frequency', () => {
    expect(toTask(input({ recurrence: { freq: 'yearly' } as unknown as Recurrence }), 'task:new', createdAt)?.recurrence).toBeUndefined();
    expect(toTask(input({ recurrence: { freq: 'daily', until: 'bad' } }), 'task:new', createdAt)?.recurrence).toEqual({ freq: 'daily' });
    expect(toTask(input({ recurrence: { freq: 'weekly', until: '2026-02-05' } }), 'task:new', createdAt)?.recurrence).toEqual({ freq: 'weekly', until: '2026-02-05' });
  });

  it('preserves id and createdAt when editing and updates task fields', () => {
    const existing = toTask(input(), 'task:original', createdAt)!;
    const edited = toTask(input({ id: 'ignored-input-id', title: 'Edited' }), 'ignored-new-id', iso(10), existing);
    expect(edited).toMatchObject({ id: 'task:original', createdAt, title: 'Edited' });
  });

  it.each([{ title: '' }, { durationMin: 0 }, { preferredDue: 'bad' }, { finalDeadline: iso(11) }, { url: 'ftp://example.com' }])(
    'returns null for invalid input %j', (patch) => expect(toTask(input(patch), 'task:new', createdAt)).toBeNull(),
  );

  it('clips long fields and drops empty optional text', () => {
    const result = toTask(input({ title: 'a'.repeat(201), category: 'b'.repeat(61), location: 'c'.repeat(201), notes: 'd'.repeat(2001) }), 'task:new', createdAt)!;
    expect(result.title).toHaveLength(200);
    expect(result.category).toHaveLength(60);
    expect(result.location).toHaveLength(200);
    expect(result.notes).toHaveLength(2000);
    const empty = toTask(input({ category: ' ', location: ' ', notes: ' ' }), 'task:new', createdAt)!;
    expect([empty.category, empty.location, empty.notes]).toEqual([undefined, undefined, undefined]);
  });
});
