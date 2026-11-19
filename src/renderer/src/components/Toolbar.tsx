import { Bell, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { fmtRangeTitle, type DateRange } from '../../../shared/time';
import type { RangeMode, ViewMode } from '../../../shared/types';
import { Segmented } from '../ui/controls';

const VIEWS: { value: ViewMode; label: string }[] = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'day', label: 'Day' },
];
const RANGES: { value: RangeMode; label: string }[] = [
  { value: 'calendar', label: 'This week' },
  { value: 'rolling', label: 'Next 7 days' },
];

export function Toolbar({
  view,
  rangeMode,
  range,
  anchor,
  urgent,
  onView,
  onRangeMode,
  onShift,
  onToday,
  onDue,
  onNewTask,
}: {
  view: ViewMode;
  rangeMode: RangeMode;
  range: DateRange;
  anchor: number;
  urgent: number;
  onView: (v: ViewMode) => void;
  onRangeMode: (m: RangeMode) => void;
  onShift: (dir: 1 | -1) => void;
  onToday: () => void;
  onDue: (rect: DOMRect) => void;
  onNewTask: () => void;
}) {
  const title = fmtRangeTitle(range, view, anchor);
  const unit = view;
  return (
    <div className="toolbar">
      <div className="left">
        <div className="range-title">
          <h1>{title.main}</h1>
          <span className="year">{title.year}</span>
        </div>
        <div className="nav">
          <button type="button" className="icon-btn framed" aria-label={`Previous ${unit}`} title={`Previous ${unit} (←)`} onClick={() => onShift(-1)}>
            <ChevronLeft size={16} />
          </button>
          <button type="button" className="pill" onClick={onToday} title="Today (T)">
            Today
          </button>
          <button type="button" className="icon-btn framed" aria-label={`Next ${unit}`} title={`Next ${unit} (→)`} onClick={() => onShift(1)}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className="right">
        {view === 'week' && <Segmented label="Which seven days" value={rangeMode} options={RANGES} onChange={onRangeMode} />}
        <Segmented label="View" value={view} options={VIEWS} onChange={onView} />
        <button
          type="button"
          className={`pill ${urgent > 0 ? 'alert' : 'calm'} due-pill`}
          aria-haspopup="dialog"
          onClick={(e) => onDue(e.currentTarget.getBoundingClientRect())}
        >
          <Bell size={14} />
          {urgent > 0 ? (
            <span>
              {urgent}
              <span className="hide-narrow"> due soon</span>
            </span>
          ) : (
            'On track'
          )}
        </button>
        <button type="button" className="pill primary" onClick={onNewTask} title="New task (Ctrl+N)">
          <Plus size={16} />
          New task
        </button>
      </div>
    </div>
  );
}
