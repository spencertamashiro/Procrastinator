// Display strings used by the views. Pure; no React.

import type { PlannerItem } from '../../../shared/items';
import { DAY, fmtDuration, fmtTime, fmtWeekday, fmtWhen, MIN, startOfDay } from '../../../shared/time';
import type { Analysis } from '../../../shared/urgency';

const monthDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

export const fmtTemp = (t: number): string => `${Math.round(t)}°`;

/** "9 AM", "9:30 AM" or "09:00". */
export function fmtClock(ms: number, hour12: boolean): string {
  const d = new Date(ms);
  if (hour12 && d.getMinutes() === 0) {
    const h = d.getHours();
    return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
  }
  return fmtTime(ms, hour12);
}

/** "10:00" without AM/PM. Blocks sit on an hour grid, so the half of the day is obvious. */
export function fmtBare(ms: number, hour12: boolean): string {
  return fmtTime(ms, hour12).replace(/\s?[AP]M$/i, '');
}

/** A nearby moment in few characters: "5 PM" (today), "tomorrow", "Thu", "Nov 20". */
export function fmtShortWhen(ms: number, now: number, hour12: boolean): string {
  const diff = Math.round((startOfDay(ms) - startOfDay(now)) / DAY);
  if (diff === 0) return fmtClock(ms, hour12);
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  if (diff > 1 && diff < 7) return fmtWeekday(ms);
  return monthDay.format(ms);
}

/** "just now", "4 min ago", "3 h ago", "yesterday", "Nov 12". */
export function fmtAgo(iso: string | undefined, now: number): string {
  if (!iso) return 'never';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'never';
  const min = Math.round((now - t) / MIN);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24 && startOfDay(t) === startOfDay(now)) return `${h} h ago`;
  if (Math.round((startOfDay(now) - startOfDay(t)) / DAY) === 1) return 'yesterday';
  return monthDay.format(t);
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** The second line of a block: when it happens, or what is due and by when. */
export function itemMeta(item: PlannerItem, now: number, hour12: boolean): string {
  if (item.kind === 'event') {
    if (item.allDay) return item.subtitle ?? 'All day';
    const when = `${fmtBare(item.start, hour12)} – ${fmtBare(item.end, hour12)}`;
    return item.location ? `${when} · ${item.location}` : when;
  }
  if (item.kind === 'assignment') {
    const state = item.done ? 'done' : item.allDay ? 'due today' : `due ${fmtClock(item.due ?? item.end, hour12)}`;
    return item.subtitle ? `${item.subtitle} · ${state}` : state;
  }
  const parts = [`~${fmtDuration(item.effortMin ?? 0)}`];
  if (item.done) parts.push('done');
  else if (item.muted) parts.push('muted');
  else if (item.deadline !== undefined) parts.push(`by ${fmtShortWhen(item.deadline, now, hour12)}`);
  return parts.join(' · ');
}

/** Short badge text for an urgency level. */
export function levelLabel(a: Analysis, now: number, hour12: boolean): string {
  switch (a.level) {
    case 'overdue':
      return 'Overdue';
    case 'behind':
      return 'Behind';
    case 'now':
      return 'Start now';
    case 'soon':
      return `Start by ${fmtClock(Math.max(now, a.startBy), hour12)}`;
    default:
      return `${a.kind === 'task' ? 'By' : 'Due'} ${fmtShortWhen(a.deadline, now, hour12)}`;
  }
}

/** One line explaining an analysis: work needed versus free time left. */
/**
 * The reasoning behind a badge, as separate phrases so they can wrap between, not within, them.
 * A task's deadline is its final deadline ("by"); an assignment's is its due date.
 */
export function analysisFacts(a: Analysis, now: number, hour12: boolean): string[] {
  const deadline = fmtWhen(a.deadline, now, hour12);
  const task = a.kind === 'task';
  if (a.level === 'overdue') return [task ? `Deadline was ${deadline}` : `Was due ${deadline}`, `about ${fmtDuration(a.effortMin)} of work`];
  const facts = [task ? `By ${deadline}` : `Due ${deadline}`, `needs ~${fmtDuration(a.needMin)}`, `${fmtDuration(a.freeMin)} free`];
  if (a.queuedMin > 0) facts.push(`${fmtDuration(a.queuedMin)} due before it`);
  return facts;
}
