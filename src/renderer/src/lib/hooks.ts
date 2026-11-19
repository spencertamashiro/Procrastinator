import { useEffect, useState } from 'react';

/** The current time, refreshed every few seconds and whenever the window comes back into view. */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = (): void => setNow(Date.now());
    const id = setInterval(tick, intervalMs);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [intervalMs]);
  return now;
}

const DARK = '(prefers-color-scheme: dark)';

/** Whether the page is drawn dark. Follows the theme chosen in Settings (the main process sets it). */
export function usePrefersDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia(DARK).matches);
  useEffect(() => {
    const mq = window.matchMedia(DARK);
    const onChange = (): void => setDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return dark;
}

export function prefersDark(): boolean {
  return window.matchMedia(DARK).matches;
}
