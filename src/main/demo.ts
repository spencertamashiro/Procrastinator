// Sample data for trying the app without connecting any account. Everything it adds
// is tagged (sourceId 'demo', task ids 'task:demo-*') so it can be removed cleanly.

import { addDays, atMinutes, dayKey, HOUR, MIN, startOfDay, startOfWeek } from '../shared/time';
import type { Assignment, CalEvent, DayWeather, HourWeather, ItemOverlay, Persisted, Task, TempUnit, WeatherCache } from '../shared/types';
import { FORECAST_DAYS, PAST_DAYS } from '../shared/weather';

const SRC = 'demo';

export interface DemoData {
  events: CalEvent[];
  assignments: Assignment[];
  tasks: Task[];
  overlay: Record<string, ItemOverlay>;
  weather: WeatherCache;
}

export function buildDemo(now: number, units: TempUnit): DemoData {
  const monday = startOfWeek(now, 1);
  const events: CalEvent[] = [];
  const assignments: Assignment[] = [];
  const tasks: Task[] = [];
  const overlay: Record<string, ItemOverlay> = {};
  const iso = (ms: number): string => new Date(ms).toISOString();
  const at = (week: number, dow: number, h: number, m = 0): number => atMinutes(addDays(monday, week * 7 + dow), h * 60 + m);

  const repeat = (id: string, title: string, calendar: string, days: number[], h1: number, m1: number, h2: number, m2: number, location?: string): void => {
    for (let w = -1; w <= 4; w++) {
      for (const d of days) {
        const s = at(w, d, h1, m1);
        events.push({
          key: `${SRC}:${id}@${iso(s)}`,
          seriesKey: `${SRC}:${id}`,
          sourceId: SRC,
          calendar,
          title,
          start: iso(s),
          end: iso(at(w, d, h2, m2)),
          allDay: false,
          recurring: true,
          location,
        });
      }
    }
  };
  repeat('cs201-lec', 'CS 201 Lecture', 'Classes', [0, 2, 4], 10, 0, 10, 50, 'Hall 100');
  repeat('cs201-dis', 'CS 201 Discussion', 'Classes', [0], 13, 0, 13, 50, 'Room 140');
  repeat('cs201-lab', 'CS 201 Lab', 'Classes', [2], 15, 0, 17, 50, 'Lab 183');
  repeat('calc2', 'Calculus II Lecture', 'Classes', [1, 3], 11, 0, 12, 20, 'Room 104');
  repeat('writing', 'Writing 102', 'Classes', [1, 3], 14, 0, 15, 20, 'Room 220');
  repeat('gym', 'Gym', 'Personal', [0, 3], 17, 30, 18, 30, 'Rec center');
  repeat('market', 'Farmers market', 'Personal', [5], 9, 0, 10, 30);
  repeat('study-group', 'Study group', 'Personal', [6], 14, 0, 15, 30, 'Science Library');

  const single = (id: string, title: string, s: number, e: number, extra: Partial<CalEvent> = {}): void => {
    events.push({ key: `${SRC}:${id}`, seriesKey: `${SRC}:${id}`, sourceId: SRC, calendar: 'Personal', title, start: iso(s), end: iso(e), allDay: false, ...extra });
  };
  single('dinner', 'Dinner with friends', at(0, 4, 18, 30), at(0, 4, 20, 0), { location: 'Downtown' });
  single('office-hours', 'Office hours', at(0, 3, 15, 30), at(0, 3, 16, 15), { calendar: 'Classes' });
  events.push({
    key: `${SRC}:club-fair`,
    seriesKey: `${SRC}:club-fair`,
    sourceId: SRC,
    calendar: 'Personal',
    title: 'Club fair',
    start: dayKey(addDays(monday, 2)),
    end: dayKey(addDays(monday, 3)),
    allDay: true,
  });
  events.push({
    key: `${SRC}:birthday`,
    seriesKey: `${SRC}:birthday`,
    sourceId: SRC,
    calendar: 'Personal',
    title: "Mom's birthday",
    start: dayKey(addDays(monday, 6)),
    end: dayKey(addDays(monday, 7)),
    allDay: true,
  });

  const assign = (id: string, title: string, course: string, due: number, extra: Partial<Assignment> = {}): string => {
    const key = `canvas:assignment:${SRC}-${id}`;
    assignments.push({ key, sourceId: SRC, title, course, dueAt: iso(due), allDay: false, submitted: false, type: 'assignment', ...extra });
    return key;
  };
  for (let w = -1; w <= 4; w++) {
    assign(`ps${w + 6}`, `Problem Set ${w + 6}`, 'CALC II', at(w, 3, 18), { points: 20, submitted: w < 0 });
    assign(`quiz${w + 6}`, `Reading quiz ${w + 6}`, 'WRITING 102', at(w, 1, 9), { type: 'quiz', points: 5, submitted: w <= 0 });
  }
  const essay = assign('essay', 'Essay draft', 'WRITING 102', at(0, 4, 17), { points: 100 });
  overlay[essay] = { important: true, effortMin: 150 };
  const project = assign('project3', 'Project 3 checkpoint', 'CS 201', at(0, 6, 23, 59), { points: 50 });
  overlay[project] = { effortMin: 120 };
  // Canvas's default due time piles several assignments onto the same 11:59 PM slot.
  assign('disc4', 'Discussion post 4', 'WRITING 102', at(0, 3, 23, 59), { type: 'discussion_topic', points: 10 });
  assign('labquiz5', 'Lab quiz 5', 'CS 201', at(0, 3, 23, 59), { type: 'quiz', points: 10 });
  assign('hw7', 'Homework 7', 'PHYS 102', at(0, 3, 23, 59), { points: 15 });
  // Something due soon, so the "due soon" analysis has a live example.
  const soon = Math.ceil((now + 3.5 * HOUR) / (30 * MIN)) * 30 * MIN;
  const lab = assign('lab5', 'Lab 5 report', 'CS 201', soon, { points: 30 });
  overlay[lab] = { effortMin: 120 };

  const task = (id: string, title: string, durationMin: number, due: number, deadline: number, extra: Partial<Task> = {}): string => {
    const tid = `task:demo-${id}`;
    tasks.push({ id: tid, title, durationMin, preferredDue: iso(due), finalDeadline: iso(deadline), createdAt: iso(now), ...extra });
    return tid;
  };
  task('advisor', 'Email advisor', 30, at(0, 1, 9, 30), at(0, 1, 17), { category: 'School' });
  task('laundry', 'Laundry', 60, at(0, 5, 12), at(0, 6, 20), { category: 'Errands' });
  const review = task('review', 'Midterm review', 180, at(0, 6, 19), at(1, 0, 9), { category: 'School', location: 'Science Library, 4th floor' });
  overlay[review] = { important: true };
  const reading = task('reading', 'Optional reading', 60, at(0, 2, 13), at(0, 4, 23), { category: 'School' });
  overlay[reading] = { muted: true };
  task('planning', 'Weekly planning', 30, at(-1, 6, 20), at(-1, 6, 22), { category: 'Personal', recurrence: { freq: 'weekly' } });
  task('rent', 'Pay rent', 15, at(0, 4, 12), at(0, 5, 17), { category: 'Errands', url: 'https://example.com/portal' });

  return { events, assignments, tasks, overlay, weather: demoWeather(now, units) };
}

function demoWeather(now: number, units: TempUnit): WeatherCache {
  // One entry per day, from PAST_DAYS ago through the last forecast day (index PAST_DAYS is today).
  const codes = [3, 2, 61, 1, 0, 2, 1, 3, 63, 61, 2, 0, 1, 3, 45, 2, 0, 80, 3, 2, 0, 1];
  const meansF = [62, 64, 59, 63, 65, 63, 66, 61, 57, 58, 62, 67, 68, 64, 59, 61, 65, 60, 62, 64, 66, 67];
  const rains = [15, 10, 70, 5, 0, 10, 5, 20, 85, 60, 15, 0, 5, 25, 10, 10, 0, 55, 20, 10, 5, 5];
  const uvs = [3, 4, 2, 5, 5, 4, 5, 3, 1, 2, 4, 5, 5, 3, 2, 4, 5, 2, 3, 4, 5, 5];
  const conv = (f: number): number => (units === 'celsius' ? Math.round(((f - 32) * 5) / 9 * 10) / 10 : f);
  const first = addDays(startOfDay(now), -PAST_DAYS);
  const days: DayWeather[] = [];
  const hours: HourWeather[] = [];
  for (let i = 0; i < Math.min(codes.length, PAST_DAYS + FORECAST_DAYS); i++) {
    const day = addDays(first, i);
    const key = dayKey(day);
    days.push({
      date: key,
      mean: conv(meansF[i]),
      max: conv(meansF[i] + 7),
      min: conv(meansF[i] - 8),
      rain: rains[i],
      uv: uvs[i],
      code: codes[i],
      sunrise: `${key}T06:24`,
      sunset: `${key}T16:51`,
    });
    // Hour by hour from yesterday, as the real forecast keeps it.
    if (i >= PAST_DAYS - 1 && i < PAST_DAYS + 7) {
      for (let h = 0; h < 24; h++) {
        const swing = Math.cos(((h - 15) / 24) * 2 * Math.PI) * 7.5;
        const light = h >= 7 && h <= 17;
        hours.push({
          t: `${key}T${String(h).padStart(2, '0')}:00`,
          temp: conv(Math.round(meansF[i] + swing)),
          rain: Math.max(0, Math.min(100, rains[i] + (h % 6) * 3 - 8)),
          uv: light ? Math.max(0, Math.round(uvs[i] * Math.sin(((h - 6) / 12) * Math.PI))) : 0,
          code: codes[i],
        });
      }
    }
  }
  return {
    fetchedAt: new Date(now).toISOString(),
    place: { name: 'Springfield', region: 'Sample data', country: 'Sample data', lat: 39.7817, lon: -89.6501 },
    units,
    days,
    hours,
  };
}

/** Removes everything buildDemo added, leaving the user's own data alone. */
export function stripDemo(d: Persisted): void {
  const demoTaskIds = new Set(d.tasks.filter((t) => t.id.startsWith('task:demo-')).map((t) => t.id));
  d.tasks = d.tasks.filter((t) => !demoTaskIds.has(t.id));
  d.events = d.events.filter((e) => e.sourceId !== SRC);
  d.assignments = d.assignments.filter((a) => a.sourceId !== SRC);
  for (const key of Object.keys(d.overlay)) {
    if (key.startsWith(`${SRC}:`) || key.includes(`:${SRC}-`) || key.startsWith('task:demo-')) delete d.overlay[key];
  }
  d.suppressed.ids = d.suppressed.ids.filter((s) => !s.key.startsWith(`${SRC}:`) && !s.key.includes(`:${SRC}-`) && !s.key.startsWith('task:demo-'));
  if (d.weather?.place.country === 'Sample data') d.weather = null;
  d.demo = false;
}

export function applyDemo(d: Persisted, now: number): void {
  stripDemo(d);
  const demo = buildDemo(now, d.settings.weather.units);
  d.events.push(...demo.events);
  d.assignments.push(...demo.assignments);
  d.tasks.push(...demo.tasks);
  Object.assign(d.overlay, demo.overlay);
  // Never replace a real forecast with sample weather.
  if (!d.weather || !d.settings.weather.place) d.weather = demo.weather;
  d.demo = true;
}
