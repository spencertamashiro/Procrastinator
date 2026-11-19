// Calendar files are parsed off the main thread. ical.js can loop forever inside a single
// step on an impossible repeat rule (FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30 never matches),
// and on the main thread that would freeze the app at every sync, including at startup.
// A worker can simply be stopped when it runs past its deadline.

import type { IcsOptions, IcsResult } from '../../shared/ics';

export interface IcsJob {
  text: string;
  options: IcsOptions;
}

export type IcsOutcome = { ok: true; result: IcsResult } | { ok: false; error: string };

/** Parses a batch of files; one outcome per job, in order. */
export type IcsParser = (jobs: IcsJob[]) => Promise<IcsOutcome[]>;

/** The parts of a worker_threads Worker used here. */
export interface WorkerLike {
  postMessage(value: unknown): void;
  on(event: 'message', listener: (value: unknown) => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  terminate(): Promise<number>;
}

export const PARSE_TIMEOUT_MS = 20_000;

export class ParseTimeoutError extends Error {
  constructor() {
    super('This calendar took too long to read, so it was skipped. Showing the saved copy.');
    this.name = 'ParseTimeoutError';
  }
}

/** Runs each batch on a fresh worker from `spawn`, stopped after `timeoutMs`. */
export function workerParser(spawn: () => WorkerLike, timeoutMs = PARSE_TIMEOUT_MS): IcsParser {
  return (jobs) =>
    new Promise<IcsOutcome[]>((resolve, reject) => {
      if (jobs.length === 0) {
        resolve([]);
        return;
      }
      const worker = spawn();
      let done = false;
      const finish = (fn: () => void): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        void worker.terminate().catch(() => undefined);
        fn();
      };
      const timer = setTimeout(() => finish(() => reject(new ParseTimeoutError())), timeoutMs);
      worker.on('message', (value) =>
        finish(() => {
          if (Array.isArray(value) && value.length === jobs.length) resolve(value as IcsOutcome[]);
          else reject(new Error('The calendar reader returned an unexpected answer.'));
        }),
      );
      worker.on('error', (err) => finish(() => reject(err)));
      worker.on('exit', (code) => finish(() => reject(new Error(`The calendar reader stopped unexpectedly (code ${code}).`))));
      worker.postMessage(jobs);
    });
}

/** The same contract, in-process: for tests and tools, never for the app. */
export function inlineParser(parse: (text: string, options: IcsOptions) => IcsResult): IcsParser {
  return async (jobs) =>
    jobs.map(({ text, options }): IcsOutcome => {
      try {
        return { ok: true, result: parse(text, options) };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    });
}

/** Parses one file, throwing its error. */
export async function parseOne(parser: IcsParser, text: string, options: IcsOptions): Promise<IcsResult> {
  const [outcome] = await parser([{ text, options }]);
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.result;
}
