// Works out how much slack is left before each task or assignment has to be started,
// and which last-minute reminders are due. Pure functions: no clocks, no I/O.

import type { PlannerItem } from './items';
import { addDays, atMinutes, fmtDuration, fmtTime, fmtWhen, MIN, startOfDay } from './time';
import type { ItemKind } from './types';

export interface WorkItem {
  key: string;
  title: string;
  kind: ItemKind;
  deadline: number;
  effortMin: number;
  important: boolean;
}

export interface Interval {
  start: number;
  end: number;
}

export interface UrgencyOptions {
  /** Padding added to every estimate, percent. */
  bufferPct: number;
  /** "Start soon" when slack drops to this many minutes (doubled for important items). */
  headsUpMin: number;
  /** "Start now" when slack drops to this many minutes. */
  startNowMin: number;
  /** Nightly window that never counts as free time, minutes past local midnight. */
  sleep: { startMin: number; endMin: number } | null;
}

export type UrgencyLevel = 'ok' | 'soon' | 'now' | 'behind' | 'overdue';

export interface Analysis extends WorkItem {
  /** Effort including the buffer. */
  needMin: number;
  /** Work with earlier deadlines that has to happen first. */
  queuedMin: number;
  /** Free minutes between now and the deadline (events and sleep removed). */
  freeMin: number;
  /** freeMin - queuedMin - needMin. Negative means it no longer fits. */
  slackMin: number;
  /** Latest moment to start working so this (and everything due before it) still fits. */
  startBy: number;
  level: UrgencyLevel;
}

/** Unfinished, unmuted tasks and assignments with a deadline, as work to schedule. */
export function workItems(items: PlannerItem[]): WorkItem[] {
  const seen = new Set<string>();
  const out: WorkItem[] = [];
  for (const i of items) {
    if (i.kind === 'event' || i.done || i.muted || i.deadline === undefined) continue;
    if (seen.has(i.key)) continue;
    seen.add(i.key);
    out.push({
      key: i.key,
      title: i.title,
      kind: i.kind,
      deadline: i.deadline,
      effortMin: Math.max(0, i.effortMin ?? 0),
      important: i.important,
    });
  }
  return out;
}

export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ start: i.start, end: i.end });
  }
  return out;
}

/** The nightly sleep windows that intersect [from, to]. */
export function sleepIntervals(from: number, to: number, sleep: UrgencyOptions['sleep']): Interval[] {
  if (!sleep || sleep.startMin === sleep.endMin) return [];
  const out: Interval[] = [];
  for (let day = addDays(startOfDay(from), -1); day <= to; day = addDays(day, 1)) {
    const start = atMinutes(day, sleep.startMin);
    const end = sleep.endMin > sleep.startMin ? atMinutes(day, sleep.endMin) : atMinutes(addDays(day, 1), sleep.endMin);
    if (end > from && start < to) out.push({ start: Math.max(start, from), end: Math.min(end, to) });
  }
  return out;
}

/** Blocked time between `from` and `to`, merged and clipped. */
function blockedBetween(from: number, to: number, busy: Interval[], sleep: UrgencyOptions['sleep']): Interval[] {
  const clipped = busy
    .filter((b) => b.end > from && b.start < to)
    .map((b) => ({ start: Math.max(b.start, from), end: Math.min(b.end, to) }));
  return mergeIntervals([...clipped, ...sleepIntervals(from, to, sleep)]);
}

export function freeMinutes(from: number, to: number, busy: Interval[], sleep: UrgencyOptions['sleep']): number {
  if (to <= from) return 0;
  const blocked = blockedBetween(from, to, busy, sleep).reduce((sum, b) => sum + (b.end - b.start), 0);
  return Math.max(0, Math.floor((to - from - blocked) / MIN));
}

/**
 * Walks backwards from the deadline through free time until `needMin` minutes are
 * collected. When there is not enough free time, returns a moment before `now`.
 */
export function latestStart(now: number, deadline: number, needMin: number, busy: Interval[], sleep: UrgencyOptions['sleep']): number {
  let remaining = needMin * MIN;
  if (remaining <= 0) return deadline;
  const blocked = blockedBetween(now, deadline, busy, sleep);
  let cursor = deadline;
  for (let i = blocked.length - 1; i >= -1; i--) {
    const gapStart = i >= 0 ? blocked[i].end : now;
    const gap = cursor - gapStart;
    if (gap >= remaining) return cursor - remaining;
    if (gap > 0) remaining -= gap;
    if (i >= 0) cursor = blocked[i].start;
  }
  return now - remaining;
}

/**
 * Earliest-deadline-first analysis: each item's slack accounts for the work that is
 * due before it, the user's calendar events and their sleep window.
 */
export function analyze(now: number, items: WorkItem[], busy: Interval[], opts: UrgencyOptions): Analysis[] {
  const sorted = [...items].sort((a, b) => a.deadline - b.deadline || a.key.localeCompare(b.key));
  const out: Analysis[] = [];
  let queued = 0;
  for (const it of sorted) {
    const needMin = Math.ceil(it.effortMin * (1 + opts.bufferPct / 100));
    if (it.deadline <= now) {
      out.push({ ...it, needMin, queuedMin: 0, freeMin: 0, slackMin: -needMin, startBy: it.deadline - needMin * MIN, level: 'overdue' });
      continue;
    }
    const freeMin = freeMinutes(now, it.deadline, busy, opts.sleep);
    const slackMin = freeMin - queued - needMin;
    const startBy = latestStart(now, it.deadline, queued + needMin, busy, opts.sleep);
    const headsUp = it.important ? opts.headsUpMin * 2 : opts.headsUpMin;
    let level: UrgencyLevel = 'ok';
    if (slackMin < 0) level = 'behind';
    else if (slackMin <= opts.startNowMin) level = 'now';
    else if (slackMin <= headsUp) level = 'soon';
    out.push({ ...it, needMin, queuedMin: queued, freeMin, slackMin, startBy, level });
    queued += needMin;
  }
  return out;
}

// ------------------------------------------------------------------ reminders

export type ReminderStage = 'soon' | 'now' | 'final';
export const STAGE_RANK: Record<ReminderStage, number> = { soon: 1, now: 2, final: 3 };

export interface Reminder {
  /** `<itemKey>|<deadline>`; one record per item deadline. */
  id: string;
  itemKey: string;
  stage: ReminderStage;
  rank: number;
  title: string;
  body: string;
}

export interface ReminderOptions {
  /** Send the last reminder this many minutes before the deadline. */
  finalMin: number;
  hour12: boolean;
}

export function reminderId(a: Pick<Analysis, 'key' | 'deadline'>): string {
  return `${a.key}|${a.deadline}`;
}

function stageFor(a: Analysis, now: number, finalMin: number): ReminderStage | null {
  if (a.level === 'overdue') return null;
  if (a.deadline - now <= finalMin * MIN) return 'final';
  if (a.level === 'behind' || a.level === 'now') return 'now';
  if (a.level === 'soon') return 'soon';
  return null;
}

function describe(a: Analysis, stage: ReminderStage, now: number, hour12: boolean): { title: string; body: string } {
  const when = fmtWhen(a.deadline, now, hour12);
  const need = fmtDuration(a.effortMin);
  const free = fmtDuration(a.freeMin);
  const queue = a.queuedMin > 0 ? ` (after ${fmtDuration(a.queuedMin)} of earlier work)` : '';
  if (stage === 'final') {
    const left = Math.max(1, Math.round((a.deadline - now) / MIN));
    return { title: `Due in ${fmtDuration(left)}: ${a.title}`, body: `Due ${when}. It needs about ${need}.` };
  }
  if (a.level === 'behind') {
    return {
      title: `Behind on: ${a.title}`,
      body: `It needs about ${need}, but only ${free} is free before ${when}${queue}. Start right away.`,
    };
  }
  if (stage === 'now') {
    return {
      title: `Start now: ${a.title}`,
      body: `About ${need} of work and ${free} of free time left before ${when}${queue}.`,
    };
  }
  return {
    title: `Start soon: ${a.title}`,
    body: `About ${need} of work, due ${when}${queue}. Start by ${fmtTime(a.startBy, hour12)} to finish in time.`,
  };
}

/**
 * Reminders that should be shown now. `fired` maps reminder ids to the highest rank
 * already shown, so each item escalates at most once per stage.
 */
export function pickReminders(analyses: Analysis[], fired: Record<string, number>, now: number, opts: ReminderOptions): Reminder[] {
  const out: Reminder[] = [];
  for (const a of analyses) {
    const stage = stageFor(a, now, opts.finalMin);
    if (!stage) continue;
    const id = reminderId(a);
    const rank = STAGE_RANK[stage];
    if ((fired[id] ?? 0) >= rank) continue;
    out.push({ id, itemKey: a.key, stage, rank, ...describe(a, stage, now, opts.hour12) });
  }
  return out;
}

/** One-line summary of today's workload, or null when nothing is due today. */
export function buildDigest(analyses: Analysis[], now: number, hour12: boolean): { title: string; body: string } | null {
  const endOfToday = addDays(startOfDay(now), 1);
  const today = analyses.filter((a) => a.level !== 'overdue' && a.deadline < endOfToday);
  if (today.length === 0) return null;
  const work = today.reduce((sum, a) => sum + a.effortMin, 0);
  const tightest = [...today].sort((a, b) => a.slackMin - b.slackMin)[0];
  return {
    title: `Today: ${today.length} due · about ${fmtDuration(work)} of work`,
    body: `Tightest: ${tightest.title}, start by ${fmtTime(Math.max(now, tightest.startBy), hour12)}.`,
  };
}

/** Whether `now` falls inside the nightly sleep window. */
export function isSleeping(now: number, sleep: UrgencyOptions['sleep']): boolean {
  return sleepIntervals(now, now + 1, sleep).length > 0;
}
