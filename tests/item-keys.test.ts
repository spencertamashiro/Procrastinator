import { describe, it, expect, vi } from 'vitest';
import { isItemKey, MAX_KEY_LENGTH } from '../src/main/actions';

describe('isItemKey', () => {
  it.each(['task:123', 'google:calendar:event', 'feed:abc:uid@2026-11-16T12:00:00.000Z', 'canvas:assignment:1', 'task:constructor'])(
    'accepts valid key %s', (key) => expect(isItemKey(key)).toBe(true),
  );
  it('accepts exactly MAX_KEY_LENGTH characters', () => expect(isItemKey('x'.repeat(MAX_KEY_LENGTH))).toBe(true));
  it('rejects more than MAX_KEY_LENGTH characters', () => expect(isItemKey('x'.repeat(MAX_KEY_LENGTH + 1))).toBe(false));
  it.each([null, undefined, 1, false, {}, [], new String('task:1')].map((key) => [key]))('rejects non-string %j', (key) => {
    expect(isItemKey(key)).toBe(false);
  });
  it('rejects the empty string', () => expect(isItemKey('')).toBe(false));
  it.each(['__proto__', 'constructor', 'prototype'])('rejects prototype key %s', (key) => {
    expect(isItemKey(key)).toBe(false);
  });
  it('does not coerce an object into a key', () => {
    const toString = vi.fn(() => 'task:1');
    expect(isItemKey({ toString })).toBe(false);
    expect(toString).not.toHaveBeenCalled();
  });
});
