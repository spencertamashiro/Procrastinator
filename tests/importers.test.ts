import { describe, it, expect } from 'vitest';
import {
  parseDuration, parseCsv, parseTasksCsv, parseTasksJson, parseTasksIcs, parseTasksFile,
  exportTasksCsv, exportTasksJson, CSV_HEADER,
} from '../src/shared/importers';
import type { Task } from '../src/shared/types';

const header = `name,duration,preferred due,final deadline,category,repeats,location,link,notes`;
const csv = `${header}
Study,45,2026-11-16T18:00:00Z,2026-11-17T18:00:00Z,School,weekly,Library,https://school.example,Bring notes`;
const json = `[
  { "name": "Study", "duration": "45 min", "due": "2026-11-16T18:00:00Z", "category": "School", "repeats": "weekly" }
]`;
const todos = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Planner tests//EN
BEGIN:VTODO
UID:study
SUMMARY:Study
DUE:20261116T180000Z
DURATION:PT45M
LOCATION:Library
URL:https://school.example
DESCRIPTION:Bring notes
END:VTODO
BEGIN:VTODO
UID:done
SUMMARY:Finished
DUE:20261116T180000Z
STATUS:COMPLETED
END:VTODO
BEGIN:VTODO
UID:date-only
SUMMARY:Read
DUE;VALUE=DATE:20261117
END:VTODO
END:VCALENDAR`;

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task:1', title: 'Review, "chapter 6"', durationMin: 90,
    preferredDue: '2026-11-16T18:00:00.000Z', finalDeadline: '2026-11-17T20:00:00.000Z',
    category: 'School', recurrence: { freq: 'weekly' }, location: 'Library',
    url: 'https://school.example/notes', notes: 'First line\nSecond line',
    createdAt: '2026-11-14T12:00:00.000Z', ...overrides,
  };
}
function importedFields(t: Task) {
  const { title, durationMin, preferredDue, finalDeadline, category, recurrence, location, url, notes } = t;
  return { title, durationMin, preferredDue, finalDeadline, category, recurrence, location, url, notes };
}

describe('parseDuration', () => {
  it.each([
    ['90', 90], [45, 45], ['45 min', 45], ['1h 30m', 90], ['1.5h', 90], ['2 hours', 120],
    ['', null], ['soon', null], [' 2 HRS ', 120], [0, null], [-1, null], [NaN, null],
    [Infinity, null], [undefined, null], ['0', null], [45.6, 46],
  ])('parses %s as %s minutes', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });
});

describe('parseCsv', () => {
  it('handles quoted commas, doubled quotes, embedded newlines and CRLF', () => {
    const text = `name,notes\r\n"Review, chapter 6","Say ""hello""\r\nthen study"\r\nPlain,Done\r\n`;
    expect(parseCsv(text)).toEqual([
      ['name', 'notes'], ['Review, chapter 6', 'Say "hello"\r\nthen study'], ['Plain', 'Done'],
    ]);
  });
  it('strips a UTF-8 BOM from the first field', () => {
    expect(parseCsv(`\uFEFFname,duration\r\nStudy,45\r\n`)).toEqual([['name', 'duration'], ['Study', '45']]);
  });
  it('keeps trailing empty fields and ignores blank rows', () => {
    expect(parseCsv(`name,notes,\n\nStudy,,\n,,\n`)).toEqual([['name', 'notes', ''], ['Study', '', '']]);
  });
});

describe('parseTasksCsv', () => {
  it('reads the documented header and all task fields', () => {
    expect(parseTasksCsv(csv)).toEqual({
      tasks: [expect.objectContaining({ title: 'Study', durationMin: 45,
        preferredDue: '2026-11-16T18:00:00.000Z', finalDeadline: '2026-11-17T18:00:00.000Z',
        category: 'School', recurrence: { freq: 'weekly' }, location: 'Library', url: 'https://school.example', notes: 'Bring notes' })],
      skipped: 0, errors: [],
    });
  });
  it('skips a row without a name and identifies the row in an error', () => {
    const result = parseTasksCsv(`${csv}
,45,2026-11-16T18:00:00Z,,,,,,`);
    expect(result.tasks).toHaveLength(1);
    expect(result.skipped).toBe(1);
    expect(result.errors).toEqual(['Row 3: Give the task a name.']);
  });
  it('raises a deadline earlier than the preferred due date', () => {
    const result = parseTasksCsv(`${header}
Study,45,2026-11-16T18:00:00Z,2026-11-15T18:00:00Z,,,,,`);
    expect(result.tasks[0]).toMatchObject({ preferredDue: '2026-11-16T18:00:00.000Z', finalDeadline: '2026-11-16T18:00:00.000Z' });
    expect(result.errors).toEqual([]);
  });
  it('uses the due date as a missing deadline', () => {
    const result = parseTasksCsv(`${header}
Study,45,2026-11-16T18:00:00Z,,,,,,`);
    expect(result.tasks[0].finalDeadline).toBe('2026-11-16T18:00:00.000Z');
  });
  it('reports a header-only file', () => {
    expect(parseTasksCsv(header)).toEqual({ tasks: [], skipped: 0, errors: ['Expected a header row followed by at least one task.'] });
  });
});

describe('parseTasksJson', () => {
  it.each([json, `{ "tasks": ${json} }`])('reads an array or tasks wrapper', (text) => {
    expect(parseTasksJson(text)).toEqual({ tasks: [expect.objectContaining({ title: 'Study', durationMin: 45,
      preferredDue: '2026-11-16T18:00:00.000Z', finalDeadline: '2026-11-16T18:00:00.000Z',
      category: 'School', recurrence: { freq: 'weekly' } })], skipped: 0, errors: [] });
  });
  it('reports invalid JSON without throwing', () => {
    expect(parseTasksJson(`{ broken JSON`)).toEqual({ tasks: [], skipped: 0, errors: ['The file is not valid JSON.'] });
  });
  it.each([`{ "tasks": {} }`, `null`, `42`, `{ "name": "Study" }`])('reports a non-list: %s', (text) => {
    expect(parseTasksJson(text)).toEqual({ tasks: [], skipped: 0, errors: ['Expected a list of tasks.'] });
  });
  it('skips primitive entries and validates object entries independently', () => {
    const result = parseTasksJson(`[null, 42, {"name":"Bad"}, {"name":"Good","due":"2026-11-16T18:00:00Z"}]`);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]).toMatchObject({ title: 'Good', durationMin: 60 });
    expect(result.skipped).toBe(3);
    expect(result.errors).toEqual(['Item 3: Pick when you would like to be done.']);
  });
});

describe('parseTasksIcs', () => {
  it('maps VTODO metadata and duration, skips COMPLETED and places date-only DUE at 5 PM local', () => {
    const result = parseTasksIcs(todos);
    expect(result.skipped).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0]).toMatchObject({ title: 'Study', durationMin: 45,
      preferredDue: '2026-11-16T18:00:00.000Z', finalDeadline: '2026-11-16T18:00:00.000Z',
      location: 'Library', url: 'https://school.example', notes: 'Bring notes' });
    const localDue = new Date(2026, 10, 17, 17, 0).toISOString();
    expect(result.tasks[1]).toMatchObject({ title: 'Read', durationMin: 60, preferredDue: localDue, finalDeadline: localDue });
  });
  it('also skips CANCELLED VTODOs', () => {
    expect(parseTasksIcs(todos.replace('STATUS:COMPLETED', 'STATUS:CANCELLED')).skipped).toBe(1);
  });
  it('reports malformed calendar text', () => {
    expect(parseTasksIcs(`not a calendar`)).toEqual({ tasks: [], skipped: 0, errors: ['The file is not a valid calendar file.'] });
  });
  it('reports a calendar without VTODO components', () => {
    expect(parseTasksIcs(`BEGIN:VCALENDAR
VERSION:2.0
END:VCALENDAR`).errors).toEqual(['No to-do items were found in the file.']);
  });
});

describe('parseTasksFile', () => {
  it.each(['tasks.csv', 'TASKS.CSV'])('selects the CSV parser for %s', (name) => {
    expect(parseTasksFile(name, csv)).toEqual(parseTasksCsv(csv));
  });
  it.each(['tasks.ics', 'TASKS.ICS'])('selects the iCalendar parser for %s', (name) => {
    expect(parseTasksFile(name, todos)).toEqual(parseTasksIcs(todos));
  });
  it.each(['tasks.json', 'TASKS.JSON', 'tasks.txt'])('selects the JSON parser for %s', (name) => {
    expect(parseTasksFile(name, json)).toEqual(parseTasksJson(json));
  });
});

describe('task export round trips', () => {
  it('round trips CSV fields, including a title with commas and quotes', () => {
    const original = task();
    const text = exportTasksCsv([original]);
    expect(text.startsWith(`${CSV_HEADER.join(',')}\r\n`)).toBe(true);
    expect(text).toContain('"Review, ""chapter 6"""');
    expect(parseTasksCsv(text)).toEqual({ tasks: [expect.objectContaining(importedFields(original))], skipped: 0, errors: [] });
  });
  it('round trips JSON fields', () => {
    const original = task();
    expect(parseTasksJson(exportTasksJson([original]))).toEqual({
      tasks: [expect.objectContaining(importedFields(original))], skipped: 0, errors: [],
    });
  });
  // Regression: the exports once dropped recurrence.until, so a re-import repeated forever.
  it.each([
    ['CSV', exportTasksCsv, parseTasksCsv], ['JSON', exportTasksJson, parseTasksJson],
  ] as const)('preserves the recurrence end date in a %s round trip', (_format, serialize, parse) => {
    const original = task({ recurrence: { freq: 'weekly', until: '2026-12-31' } });
    expect(parse(serialize([original])).tasks[0].recurrence).toEqual(original.recurrence);
  });
});
