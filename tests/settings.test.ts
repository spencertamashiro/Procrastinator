import { describe, it, expect, vi } from 'vitest';
import { defaultSettings, mergeDeep } from '../src/shared/defaults';
import { sanitizeSettings, toggleOnly } from '../src/shared/settings';

const numericFields = [
  ['canvas', 'defaultEffortMin', 5, 1440], ['sync', 'intervalMin', 5, 1440],
  ['sync', 'keepPastDays', 1, 365], ['sync', 'horizonDays', 14, 366],
  ['notify', 'headsUpMin', 15, 1440], ['notify', 'bufferPct', 0, 200],
] as const;
const field = (value: unknown, group: string, key: string): unknown =>
  (value as Record<string, Record<string, unknown>>)[group][key];

describe('sanitizeSettings', () => {
  it('keeps the defaults unchanged', () => {
    expect(sanitizeSettings(defaultSettings(), defaultSettings())).toEqual(defaultSettings());
  });
  it.each([null, undefined, false, 42, 'settings', []].map((input) => [input]))('uses the fallback for non-object input %j', (input) => {
    const fallback = defaultSettings();
    fallback.theme = 'dark';
    expect(sanitizeSettings(input, fallback)).toEqual(fallback);
  });
  it('falls back for unknown enum values', () => {
    expect(sanitizeSettings({ theme: 'blue', view: 'year', rangeMode: 'forever', weekStartsOn: '1',
      density: 'tiny', weather: { units: 'kelvin' } }, defaultSettings())).toEqual(defaultSettings());
  });
  it('falls back for non-boolean switches', () => {
    expect(sanitizeSettings({ hour12: 'false', keepInTray: 0, launchAtLogin: 1,
      canvas: { showSubmitted: 'true' }, sync: { auto: null },
      notify: { enabled: 0, respectSleep: 'false', dailyDigest: [] } }, defaultSettings())).toEqual(defaultSettings());
  });
  it.each(numericFields)('clamps %s.%s at both bounds', (group, key, low, high) => {
    expect(field(sanitizeSettings({ [group]: { [key]: low - 100 } }, defaultSettings()), group, key)).toBe(low);
    expect(field(sanitizeSettings({ [group]: { [key]: high + 100 } }, defaultSettings()), group, key)).toBe(high);
  });
  it.each(numericFields)('rounds %s.%s to an integer', (group, key, low) => {
    expect(field(sanitizeSettings({ [group]: { [key]: low + 0.6 } }, defaultSettings()), group, key)).toBe(low + 1);
  });
  it.each(numericFields)('falls back for wrong types and non-finite %s.%s', (group, key) => {
    for (const value of ['30', NaN, Infinity, -Infinity, null, false]) {
      const fallback = defaultSettings();
      expect(field(sanitizeSettings({ [group]: { [key]: value } }, fallback), group, key)).toBe(field(fallback, group, key));
    }
  });
  it.each(['24:00', '12:60', '7:00', '12:3', 'noon', '', 1200])('rejects invalid HH:MM value %j', (value) => {
    const fallback = defaultSettings();
    expect(sanitizeSettings({ notify: { sleepStart: value, sleepEnd: value, digestTime: value } }, fallback).notify).toEqual(fallback.notify);
  });
  it('accepts valid clock boundaries', () => {
    expect(sanitizeSettings({ notify: { sleepStart: '00:00', sleepEnd: '23:59', digestTime: '12:30' } }, defaultSettings()).notify)
      .toMatchObject({ sleepStart: '00:00', sleepEnd: '23:59', digestTime: '12:30' });
  });
  it.each([{ lat: 91, lon: 0 }, { lat: -91, lon: 0 }, { lat: 0, lon: 181 }, { lat: 0, lon: -181 },
    { lat: '45', lon: 0 }, { lat: 0, lon: '90' }, { lat: NaN, lon: 0 }, { lat: 0, lon: Infinity }])(
    'keeps the previous place for invalid coordinates %j', (coordinates) => {
      const fallback = defaultSettings();
      fallback.weather.place = { name: 'Home', lat: 45, lon: -120 };
      expect(sanitizeSettings({ weather: { place: { name: 'Invalid', ...coordinates } } }, fallback).weather.place).toEqual(fallback.weather.place);
    },
  );
  it('keeps an explicit null place', () => {
    const fallback = defaultSettings();
    fallback.weather.place = { name: 'Home', lat: 45, lon: -120 };
    expect(sanitizeSettings({ weather: { place: null } }, fallback).weather.place).toBeNull();
  });
  it.each(['google', 'icloud'])('deduplicates %s calendars by id', (group) => {
    const calendars = [{ id: 'a', name: 'First', enabled: false }, { id: 'a', name: 'Duplicate', enabled: true },
      { id: 'b', name: 'Second', enabled: true }];
    expect(field(sanitizeSettings({ [group]: { calendars } }, defaultSettings()), group, 'calendars')).toEqual([calendars[0], calendars[2]]);
  });
  it.each(['google', 'icloud'])('caps %s calendars at 250', (group) => {
    const calendars = Array.from({ length: 260 }, (_, i) => ({ id: String(i), name: `Calendar ${i}`, enabled: true }));
    expect(field(sanitizeSettings({ [group]: { calendars } }, defaultSettings()), group, 'calendars')).toEqual(calendars.slice(0, 250));
  });
  it('drops feed ids outside the allowed pattern', () => {
    const ids = ['', 'has space', 'a/b', 'a.b', 'x'.repeat(41), 'valid_ID-2'];
    expect(sanitizeSettings({ feeds: ids.map((id) => ({ id, name: 'Feed', host: 'example.com' })) }, defaultSettings()).feeds)
      .toEqual([{ id: 'valid_ID-2', name: 'Feed', host: 'example.com' }]);
  });
  it.each(['123 abc.apps.googleusercontent.com', '123/abc.apps.googleusercontent.com'])('rejects malformed Google client id %s', (clientId) => {
    const fallback = defaultSettings();
    fallback.google.clientId = '123-abc.apps.googleusercontent.com';
    expect(sanitizeSettings({ google: { clientId } }, fallback).google.clientId).toBe(fallback.google.clientId);
  });
  it.each(['http://canvas.example.com', 'not a valid address'])('rejects unsafe Canvas base URL %s', (baseUrl) => {
    const fallback = defaultSettings();
    fallback.canvas.baseUrl = 'https://canvas.example.com';
    expect(sanitizeSettings({ canvas: { baseUrl } }, fallback).canvas.baseUrl).toBe(fallback.canvas.baseUrl);
  });
  it('accepts an empty Canvas base URL', () => {
    const fallback = defaultSettings();
    fallback.canvas.baseUrl = 'https://canvas.example.com';
    expect(sanitizeSettings({ canvas: { baseUrl: '' } }, fallback).canvas.baseUrl).toBe('');
  });
  it('trims, clips and deduplicates categories', () => {
    expect(sanitizeSettings({ categories: [' School ', 'School', '', '  ', 5, 'x'.repeat(50), 'x'.repeat(45)] }, defaultSettings()).categories)
      .toEqual(['School', 'x'.repeat(40)]);
  });
  it('caps categories at 30 entries', () => {
    const categories = Array.from({ length: 35 }, (_, i) => `Category ${i}`);
    expect(sanitizeSettings({ categories }, defaultSettings()).categories).toEqual(categories.slice(0, 30));
  });
  it('does not coerce numeric objects', () => {
    const valueOf = vi.fn(() => 60);
    expect(sanitizeSettings({ sync: { intervalMin: { valueOf } } }, defaultSettings()).sync.intervalMin).toBe(30);
    expect(valueOf).not.toHaveBeenCalled();
  });
});

describe('prototype pollution protection', () => {
  const payloads = [
    '{"__proto__":{"securityTestInjected":true}}',
    '{"constructor":{"prototype":{"securityTestInjected":true}}}',
    '{"notify":{"__proto__":{"securityTestInjected":true},"constructor":{"prototype":{"securityTestInjected":true}}}}',
  ];
  it.each(payloads)('sanitizeSettings rejects injected properties in %s', (json) => {
    const result = sanitizeSettings(JSON.parse(json), defaultSettings());
    expect({}).not.toHaveProperty('securityTestInjected');
    expect(result).not.toHaveProperty('securityTestInjected');
    expect(result.notify).not.toHaveProperty('securityTestInjected');
    expect(JSON.stringify(result)).not.toContain('securityTestInjected');
  });
  it.each(payloads)('mergeDeep rejects injected properties in %s', (json) => {
    const result = mergeDeep(defaultSettings(), JSON.parse(json));
    expect({}).not.toHaveProperty('securityTestInjected');
    expect(result).not.toHaveProperty('securityTestInjected');
    expect(result.notify).not.toHaveProperty('securityTestInjected');
    expect(JSON.stringify(result)).not.toContain('securityTestInjected');
  });
  it('mergeDeep rejects prototype keys inside newly added objects', () => {
    const result = mergeDeep<Record<string, unknown>>({}, JSON.parse('{"newSection":{"__proto__":{"securityTestInjected":true},"constructor":{"prototype":{"securityTestInjected":true}}}}'));
    expect({}).not.toHaveProperty('securityTestInjected');
    expect(result).not.toHaveProperty('securityTestInjected');
    expect(JSON.stringify(result)).not.toContain('securityTestInjected');
  });
});

describe('toggleOnly', () => {
  it('changes only enabled on known ids and preserves known names and order', () => {
    const known = [{ id: 'a', name: 'First', enabled: true }, { id: 'b', name: 'Second', enabled: false }];
    expect(toggleOnly(known, [{ id: 'b', name: 'Renamed', enabled: true }, { id: 'a', name: 'Renamed', enabled: false }]))
      .toEqual([{ id: 'a', name: 'First', enabled: false }, { id: 'b', name: 'Second', enabled: true }]);
  });
  it('ignores unknown ids and retains missing ids unchanged', () => {
    const known = [{ id: 'a', name: 'First', enabled: false }];
    expect(toggleOnly(known, [{ id: 'unknown', name: 'Unknown', enabled: true }])).toEqual(known);
  });
});
