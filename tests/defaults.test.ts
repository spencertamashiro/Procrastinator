import { describe, it, expect } from 'vitest';
import { defaultSettings, emptyData, mergeDeep } from '../src/shared/defaults';

describe('mergeDeep', () => {
  it('merges nested objects while preserving untouched values and inputs', () => {
    const base = { nested: { left: 1, right: 2 }, enabled: true };
    const patch = { nested: { left: 3 } };
    expect(mergeDeep(base, patch)).toEqual({ nested: { left: 3, right: 2 }, enabled: true });
    expect(base).toEqual({ nested: { left: 1, right: 2 }, enabled: true });
    expect(patch).toEqual({ nested: { left: 3 } });
  });

  it('replaces arrays rather than merging their elements', () => {
    expect(mergeDeep({ rows: [{ id: 1 }, { id: 2 }] }, { rows: [{ id: 3 }] })).toEqual({ rows: [{ id: 3 }] });
    expect(mergeDeep({ rows: [1, 2] }, { rows: [] })).toEqual({ rows: [] });
    expect(mergeDeep([1, 2], [3])).toEqual([3]);
  });

  it('ignores undefined at the root and at nested properties', () => {
    const base = { a: 1, nested: { b: 2, c: 3 } };
    expect(mergeDeep(base, undefined)).toBe(base);
    expect(mergeDeep(base, { a: undefined, nested: { b: undefined, c: 4 } })).toEqual({ a: 1, nested: { b: 2, c: 4 } });
  });

  it('can replace null with an object and replace an object with null', () => {
    const base: { place: { name: string; lat: number } | null } = { place: null };
    expect(mergeDeep(base, { place: { name: 'Here', lat: 12 } })).toEqual({ place: { name: 'Here', lat: 12 } });
    expect(mergeDeep({ place: { name: 'Here', lat: 12 } } as typeof base, { place: null })).toEqual({ place: null });
  });

  it('replaces primitives including falsy values', () => {
    expect(mergeDeep({ enabled: true, count: 2, name: 'old' }, { enabled: false, count: 0, name: '' })).toEqual({ enabled: false, count: 0, name: '' });
  });

  it('merges real settings without losing sibling defaults', () => {
    const settings = defaultSettings();
    const merged = mergeDeep(settings, { canvas: { showSubmitted: false }, categories: ['Custom'], weather: { place: { name: 'Here', lat: 1, lon: 2 } } });
    expect(merged.canvas).toEqual({ ...settings.canvas, showSubmitted: false });
    expect(merged.categories).toEqual(['Custom']);
    expect(merged.weather).toEqual({ units: settings.weather.units, place: { name: 'Here', lat: 1, lon: 2 } });
    expect(settings.weather.place).toBeNull();
  });
});

describe('default factories', () => {
  it('returns independent settings and persisted data on each call', () => {
    const first = emptyData();
    const second = emptyData();
    expect(first).toMatchObject({ version: 1, tasks: [], events: [], assignments: [], overlay: {}, suppressed: { ids: [], rules: [] }, weather: null, sync: {}, reminders: {}, demo: false });
    expect(first.settings).toEqual(defaultSettings());
    first.settings.categories.push('Extra');
    first.settings.notify.headsUpMin = 1;
    first.reminders.test = 2;
    expect(second.settings.categories).not.toContain('Extra');
    expect(second.settings.notify.headsUpMin).toBe(90);
    expect(second.reminders).toEqual({});
  });
});
