// Six-week overview. Each day lists what happens or is due that day, as many rows as
// fit, with the forecast for the days the weather service covers.

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PlannerItem } from '../../../shared/items';
import { addDays, dayKey, fmtDayLong, fmtWeekday, isSameDay, startOfDay } from '../../../shared/time';
import type { WeatherCache } from '../../../shared/types';
import { FORECAST_DAYS, PAST_DAYS, weatherForDay } from '../../../shared/weather';
import { fmtTemp } from '../lib/format';
import { WeatherIcon } from '../ui/icons';
import { MonthRow, type OpenItem } from './ItemBlock';

const ROW = 21; // 18px row + 3px gap
const CHROME = 34; // cell padding + the date line
const MORE = 17;

/** Events on every day they touch; tasks and assignments only on the day they are due. */
function bucket(items: PlannerItem[], days: number[]): Map<number, PlannerItem[]> {
  const out = new Map<number, PlannerItem[]>(days.map((d) => [d, []]));
  for (const item of items) {
    if (item.kind === 'event') {
      if (item.allDay) {
        for (const d of days) if (item.start < addDays(d, 1) && item.end > d) out.get(d)!.push(item);
      } else out.get(startOfDay(item.start))?.push(item);
    } else {
      out.get(startOfDay(item.due ?? item.start))?.push(item);
    }
  }
  const at = (i: PlannerItem): number => (i.kind === 'event' ? i.start : (i.due ?? i.start));
  for (const list of out.values()) {
    list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || at(a) - at(b) || a.title.localeCompare(b.title));
  }
  return out;
}

export function MonthView({
  days,
  anchor,
  items,
  now,
  hour12,
  weather,
  flash,
  onOpen,
  onOpenDay,
}: {
  days: number[];
  anchor: number;
  items: PlannerItem[];
  now: number;
  hour12: boolean;
  weather: WeatherCache | null;
  flash: string | null;
  onOpen: OpenItem;
  onOpenDay: (day: number) => void;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const [cellHeight, setCellHeight] = useState(110);
  const month = new Date(anchor).getMonth();
  const buckets = useMemo(() => bucket(items, days), [items, days]);

  useLayoutEffect(() => {
    const el = grid.current;
    if (!el) return;
    const measure = (): void => setCellHeight(el.clientHeight / 6);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const room = cellHeight - CHROME;
  const lastForecast = weather?.days.length ? weather.days[weather.days.length - 1].date : null;

  return (
    <div className="month">
      <div className="month-head label">
        {days.slice(0, 7).map((d) => (
          <div key={d}>{fmtWeekday(d)}</div>
        ))}
      </div>
      <div className="month-grid" ref={grid}>
        {days.map((day) => {
          const list = buckets.get(day) ?? [];
          const fitsAll = list.length * ROW <= room;
          const fit = fitsAll ? list.length : Math.max(0, Math.floor((room - MORE) / ROW));
          const wx = weatherForDay(weather, dayKey(day));
          const cls = ['m-cell', new Date(day).getMonth() !== month && 'out', isSameDay(day, now) && 'today'].filter(Boolean).join(' ');
          return (
            <div
              key={day}
              className={cls}
              role="button"
              tabIndex={0}
              aria-label={`${fmtDayLong(day)}, ${list.length} item${list.length === 1 ? '' : 's'}`}
              onClick={() => onOpenDay(day)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpenDay(day);
                }
              }}
            >
              <div className="top">
                <span className="num">{new Date(day).getDate()}</span>
                {wx && (
                  <span className="wx" title={`Average ${fmtTemp(wx.mean)}${wx.rain !== null ? ` · ${wx.rain}% rain` : ''}`}>
                    <WeatherIcon code={wx.code} size={12} />
                    {fmtTemp(wx.mean)}
                  </span>
                )}
              </div>
              {list.slice(0, fit).map((item) => (
                <MonthRow key={item.key} item={item} hour12={hour12} flash={flash === item.key} onOpen={onOpen} />
              ))}
              {list.length > fit && <div className="m-more">+{list.length - fit} more</div>}
            </div>
          );
        })}
      </div>
      <div className="month-foot small">
        {lastForecast
          ? `Weather covers the last ${PAST_DAYS} days and a ${FORECAST_DAYS}-day forecast. Click a day to see it hour by hour.`
          : 'Choose a place in Settings to see the weather. Click a day to see it hour by hour.'}
      </div>
    </div>
  );
}
