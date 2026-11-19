import { describe, it, expect, vi } from 'vitest';
import { EventEmitter, once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { workerParser, inlineParser, parseOne, ParseTimeoutError, type WorkerLike, type IcsJob, type IcsOutcome } from '../src/main/services/icsParser';

const options = { sourceId: 'feed:test', rangeStart: 0, rangeEnd: 1000 };
const jobs: IcsJob[] = [{ text: 'calendar', options }];
const answer: IcsOutcome[] = [{ ok: true, result: { events: [], assignments: [] } }];
class FakeWorker extends EventEmitter implements WorkerLike {
  postMessage = vi.fn<(value: unknown) => void>();
  terminate = vi.fn(async () => 0);
}

describe('workerParser', () => {
  it('resolves the worker answer and terminates the worker', async () => {
    const worker = new FakeWorker();
    const pending = workerParser(() => worker)(jobs);
    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith(jobs);
    worker.emit('message', answer);
    await expect(pending).resolves.toEqual(answer);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it.each([{ label: 'empty', value: [] }, { label: 'too long', value: [...answer, ...answer] }])(
    'rejects a $label answer with the wrong number of outcomes', async ({ value }) => {
    const worker = new FakeWorker();
    const pending = workerParser(() => worker)(jobs);
    const rejected = expect(pending).rejects.toThrow('unexpected answer');
    worker.emit('message', value);
    await rejected;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    },
  );
  it('rejects with ParseTimeoutError at the deadline and terminates the worker', async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorker();
      const pending = workerParser(() => worker, 25)(jobs);
      const rejected = expect(pending).rejects.toBeInstanceOf(ParseTimeoutError);
      await vi.advanceTimersByTimeAsync(25);
      await rejected;
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it('rejects an error event and terminates the worker', async () => {
    const worker = new FakeWorker();
    const pending = workerParser(() => worker)(jobs);
    const error = new Error('Worker failed');
    const rejected = expect(pending).rejects.toBe(error);
    worker.emit('error', error);
    await rejected;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it('rejects an exit before an answer', async () => {
    const worker = new FakeWorker();
    const pending = workerParser(() => worker)(jobs);
    const rejected = expect(pending).rejects.toThrow('stopped unexpectedly (code 2)');
    worker.emit('exit', 2);
    await rejected;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it('resolves an empty job list without spawning', async () => {
    const spawn = vi.fn(() => new FakeWorker());
    await expect(workerParser(spawn)([])).resolves.toEqual([]);
    expect(spawn).not.toHaveBeenCalled();
  });
  it('times out an infinite real worker and the thread actually exits', async () => {
    const worker = new Worker('while (true) {}', { eval: true });
    const exited = once(worker, 'exit');
    try {
      // Start the deadline after the worker is online, avoiding startup-time dependence.
      await once(worker, 'online');
      const start = performance.now();
      await expect(workerParser(() => worker, 40)(jobs)).rejects.toBeInstanceOf(ParseTimeoutError);
      expect(performance.now() - start).toBeLessThan(1200);
      await exited;
      expect(worker.threadId).toBe(-1);
    } finally {
      await worker.terminate();
    }
  }, 3000);
});

describe('inlineParser and parseOne', () => {
  it('returns a failed outcome for a throwing parse', async () => {
    const parse = vi.fn(() => { throw new Error('Malformed calendar'); });
    await expect(inlineParser(parse)(jobs)).resolves.toEqual([{ ok: false, error: 'Malformed calendar' }]);
    expect(parse).toHaveBeenCalledExactlyOnceWith('calendar', options);
  });
  it('parseOne rethrows the failed outcome message', async () => {
    const parser = inlineParser(() => { throw new Error('Malformed calendar'); });
    await expect(parseOne(parser, 'calendar', options)).rejects.toThrow('Malformed calendar');
  });
});
