// Validation and normalisation of user-entered tasks. Used by the dialog (to show
// errors) and by the main process (which never trusts what the renderer sends).

import type { Recurrence, RecurrenceFreq, Task, TaskInput } from './types';

export const FREQS: RecurrenceFreq[] = ['daily', 'weekdays', 'weekly', 'biweekly', 'monthly'];
export const MAX_DURATION_MIN = 7 * 24 * 60;

export interface TaskErrors {
  title?: string;
  durationMin?: string;
  preferredDue?: string;
  finalDeadline?: string;
  url?: string;
}

export function validateTask(input: Partial<TaskInput>): TaskErrors {
  const errors: TaskErrors = {};
  if (!input.title || !input.title.trim()) errors.title = 'Give the task a name.';
  const dur = input.durationMin;
  if (typeof dur !== 'number' || !Number.isFinite(dur) || dur <= 0) errors.durationMin = 'Enter how long it will take.';
  else if (dur > MAX_DURATION_MIN) errors.durationMin = 'Keep the estimate under a week.';
  const due = input.preferredDue ? Date.parse(input.preferredDue) : NaN;
  const deadline = input.finalDeadline ? Date.parse(input.finalDeadline) : NaN;
  if (!Number.isFinite(due)) errors.preferredDue = 'Pick when you would like to be done.';
  if (!Number.isFinite(deadline)) errors.finalDeadline = 'Pick the final deadline.';
  else if (Number.isFinite(due) && deadline < due) errors.finalDeadline = 'The final deadline cannot be before the preferred due date.';
  if (input.url && normalizeUrl(input.url) === null) errors.url = 'That does not look like a web link.';
  return errors;
}

/** Adds https:// when missing; null when the result is not an http(s) URL. */
export function normalizeUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null;
    return u.toString();
  } catch {
    return null;
  }
}

function cleanRecurrence(r: Recurrence | undefined): Recurrence | undefined {
  if (!r || !FREQS.includes(r.freq)) return undefined;
  const until = r.until && /^\d{4}-\d{2}-\d{2}$/.test(r.until) ? r.until : undefined;
  return until ? { freq: r.freq, until } : { freq: r.freq };
}

const clip = (v: string | undefined, max: number): string | undefined => {
  const t = v?.trim();
  return t ? t.slice(0, max) : undefined;
};

/**
 * Builds the stored task from validated input. Returns null when the input is invalid.
 * `existing` keeps the id and creation time when editing.
 */
export function toTask(input: TaskInput, id: string, nowIso: string, existing?: Task): Task | null {
  if (Object.keys(validateTask(input)).length > 0) return null;
  return {
    id: existing?.id ?? id,
    title: input.title.trim().slice(0, 200),
    durationMin: Math.round(input.durationMin),
    preferredDue: new Date(Date.parse(input.preferredDue)).toISOString(),
    finalDeadline: new Date(Date.parse(input.finalDeadline)).toISOString(),
    category: clip(input.category, 60),
    recurrence: cleanRecurrence(input.recurrence),
    location: clip(input.location, 200),
    url: input.url ? (normalizeUrl(input.url) ?? undefined) : undefined,
    notes: clip(input.notes, 2000),
    createdAt: existing?.createdAt ?? nowIso,
  };
}
