import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/main/store';
import { emptyData } from '../src/shared/defaults';
import { addDays, dayKey } from '../src/shared/time';
import { PAST_DAYS } from '../src/shared/weather';

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'procrastinator-store-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('Store.load', () => {
  it('clears syncing flags left behind by a crash and keeps the rest of the status', () => {
    const dir = tempDir();
    const saved = { ...emptyData(), sync: { weather: { syncing: true, lastSync: '2026-11-14T10:00:00.000Z' }, canvas: { syncing: false, lastError: 'Offline' } } };
    writeFileSync(path.join(dir, 'store.json'), JSON.stringify(saved));
    const store = new Store(dir);
    expect(store.loadError).toBeNull();
    expect(store.data.sync).toEqual({
      weather: { syncing: false, lastSync: '2026-11-14T10:00:00.000Z' },
      canvas: { syncing: false, lastError: 'Offline' },
    });
  });

  it('starts empty when there is no file', () => {
    expect(new Store(tempDir()).data.sync).toEqual({});
  });
});

describe('Store.prune weather', () => {
  it('keeps daily weather for the current week but hourly detail only from yesterday', () => {
    const store = new Store(tempDir());
    const now = new Date(2026, 10, 15, 16, 0).getTime();
    const day = (offset: number): string => dayKey(addDays(now, offset));
    store.data.weather = {
      fetchedAt: new Date(now).toISOString(),
      place: { name: 'Somewhere', lat: 1, lon: 2 },
      units: 'fahrenheit',
      days: [-8, -7, -6, -5, -1, 0, 1].map((o) => ({ date: day(o), mean: 60, max: 65, min: 55, rain: 10, uv: 3, code: 1 })),
      hours: [-3, -2, -1, 0, 1].map((o) => ({ t: `${day(o)}T12:00`, temp: 60, rain: 0, uv: 1, code: 1 })),
    };
    store.prune(now);
    expect(store.data.weather!.days.map((d) => d.date)).toEqual([-6, -5, -1, 0, 1].map(day));
    expect(store.data.weather!.days[0].date).toBe(day(-PAST_DAYS));
    expect(store.data.weather!.hours.map((h) => h.t.slice(0, 10))).toEqual([-1, 0, 1].map(day));
  });
});
