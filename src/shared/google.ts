// Google Calendar API v3 response mapping.

import { clip, LIMITS, shortId, webUrl } from './sanitize';
import type { CalendarRef, CalEvent } from './types';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

const MAX_NOTES = 280;

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
].join(' ');

export function eventsUrl(calendarId: string, timeMin: number, timeMax: number, pageToken?: string): string {
  const q = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    timeMin: new Date(timeMin).toISOString(),
    timeMax: new Date(timeMax).toISOString(),
    maxResults: '1000',
  });
  if (pageToken) q.set('pageToken', pageToken);
  return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${q}`;
}

export function mapCalendarList(json: unknown, previous: CalendarRef[]): CalendarRef[] {
  if (!isRecord(json) || !Array.isArray(json.items)) return [];
  const prior = new Map(previous.map((c) => [c.id, c.enabled]));
  const out: CalendarRef[] = [];
  for (const c of json.items) {
    if (!isRecord(c) || typeof c.id !== 'string') continue;
    const name = clip(c.summaryOverride, LIMITS.calendar) ?? clip(c.summary, LIMITS.calendar) ?? c.id.slice(0, LIMITS.calendar);
    // New calendars follow Google's own "selected" checkbox; known ones keep the user's choice.
    out.push({ id: c.id, name, enabled: prior.get(c.id) ?? (c.selected !== false) });
  }
  return out;
}

export function mapGoogleEvents(json: unknown, calendar: CalendarRef): CalEvent[] {
  if (!isRecord(json) || !Array.isArray(json.items)) return [];
  const out: CalEvent[] = [];
  for (const e of json.items) {
    if (!isRecord(e) || typeof e.id !== 'string' || e.status === 'cancelled') continue;
    const start = isRecord(e.start) ? e.start : {};
    const end = isRecord(e.end) ? e.end : {};
    const allDay = typeof start.date === 'string';
    const s = allDay ? (start.date as string) : typeof start.dateTime === 'string' ? start.dateTime : '';
    const en = allDay ? (typeof end.date === 'string' ? end.date : s) : typeof end.dateTime === 'string' ? end.dateTime : s;
    if (!s) continue;
    if (!allDay && !Number.isFinite(Date.parse(s))) continue;
    const key = `google:${shortId(calendar.id)}:${shortId(e.id)}`;
    const series = typeof e.recurringEventId === 'string' ? `google:${shortId(calendar.id)}:${shortId(e.recurringEventId)}` : key;
    out.push({
      key,
      seriesKey: series,
      sourceId: 'google',
      calendar: calendar.name,
      title: clip(e.summary, LIMITS.title) ?? '(untitled)',
      start: allDay ? s : new Date(Date.parse(s)).toISOString(),
      end: allDay ? en : new Date(Date.parse(en)).toISOString(),
      allDay,
      recurring: series !== key || undefined,
      location: clip(e.location, LIMITS.location),
      url: webUrl(e.htmlLink),
      notes: typeof e.description === 'string' ? e.description.slice(0, MAX_NOTES) : undefined,
    });
  }
  return out;
}
