// The "due soon" list: everything that needs starting, most pressing first.

import { useLayoutEffect, useRef, useState } from 'react';
import type { Analysis, UrgencyLevel } from '../../../shared/urgency';
import { analysisFacts, levelLabel } from '../lib/format';
import { KindGlyph } from '../ui/icons';

const ORDER: Record<UrgencyLevel, number> = { overdue: 0, behind: 1, now: 2, soon: 3, ok: 4 };
const UPCOMING_MS = 48 * 3_600_000;

export function dueList(analyses: Analysis[], now: number): { urgent: Analysis[]; upcoming: Analysis[] } {
  const urgent = analyses.filter((a) => a.level !== 'ok').sort((a, b) => ORDER[a.level] - ORDER[b.level] || a.startBy - b.startBy);
  const upcoming = analyses.filter((a) => a.level === 'ok' && a.deadline - now <= UPCOMING_MS).sort((a, b) => a.deadline - b.deadline);
  return { urgent, upcoming };
}

export function DuePopover({
  analyses,
  anchor,
  now,
  hour12,
  onPick,
  onClose,
}: {
  analyses: Analysis[];
  anchor: DOMRect | null;
  now: number;
  hour12: boolean;
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const { urgent, upcoming } = dueList(analyses, now);
  const rows = [...urgent, ...upcoming];

  useLayoutEffect(() => {
    const width = ref.current?.offsetWidth ?? 380;
    const right = anchor ? anchor.right : window.innerWidth - 28;
    const top = anchor ? anchor.bottom + 8 : 100;
    setPos({ left: Math.max(8, Math.min(right - width, window.innerWidth - width - 8)), top });
    ref.current?.querySelector<HTMLElement>('.due-row')?.focus();
  }, [anchor]);

  let lede = 'Nothing is due in the next two days.';
  if (urgent.length > 0) {
    const more = upcoming.length ? `, and ${upcoming.length} more due in the next two days` : '';
    lede = `${urgent.length} ${urgent.length === 1 ? 'thing needs' : 'things need'} attention${more}.`;
  } else if (upcoming.length > 0) {
    lede = `Nothing is pressing. ${upcoming.length} due in the next two days.`;
  }

  return (
    <div
      className="menu-layer"
      onMouseDown={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        ref={ref}
        className="popover"
        role="dialog"
        aria-label="Due soon"
        style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3>Due soon</h3>
        <p className="lede">{lede}</p>
        {rows.length > 0 && (
          <div className="list">
            {rows.map((a) => (
              <button key={a.key} type="button" className={`due-row k-${a.kind}-row`} onClick={() => onPick(a.key)}>
                <span className={`k-${a.kind}`} style={{ paddingTop: 2, background: 'none', boxShadow: 'none', outline: 'none' }}>
                  <KindGlyph item={{ kind: a.kind, done: false }} size={13} />
                </span>
                <span className="main">
                  <span className="name" style={{ display: 'block' }}>
                    {a.title}
                  </span>
                  <span className="facts">
                    {/* Non-breaking inside each phrase, so lines only break after a "·". */}
                    {analysisFacts(a, now, hour12)
                      .map((f) => f.replace(/ /g, ' '))
                      .join(' · ')}
                  </span>
                </span>
                <span className={`badge ${a.level}`}>{levelLabel(a, now, hour12)}</span>
              </button>
            ))}
          </div>
        )}
        <p className="hint" style={{ margin: '10px 8px 0' }}>
          Counts the free time between your events, outside quiet hours, with estimates padded as set in Settings.
        </p>
      </div>
    </div>
  );
}
