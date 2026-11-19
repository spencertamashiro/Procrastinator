import { describe, it, expect } from 'vitest';
import { diceSimilarity, isSimilarTitle, normalizeTitle, patternsMatch, ruleFor, ruleMatches } from '../src/shared/similarity';

describe('title normalization and matching', () => {
  it.each([
    [' Problem Set 6 [MATH 3A] ', 'problem set #'],
    ['Review November 14th 2026-11-14 11/14', 'review'],
    ['Café: Exercise 3.2 / 4', 'cafe exercise #'],
    ['  QUIZ!!!   12  ', 'quiz #'],
    ['', ''],
  ])('normalizes %s', (raw, expected) => expect(normalizeTitle(raw)).toBe(expected));

  it('matches numbered problem sets', () => {
    expect(isSimilarTitle('Problem Set 6', 'Problem Set 12')).toBe(true);
  });

  it.each([['Homework 3', 'Quiz 3'], ['Read the textbook', 'Write the essay'], ['Midterm review', 'Final project']])(
    'does not match differently-worded titles %s and %s', (a, b) => expect(isSimilarTitle(a, b)).toBe(false),
  );

  it('allows near-identical long patterns but never fuzzy-matches very short ones', () => {
    expect(patternsMatch('assignment review', 'assignments review')).toBe(true);
    expect(patternsMatch('abc', 'abcd')).toBe(false);
    expect(patternsMatch('a', 'b')).toBe(false);
    expect(patternsMatch('', '')).toBe(false);
    expect(patternsMatch('abc', 'abc')).toBe(true);
  });

  it('builds rules from normalized titles and respects kind and scope', () => {
    const rule = ruleFor({ title: 'Problem Set 6', kind: 'assignment', scope: 'Math' });
    expect(rule).toEqual({ pattern: 'problem set #', kind: 'assignment', scope: 'Math', sample: 'Problem Set 6' });
    expect(ruleMatches(rule, { title: 'Problem Set 12', kind: 'assignment', scope: 'Math' })).toBe(true);
    expect(ruleMatches(rule, { title: 'Problem Set 12', kind: 'task', scope: 'Math' })).toBe(false);
    expect(ruleMatches(rule, { title: 'Problem Set 12', kind: 'assignment', scope: 'Physics' })).toBe(false);
    expect(ruleMatches(rule, { title: 'Problem Set 12', kind: 'assignment' })).toBe(false);
    expect(ruleMatches({ ...rule, scope: '' }, { title: 'Problem Set 12', kind: 'assignment', scope: 'Physics' })).toBe(true);
    expect(ruleMatches(rule, { title: 'unused', kind: 'assignment', scope: 'Math' }, 'problem set #')).toBe(true);
  });

  it('keeps Dice similarity symmetric and bounded, including repeated bigrams', () => {
    for (const a of ['', 'a', 'aaaa', 'homework', 'problem set #']) {
      for (const b of ['', 'z', 'aa', 'homework', 'quiz #']) {
        const score = diceSimilarity(a, b);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
        expect(score).toBe(diceSimilarity(b, a));
      }
    }
    expect(diceSimilarity('same', 'same')).toBe(1);
    expect(diceSimilarity('ab', 'cd')).toBe(0);
    expect(diceSimilarity('aaaa', 'aa')).toBe(0.5);
    expect(diceSimilarity('a', 'b')).toBe(0);
  });
});
