import { CloudOff, Moon, RefreshCw, Settings as SettingsIcon, Sun, TriangleAlert } from 'lucide-react';
import { fmtTime, fmtWeekday } from '../../../shared/time';

export function TitleBar({
  now,
  hour12,
  dark,
  offline,
  problem,
  syncing,
  onToggleTheme,
  onSettings,
}: {
  now: number;
  hour12: boolean;
  dark: boolean;
  offline: boolean;
  /** A source failed for a reason other than being offline. */
  problem: string | null;
  syncing: boolean;
  onToggleTheme: () => void;
  onSettings: () => void;
}) {
  let status = null;
  if (offline) {
    status = (
      <span className="offline small" title="Showing the copy saved on this computer">
        <CloudOff size={13} aria-hidden /> Offline
      </span>
    );
  } else if (syncing) {
    status = (
      <span className="offline small">
        <RefreshCw size={12} aria-hidden /> Syncing
      </span>
    );
  } else if (problem) {
    status = (
      <button type="button" className="offline small" title={problem} onClick={onSettings}>
        <TriangleAlert size={12} aria-hidden /> Sync issue
      </button>
    );
  }
  return (
    <header className="titlebar">
      <div className="wordmark">Procrastinator</div>
      <div className="right">
        {status}
        <span className="clock small">
          {fmtWeekday(now)} · {fmtTime(now, hour12)}
        </span>
        <button
          type="button"
          className="icon-btn"
          aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          title={dark ? 'Light mode' : 'Dark mode'}
          onClick={onToggleTheme}
        >
          {dark ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button type="button" className="icon-btn" aria-label="Settings" title="Settings (Ctrl+,)" onClick={onSettings}>
          <SettingsIcon size={15} />
        </button>
      </div>
    </header>
  );
}
