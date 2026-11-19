// Title matching for "delete all like this". Deliberately strict: numbered series
// ("Problem Set 6" / "Problem Set 7") match, differently-worded titles do not.

import type { ItemKind, SuppressRule } from './types';

const MONTHS =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const MONTH_DAY = new RegExp(`\\b${MONTHS}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, 'g');

/**
 * Reduces a title to its series shape: case, accents, punctuation, dates and
 * numbers are removed, with every number collapsed to `#`.
 * "Problem Set 6 [MATH 3A]" -> "problem set #"
 */
export function normalizeTitle(raw: string): string {
  let s = raw.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  s = s.replace(/\[[^\]]*\]\s*$/g, ' '); // trailing [course code]
  s = s.replace(MONTH_DAY, ' ');
  s = s.replace(/\b\d{1,4}[/-]\d{1,2}(?:[/-]\d{1,4})?\b/g, ' '); // 11/14, 2026-11-14
  s = s.replace(/\d+(?:\.\d+)*[a-z]?\b/g, '#'); // 6, 3.2, 3a
  s = s.replace(/[^a-z0-9#]+/g, ' ');
  s = s.replace(/#(?:\s*#)+/g, '#');
  return s.trim().replace(/\s+/g, ' ');
}

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  const t = s.replace(/\s+/g, '');
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Sørensen–Dice coefficient over character bigrams, 0..1. */
export function diceSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  let sizeA = 0;
  let sizeB = 0;
  let shared = 0;
  for (const n of A.values()) sizeA += n;
  for (const n of B.values()) sizeB += n;
  if (sizeA === 0 || sizeB === 0) return 0;
  for (const [g, n] of A) shared += Math.min(n, B.get(g) ?? 0);
  return (2 * shared) / (sizeA + sizeB);
}

export const SIMILARITY_THRESHOLD = 0.9;

/** True when two already-normalised titles are the same or near-identical. */
export function patternsMatch(a: string, b: string): boolean {
  if (a === b) return a.length > 0;
  if (a.length < 4 || b.length < 4) return false;
  return diceSimilarity(a, b) >= SIMILARITY_THRESHOLD;
}

export function isSimilarTitle(a: string, b: string): boolean {
  return patternsMatch(normalizeTitle(a), normalizeTitle(b));
}

export interface RuleTarget {
  title: string;
  kind: ItemKind;
  scope?: string;
}

export function ruleFor(target: RuleTarget): Pick<SuppressRule, 'pattern' | 'kind' | 'scope' | 'sample'> {
  return {
    pattern: normalizeTitle(target.title),
    kind: target.kind,
    scope: target.scope || undefined,
    sample: target.title,
  };
}

/** Whether a stored rule hides the given item. `normalized` lets callers reuse a cached normalisation. */
export function ruleMatches(
  rule: Pick<SuppressRule, 'pattern' | 'kind' | 'scope'>,
  target: RuleTarget,
  normalized: string = normalizeTitle(target.title),
): boolean {
  if (rule.kind !== target.kind) return false;
  if (rule.scope && rule.scope !== (target.scope ?? '')) return false;
  return patternsMatch(rule.pattern, normalized);
}
