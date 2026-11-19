// The one place that decides how urgent each piece of work is. The reminder service
// (main process) and the "due soon" view (renderer) both call this, so a badge in the
// window always agrees with the notification that was sent.

import { buildItems, busyIntervals, type DataSlice } from './items';
import { addDays, DAY, parseClock } from './time';
import type { Settings } from './types';
import { analyze, workItems, type Analysis, type UrgencyOptions } from './urgency';

/** How far ahead deadlines are looked at. */
export const LOOKAHEAD_DAYS = 14;
/** "Start now" once this little slack is left. */
export const START_NOW_MIN = 15;
/** The last reminder goes out this many minutes before a deadline. */
export const FINAL_MIN = 30;

export function urgencyOptions(settings: Settings): UrgencyOptions {
  const n = settings.notify;
  return {
    bufferPct: n.bufferPct,
    headsUpMin: n.headsUpMin,
    startNowMin: START_NOW_MIN,
    sleep: n.respectSleep ? { startMin: parseClock(n.sleepStart), endMin: parseClock(n.sleepEnd) } : null,
  };
}

/** Urgency of every unfinished task and assignment due between yesterday and the lookahead. */
export function analyzeData(data: DataSlice, now: number): Analysis[] {
  const items = buildItems(data, now - DAY, addDays(now, LOOKAHEAD_DAYS));
  return analyze(now, workItems(items), busyIntervals(items), urgencyOptions(data.settings));
}
