import { describe, it, expect, vi } from 'vitest';
import { exportTasksCsv, parseCsv, parseTasksCsv, CSV_HEADER } from '../src/shared/importers';
import type { Task } from '../src/shared/types';

function task(title: string, notes = title): Task {
  return { id: 'task:1', title, notes, durationMin: 60, preferredDue: '2026-11-16T18:00:00.000Z',
    finalDeadline: '2026-11-16T18:00:00.000Z', createdAt: '2026-11-15T12:00:00.000Z' };
}
const dangerous = ['=1+1', '+SUM(A1)', '-1+2', '@SUM(A1)', '\ttext', '\rtext',
  '  =1+1', ' \u0001+1', '\u0000-1', '\n@SUM(A1)', ' \t\r=1'];

describe('CSV formula guards', () => {
  it.each(dangerous)('prefixes dangerous text %j with an apostrophe', (text) => {
    const row = parseCsv(exportTasksCsv([task(text)]))[1];
    expect(row[0]).toBe(`'${text}`);
    expect(row[CSV_HEADER.indexOf('notes')]).toBe(`'${text}`);
  });
  it.each(['Read chapter 1', '1 + 2', "'quoted text", 'email@example.com'])('does not guard ordinary text %j', (text) => {
    const row = parseCsv(exportTasksCsv([task(text)]))[1];
    expect(row[0]).toBe(text);
    expect(row[CSV_HEADER.indexOf('notes')]).toBe(text);
  });
  it('quotes commas, quotes and newlines after adding the guard', () => {
    const text = '=SUM(1,2)\nSay "hello"';
    const csv = exportTasksCsv([task(text)]);
    expect(csv).toContain('"\'=SUM(1,2)\nSay ""hello"""');
    expect(parseCsv(csv)[1][0]).toBe(`'${text}`);
  });
  it('does not change the task when guarding exported text', () => {
    const original = task('=1+1');
    const setTitle = vi.fn();
    Object.defineProperty(original, 'title', { get: () => '=1+1', set: setTitle });
    exportTasksCsv([original]);
    expect(setTitle).not.toHaveBeenCalled();
    expect(original.notes).toBe('=1+1');
  });
});

describe('CSV formula guard round trips', () => {
  // Import trims the whitespace around every cell (as it always has), so leading tabs,
  // returns and spaces do not survive; what matters is that the added ' is gone again.
  it.each([...dangerous, '=SUM(1,2)\nSay "hello"'])('restores the title and notes for %j without the added quote', (text) => {
    const result = parseTasksCsv(exportTasksCsv([task(text)]));
    expect(result.errors).toEqual([]);
    expect(result.skipped).toBe(0);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]).toMatchObject({ title: text.trim(), notes: text.trim() });
  });
});
