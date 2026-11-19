// Once a minute: look at everything still to do, work out how much free time is left
// before each deadline, and raise a desktop notification when something has to be started.

import { analyzeData, FINAL_MIN, urgencyOptions } from '../shared/analysis';
import { atMinutes, dayKey, parseClock, startOfDay } from '../shared/time';
import { buildDigest, isSleeping, pickReminders } from '../shared/urgency';
import type { Store } from './store';

export interface Toast {
  title: string;
  body: string;
  /** Item to reveal when the notification is clicked. */
  itemKey?: string;
}

const TICK_MS = 60_000;
const MAX_SEPARATE = 3;

export class ReminderService {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: Store,
    private readonly show: (toast: Toast) => void,
    private readonly clock: () => number = Date.now,
  ) {}

  start(): void {
    this.stop();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Evaluates reminders once and returns the notifications that were shown. */
  tick(): Toast[] {
    const data = this.store.data;
    const n = data.settings.notify;
    if (!n.enabled) return [];
    const now = this.clock();
    const opts = urgencyOptions(data.settings);
    if (isSleeping(now, opts.sleep)) return [];

    const analyses = analyzeData(data, now);
    const due = pickReminders(analyses, data.reminders, now, { finalMin: FINAL_MIN, hour12: data.settings.hour12 });
    const toasts: Toast[] = [];

    if (due.length > MAX_SEPARATE) {
      const names = due.slice(0, 4).map((r) => r.title.replace(/^[^:]+:\s*/, ''));
      const extra = due.length > 4 ? ` and ${due.length - 4} more` : '';
      toasts.push({ title: `${due.length} things need attention`, body: `${names.join(', ')}${extra}.`, itemKey: due[0].itemKey });
    } else {
      for (const r of due) toasts.push({ title: r.title, body: r.body, itemKey: r.itemKey });
    }

    let digestId: string | null = null;
    if (n.dailyDigest) {
      const id = `digest|${dayKey(now)}`;
      if (!data.reminders[id] && now >= atMinutes(startOfDay(now), parseClock(n.digestTime))) {
        digestId = id;
        const digest = buildDigest(analyses, now, data.settings.hour12);
        if (digest) toasts.push(digest);
      }
    }

    if (due.length > 0 || digestId) {
      this.store.update((d) => {
        for (const r of due) d.reminders[r.id] = r.rank;
        if (digestId) d.reminders[digestId] = 1;
      });
    }
    for (const t of toasts) this.show(t);
    return toasts;
  }
}
