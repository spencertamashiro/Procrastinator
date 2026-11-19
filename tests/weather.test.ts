import { describe, it, expect } from 'vitest';
import { conditionFor, forecastUrl, geocodeUrl, mapForecast, mapPlaces, weatherForDay, hoursForDay, uvLabel } from '../src/shared/weather';
import type { Place } from '../src/shared/types';

const place: Place = { name: 'Los Angeles', lat: 34.05223, lon: -118.24368 };
const fetchedAt = '2026-11-14T12:00:00.000Z';
function forecast() {
  return {
    latitude: place.lat, longitude: place.lon, timezone: 'America/Los_Angeles',
    daily: {
      time: ['2026-11-14', '2026-11-15'],
      temperature_2m_mean: [19, null], temperature_2m_max: [24, 22], temperature_2m_min: [14, 10],
      precipitation_probability_max: [30, null], uv_index_max: [4.5, null], weather_code: [2, 63],
      sunrise: ['2026-11-14T06:25', '2026-11-15T06:26'], sunset: ['2026-11-14T16:49', '2026-11-15T16:48'],
    },
    hourly: {
      time: ['2026-11-14T00:00', '2026-11-14T01:00', '2026-11-15T00:00'],
      temperature_2m: [14, 13, 10], precipitation_probability: [20, null, 50],
      uv_index: [0, null, 0], weather_code: [2, 3, 63],
    },
  };
}

describe('conditionFor', () => {
  it.each([
    [0, 'clear', 'Clear'], [2, 'partly', 'Partly cloudy'], [3, 'cloudy', 'Overcast'],
    [45, 'fog', 'Fog'], [53, 'drizzle', 'Drizzle'], [63, 'rain', 'Rain'],
    [73, 'snow', 'Snow'], [81, 'rain', 'Showers'], [95, 'storm', 'Thunderstorm'],
    [1234, 'cloudy', 'Cloudy'], [56, 'drizzle', 'Freezing drizzle'],
    [66, 'rain', 'Freezing rain'], [85, 'snow', 'Snow showers'],
  ])('maps WMO code %s', (code, kind, label) => {
    expect(conditionFor(code as number)).toEqual({ kind, label });
  });
});

describe('weather URLs', () => {
  it.each(['fahrenheit', 'celsius'] as const)('builds the forecast query in %s', (units) => {
    const url = new URL(forecastUrl(place, units));
    expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      latitude: '34.0522', longitude: '-118.2437', timezone: 'auto', forecast_days: '16',
      past_days: '6', temperature_unit: units,
    });
    expect(url.searchParams.get('daily')?.split(',')).toEqual([
      'temperature_2m_mean', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_probability_max',
      'uv_index_max', 'weather_code', 'sunrise', 'sunset',
    ]);
    expect(url.searchParams.get('hourly')?.split(',')).toEqual([
      'temperature_2m', 'precipitation_probability', 'weather_code', 'uv_index',
    ]);
  });
  it('encodes a geocoding query', () => {
    const url = new URL(geocodeUrl('São Paulo & coast'));
    expect(Object.fromEntries(url.searchParams)).toEqual({ name: 'São Paulo & coast', count: '8', language: 'en', format: 'json' });
  });
});

describe('mapForecast', () => {
  it('maps daily and hourly arrays, preserves nulls and derives a missing mean', () => {
    const cache = mapForecast(forecast(), place, 'celsius', fetchedAt);
    expect(cache).toEqual({
      place, units: 'celsius', fetchedAt,
      days: [
        { date: '2026-11-14', mean: 19, max: 24, min: 14, rain: 30, uv: 4.5, code: 2, sunrise: '2026-11-14T06:25', sunset: '2026-11-14T16:49' },
        { date: '2026-11-15', mean: 16, max: 22, min: 10, rain: null, uv: null, code: 63, sunrise: '2026-11-15T06:26', sunset: '2026-11-15T16:48' },
      ],
      hours: [
        { t: '2026-11-14T00:00', temp: 14, rain: 20, uv: 0, code: 2 },
        { t: '2026-11-14T01:00', temp: 13, rain: null, uv: null, code: 3 },
        { t: '2026-11-15T00:00', temp: 10, rain: 50, uv: 0, code: 63 },
      ],
    });
  });
  it('caps hourly entries at eight days', () => {
    const payload = forecast();
    // Build wall-clock strings without using the host timezone.
    const times = Array.from({ length: 16 * 24 }, (_, i) =>
      `2026-11-${String(14 + Math.floor(i / 24)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00`);
    payload.hourly = { time: times, temperature_2m: times.map(() => 15),
      precipitation_probability: times.map(() => 0), uv_index: times.map(() => 0), weather_code: times.map(() => 0) };
    const { hours } = mapForecast(payload, place, 'celsius', fetchedAt);
    expect(hours).toHaveLength(8 * 24);
    expect(hours.at(-1)?.t).toBe('2026-11-21T23:00');
  });
  it('keeps hourly entries only from the given day, still capped at eight days', () => {
    const payload = forecast();
    const times = Array.from({ length: 16 * 24 }, (_, i) =>
      `2026-11-${String(10 + Math.floor(i / 24)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00`);
    payload.hourly = { time: times, temperature_2m: times.map(() => 15),
      precipitation_probability: times.map(() => 0), uv_index: times.map(() => 0), weather_code: times.map(() => 0) };
    const { hours, days } = mapForecast(payload, place, 'celsius', fetchedAt, '2026-11-14');
    expect(hours[0].t).toBe('2026-11-14T00:00');
    expect(hours).toHaveLength(8 * 24);
    expect(hours.at(-1)?.t).toBe('2026-11-21T23:00');
    // Daily summaries are not trimmed.
    expect(days.map((d) => d.date)).toEqual(['2026-11-14', '2026-11-15']);
  });
  it('skips non-finite temperatures and defaults missing weather codes', () => {
    const payload = {
      daily: { time: ['2026-11-14', '2026-11-15', '2026-11-16'], temperature_2m_max: [24, NaN, 22], temperature_2m_min: [14, 10, Infinity] },
      hourly: { time: ['2026-11-14T00:00', '2026-11-14T01:00'], temperature_2m: [14, NaN] },
    };
    const cache = mapForecast(payload, place, 'celsius', fetchedAt);
    expect(cache.days).toEqual([expect.objectContaining({ date: '2026-11-14', mean: 19, rain: null, uv: null, code: 3 })]);
    expect(cache.hours).toEqual([{ t: '2026-11-14T00:00', temp: 14, rain: null, uv: null, code: 3 }]);
  });
  it('allows a daily-only forecast', () => {
    const { daily } = forecast();
    expect(mapForecast({ daily }, place, 'celsius', fetchedAt).hours).toEqual([]);
  });
  it.each([null, {}, { error: true, reason: 'Unavailable' }, { daily: { time: 'invalid' } }])('rejects non-forecast payload %j', (payload) => {
    expect(() => mapForecast(payload, place, 'celsius', fetchedAt)).toThrow('unexpected response');
  });
});

describe('mapPlaces', () => {
  it('maps valid places and skips malformed coordinates or names', () => {
    expect(mapPlaces({ results: [
      { name: 'Los Angeles', latitude: 34, longitude: -118, admin1: 'California', country: 'United States' },
      { name: 'Equator', latitude: 0, longitude: 0 }, null,
      { name: 'Bad', latitude: NaN, longitude: 1 }, { name: 'Bad', latitude: 1, longitude: Infinity },
      { name: 'Bad', latitude: '34', longitude: 1 }, { latitude: 1, longitude: 2 },
    ] })).toEqual([
      { name: 'Los Angeles', lat: 34, lon: -118, region: 'California', country: 'United States' },
      { name: 'Equator', lat: 0, lon: 0 },
    ]);
  });
  it.each([null, {}, { results: 'invalid' }])('returns no places for %j', (payload) => {
    expect(mapPlaces(payload)).toEqual([]);
  });
});

describe('forecast lookups', () => {
  it('looks up a day and handles absent days or a null cache', () => {
    const cache = mapForecast(forecast(), place, 'celsius', fetchedAt);
    expect(weatherForDay(cache, '2026-11-15')).toEqual(cache.days[1]);
    expect(weatherForDay(cache, '2026-12-01')).toBeUndefined();
    expect(weatherForDay(null, '2026-11-14')).toBeUndefined();
  });
  it('selects only hours on the requested day', () => {
    const cache = mapForecast(forecast(), place, 'celsius', fetchedAt);
    expect(hoursForDay(cache, '2026-11-14')).toEqual(cache.hours.slice(0, 2));
    expect(hoursForDay(cache, '2026-12-01')).toEqual([]);
    expect(hoursForDay(null, '2026-11-14')).toEqual([]);
  });
});

describe('uvLabel', () => {
  it.each([
    [0, 'Low'], [2.99, 'Low'], [3, 'Moderate'], [5.99, 'Moderate'],
    [6, 'High'], [7.99, 'High'], [8, 'Very high'], [10.99, 'Very high'], [11, 'Extreme'], [15, 'Extreme'],
  ])('labels UV %s as %s', (uv, label) => {
    expect(uvLabel(uv as number)).toBe(label);
  });
});
