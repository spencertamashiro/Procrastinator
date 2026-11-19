// Right-click (or click) menu for one item: flags, time estimate, edit, open, delete.

import { BellOff, Bell, Check, CopyX, ExternalLink, ListX, Pencil, Star, Undo2, X, type LucideIcon } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { PlannerItem } from '../../../shared/items';
import { fmtDuration, fmtWhen } from '../../../shared/time';
import type { Analysis } from '../../../shared/urgency';
import { analysisFacts, fmtBare, levelLabel } from '../lib/format';

const EFFORT = [15, 30, 60, 120, 180];
const effortLabel = (m: number): string => (m < 60 ? `${m}m` : `${m / 60}h`);

export interface MenuActions {
  important: () => void;
  mute: () => void;
  done: (() => void) | null;
  effort: ((min: number) => void) | null;
  edit: (() => void) | null;
  open: (() => void) | null;
  deleteOne: () => void;
  deleteSeries: (() => void) | null;
  deleteSimilar: () => void;
}

function MenuItem({
  icon: Icon,
  label,
  sub,
  kbd,
  on,
  alert,
  onSelect,
}: {
  icon: LucideIcon;
  label: string;
  sub?: string;
  kbd?: string;
  on?: boolean;
  alert?: boolean;
  onSelect: () => void;
}) {
  return (
    <button type="button" role="menuitem" className={`menu-item${on ? ' on' : ''}${alert ? ' alert' : ''}`} onClick={onSelect}>
      <Icon size={15} fill={on && Icon === Star ? 'currentColor' : 'none'} />
      <span className="text">
        {label}
        {sub && <span className="sub">{sub}</span>}
      </span>
      {kbd && <kbd>{kbd}</kbd>}
    </button>
  );
}

export function ContextMenu({
  item,
  x,
  y,
  analysis,
  now,
  hour12,
  actions,
  onClose,
}: {
  item: PlannerItem;
  x: number;
  y: number;
  analysis?: Analysis;
  now: number;
  hour12: boolean;
  actions: MenuActions;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y, ready: false });

  // Keep the menu on screen, flipping left/up when there is no room.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const margin = 8;
    let left = x + 2;
    let top = y + 2;
    if (left + width > window.innerWidth - margin) left = Math.max(margin, x - width - 2);
    if (top + height > window.innerHeight - margin) top = Math.max(margin, window.innerHeight - height - margin);
    setPos({ left, top, ready: true });
    el.querySelector<HTMLElement>('.menu-item')?.focus();
  }, [x, y]);

  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('.menu-item') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const key = e.key.toLowerCase();
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') items[(i + 1) % items.length]?.focus();
    else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length]?.focus();
    else if (key === 'i') run(actions.important)();
    else if (key === 'm') run(actions.mute)();
    else if (key === 'd' && actions.done) run(actions.done)();
    else if (key === 'e' && actions.edit) run(actions.edit)();
    else if (e.key === 'Delete' || e.key === 'Backspace') run(actions.deleteOne)();
    else return;
    e.preventDefault();
  };

  const when =
    item.kind === 'event'
      ? item.allDay
        ? 'All day'
        : `${fmtWhen(item.start, now, hour12)} – ${fmtBare(item.end, hour12)}`
      : item.due !== undefined
        ? `${item.kind === 'task' ? 'Done by' : 'Due'} ${fmtWhen(item.due, now, hour12)}`
        : '';
  const deadline = item.kind === 'task' && item.deadline !== undefined && item.deadline !== item.due ? `Deadline ${fmtWhen(item.deadline, now, hour12)}` : '';
  const muteSub = item.kind === 'event' ? 'Fades it and frees up its time' : 'No reminders, faded on the board';

  return (
    <div
      className="menu-layer"
      onMouseDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        ref={ref}
        className="menu"
        role="menu"
        aria-label={item.title}
        style={{ left: pos.left, top: pos.top, visibility: pos.ready ? 'visible' : 'hidden' }}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onKeyDown={onKey}
      >
        <div className="target">
          <div className="name">{item.title}</div>
          <div className="line">
            <span>{[item.subtitle, when].filter(Boolean).join(' · ')}</span>
          </div>
          {deadline && (
            <div className="line">
              <span>{deadline}</span>
            </div>
          )}
          {item.location && (
            <div className="line">
              <span>{item.location}</span>
            </div>
          )}
          {analysis && !item.done && (
            <div className="line" title={analysisFacts(analysis, now, hour12).join(' · ')}>
              <span className={`badge ${analysis.level}`}>{levelLabel(analysis, now, hour12)}</span>
              <span>needs ~{fmtDuration(analysis.needMin)}</span>
            </div>
          )}
        </div>
        <div className="sep" />
        <MenuItem icon={Star} label={item.important ? 'Not important' : 'Mark as important'} kbd="I" on={item.important} onSelect={run(actions.important)} />
        <MenuItem icon={item.muted ? Bell : BellOff} label={item.muted ? 'Unmute' : 'Mute'} sub={item.muted ? undefined : muteSub} kbd="M" onSelect={run(actions.mute)} />
        {actions.done && <MenuItem icon={item.done ? Undo2 : Check} label={item.done ? 'Mark as not done' : 'Mark as done'} kbd="D" onSelect={run(actions.done)} />}
        {actions.effort && (
          <div className="effort">
            <span className="micro t3">Time it needs</span>
            <div className="opts" role="group" aria-label="Time it needs">
              {EFFORT.map((m) => (
                <button key={m} type="button" aria-pressed={item.effortMin === m} onClick={run(() => actions.effort!(m))}>
                  {effortLabel(m)}
                </button>
              ))}
            </div>
          </div>
        )}
        {(actions.edit || actions.open) && <div className="sep" />}
        {actions.edit && <MenuItem icon={Pencil} label="Edit details…" kbd="E" onSelect={run(actions.edit)} />}
        {actions.open && (
          <MenuItem icon={ExternalLink} label={item.kind === 'assignment' ? 'Open in Canvas' : 'Open link'} onSelect={run(actions.open)} />
        )}
        <div className="sep" />
        <MenuItem icon={X} alert label={actions.deleteSeries ? 'Delete this one' : 'Delete'} kbd="Del" onSelect={run(actions.deleteOne)} />
        {actions.deleteSeries && <MenuItem icon={ListX} alert label="Delete every repeat" onSelect={run(actions.deleteSeries)} />}
        <MenuItem icon={CopyX} alert label="Delete all like this…" sub="Same or near-identical names" onSelect={run(actions.deleteSimilar)} />
      </div>
    </div>
  );
}
