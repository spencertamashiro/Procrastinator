// Canvas LMS planner mapping (GET /api/v1/planner/items).

import { clip, LIMITS, shortId, webUrl } from './sanitize';
import { dayKey } from './time';
import type { Assignment } from './types';

const GRADED_TYPES = new Set(['assignment', 'quiz', 'discussion_topic', 'sub_assignment']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** "canvas.school.edu/courses/1" -> "https://canvas.school.edu". Null when not a usable web address. */
export function normalizeBaseUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (u.protocol !== 'https:') return null; // a token must never travel over plain http
    return u.origin;
  } catch {
    return null;
  }
}

export function plannerUrl(baseUrl: string, start: number, end: number): string {
  const q = new URLSearchParams({ start_date: dayKey(start), end_date: dayKey(end), per_page: '50' });
  return `${baseUrl}/api/v1/planner/items?${q}`;
}

/** The rel="next" URL from a Link header, if any. */
export function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="?next"?/.exec(part);
    if (m) return m[1];
  }
  return null;
}

/** Maps planner items to assignments, skipping announcements, notes and anything without a due date. */
export function mapPlannerItems(items: unknown, baseUrl: string): Assignment[] {
  if (!Array.isArray(items)) return [];
  const out: Assignment[] = [];
  for (const it of items) {
    if (!isRecord(it)) continue;
    const type = typeof it.plannable_type === 'string' ? it.plannable_type : '';
    if (!GRADED_TYPES.has(type)) continue;
    const plannable = isRecord(it.plannable) ? it.plannable : {};
    const dueRaw = typeof plannable.due_at === 'string' ? plannable.due_at : typeof it.plannable_date === 'string' ? it.plannable_date : '';
    const due = Date.parse(dueRaw);
    if (!Number.isFinite(due)) continue;
    const rawId = it.plannable_id ?? plannable.id;
    if (typeof rawId !== 'string' && typeof rawId !== 'number') continue;
    const id = shortId(String(rawId));
    const sub = isRecord(it.submissions) ? it.submissions : null;
    const override = isRecord(it.planner_override) ? it.planner_override : null;
    const submitted = !!(sub && (sub.submitted || sub.graded || sub.excused)) || !!override?.marked_complete;
    // Canvas gives a path on the school's site ("/courses/1/assignments/2"), occasionally a full address.
    const htmlUrl = typeof it.html_url === 'string' ? it.html_url.trim() : '';
    out.push({
      key: `canvas:${type === 'sub_assignment' ? 'assignment' : type}:${id}`,
      sourceId: 'canvas',
      title: clip(plannable.title, LIMITS.title) ?? '(untitled)',
      course: clip(it.context_name, LIMITS.course),
      dueAt: new Date(due).toISOString(),
      allDay: false,
      url: htmlUrl.startsWith('/') && !htmlUrl.startsWith('//') ? webUrl(`${baseUrl}${htmlUrl}`) : webUrl(htmlUrl),
      points: typeof plannable.points_possible === 'number' ? plannable.points_possible : undefined,
      submitted,
      missing: sub ? !!sub.missing : undefined,
      type,
    });
  }
  return out;
}
