// Limits for text that arrives from outside services (calendar feeds, Google, Canvas,
// iCloud, weather search), so a hostile or broken source cannot bloat the saved data or
// slip in a link that is not a web page.

export const LIMITS = {
  title: 300,
  location: 300,
  calendar: 100,
  course: 100,
  place: 100,
  url: 2048,
  /** Identifiers longer than this are replaced by a short hash (they become item keys). */
  id: 200,
} as const;

/** Trimmed text cut to `max` characters, or undefined when it is not text or is empty. */
export function clip(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const s = value.trim();
  if (!s) return undefined;
  return s.length > max ? s.slice(0, max) : s;
}

/** An http(s) address of sensible length, or undefined. Anything else (javascript:, file:, ...) is dropped. */
export function webUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const s = value.trim();
  if (!s || s.length > LIMITS.url) return undefined;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/** Two 32-bit FNV-1a hashes with different seeds, as hex. Not cryptographic; only for stable short keys. */
function hash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x01000193) ^ (b >>> 13);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

/** The identifier itself, or a stable shortened form when it is unreasonably long. */
export function shortId(id: string, max: number = LIMITS.id): string {
  return id.length <= max ? id : `${id.slice(0, 64)}#${hash(id)}`;
}
