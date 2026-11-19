// Turns stored tasks, events and assignments into the uniform items the views draw,
// and lays timed items out into side-by-side columns for a single day.

import { occurrencesInRange } from './recurrence';
import { normalizeTitle, ruleMatches } from './similarity';
import { addDays, atMinutes, MIN, parseDayKey, startOfDay } from './time';
import type { AppState, ItemKind, Suppressed } from './types';

export interface PlannerItem {
  key: string;
  seriesKey: string;
  kind: ItemKind;
  source: string;
  title: string;
  /** Course, calendar or category. */
  subtitle?: string;
  allDay: boolean;
  /** Block drawn on the grid. For tasks and assignments this is the work window ending at `due`. */
  start: number;
  end: number;
  /** When the work is meant to be finished. */
  due?: number;
  /** The hard deadline. */
  deadline?: number;
  effortMin?: number;
  important: boolean;
  muted: boolean;
  done: boolean;
  recurring: boolean;
  location?: string;
  url?: string;
  notes?: string;
  taskId?: string;
  /** Course or calendar; narrows "delete all like this". */
  scope?: string;
}

export type DataSlice = Pick<AppState, 'tasks' | 'events' | 'assignments' | 'overlay' | 'suppressed' | 'settings'>;

const MIN_EVENT_MIN = 20;

/** Returns a predicate telling whether an item has been deleted (hidden) by the user. */
export function hiddenTester(
  suppressed: Suppressed,
): (item: { key: string; seriesKey?: string; title: string; kind: ItemKind; scope?: string }) => boolean {
  const ids = new Set(suppressed.ids.map((s) => s.key));
  const rules = suppressed.rules;
  const normCache = new Map<string, string>();
  return (item) => {
    // A deleted id hides that one occurrence, or the whole series when the series key was deleted.
    if (ids.has(item.key) || (item.seriesKey !== undefined && ids.has(item.seriesKey))) return true;
    if (rules.length === 0) return false;
    let norm = normCache.get(item.title);
    if (norm === undefined) {
      norm = normalizeTitle(item.title);
      normCache.set(item.title, norm);
    }
    return rules.some((r) => ruleMatches(r, item, norm));
  };
}

/** Every visible item that overlaps [start, end), sorted by start time. */
export function buildItems(data: DataSlice, start: number, end: number): PlannerItem[] {
  const hidden = hiddenTester(data.suppressed);
  const { overlay, settings } = data;
  const out: PlannerItem[] = [];

  for (const ev of data.events) {
    const s = ev.allDay ? parseDayKey(ev.start) : Date.parse(ev.start);
    let e = ev.allDay ? parseDayKey(ev.end) : Date.parse(ev.end);
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
    if (ev.allDay && e <= s) e = addDays(s, 1);
    if (!ev.allDay && e < s + MIN_EVENT_MIN * MIN) e = s + MIN_EVENT_MIN * MIN;
    if (e <= start || s >= end) continue;
    const item: PlannerItem = {
      key: ev.key,
      seriesKey: ev.seriesKey,
      kind: 'event',
      source: ev.sourceId,
      title: ev.title,
      subtitle: ev.calendar,
      allDay: ev.allDay,
      start: s,
      end: e,
      important: !!overlay[ev.seriesKey]?.important,
      muted: !!overlay[ev.seriesKey]?.muted,
      done: false,
      recurring: !!ev.recurring,
      location: ev.location,
      url: ev.url,
      notes: ev.notes,
      scope: ev.calendar,
    };
    if (!hidden(item)) out.push(item);
  }

  for (const a of data.assignments) {
    const series = overlay[a.key];
    const done = a.submitted || !!series?.done;
    if (a.submitted && !settings.canvas.showSubmitted) continue;
    const effortMin = series?.effortMin ?? settings.canvas.defaultEffortMin;
    let s: number;
    let e: number;
    let due: number;
    if (a.allDay) {
      s = parseDayKey(a.dueAt);
      e = addDays(s, 1);
      due = e - MIN; // counts as due at the very end of that day
    } else {
      due = Date.parse(a.dueAt);
      e = due;
      s = due - Math.max(MIN_EVENT_MIN, effortMin) * MIN;
    }
    if (!Number.isFinite(due)) continue;
    if (e <= start || s >= end) continue;
    const item: PlannerItem = {
      key: a.key,
      seriesKey: a.key,
      kind: 'assignment',
      source: a.sourceId,
      title: a.title,
      subtitle: a.course,
      allDay: a.allDay,
      start: s,
      end: e,
      due,
      deadline: due,
      effortMin,
      important: !!series?.important,
      muted: !!series?.muted,
      done,
      recurring: false,
      url: a.url,
      scope: a.course,
    };
    if (!hidden(item)) out.push(item);
  }

  for (const t of data.tasks) {
    const series = overlay[t.id];
    const effortMin = series?.effortMin ?? t.durationMin;
    for (const occ of occurrencesInRange(t, start, end)) {
      const item: PlannerItem = {
        key: occ.key,
        seriesKey: t.id,
        kind: 'task',
        source: 'local',
        title: t.title,
        subtitle: t.category,
        allDay: false,
        start: occ.preferredDue - Math.max(MIN_EVENT_MIN, effortMin) * MIN,
        end: occ.preferredDue,
        due: occ.preferredDue,
        deadline: occ.finalDeadline,
        effortMin,
        important: !!series?.important,
        muted: !!series?.muted,
        done: !!overlay[occ.key]?.done,
        recurring: !!t.recurrence,
        location: t.location,
        url: t.url,
        notes: t.notes,
        taskId: t.id,
      };
      if (item.end <= start && (item.deadline ?? 0) < start) continue;
      if (!hidden(item)) out.push(item);
    }
  }

  return out.sort((a, b) => a.start - b.start || a.end - b.end || a.title.localeCompare(b.title));
}

// ------------------------------------------------------------------ day layout

export interface Placed {
  item: PlannerItem;
  /** Minutes from local midnight of the day. */
  top: number;
  /** Height in minutes (already clamped to the minimum). */
  height: number;
  col: number;
  cols: number;
  /** The item started on an earlier day / continues onto a later one. */
  continuesBefore: boolean;
  continuesAfter: boolean;
}

/**
 * Places the timed items that touch one day into columns so overlapping items sit
 * side by side. `minMinutes` is the smallest block that still fits a line of text.
 */
export function layoutDay(items: PlannerItem[], dayStart: number, minMinutes = 24): Placed[] {
  const dayEnd = addDays(dayStart, 1);
  const dayMinutes = Math.round((dayEnd - dayStart) / MIN);
  const segs = items
    .filter((i) => !i.allDay && i.end > dayStart && i.start < dayEnd)
    .map((item) => {
      const top = Math.max(0, Math.round((item.start - dayStart) / MIN));
      const rawEnd = Math.min(dayMinutes, Math.round((item.end - dayStart) / MIN));
      const height = Math.max(minMinutes, rawEnd - top);
      return {
        item,
        top: Math.min(top, dayMinutes - minMinutes),
        height,
        col: 0,
        cols: 1,
        continuesBefore: item.start < dayStart,
        continuesAfter: item.end > dayEnd,
      };
    })
    .sort((a, b) => a.top - b.top || b.height - a.height);

  let cluster: typeof segs = [];
  let clusterEnd = -1;
  const flush = (): void => {
    const cols = cluster.reduce((m, s) => Math.max(m, s.col + 1), 1);
    for (const s of cluster) s.cols = cols;
    cluster = [];
  };
  for (const seg of segs) {
    if (cluster.length > 0 && seg.top >= clusterEnd) flush();
    const taken = new Set(cluster.filter((s) => s.top + s.height > seg.top).map((s) => s.col));
    let col = 0;
    while (taken.has(col)) col++;
    seg.col = col;
    cluster.push(seg);
    clusterEnd = Math.max(clusterEnd, seg.top + seg.height);
  }
  if (cluster.length > 0) flush();
  return segs;
}

/** All-day items (and all-day assignments) that fall on the given day. */
export function allDayFor(items: PlannerItem[], dayStart: number): PlannerItem[] {
  const dayEnd = addDays(dayStart, 1);
  return items.filter((i) => i.allDay && i.end > dayStart && i.start < dayEnd);
}

export interface DeadlineMarker {
  item: PlannerItem;
  /** Minutes from local midnight. */
  at: number;
}

/** Hard deadlines of tasks that fall on this day and differ from the work block's end. */
export function deadlineMarkers(items: PlannerItem[], dayStart: number): DeadlineMarker[] {
  const dayEnd = addDays(dayStart, 1);
  const out: DeadlineMarker[] = [];
  for (const item of items) {
    if (item.kind !== 'task' || item.deadline === undefined || item.done) continue;
    if (item.deadline === item.due) continue;
    if (item.deadline < dayStart || item.deadline >= dayEnd) continue;
    out.push({ item, at: Math.round((item.deadline - dayStart) / MIN) });
  }
  return out;
}

/** Timed, unmuted events as busy intervals (used to work out free time). */
export function busyIntervals(items: PlannerItem[]): { start: number; end: number }[] {
  return items
    .filter((i) => i.kind === 'event' && !i.allDay && !i.muted)
    .map((i) => ({ start: i.start, end: i.end }));
}

/** Local midnight of the day containing `ms`, plus `minutes`. */
export function dayAt(ms: number, minutes: number): number {
  return atMinutes(startOfDay(ms), minutes);
}
