// How one item looks: a timed block on the hourly grid, a chip in the all-day lane,
// or a one-line row in the month view. Clicking or right-clicking opens its menu.

import { Star } from 'lucide-react';
import type { MouseEvent } from 'react';
import type { Placed, PlannerItem } from '../../../shared/items';
import type { Analysis } from '../../../shared/urgency';
import { fmtBare, fmtClock, itemMeta } from '../lib/format';
import { KindGlyph } from '../ui/icons';

export type OpenItem = (item: PlannerItem, x: number, y: number) => void;

const URGENT = new Set(['now', 'behind', 'overdue']);

export function itemClasses(item: PlannerItem, extra: (string | false | undefined)[] = []): string {
  return [`k-${item.kind}`, item.important && 'important', item.muted && 'muted', item.done && 'done', ...extra].filter(Boolean).join(' ');
}

function handlers(item: PlannerItem, onOpen: OpenItem) {
  const open = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    onOpen(item, e.clientX, e.clientY);
  };
  return { onClick: open, onContextMenu: open, onDoubleClick: (e: MouseEvent) => e.stopPropagation() };
}

export function Block({
  placed,
  hourPx,
  now,
  hour12,
  analysis,
  flash,
  onOpen,
}: {
  placed: Placed;
  hourPx: number;
  now: number;
  hour12: boolean;
  analysis?: Analysis;
  flash: boolean;
  onOpen: OpenItem;
}) {
  const { item, top, height, col, cols } = placed;
  const px = (height / 60) * hourPx;
  const urgent = !!analysis && URGENT.has(analysis.level) && !item.muted;
  const meta = itemMeta(item, now, hour12);
  const cls = itemClasses(item, [
    'item',
    px < 38 && 'tight',
    placed.continuesBefore && 'cut-top',
    placed.continuesAfter && 'cut-bottom',
    flash && 'flash',
  ]);
  return (
    <button
      type="button"
      className={cls}
      data-key={item.key}
      title={`${item.title}\n${meta}`}
      style={{
        top: `calc(var(--hour) * ${top / 60})`,
        height: `calc(var(--hour) * ${height / 60} - 2px)`,
        left: `calc(${(col / cols) * 100}% + 3px)`,
        width: `calc(${100 / cols}% - 6px)`,
        paddingRight: urgent ? 16 : undefined,
      }}
      {...handlers(item, onOpen)}
    >
      {item.kind === 'event' && <span className="bar" />}
      <span className="body">
        <span className="title-row">
          <KindGlyph item={item} />
          <span className="title">{item.title}</span>
          {item.important && <Star className="star" size={10} fill="currentColor" aria-label="Important" />}
        </span>
        <span className="meta">{meta}</span>
        {px >= 76 && item.kind !== 'event' && item.location && <span className="meta">{item.location}</span>}
      </span>
      {urgent && <span className="urgent-dot" aria-label="Needs attention" />}
    </button>
  );
}

/** All-day lane chip. Assignments due at the end of the day show as chips too. */
export function Chip({ item, hour12, flash, onOpen }: { item: PlannerItem; hour12: boolean; flash: boolean; onOpen: OpenItem }) {
  const label = item.kind === 'assignment' && !item.allDay && item.due ? `${item.title} · ${fmtClock(item.due, hour12)}` : item.title;
  return (
    <button type="button" className={itemClasses(item, ['chip', flash && 'flash'])} data-key={item.key} title={label} {...handlers(item, onOpen)}>
      <KindGlyph item={item} />
      <span className="title">{label}</span>
      {item.important && <Star className="star" size={10} fill="currentColor" aria-label="Important" />}
    </button>
  );
}

/** Month view row. */
export function MonthRow({ item, hour12, flash, onOpen }: { item: PlannerItem; hour12: boolean; flash: boolean; onOpen: OpenItem }) {
  const at = item.kind === 'event' ? item.start : (item.due ?? item.start);
  const time = item.allDay ? '' : fmtBare(at, hour12);
  return (
    <button type="button" className={itemClasses(item, ['m-row', flash && 'flash'])} data-key={item.key} title={item.title} {...handlers(item, onOpen)}>
      <KindGlyph item={item} size={10} />
      <span className="title">{item.title}</span>
      {time && <span className="time">{time}</span>}
    </button>
  );
}
