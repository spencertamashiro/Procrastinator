import { describe, it, expect, vi } from 'vitest';
import { clip, webUrl, shortId, LIMITS } from '../src/shared/sanitize';

describe('clip', () => {
  it.each([undefined, null, 42, false, {}, [], '', ' \t\n '].map((value) => [value]))('drops non-text or blank input %j', (value) => {
    expect(clip(value, 10)).toBeUndefined();
  });
  it('trims surrounding whitespace', () => expect(clip('  hello \n', 10)).toBe('hello'));
  it('cuts text to max', () => expect(clip('abcdef', 5)).toBe('abcde'));
  it('keeps exactly max characters', () => expect(clip('abcde', 5)).toBe('abcde'));
  it('does not coerce objects into text', () => {
    const toString = vi.fn(() => 'secret');
    expect(clip({ toString }, 10)).toBeUndefined();
    expect(toString).not.toHaveBeenCalled();
  });
});

describe('webUrl', () => {
  it.each(['http://EXAMPLE.com:80', 'https://EXAMPLE.com:443/a/../b?q=1'])('keeps the normalised href for %s', (value) => {
    expect(webUrl(value)).toBe(new URL(value).href);
  });
  it.each(['javascript:alert(1)', 'data:text/plain,hello', 'file:///secret', 'mailto:a@example.com',
    '/relative', '//host/x', 'not an address', '', undefined, null, 12, {}, []].map((value) => [value]))('drops unsafe or invalid input %j', (value) => {
    expect(webUrl(value)).toBeUndefined();
  });
  it('rejects addresses longer than the URL limit', () => {
    expect(webUrl(`https://example.com/${'a'.repeat(LIMITS.url)}`)).toBeUndefined();
  });
  it('ignores surrounding spaces', () => expect(webUrl('  https://example.com/x  ')).toBe('https://example.com/x'));
});

describe('shortId', () => {
  it.each(['', 'event-1', 'x'.repeat(LIMITS.id)])('keeps an id within the limit unchanged', (id) => {
    expect(shortId(id)).toBe(id);
  });
  it('bounds long identifiers', () => expect(shortId('x'.repeat(5000)).length).toBeLessThanOrEqual(LIMITS.id));
  it('shortens the same identifier consistently', () => {
    const id = 'x'.repeat(5000);
    expect(shortId(id)).toBe(shortId(id));
  });
  it('distinguishes identifiers with a long shared prefix', () => {
    const prefix = 'x'.repeat(5000);
    expect(shortId(`${prefix}a`)).not.toBe(shortId(`${prefix}b`));
  });
});
