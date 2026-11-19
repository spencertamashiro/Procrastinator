// Side column of the day view: the day's weather in detail and what has to get done.

import { Circle, CircleCheck } from 'lucide-react';
import type { PlannerItem } from '../../../shared/items';
import { addDays, dayKey, fmtDuration, fmtHour, startOfDay } from '../../../shared/time';
import type { AppState } from '../../../shared/types';
import type { Analysis, UrgencyLevel } from '../../../shared/urgency';
import { conditionFor, FORECAST_DAYS, hoursForDay, uvLabel, weatherForDay } from '../../../shared/weather';
import { fmtClock, fmtTemp, levelLabel } from '../lib/format';
import { WeatherIcon } from '../ui/icons';
import type { OpenItem } from './ItemBlock';

const ORDER: Record<UrgencyLevel, number> = { overdue: 0, behind: 1, now: 2, soon: 3, ok: 4 };

/** "06:24" (local time at the forecast place) shown as a clock string. */
function clockFromLocal(t: string | undefined, hour12: boolean): string {
  const m = t ? /T(\d{2}):(\d{2})/.exec(t) : null;
  if (!m) return '–';
  const h = Number(m[1]);
  const min = m[2];
  if (!hour12) return `${m[1]}:${min}`;
  return `${h % 12 === 0 ? 12 : h % 12}:${min} ${h < 12 ? 'AM' : 'PM'}`;
}

export function DayRail({
  day,
  state,
  items,
  now,
  analyses,
  onOpen,
  onToggleDone,
  canToggleDone,
  onOpenSettings,
}: {
  day: number;
  state: AppState;
  items: PlannerItem[];
  now: number;
  analyses: Map<string, Analysis>;
  onOpen: OpenItem;
  onToggleDone: (item: PlannerItem) => void;
  canToggleDone: (item: PlannerItem) => boolean;
  onOpenSettings: () => void;
}) {
  const { hour12 } = state.settings;
  const key = dayKey(day);
  const wx = weatherForDay(state.weather, key);
  const hours = hoursForDay(state.weather, key).filter((h) => {
    const hour = Number(h.t.slice(11, 13));
    return hour >= 6 && hour <= 21 && hour % 3 === 0;
  });
  const dayEnd = addDays(day, 1);
  const todo = items
    .filter((i) => i.kind !== 'event' && (i.due ?? i.start) >= day && (i.due ?? i.start) < dayEnd)
    .sort((a, b) => {
      const la = analyses.get(a.key)?.level ?? 'ok';
      const lb = analyses.get(b.key)?.level ?? 'ok';
      return Number(a.done) - Number(b.done) || ORDER[la] - ORDER[lb] || (a.due ?? 0) - (b.due ?? 0);
    });
  const totalMin = todo.filter((i) => !i.done && !i.muted).reduce((sum, i) => sum + (i.effortMin ?? 0), 0);
  const beyond = Math.round((startOfDay(day) - startOfDay(now)) / 86_400_000) >= FORECAST_DAYS;

  return (
    <aside className="rail" aria-label="Day details">
      <section className="card">
        <h3>{state.weather ? `Weather in ${state.weather.place.name}` : 'Weather'}</h3>
        {wx ? (
          <>
            <div className="wx-now">
              <WeatherIcon code={wx.code} size={38} />
              <div>
                <div className="big">{fmtTemp(wx.mean)}</div>
                <div className="t2">
                  {conditionFor(wx.code).label} · {fmtTemp(wx.max)} / {fmtTemp(wx.min)}
                </div>
              </div>
            </div>
            <div className="wx-stats">
              <div className="stat">
                <div className="micro t3">Chance of rain</div>
                <div className="v">{wx.rain === null ? '–' : `${wx.rain}%`}</div>
              </div>
              <div className="stat">
                <div className="micro t3">UV index</div>
                <div className="v">{wx.uv === null ? '–' : `${Math.round(wx.uv)} · ${uvLabel(wx.uv)}`}</div>
              </div>
              <div className="stat">
                <div className="micro t3">Sunrise</div>
                <div className="v">{clockFromLocal(wx.sunrise, hour12)}</div>
              </div>
              <div className="stat">
                <div className="micro t3">Sunset</div>
                <div className="v">{clockFromLocal(wx.sunset, hour12)}</div>
              </div>
            </div>
            {hours.length > 0 && (
              <div className="wx-hours">
                {hours.map((h) => (
                  <div className="h" key={h.t}>
                    <span className="micro t3">{fmtHour(Number(h.t.slice(11, 13)), hour12)}</span>
                    <WeatherIcon code={h.code} size={16} />
                    <span className="strong">{fmtTemp(h.temp)}</span>
                    <span className="small t3">{h.rain === null ? '' : `${h.rain}%`}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="quiet">
            {!state.weather ? (
              <>
                No place chosen yet.{' '}
                <button type="button" className="linkish" onClick={onOpenSettings}>
                  Choose one in Settings
                </button>
              </>
            ) : beyond ? (
              `Forecasts reach ${FORECAST_DAYS} days ahead. Check back closer to the day.`
            ) : (
              'No forecast for this day.'
            )}
          </p>
        )}
      </section>

      <section className="card">
        <h3>Due this day</h3>
        {todo.length === 0 ? (
          <p className="quiet">Nothing due. Enjoy the slack.</p>
        ) : (
          <>
            <p className="small t3" style={{ margin: '-6px 0 8px' }}>
              About {fmtDuration(totalMin)} of work left
            </p>
            <div className="todo">
              {todo.map((item) => {
                const a = analyses.get(item.key);
                const toggle = canToggleDone(item);
                const Check = item.done ? CircleCheck : Circle;
                return (
                  <div key={item.key} className={`todo-row${item.muted ? ' muted' : ''}${item.done ? ' done' : ''}`} data-key={item.key}>
                    <button
                      type="button"
                      className="check"
                      disabled={!toggle}
                      aria-label={item.done ? `Mark ${item.title} as not done` : `Mark ${item.title} as done`}
                      onClick={() => onToggleDone(item)}
                    >
                      <Check size={16} />
                    </button>
                    <button
                      type="button"
                      className="main"
                      style={{ textAlign: 'left' }}
                      onClick={(e) => onOpen(item, e.clientX, e.clientY)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        onOpen(item, e.clientX, e.clientY);
                      }}
                    >
                      <div className="name title">{item.title}</div>
                      <div className="small t2">
                        {[item.subtitle, item.allDay ? 'by end of day' : `due ${fmtClock(item.due ?? item.end, hour12)}`, `~${fmtDuration(item.effortMin ?? 0)}`]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </button>
                    {item.done ? (
                      <span className="badge">Done</span>
                    ) : a && a.level !== 'ok' ? (
                      <span className={`badge ${a.level}`}>{levelLabel(a, now, hour12)}</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>
    </aside>
  );
}
