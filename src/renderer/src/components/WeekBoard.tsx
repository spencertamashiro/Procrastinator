// The week (or single-day) map: day headers with the forecast, an all-day lane, and
// a 24-hour grid of events, work blocks for tasks and assignments, and deadlines.

import { Droplet, Flag } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, type CSSProperties, type MouseEvent } from 'react';
import { allDayFor, deadlineMarkers, layoutDay, type PlannerItem } from '../../../shared/items';
import { dayKey, fmtHour, fmtTime, fmtWeekday, isSameDay, minutesIntoDay } from '../../../shared/time';
import type { Settings, WeatherCache } from '../../../shared/types';
import type { Analysis } from '../../../shared/urgency';
import { weatherForDay } from '../../../shared/weather';
import { fmtTemp } from '../lib/format';
import { WeatherIcon } from '../ui/icons';
import { Block, Chip, type OpenItem } from './ItemBlock';

/** Assignments due this late (Canvas defaults to 11:59 PM) sit in the all-day lane where they are seen. */
const END_OF_DAY_MIN = 23 * 60 + 30;
const LANE_ROWS = 3;
const SCROLL_TO_HOUR = 7;

export function isEndOfDay(item: PlannerItem): boolean {
  return item.kind === 'assignment' && !item.allDay && item.due !== undefined && minutesIntoDay(item.due) >= END_OF_DAY_MIN;
}

export function WeekBoard({
  days,
  items,
  now,
  settings,
  weather,
  analyses,
  flash,
  onOpen,
  onOpenDay,
  onCreateAt,
}: {
  days: number[];
  items: PlannerItem[];
  now: number;
  settings: Settings;
  weather: WeatherCache | null;
  analyses: Map<string, Analysis>;
  flash: string | null;
  onOpen: OpenItem;
  onOpenDay: (day: number) => void;
  /** Double-click on an empty part of the grid. */
  onCreateAt: (at: number) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const hourPx = settings.density === 'compact' ? 44 : 56;
  const minBlock = settings.density === 'compact' ? 30 : 24;
  const { hour12 } = settings;
  const nowMin = minutesIntoDay(now);
  const todayIndex = days.findIndex((d) => isSameDay(d, now));
  // An hour label sits 5-17px below its line and the "now" tag spans 8px either side of
  // the current time, so the label the tag would cover is hidden while it is there.
  const nowPx = (nowMin / 60) * hourPx;
  const underNowTag = (h: number): boolean => todayIndex >= 0 && nowPx - h * hourPx > -4 && nowPx - h * hourPx < 26;

  const perDay = useMemo(
    () =>
      days.map((day) => {
        const lane = items.filter((i) => isEndOfDay(i) && isSameDay(i.due!, day));
        const timed = items.filter((i) => !isEndOfDay(i));
        return {
          day,
          allDay: [...allDayFor(items, day), ...lane],
          placed: layoutDay(timed, day, minBlock),
          deadlines: deadlineMarkers(items, day),
        };
      }),
    [days, items, minBlock],
  );

  // Open on the morning, or on the present moment when it is later in the day.
  const firstDay = days[0];
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const visibleHours = el.clientHeight / hourPx;
    let hour = SCROLL_TO_HOUR;
    if (todayIndex >= 0 && nowMin / 60 > SCROLL_TO_HOUR + visibleHours - 2) hour = nowMin / 60 - visibleHours / 3;
    el.scrollTop = Math.max(0, hour * hourPx - 8);
    // Only when the range or density changes, not on every clock tick.
  }, [firstDay, days.length, hourPx]);

  // Bring a revealed item into view.
  useLayoutEffect(() => {
    if (!flash || !scroller.current) return;
    const el = scroller.current.querySelector<HTMLElement>(`[data-key="${CSS.escape(flash)}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [flash]);

  const style = { '--n': days.length } as CSSProperties;

  const createAt = (day: number) => (e: MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const minutes = Math.round(((e.clientY - rect.top) / hourPx) * 4) * 15; // nearest quarter hour
    const at = new Date(day);
    at.setHours(0, Math.min(23 * 60 + 45, Math.max(0, minutes)), 0, 0);
    onCreateAt(at.getTime());
  };

  // The header sits outside the scroller, so the hour grid never slides underneath it.
  return (
    <>
      <div className="board-head">
        <div className="cols days-head" style={style}>
          <div />
          {days.map((day, i) => (
            <DayHead key={day} day={day} today={i === todayIndex} weather={weather} onOpen={() => onOpenDay(day)} />
          ))}
        </div>
        <div className="rule" />
        <div className="cols allday" style={style}>
          <div className="gut micro">All day</div>
          {perDay.map(({ day, allDay }) => {
            const extra = allDay.length > LANE_ROWS ? allDay.length - (LANE_ROWS - 1) : 0;
            const shown = extra ? allDay.slice(0, LANE_ROWS - 1) : allDay;
            return (
              <div className="cell" key={day}>
                {shown.map((item) => (
                  <Chip key={item.key} item={item} hour12={hour12} flash={flash === item.key} onOpen={onOpen} />
                ))}
                {extra > 0 && (
                  <button type="button" className="chip k-task" onClick={() => onOpenDay(day)}>
                    <span>+{extra} more</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div className="rule" />
      </div>

      <div className="board-scroll" ref={scroller}>
      <div className="cols hours" style={style}>
        <div className="gut">
          {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
            <span key={h} className={`hour-label micro${underNowTag(h) ? ' under-now' : ''}`} style={{ top: `calc(var(--hour) * ${h})` }}>
              {fmtHour(h, hour12)}
            </span>
          ))}
          {todayIndex >= 0 && (
            <span className="now-tag micro" style={{ top: `calc(var(--hour) * ${nowMin / 60})` }}>
              {fmtTime(now, hour12).replace(/\s?[AP]M$/i, '')}
            </span>
          )}
        </div>
        {perDay.map(({ day, placed, deadlines }, i) => (
          <div key={day} className={`col${i === todayIndex ? ' today' : ''}`} onDoubleClick={createAt(day)}>
            {placed.map((p) => (
              <Block
                key={p.item.key}
                placed={p}
                hourPx={hourPx}
                now={now}
                hour12={hour12}
                analysis={analyses.get(p.item.key)}
                flash={flash === p.item.key}
                onOpen={onOpen}
              />
            ))}
            {deadlines.map((d) => (
              <div key={`dl-${d.item.key}`} className="deadline" style={{ top: `calc(var(--hour) * ${d.at / 60})` }}>
                <span>
                  <Flag size={9} aria-hidden />
                  {d.item.title}
                </span>
              </div>
            ))}
            {i === todayIndex && <div className="now-line" style={{ top: `calc(var(--hour) * ${nowMin / 60})` }} />}
          </div>
        ))}
      </div>
      </div>
    </>
  );
}

function DayHead({ day, today, weather, onOpen }: { day: number; today: boolean; weather: WeatherCache | null; onOpen: () => void }) {
  const wx = weatherForDay(weather, dayKey(day));
  const label = `${fmtWeekday(day, 'long')} ${new Date(day).getDate()}`;
  return (
    <button type="button" className={`day-head${today ? ' today' : ''}`} onClick={onOpen} aria-label={`Open ${label}`}>
      <div>
        <div className="weekday label">{fmtWeekday(day)}</div>
        <div className="num">{new Date(day).getDate()}</div>
      </div>
      {wx ? (
        <div className="wx" title={`Average ${fmtTemp(wx.mean)} · high ${fmtTemp(wx.max)}, low ${fmtTemp(wx.min)}`}>
          <div className="temp">
            <WeatherIcon code={wx.code} size={15} />
            {fmtTemp(wx.mean)}
          </div>
          <div className="detail">
            <Droplet size={10} aria-hidden />
            {wx.rain === null ? '–' : `${wx.rain}%`}{wx.uv !== null ? ` · UV ${Math.round(wx.uv)}` : ''}
          </div>
        </div>
      ) : null}
    </button>
  );
}
