// Worker-thread entry: parses calendar files for services/icsParser.ts, which stops this
// thread if it runs too long. Imports nothing from Electron.

import { parentPort } from 'node:worker_threads';
import { parseIcs } from '../shared/ics';
import type { IcsJob, IcsOutcome } from './services/icsParser';

parentPort?.on('message', (jobs: IcsJob[]) => {
  const outcomes = jobs.map(({ text, options }): IcsOutcome => {
    try {
      return { ok: true, result: parseIcs(text, options) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  parentPort?.postMessage(outcomes);
});
