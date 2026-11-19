// The app's local copy of everything: one compact JSON file, written atomically.
// Synced data is pruned to a time window so the file stays small.

import { existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultSettings, emptyData, mergeDeep } from '../shared/defaults';
import { sanitizeSettings } from '../shared/settings';
import { addDays, dayKey, parseDayKey } from '../shared/time';
import type { Persisted } from '../shared/types';
import { PAST_DAYS } from '../shared/weather';

const SAVE_DELAY_MS = 400;
const MAX_SUPPRESSED_IDS = 2000;

export class Store {
  data: Persisted;
  /** Set when the saved file could not be read; the unreadable file is kept as a backup. */
  loadError: string | null = null;
  private readonly file: string;
  private readonly listeners = new Set<() => void>();
  private timer: NodeJS.Timeout | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'store.json');
    this.data = this.load();
  }

  private load(): Persisted {
    if (!existsSync(this.file)) return emptyData();
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Persisted>;
      if (parsed.version !== 1) throw new Error(`unsupported data version ${String(parsed.version)}`);
      const base = emptyData();
      // Nothing can be syncing while the file is read; a flag left by a crash would stick.
      const sync = Object.fromEntries(Object.entries(parsed.sync ?? {}).map(([id, s]) => [id, { ...s, syncing: false }]));
      return {
        ...base,
        ...parsed,
        version: 1,
        settings: sanitizeSettings(mergeDeep(defaultSettings(), parsed.settings ?? {}), defaultSettings()),
        suppressed: { ids: parsed.suppressed?.ids ?? [], rules: parsed.suppressed?.rules ?? [] },
        sync,
      };
    } catch (err) {
      // Never overwrite data we could not read: move it aside and start clean.
      const backup = path.join(path.dirname(this.file), `store.unreadable-${Date.now()}.json`);
      try {
        renameSync(this.file, backup);
        this.loadError = `Saved data could not be read (${(err as Error).message}). It was kept at ${backup}.`;
      } catch {
        this.loadError = `Saved data could not be read (${(err as Error).message}).`;
      }
      return emptyData();
    }
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Mutate the data in place; listeners are told and a save is scheduled. */
  update(fn: (data: Persisted) => void): void {
    fn(this.data);
    for (const cb of this.listeners) cb();
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.write();
    }, SAVE_DELAY_MS);
  }

  private write(): Promise<void> {
    const json = JSON.stringify(this.data);
    this.chain = this.chain
      .then(async () => {
        const tmp = `${this.file}.tmp`;
        await writeFile(tmp, json, 'utf8');
        await rename(tmp, this.file);
      })
      .catch((err) => {
        console.error('[store] save failed:', err);
      });
    return this.chain;
  }

  /** Write any pending change now (call before quitting). */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      await this.write();
    } else {
      await this.chain;
    }
  }

  sizeBytes(): number {
    try {
      return statSync(this.file).size;
    } catch {
      return 0;
    }
  }

  get path(): string {
    return this.file;
  }

  /** Drops synced data outside the retention window and stale bookkeeping. */
  prune(now: number): void {
    const d = this.data;
    const { keepPastDays, horizonDays } = d.settings.sync;
    const from = addDays(now, -keepPastDays);
    const to = addDays(now, horizonDays);
    const at = (v: string, allDay: boolean): number => (allDay ? parseDayKey(v) : Date.parse(v));

    d.events = d.events.filter((e) => at(e.end, e.allDay) >= from && at(e.start, e.allDay) <= to);
    d.assignments = d.assignments.filter((a) => {
      const due = at(a.dueAt, a.allDay);
      return due >= from && due <= to;
    });

    // Reminder records: `<key>|<deadline>` and `digest|<day>`.
    const reminderCutoff = addDays(now, -14);
    for (const id of Object.keys(d.reminders)) {
      const tail = id.slice(id.lastIndexOf('|') + 1);
      const when = /^\d{4}-\d{2}-\d{2}$/.test(tail) ? parseDayKey(tail) : Number(tail);
      if (!Number.isFinite(when) || when < reminderCutoff) delete d.reminders[id];
    }

    // Per-occurrence overlay entries (`...@YYYY-MM-DD...`) for occurrences long past.
    const cutoffKey = dayKey(from);
    for (const key of Object.keys(d.overlay)) {
      const m = /@(\d{4}-\d{2}-\d{2})/.exec(key);
      if (m && m[1] < cutoffKey) delete d.overlay[key];
      else if (Object.keys(d.overlay[key]).length === 0) delete d.overlay[key];
    }

    if (d.suppressed.ids.length > MAX_SUPPRESSED_IDS) {
      d.suppressed.ids = d.suppressed.ids.slice(-MAX_SUPPRESSED_IDS);
    }

    if (d.weather) {
      // Daily summaries cover the whole current week; hour-by-hour only from yesterday.
      const firstDay = dayKey(addDays(now, -PAST_DAYS));
      const yesterday = dayKey(addDays(now, -1));
      d.weather.days = d.weather.days.filter((w) => w.date >= firstDay);
      d.weather.hours = d.weather.hours.filter((h) => h.t.slice(0, 10) >= yesterday);
    }
  }
}
