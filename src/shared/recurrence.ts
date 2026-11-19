// Expands a (possibly repeating) local task into the occurrences that touch a time window.

import { addDays, addMonths, dayKey, MIN, parseDayKey } from './time';
import type { Task } from './types';

export interface TaskOccurrence {
  /** `task.id` for a one-off task, `task.id@YYYY-MM-DD` for a repeat. */
  key: string;
  preferredDue: number;
  finalDeadline: number;
}

const MAX_STEPS = 6000;

function step(base: number, freq: NonNullable<Task['recurrence']>['freq'], n: number): number {
  switch (freq) {
    case 'daily':
      return addDays(base, n);
    case 'weekly':
      return addDays(base, 7 * n);
    case 'biweekly':
      return addDays(base, 14 * n);
    case 'monthly':
      return addMonths(base, n);
    case 'weekdays':
      return addDays(base, n); // weekend days are filtered by the caller
  }
}

/**
 * Occurrences whose work block or deadline overlaps [start, end).
 * The gap between preferred due and final deadline is preserved for every repeat.
 */
export function occurrencesInRange(task: Task, start: number, end: number): TaskOccurrence[] {
  const due0 = Date.parse(task.preferredDue);
  const deadline0 = Date.parse(task.finalDeadline);
  if (!Number.isFinite(due0) || !Number.isFinite(deadline0)) return [];
  const lead = Math.max(0, task.durationMin) * MIN;
  const tail = Math.max(0, deadline0 - due0);

  const touches = (due: number): boolean => due - lead < end && due + tail >= start;

  if (!task.recurrence) {
    return touches(due0) ? [{ key: task.id, preferredDue: due0, finalDeadline: due0 + tail }] : [];
  }

  const { freq, until } = task.recurrence;
  const untilEnd = until ? addDays(parseDayKey(until), 1) : Infinity;
  const out: TaskOccurrence[] = [];
  for (let n = 0; n < MAX_STEPS; n++) {
    const due = step(due0, freq, n);
    if (due >= untilEnd) break;
    if (due - lead >= end) break;
    if (freq === 'weekdays') {
      const dow = new Date(due).getDay();
      if (dow === 0 || dow === 6) continue;
    }
    if (touches(due)) {
      out.push({ key: `${task.id}@${dayKey(due)}`, preferredDue: due, finalDeadline: due + tail });
    }
  }
  return out;
}
