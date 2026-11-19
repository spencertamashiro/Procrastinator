import { describe, it, expect, vi } from 'vitest';
import { partialWarning } from '../src/main/sync';

describe('partialWarning', () => {
  it('returns no warning when nothing was omitted', () => {
    expect(partialWarning(false, 0)).toBeUndefined();
  });
  it('explains a truncated calendar', () => {
    expect(partialWarning(true, 0)).toBe('This calendar is unusually large, so some repeating events were left out.');
  });
  it('uses singular wording for one skipped event', () => {
    expect(partialWarning(false, 1)).toBe('1 event could not be read and was left out.');
  });
  it('uses plural wording for several skipped events', () => {
    expect(partialWarning(false, 3)).toBe('3 events could not be read and were left out.');
  });
  it('includes both truncation and skipped-event warnings', () => {
    expect(partialWarning(true, 2)).toBe('This calendar is unusually large, so some repeating events were left out. 2 events could not be read and were left out.');
  });
  it('returns the warning without logging it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(partialWarning(false, 1)).toBeDefined();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
