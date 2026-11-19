// Open-Meteo request building and response mapping (https://open-meteo.com/en/docs).

import { clip, LIMITS } from './sanitize';
import type { DayWeather, HourWeather, Place, TempUnit, WeatherCache } from './types';

export type Condition = 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm';

/** WMO weather interpretation codes, as documented by Open-Meteo. */
export function conditionFor(code: number): { kind: Condition; label: string } {
  if (code === 0) return { kind: 'clear', label: 'Clear' };
  if (code === 1) return { kind: 'clear', label: 'Mostly clear' };
  if (code === 2) return { kind: 'partly', label: 'Partly cloudy' };
  if (code === 3) return { kind: 'cloudy', label: 'Overcast' };
  if (code === 45 || code === 48) return { kind: 'fog', label: 'Fog' };
  if (code >= 51 && code <= 57) return { kind: 'drizzle', label: code >= 56 ? 'Freezing drizzle' : 'Drizzle' };
  if (code >= 61 && code <= 67) return { kind: 'rain', label: code >= 66 ? 'Freezing rain' : 'Rain' };
  if (code >= 71 && code <= 77) return { kind: 'snow', label: 'Snow' };
  if (code >= 80 && code <= 82) return { kind: 'rain', label: 'Showers' };
  if (code === 85 || code === 86) return { kind: 'snow', label: 'Snow showers' };
  if (code >= 95 && code <= 99) return { kind: 'storm', label: 'Thunderstorm' };
  return { kind: 'cloudy', label: 'Cloudy' };
}

export const FORECAST_DAYS = 16;
/** Days of history in the daily forecast, so every day of the current week has weather. */
export const PAST_DAYS = 6;
/** Hour-by-hour detail kept, in days (from yesterday when the caller says so). */
const HOURLY_KEEP_DAYS = 8;

export function forecastUrl(place: Place, units: TempUnit): string {
  const q = new URLSearchParams({
    latitude: place.lat.toFixed(4),
    longitude: place.lon.toFixed(4),
    daily: 'temperature_2m_mean,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,weather_code,sunrise,sunset',
    hourly: 'temperature_2m,precipitation_probability,weather_code,uv_index',
    timezone: 'auto',
    forecast_days: String(FORECAST_DAYS),
    past_days: String(PAST_DAYS),
    temperature_unit: units,
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

export function geocodeUrl(query: string): string {
  const q = new URLSearchParams({ name: query, count: '8', language: 'en', format: 'json' });
  return `https://geocoding-api.open-meteo.com/v1/search?${q}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function mapPlaces(json: unknown): Place[] {
  if (!isRecord(json) || !Array.isArray(json.results)) return [];
  const out: Place[] = [];
  for (const r of json.results) {
    if (!isRecord(r)) continue;
    const lat = num(r.latitude);
    const lon = num(r.longitude);
    const name = clip(r.name, LIMITS.place);
    if (lat === null || lon === null || !name || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    out.push({
      name,
      region: clip(r.admin1, LIMITS.place),
      country: clip(r.country, LIMITS.place),
      lat,
      lon,
    });
    if (out.length >= 20) break;
  }
  return out;
}

/**
 * Maps a forecast response. Throws when the payload is not a forecast.
 * Hourly entries before `hoursFrom` (YYYY-MM-DD) are dropped: past days only need the daily summary.
 */
export function mapForecast(json: unknown, place: Place, units: TempUnit, fetchedAt: string, hoursFrom?: string): WeatherCache {
  if (!isRecord(json) || !isRecord(json.daily) || !Array.isArray(json.daily.time)) {
    throw new Error('Weather service returned an unexpected response');
  }
  const d = json.daily as Record<string, unknown[]>;
  const days: DayWeather[] = [];
  for (let i = 0; i < d.time.length; i++) {
    const date = d.time[i];
    const max = num(d.temperature_2m_max?.[i]);
    const min = num(d.temperature_2m_min?.[i]);
    if (typeof date !== 'string' || max === null || min === null) continue;
    days.push({
      date,
      mean: num(d.temperature_2m_mean?.[i]) ?? (max + min) / 2,
      max,
      min,
      rain: num(d.precipitation_probability_max?.[i]),
      uv: num(d.uv_index_max?.[i]),
      code: num(d.weather_code?.[i]) ?? 3,
      sunrise: typeof d.sunrise?.[i] === 'string' ? (d.sunrise[i] as string) : undefined,
      sunset: typeof d.sunset?.[i] === 'string' ? (d.sunset[i] as string) : undefined,
    });
  }
  const hours: HourWeather[] = [];
  if (isRecord(json.hourly) && Array.isArray(json.hourly.time)) {
    const h = json.hourly as Record<string, unknown[]>;
    for (let i = 0; i < h.time.length && hours.length < HOURLY_KEEP_DAYS * 24; i++) {
      const t = h.time[i];
      const temp = num(h.temperature_2m?.[i]);
      if (typeof t !== 'string' || temp === null) continue;
      if (hoursFrom && t.slice(0, 10) < hoursFrom) continue;
      hours.push({
        t,
        temp,
        rain: num(h.precipitation_probability?.[i]),
        uv: num(h.uv_index?.[i]),
        code: num(h.weather_code?.[i]) ?? 3,
      });
    }
  }
  return { fetchedAt, place, units, days, hours };
}

export function weatherForDay(cache: WeatherCache | null, key: string): DayWeather | undefined {
  return cache?.days.find((d) => d.date === key);
}

export function hoursForDay(cache: WeatherCache | null, key: string): HourWeather[] {
  return cache ? cache.hours.filter((h) => h.t.startsWith(key)) : [];
}

export function uvLabel(uv: number): string {
  if (uv < 3) return 'Low';
  if (uv < 6) return 'Moderate';
  if (uv < 8) return 'High';
  if (uv < 11) return 'Very high';
  return 'Extreme';
}
