// Screenshot harness (development only). The main process loads the page with
// ?harness=1 and calls window.__harness.apply("<step>") before each capture.
//
// A step is a dash-separated list of tokens, in any order:
//   month | week | day          view (default week)
//   light | dark                theme
//   rolling                     "Next 7 days" instead of the calendar week
//   compact                     compact density
//   dialog | more | edit        new-task dialog, with details open, or editing a task
//   menu | similar | due        context menu, "delete all like this" confirmation, due-soon list
//   settings[:section]          Settings, optionally on a section (e.g. settings:calendars)
//   snack                       the undo message
// e.g. "week-dark-menu", "day-light", "settings:data-dark".

import type { ViewMode } from '../../shared/types';

export interface HarnessStep {
  view: ViewMode;
  theme: 'light' | 'dark' | null;
  overlay: string | null;
  arg: string | null;
  flags: Set<string>;
}

const VIEWS = new Set(['month', 'week', 'day']);
const OVERLAYS = new Set(['dialog', 'more', 'edit', 'menu', 'similar', 'due', 'settings', 'snack']);

export function parseStep(step: string): HarnessStep {
  const out: HarnessStep = { view: 'week', theme: null, overlay: null, arg: null, flags: new Set() };
  for (const raw of step.split('-')) {
    const [token, arg] = raw.split(':');
    if (VIEWS.has(token)) out.view = token as ViewMode;
    else if (token === 'light' || token === 'dark') out.theme = token;
    else if (OVERLAYS.has(token)) {
      out.overlay = token;
      out.arg = arg ?? null;
    } else if (token) out.flags.add(token);
  }
  return out;
}

export const harnessEnabled = new URLSearchParams(window.location.search).has('harness');

type Handler = (step: HarnessStep) => Promise<void>;
let handler: Handler | null = null;
let markReady: () => void = () => undefined;
const ready = new Promise<void>((resolve) => {
  markReady = resolve;
});

/** Called by the app once it has state and can act on steps. */
export function registerHarness(fn: Handler): void {
  handler = fn;
  markReady();
}

export const frames = (n = 2): Promise<void> =>
  new Promise((resolve) => {
    const step = (left: number): void => {
      if (left <= 0) resolve();
      else requestAnimationFrame(() => step(left - 1));
    };
    step(n);
  });

export async function waitFor(test: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = performance.now();
  while (!test()) {
    if (performance.now() - start > timeoutMs) throw new Error('harness: timed out waiting');
    await new Promise((r) => setTimeout(r, 25));
  }
}

// Installed at load time: the main process may call apply() as soon as the page has loaded.
if (harnessEnabled) {
  window.__harness = {
    async apply(step: string) {
      await ready;
      await handler!(parseStep(step));
      await document.fonts.ready;
      await frames(3);
    },
  };
}
