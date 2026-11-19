// Changes the user makes to their own data. Kept free of Electron so the rules can be
// tested directly: nothing here talks to Google, Apple or Canvas, so "delete" only ever
// hides an item locally and can be undone from Settings.

import { randomUUID } from 'node:crypto';
import { parseTasksFile } from '../shared/importers';
import { buildItems, type PlannerItem } from '../shared/items';
import { ruleFor, ruleMatches } from '../shared/similarity';
import { toTask, validateTask } from '../shared/tasks';
import { addDays, fmtDayShort, fmtTime } from '../shared/time';
import type { ActionResult, ImportResult, ItemOverlay, Persisted, SimilarPreview, TaskInput } from '../shared/types';
import type { Store } from './store';

const PREVIEW_LIMIT = 40;
const MAX_EFFORT_MIN = 7 * 24 * 60;
/** Item keys are built from source and event IDs; anything longer is not a real key. */
export const MAX_KEY_LENGTH = 600;

/** A key that can safely index the overlay map: a real string, not one that reaches a prototype. */
export function isItemKey(key: unknown): key is string {
  return typeof key === 'string' && key.length > 0 && key.length <= MAX_KEY_LENGTH && key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

/** Every visible item in the stored window. */
export function allItems(d: Persisted, now: number): PlannerItem[] {
  const { keepPastDays, horizonDays } = d.settings.sync;
  return buildItems(d, addDays(now, -keepPastDays - 1), addDays(now, horizonDays + 1));
}

export function findItem(d: Persisted, key: string, now: number): PlannerItem | undefined {
  return allItems(d, now).find((i) => i.key === key);
}

export function saveTask(store: Store, input: TaskInput, now: number): ActionResult {
  const errors = validateTask(input);
  const first = Object.values(errors)[0];
  if (first) return { ok: false, message: first };
  const existing = input.id ? store.data.tasks.find((t) => t.id === input.id) : undefined;
  if (input.id && !existing) return { ok: false, message: 'That task no longer exists.' };
  const task = toTask(input, `task:${randomUUID()}`, new Date(now).toISOString(), existing);
  if (!task) return { ok: false, message: 'The task could not be saved.' };
  store.update((d) => {
    const i = d.tasks.findIndex((t) => t.id === task.id);
    if (i >= 0) d.tasks[i] = task;
    else d.tasks.push(task);
    if (input.important !== undefined) applyFlags(d, task.id, { important: input.important });
  });
  return { ok: true };
}

function applyFlags(d: Persisted, key: string, flags: Partial<ItemOverlay>): void {
  const cur: ItemOverlay = { ...d.overlay[key] };
  for (const name of ['important', 'muted', 'done'] as const) {
    if (flags[name] === undefined) continue;
    if (flags[name]) cur[name] = true;
    else delete cur[name];
  }
  if (flags.effortMin !== undefined) {
    const v = Number(flags.effortMin);
    if (Number.isFinite(v) && v > 0) cur.effortMin = Math.min(MAX_EFFORT_MIN, Math.round(v));
    else delete cur.effortMin;
  }
  if (Object.keys(cur).length === 0) delete d.overlay[key];
  else d.overlay[key] = cur;
}

/** important / muted / effortMin belong on the series key, done on the occurrence key. */
export function setFlags(store: Store, key: string, flags: Partial<ItemOverlay>): void {
  if (!isItemKey(key) || typeof flags !== 'object' || flags === null) return;
  store.update((d) => applyFlags(d, key, flags));
}

function removeTask(d: Persisted, taskId: string): void {
  d.tasks = d.tasks.filter((t) => t.id !== taskId);
  const mine = (k: string): boolean => k === taskId || k.startsWith(`${taskId}@`);
  for (const k of Object.keys(d.overlay)) if (mine(k)) delete d.overlay[k];
  for (const k of Object.keys(d.reminders)) if (mine(k.slice(0, k.lastIndexOf('|')))) delete d.reminders[k];
  d.suppressed.ids = d.suppressed.ids.filter((s) => !mine(s.key));
}

function hide(d: Persisted, key: string, item: Pick<PlannerItem, 'title' | 'kind'>, now: number): void {
  if (d.suppressed.ids.some((s) => s.key === key)) return;
  d.suppressed.ids.push({ key, title: item.title, kind: item.kind, at: new Date(now).toISOString() });
}

export function deleteItem(store: Store, key: string, scope: 'one' | 'series', now: number): ActionResult {
  const d = store.data;
  const task = d.tasks.find((t) => key === t.id || key.startsWith(`${t.id}@`));
  if (task) {
    store.update((data) => {
      if (!task.recurrence || scope === 'series') removeTask(data, task.id);
      else hide(data, key, { title: task.title, kind: 'task' }, now);
    });
    return { ok: true };
  }
  const item = findItem(d, key, now);
  if (!item) return { ok: false, message: 'That item is no longer here.' };
  store.update((data) => hide(data, scope === 'series' ? item.seriesKey : item.key, item, now));
  return { ok: true };
}

function similarTo(d: Persisted, item: PlannerItem, now: number): PlannerItem[] {
  const rule = ruleFor(item);
  return allItems(d, now).filter((i) => ruleMatches(rule, i));
}

export function previewSimilar(store: Store, key: string, now: number): SimilarPreview | null {
  const d = store.data;
  const item = findItem(d, key, now);
  if (!item) return null;
  const matches = similarTo(d, item, now);
  return {
    rule: ruleFor(item),
    total: matches.length,
    matches: matches.slice(0, PREVIEW_LIMIT).map((m) => {
      const when = m.due ?? m.start;
      return { key: m.key, title: m.title, when: m.allDay ? fmtDayShort(when) : `${fmtDayShort(when)}, ${fmtTime(when, d.settings.hour12)}` };
    }),
  };
}

/**
 * Removes an item and everything with the same or a near-identical name.
 * Local tasks are deleted outright. Synced items get a rule, so matching items that
 * arrive in later syncs stay hidden too. Returns how many items were removed.
 */
export function deleteSimilar(store: Store, key: string, now: number): number {
  const d = store.data;
  const item = findItem(d, key, now);
  if (!item) return 0;
  const matches = similarTo(d, item, now);
  const rule = ruleFor(item);
  store.update((data) => {
    if (item.kind === 'task') {
      const ids = new Set(matches.map((m) => m.taskId).filter((id): id is string => !!id));
      for (const id of ids) removeTask(data, id);
      return;
    }
    const exists = data.suppressed.rules.some((r) => r.kind === rule.kind && r.pattern === rule.pattern && (r.scope ?? '') === (rule.scope ?? ''));
    if (!exists) data.suppressed.rules.push({ ...rule, id: randomUUID(), at: new Date(now).toISOString() });
  });
  return matches.length;
}

/** `all`, `id:<key>` or `rule:<id>`. */
export function restoreSuppressed(store: Store, target: string): void {
  store.update((d) => {
    if (target === 'all') d.suppressed = { ids: [], rules: [] };
    else if (target.startsWith('id:')) d.suppressed.ids = d.suppressed.ids.filter((s) => s.key !== target.slice(3));
    else if (target.startsWith('rule:')) d.suppressed.rules = d.suppressed.rules.filter((r) => r.id !== target.slice(5));
  });
}

export function importTasks(store: Store, fileName: string, text: string, now: number): ImportResult {
  const parsed = parseTasksFile(fileName, text);
  const nowIso = new Date(now).toISOString();
  let added = 0;
  let skipped = parsed.skipped;
  store.update((d) => {
    const seen = new Set(d.tasks.map((t) => `${t.title.toLowerCase()}|${t.preferredDue}`));
    for (const input of parsed.tasks) {
      const task = toTask(input, `task:${randomUUID()}`, nowIso);
      if (!task || seen.has(`${task.title.toLowerCase()}|${task.preferredDue}`)) {
        skipped++;
        continue;
      }
      seen.add(`${task.title.toLowerCase()}|${task.preferredDue}`);
      d.tasks.push(task);
      if (input.important) applyFlags(d, task.id, { important: true });
      added++;
    }
  });
  return { added, skipped, errors: parsed.errors };
}

/** Drops everything that can be downloaded again. Tasks, flags and deletions are kept. */
export function clearCache(store: Store): void {
  store.update((d) => {
    d.events = d.events.filter((e) => e.sourceId === 'demo');
    d.assignments = d.assignments.filter((a) => a.sourceId === 'demo');
    if (d.weather && d.weather.place.country !== 'Sample data') d.weather = null;
    d.sync = {};
  });
}
