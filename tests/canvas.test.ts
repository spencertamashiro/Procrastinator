import { describe, it, expect } from 'vitest';
import { normalizeBaseUrl, plannerUrl, nextLink, mapPlannerItems } from '../src/shared/canvas';

const baseUrl = 'https://canvas.school.example';
const due = '2026-11-16T18:00:00.000Z';
function item(overrides: Record<string, unknown> = {}) {
  return { plannable_type: 'assignment', plannable_id: 123, context_name: 'MATH 3A',
    plannable: { title: ' Problem Set 6 ', due_at: due, points_possible: 20 },
    html_url: '/courses/1/assignments/123', submissions: false, ...overrides };
}

describe('normalizeBaseUrl', () => {
  it.each(['canvas.school.example/courses/1', ' https://canvas.school.example/courses/1?x=1#top '])('normalizes %s to its HTTPS origin', (input) => {
    expect(normalizeBaseUrl(input)).toBe(baseUrl);
  });
  it.each(['http://canvas.school.example', 'not a url', '://', ''])('rejects %s', (input) => {
    expect(normalizeBaseUrl(input)).toBeNull();
  });
});

describe('plannerUrl', () => {
  it('uses local date keys and requests fifty items', () => {
    const url = new URL(plannerUrl(baseUrl, new Date(2026, 10, 16, 0, 0).getTime(), new Date(2026, 10, 23, 0, 0).getTime()));
    expect(url.origin + url.pathname).toBe(`${baseUrl}/api/v1/planner/items`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ start_date: '2026-11-16', end_date: '2026-11-23', per_page: '50' });
  });
});

describe('nextLink', () => {
  it('finds next among multiple Link relations', () => {
    expect(nextLink(`<${baseUrl}/items?page=1>; rel="current", <${baseUrl}/items?page=2>; rel="next", <${baseUrl}/items?page=9>; rel="last"`)).toBe(`${baseUrl}/items?page=2`);
  });
  it.each([null, '', `<${baseUrl}/items?page=1>; rel="prev"`])('returns null when there is no next link: %s', (header) => {
    expect(nextLink(header)).toBeNull();
  });
});

describe('mapPlannerItems', () => {
  it.each(['assignment', 'quiz', 'discussion_topic'])('maps graded type %s with a relative URL and false submissions', (type) => {
    expect(mapPlannerItems([item({ plannable_type: type })], baseUrl)).toEqual([{
      key: `canvas:${type}:123`, sourceId: 'canvas', title: 'Problem Set 6', course: 'MATH 3A',
      dueAt: due, allDay: false, url: `${baseUrl}/courses/1/assignments/123`, points: 20,
      submitted: false, missing: undefined, type,
    }]);
  });
  it.each(['announcement', 'calendar_event', 'planner_note'])('skips %s', (type) => {
    expect(mapPlannerItems([item({ plannable_type: type })], baseUrl)).toEqual([]);
  });
  it.each(['submitted', 'graded', 'excused'])('marks submissions.%s as submitted', (flag) => {
    expect(mapPlannerItems([item({ submissions: { [flag]: true, missing: false } })], baseUrl)[0]).toMatchObject({ submitted: true, missing: false });
  });
  it('honors a marked-complete planner override', () => {
    expect(mapPlannerItems([item({ planner_override: { marked_complete: true } })], baseUrl)[0].submitted).toBe(true);
  });
  it('keeps false submission flags incomplete and maps missing status', () => {
    expect(mapPlannerItems([item({ submissions: { submitted: false, graded: false, excused: false, missing: true } })], baseUrl)[0]).toMatchObject({ submitted: false, missing: true });
  });
  it('falls back to plannable_date and the nested ID', () => {
    const result = mapPlannerItems([item({ plannable_id: undefined, plannable_date: '2026-11-16T10:00:00-08:00',
      plannable: { id: 456, title: 'Quiz' } })], baseUrl);
    expect(result[0]).toMatchObject({ key: 'canvas:assignment:456', dueAt: due, title: 'Quiz' });
  });
  it('preserves absolute HTML URLs and normalizes sub-assignment keys', () => {
    expect(mapPlannerItems([item({ plannable_type: 'sub_assignment', html_url: 'https://other.example/assignment' })], baseUrl)[0]).toMatchObject({
      key: 'canvas:assignment:123', type: 'sub_assignment', url: 'https://other.example/assignment',
    });
  });
  it('skips missing or invalid due dates, missing IDs and malformed items', () => {
    expect(mapPlannerItems([
      item({ plannable: { title: 'No date' } }), item({ plannable: { due_at: 'soon' } }),
      item({ plannable_id: undefined }), null, 'invalid', {},
    ], baseUrl)).toEqual([]);
  });
  it('uses an untitled fallback for blank titles', () => {
    expect(mapPlannerItems([item({ plannable: { title: '  ', due_at: due } })], baseUrl)[0].title).toBe('(untitled)');
  });
  it.each([null, {}, 'invalid'])('returns an empty array for non-array %j', (input) => {
    expect(mapPlannerItems(input, baseUrl)).toEqual([]);
  });
});
