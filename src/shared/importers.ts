// Importing tasks from JSON, CSV or iCalendar (VTODO), and exporting them back out.

import ICAL from 'ical.js';
import { FREQS, validateTask } from './tasks';
import { HOUR } from './time';
import type { RecurrenceFreq, Task, TaskInput } from './types';

export interface ParsedTasks {
  tasks: TaskInput[];
  skipped: number;
  errors: string[];
}

/** "90", "45 min", "1h 30m", "1.5h", "2 hours" -> minutes. Null when unreadable. */
export function parseDuration(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null;
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s)) || null;
  let total = 0;
  let matched = false;
  const re = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    matched = true;
    total += Number(m[1]) * (m[2].startsWith('h') ? 60 : 1);
  }
  return matched && total > 0 ? Math.round(total) : null;
}

function parseWhen(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const ms = typeof raw === 'number' ? raw : Date.parse(raw.trim());
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function parseFreq(raw: unknown): RecurrenceFreq | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim().toLowerCase().replace(/[^a-z]/g, '');
  if (s === 'everyweekday') return 'weekdays';
  if (s === 'everytwoweeks' || s === 'fortnightly') return 'biweekly';
  return FREQS.find((f) => f === s);
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Reads one loosely-shaped record (from JSON or a CSV row) into a task. */
function fromRecord(rec: Record<string, unknown>, label: string, out: ParsedTasks): void {
  const pick = (...names: string[]): unknown => {
    for (const n of names) if (rec[n] !== undefined && rec[n] !== '') return rec[n];
    return undefined;
  };
  const title = str(pick('title', 'name', 'task', 'summary'));
  const due = parseWhen(pick('preferreddue', 'preferred due', 'preferred_due', 'due', 'due date', 'duedate'));
  const deadline = parseWhen(pick('finaldeadline', 'final deadline', 'final_deadline', 'deadline')) ?? due;
  const durationMin = parseDuration(pick('durationmin', 'duration', 'duration_min', 'estimate', 'minutes')) ?? 60;
  const freq = parseFreq(pick('repeats', 'recurrence', 'recurring', 'repeat'));
  const untilRaw = str(pick('repeat until', 'repeatuntil', 'repeat_until', 'until'));
  const until = untilRaw && /^\d{4}-\d{2}-\d{2}$/.test(untilRaw) ? untilRaw : undefined;
  const input: Partial<TaskInput> = {
    title,
    durationMin,
    preferredDue: due ?? deadline ?? undefined,
    finalDeadline: deadline ?? undefined,
    category: str(pick('category')),
    location: str(pick('location')),
    url: str(pick('url', 'link', 'website')),
    notes: str(pick('notes', 'description')),
    recurrence: freq ? (until ? { freq, until } : { freq }) : undefined,
    important: pick('important') === true || String(pick('important') ?? '').toLowerCase() === 'true',
  };
  if (input.preferredDue && input.finalDeadline && Date.parse(input.finalDeadline) < Date.parse(input.preferredDue)) {
    input.finalDeadline = input.preferredDue;
  }
  const errors = validateTask(input);
  if (errors.url) {
    delete input.url;
    delete errors.url;
  }
  const first = Object.values(errors)[0];
  if (first) {
    out.skipped++;
    if (out.errors.length < 8) out.errors.push(`${label}: ${first}`);
    return;
  }
  out.tasks.push(input as TaskInput);
}

const lowerKeys = (rec: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(rec).map(([k, v]) => [k.trim().toLowerCase(), v]));

export function parseTasksJson(text: string): ParsedTasks {
  const out: ParsedTasks = { tasks: [], skipped: 0, errors: [] };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    out.errors.push('The file is not valid JSON.');
    return out;
  }
  const list = Array.isArray(data) ? data : typeof data === 'object' && data !== null && Array.isArray((data as { tasks?: unknown }).tasks) ? (data as { tasks: unknown[] }).tasks : null;
  if (!list) {
    out.errors.push('Expected a list of tasks.');
    return out;
  }
  list.forEach((rec, i) => {
    if (typeof rec === 'object' && rec !== null) fromRecord(lowerKeys(rec as Record<string, unknown>), `Item ${i + 1}`, out);
    else out.skipped++;
  });
  return out;
}

/** RFC 4180-style CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

export function parseTasksCsv(text: string): ParsedTasks {
  const out: ParsedTasks = { tasks: [], skipped: 0, errors: [] };
  const rows = parseCsv(text);
  if (rows.length < 2) {
    out.errors.push('Expected a header row followed by at least one task.');
    return out;
  }
  const header = rows[0].map((h) => h.trim().toLowerCase());
  for (let i = 1; i < rows.length; i++) {
    const rec: Record<string, unknown> = {};
    header.forEach((h, c) => {
      rec[h] = unguard(rows[i][c] ?? '').trim();
    });
    fromRecord(rec, `Row ${i + 1}`, out);
  }
  return out;
}

/** VTODO components from an iCalendar file. */
export function parseTasksIcs(text: string): ParsedTasks {
  const out: ParsedTasks = { tasks: [], skipped: 0, errors: [] };
  let root: InstanceType<typeof ICAL.Component>;
  try {
    root = new ICAL.Component(ICAL.parse(text));
  } catch {
    out.errors.push('The file is not a valid calendar file.');
    return out;
  }
  const todos = root.getAllSubcomponents('vtodo');
  if (todos.length === 0) out.errors.push('No to-do items were found in the file.');
  todos.forEach((todo, i) => {
    const due = todo.getFirstPropertyValue('due') as InstanceType<typeof ICAL.Time> | null;
    const dur = todo.getFirstPropertyValue('duration') as InstanceType<typeof ICAL.Duration> | null;
    const status = String(todo.getFirstPropertyValue('status') ?? '').toUpperCase();
    if (status === 'COMPLETED' || status === 'CANCELLED') {
      out.skipped++;
      return;
    }
    let dueMs = due ? due.toJSDate().getTime() : NaN;
    if (due?.isDate) dueMs += 17 * HOUR; // date-only to-dos land at 5 PM
    const rec: Record<string, unknown> = {
      title: String(todo.getFirstPropertyValue('summary') ?? ''),
      due: Number.isFinite(dueMs) ? dueMs : undefined,
      duration: dur ? Math.round(dur.toSeconds() / 60) : undefined,
      location: String(todo.getFirstPropertyValue('location') ?? ''),
      url: String(todo.getFirstPropertyValue('url') ?? ''),
      notes: String(todo.getFirstPropertyValue('description') ?? ''),
    };
    fromRecord(rec, `To-do ${i + 1}`, out);
  });
  return out;
}

export function parseTasksFile(name: string, text: string): ParsedTasks {
  const lower = name.toLowerCase();
  if (lower.endsWith('.csv')) return parseTasksCsv(text);
  if (lower.endsWith('.ics')) return parseTasksIcs(text);
  return parseTasksJson(text);
}

export const CSV_HEADER = ['name', 'duration', 'preferred due', 'final deadline', 'category', 'repeats', 'repeat until', 'location', 'link', 'notes'];

/** Cells a spreadsheet would run as a formula: =, +, - or @ (possibly after spaces), or a leading tab/CR. */
const FORMULA_START = /^[\s\u0000-\u001f]*[=+\-@]|^[\t\r]/;

function csvCell(v: string | number | undefined): string {
  let s = v === undefined ? '' : String(v);
  // Exported text may have come from imported files: keep spreadsheets from running it.
  if (typeof v === 'string' && FORMULA_START.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Undoes csvCell's formula guard when a file exported by this app is imported again. */
function unguard(cell: string): string {
  return cell.startsWith("'") && FORMULA_START.test(cell.slice(1)) ? cell.slice(1) : cell;
}

export function exportTasksCsv(tasks: Task[]): string {
  const lines = [CSV_HEADER.join(',')];
  for (const t of tasks) {
    lines.push(
      [t.title, t.durationMin, t.preferredDue, t.finalDeadline, t.category, t.recurrence?.freq, t.recurrence?.until, t.location, t.url, t.notes]
        .map(csvCell)
        .join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}

export function exportTasksJson(tasks: Task[]): string {
  return JSON.stringify(
    tasks.map((t) => ({
      name: t.title,
      durationMin: t.durationMin,
      preferredDue: t.preferredDue,
      finalDeadline: t.finalDeadline,
      category: t.category,
      repeats: t.recurrence?.freq,
      repeatUntil: t.recurrence?.until,
      location: t.location,
      link: t.url,
      notes: t.notes,
    })),
    null,
    2,
  );
}
