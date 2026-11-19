// Top level: holds the synced state, what is on screen, and the open overlay.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyzeData } from '../../shared/analysis';
import { buildItems, type PlannerItem } from '../../shared/items';
import { ruleMatches } from '../../shared/similarity';
import { addDays, isSameDay, rangeFor, shiftAnchor, startOfDay, type DateRange } from '../../shared/time';
import type { AppState, RangeMode, SimilarPreview, Task, TaskInput, ViewMode } from '../../shared/types';
import { ContextMenu, type MenuActions } from './components/ContextMenu';
import { DayRail } from './components/DayRail';
import { DuePopover } from './components/DuePopover';
import { MonthView } from './components/MonthView';
import { Settings, type SettingsSection } from './components/Settings';
import { SimilarDialog } from './components/SimilarDialog';
import { Snack, type SnackMessage } from './components/Snack';
import { TaskDialog, type TaskDraft } from './components/TaskDialog';
import { TitleBar } from './components/TitleBar';
import { Toolbar } from './components/Toolbar';
import { WeekBoard } from './components/WeekBoard';
import { frames, harnessEnabled, registerHarness, waitFor, type HarnessStep } from './harness';
import { prefersDark, useNow, usePrefersDark } from './lib/hooks';

type Overlay =
  | { type: 'task'; draft: TaskDraft }
  | { type: 'settings' }
  | { type: 'menu'; item: PlannerItem; x: number; y: number }
  | { type: 'similar'; item: PlannerItem; preview: SimilarPreview }
  | { type: 'due'; anchor: DOMRect | null };

type StateRef = { readonly current: AppState | null };

/** What describeError() says when a source could not be reached. */
const UNREACHABLE = /^Offline|timed out/i;

function taskToInput(t: Task, important: boolean): TaskInput {
  return {
    title: t.title,
    durationMin: t.durationMin,
    preferredDue: t.preferredDue,
    finalDeadline: t.finalDeadline,
    category: t.category,
    recurrence: t.recurrence,
    location: t.location,
    url: t.url,
    notes: t.notes,
    important,
  };
}

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const stateRef = useRef<AppState | null>(null);
  useEffect(() => {
    let alive = true;
    const off = window.api.onState((next) => {
      stateRef.current = next;
      setState(next);
    });
    void window.api.getState().then((first) => {
      // A pushed state is never older than this reply, so only use it if nothing arrived yet.
      if (alive && !stateRef.current) {
        stateRef.current = first;
        setState(first);
      }
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  if (!state) return <div className="loading">Procrastinator</div>;
  return <Planner state={state} stateRef={stateRef} />;
}

function Planner({ state, stateRef }: { state: AppState; stateRef: StateRef }) {
  const s = state.settings;
  const now = useNow();
  const dark = usePrefersDark();
  const [view, setViewState] = useState<ViewMode>(s.view);
  const [rangeMode, setRangeModeState] = useState<RangeMode>(s.rangeMode);
  /** null follows today, so a window left open overnight moves on by itself. */
  const [anchor, setAnchor] = useState<number | null>(null);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [section, setSection] = useState<SettingsSection>('general');
  const [snack, setSnack] = useState<SnackMessage | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const flashTimer = useRef(0);

  const base = anchor ?? now;
  const baseDay = startOfDay(base);
  const range = useMemo(() => rangeFor(view, baseDay, rangeMode, s.weekStartsOn), [view, baseDay, rangeMode, s.weekStartsOn]);
  const items = useMemo(() => buildItems(state, range.start, range.end), [state, range]);
  const minute = Math.floor(now / 60_000);
  // Same analysis as the reminder service, so badges agree with notifications.
  const analyses = useMemo(() => analyzeData(state, minute * 60_000), [state, minute]);
  const byKey = useMemo(() => new Map(analyses.map((a) => [a.key, a])), [analyses]);
  const urgent = analyses.filter((a) => a.level !== 'ok').length;

  useEffect(() => {
    const update = (): void => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  const statuses = Object.values(state.sync);
  const syncing = statuses.some((x) => x.syncing);
  const failures = statuses.map((x) => x.lastError).filter((e): e is string => !!e);
  const offline = !online || failures.some((e) => UNREACHABLE.test(e));
  const problem = failures.find((e) => !UNREACHABLE.test(e)) ?? null;

  // ---------------------------------------------------------------- actions

  const notify = useCallback((text: string, action?: SnackMessage['action']) => setSnack({ id: Date.now(), text, action }), []);
  const dismissSnack = useCallback(() => setSnack(null), []);
  const close = useCallback(() => setOverlay(null), []);

  const setView = useCallback((v: ViewMode) => {
    setViewState(v);
    void window.api.updateSettings({ view: v });
  }, []);
  const setRangeMode = useCallback((m: RangeMode) => {
    setRangeModeState(m);
    setAnchor(null);
    void window.api.updateSettings({ rangeMode: m });
  }, []);
  const openSettings = useCallback((at?: SettingsSection) => {
    if (at) setSection(at);
    setOverlay({ type: 'settings' });
  }, []);
  const newTask = useCallback((dueAt?: number) => setOverlay({ type: 'task', draft: { dueAt } }), []);
  const openItem = useCallback((item: PlannerItem, x: number, y: number) => setOverlay({ type: 'menu', item, x, y }), []);
  const openDay = (day: number): void => {
    setAnchor(isSameDay(day, Date.now()) ? null : day);
    setView('day');
  };

  const flashItem = useCallback((key: string) => {
    setFlash(key);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 2200);
  }, []);

  // Read by callbacks that outlive a render (commands, keyboard, harness).
  const live = useRef({ view, range });
  live.current = { view, range };

  /** Shows an item, e.g. after its notification was clicked. */
  const reveal = useCallback(
    (key: string) => {
      const st = stateRef.current;
      setOverlay(null);
      if (!st) return;
      const t = Date.now();
      const item = buildItems(st, addDays(t, -2), addDays(t, 16)).find((i) => i.key === key);
      if (!item) {
        notify('That item is no longer on the board.');
        return;
      }
      const when = item.kind === 'event' ? item.start : (item.due ?? item.start);
      if (live.current.view === 'month') setViewState('week');
      const { range: r } = live.current;
      if (live.current.view === 'month' || when < r.start || when >= r.end) setAnchor(isSameDay(when, t) ? null : when);
      flashItem(key);
    },
    [stateRef, notify, flashItem],
  );

  const canToggleDone = (item: PlannerItem): boolean =>
    item.kind === 'task' || (item.kind === 'assignment' && !(item.done && !state.overlay[item.key]?.done)); // submitted work stays done
  const toggleDone = (item: PlannerItem): void => {
    if (canToggleDone(item)) void window.api.setFlags(item.key, { done: !item.done });
  };

  const deleteItem = async (item: PlannerItem, scope: 'one' | 'series'): Promise<void> => {
    const st = stateRef.current ?? state;
    const task = item.taskId ? st.tasks.find((t) => t.id === item.taskId) : undefined;
    const permanent = !!task && (!task.recurrence || scope === 'series');
    const res = await window.api.deleteItem(item.key, scope);
    if (!res.ok) {
      notify(res.message ?? 'That could not be deleted.');
      return;
    }
    const text = scope === 'series' ? `Deleted every “${item.title}”` : `Deleted “${item.title}”`;
    if (permanent && task) {
      // Local tasks are removed outright; undo adds them back.
      const important = !!st.overlay[task.id]?.important;
      notify(text, { label: 'Undo', run: () => void window.api.saveTask(taskToInput(task, important)) });
    } else {
      const hidden = scope === 'series' ? item.seriesKey : item.key;
      notify(text, { label: 'Undo', run: () => void window.api.restoreSuppressed(`id:${hidden}`) });
    }
  };

  const askSimilar = async (item: PlannerItem): Promise<void> => {
    const preview = await window.api.previewSimilar(item.key);
    if (!preview) notify('That item is no longer here.');
    else setOverlay({ type: 'similar', item, preview });
  };

  const confirmSimilar = async (item: PlannerItem, preview: SimilarPreview): Promise<void> => {
    setOverlay(null);
    const st = stateRef.current ?? state;
    const candidates = item.kind === 'task' ? st.tasks.filter((t) => ruleMatches(preview.rule, { title: t.title, kind: 'task' })) : [];
    const n = await window.api.deleteSimilar(item.key);
    const text = `${item.kind === 'task' ? 'Deleted' : 'Hid'} ${n} like “${item.title}”`;
    if (item.kind === 'task') {
      notify(text, {
        label: 'Undo',
        run: () => {
          const left = new Set((stateRef.current ?? st).tasks.map((t) => t.id));
          for (const t of candidates) if (!left.has(t.id)) void window.api.saveTask(taskToInput(t, !!st.overlay[t.id]?.important));
        },
      });
      return;
    }
    notify(text, {
      label: 'Undo',
      run: () => {
        const rule = (stateRef.current ?? st).suppressed.rules.find(
          (r) => r.kind === preview.rule.kind && r.pattern === preview.rule.pattern && (r.scope ?? '') === (preview.rule.scope ?? ''),
        );
        if (rule) void window.api.restoreSuppressed(`rule:${rule.id}`);
      },
    });
  };

  const menuActions = (item: PlannerItem): MenuActions => {
    const task = item.taskId ? state.tasks.find((t) => t.id === item.taskId) : undefined;
    let effort: MenuActions['effort'] = null;
    // A task's estimate is its duration; an assignment's is a local override.
    if (task) effort = (min) => void window.api.saveTask({ ...taskToInput(task, item.important), id: task.id, durationMin: min });
    else if (item.kind === 'assignment') effort = (min) => void window.api.setFlags(item.seriesKey, { effortMin: min });
    return {
      important: () => void window.api.setFlags(item.seriesKey, { important: !item.important }),
      mute: () => void window.api.setFlags(item.seriesKey, { muted: !item.muted }),
      done: canToggleDone(item) ? () => toggleDone(item) : null,
      effort,
      edit: task ? () => setOverlay({ type: 'task', draft: { task, important: item.important } }) : null,
      open: item.url ? () => void window.api.openItem(item.key) : null,
      deleteOne: () => void deleteItem(item, 'one'),
      deleteSeries: item.recurring ? () => void deleteItem(item, 'series') : null,
      deleteSimilar: () => void askSimilar(item),
    };
  };

  // ---------------------------------------------------------------- commands and keys

  const commands = useRef({ newTask, openSettings, reveal, setView, shift: (_dir: 1 | -1) => {}, today: () => {}, busy: false });
  commands.current = {
    newTask,
    openSettings,
    reveal,
    setView,
    shift: (dir) => setAnchor(shiftAnchor(base, view, dir)),
    today: () => setAnchor(null),
    busy: overlay !== null,
  };

  useEffect(
    () =>
      window.api.onCommand((cmd, arg) => {
        const c = commands.current;
        if (cmd === 'new-task') c.newTask();
        else if (cmd === 'today') {
          setOverlay(null);
          c.today();
        } else if (cmd === 'settings') c.openSettings();
        else if (cmd === 'reveal' && arg) c.reveal(arg);
      }),
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const c = commands.current;
      if (c.busy || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement).closest?.('input, textarea, select')) return;
      if (e.key === 'ArrowLeft') c.shift(-1);
      else if (e.key === 'ArrowRight') c.shift(1);
      else if (e.key === 't') c.today();
      else if (e.key === 'n') c.newTask();
      else if (e.key === 'm') c.setView('month');
      else if (e.key === 'w') c.setView('week');
      else if (e.key === 'd') c.setView('day');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---------------------------------------------------------------- screenshot harness

  useEffect(() => {
    if (!harnessEnabled) return;
    registerHarness(async (step: HarnessStep) => {
      setOverlay(null);
      setSnack(null);
      setFlash(null);
      const theme = step.theme ?? 'light';
      const density = step.flags.has('compact') ? 'compact' : 'comfortable';
      await window.api.updateSettings({ theme, density });
      setViewState(step.view);
      setRangeModeState(step.flags.has('rolling') ? 'rolling' : 'calendar');
      setAnchor(null);
      await waitFor(() => prefersDark() === (theme === 'dark') && stateRef.current?.settings.density === density);
      await frames(2);
      const st = stateRef.current!;
      const pick = (): PlannerItem | undefined => {
        const r: DateRange = rangeFor(step.view, Date.now(), step.flags.has('rolling') ? 'rolling' : 'calendar', st.settings.weekStartsOn);
        const list = buildItems(st, r.start, r.end);
        return (
          list.find((i) => i.kind === 'assignment' && !i.done && /^Problem Set/.test(i.title)) ??
          list.find((i) => i.kind === 'assignment' && !i.done) ??
          list.find((i) => !i.allDay)
        );
      };
      if (step.overlay === 'dialog') setOverlay({ type: 'task', draft: {} });
      else if (step.overlay === 'more') setOverlay({ type: 'task', draft: { expanded: true } });
      else if (step.overlay === 'edit') {
        const task = st.tasks.find((t) => t.title === 'Midterm review') ?? st.tasks[0];
        if (task) setOverlay({ type: 'task', draft: { task, important: !!st.overlay[task.id]?.important } });
      } else if (step.overlay === 'menu') {
        const item = pick();
        const el = item && document.querySelector<HTMLElement>(`[data-key="${CSS.escape(item.key)}"]`);
        if (item && el) {
          const rect = el.getBoundingClientRect();
          setOverlay({ type: 'menu', item, x: rect.left + rect.width * 0.6, y: rect.top + 16 });
        }
      } else if (step.overlay === 'similar') {
        const item = pick();
        const preview = item && (await window.api.previewSimilar(item.key));
        if (item && preview) setOverlay({ type: 'similar', item, preview });
      } else if (step.overlay === 'due') {
        setOverlay({ type: 'due', anchor: document.querySelector('.due-pill')?.getBoundingClientRect() ?? null });
      } else if (step.overlay === 'settings') {
        setSection((step.arg as SettingsSection | null) ?? 'general');
        setOverlay({ type: 'settings' });
      } else if (step.overlay === 'snack') {
        notify('Deleted “Problem Set 6”', { label: 'Undo', run: () => undefined });
      }
      await frames(2);
      await new Promise((r) => setTimeout(r, 250));
    });
  }, [stateRef, notify]);

  // ---------------------------------------------------------------- render

  const empty = state.events.length + state.assignments.length + state.tasks.length === 0;
  const platform = state.platform === 'darwin' ? 'mac' : 'win';

  return (
    <div className={`app ${platform}${s.density === 'compact' ? ' compact' : ''}`}>
      <div className="haze" aria-hidden>
        <i className="h1" />
        <i className="h2" />
        <i className="h3" />
      </div>
      <TitleBar
        now={now}
        hour12={s.hour12}
        dark={dark}
        offline={offline}
        problem={problem}
        syncing={syncing}
        onToggleTheme={() => void window.api.updateSettings({ theme: dark ? 'light' : 'dark' })}
        onSettings={() => openSettings()}
      />
      <Toolbar
        view={view}
        rangeMode={rangeMode}
        range={range}
        anchor={base}
        urgent={urgent}
        onView={setView}
        onRangeMode={setRangeMode}
        onShift={(dir) => setAnchor(shiftAnchor(base, view, dir))}
        onToday={() => setAnchor(null)}
        onDue={(rect) => setOverlay({ type: 'due', anchor: rect })}
        onNewTask={() => newTask()}
      />
      <main className="board-wrap">
        <section className="board" aria-label={view === 'month' ? 'Month' : view === 'week' ? 'Week' : 'Day'}>
          {view === 'month' ? (
            <MonthView
              days={range.days}
              anchor={base}
              items={items}
              now={now}
              hour12={s.hour12}
              weather={state.weather}
              flash={flash}
              onOpen={openItem}
              onOpenDay={openDay}
            />
          ) : (
            <WeekBoard
              days={range.days}
              items={items}
              now={now}
              settings={s}
              weather={state.weather}
              analyses={byKey}
              flash={flash}
              onOpen={openItem}
              onOpenDay={openDay}
              onCreateAt={(at) => newTask(at)}
            />
          )}
          {empty && (
            <div className="empty-hint">
              <span>Nothing here yet. Add a task, or connect a calendar or Canvas.</span>
              <button type="button" className="pill" onClick={() => openSettings('calendars')}>
                Connect
              </button>
              <button type="button" className="pill ghost" onClick={() => void window.api.loadDemo()}>
                Try sample data
              </button>
            </div>
          )}
        </section>
        {view === 'day' && (
          <DayRail
            day={range.start}
            state={state}
            items={items}
            now={now}
            analyses={byKey}
            onOpen={openItem}
            onToggleDone={toggleDone}
            canToggleDone={canToggleDone}
            onOpenSettings={() => openSettings('weather')}
          />
        )}
      </main>

      {overlay?.type === 'task' && (
        <TaskDialog
          draft={overlay.draft}
          categories={s.categories}
          now={now}
          onClose={close}
          onSaved={(title, created) => {
            setOverlay(null);
            notify(created ? `Added “${title}”` : `Saved “${title}”`);
          }}
        />
      )}
      {overlay?.type === 'settings' && <Settings state={state} now={now} section={section} onSection={setSection} onClose={close} notify={notify} />}
      {overlay?.type === 'menu' && (
        <ContextMenu
          item={overlay.item}
          x={overlay.x}
          y={overlay.y}
          analysis={byKey.get(overlay.item.key)}
          now={now}
          hour12={s.hour12}
          actions={menuActions(overlay.item)}
          onClose={close}
        />
      )}
      {overlay?.type === 'similar' && (
        <SimilarDialog item={overlay.item} preview={overlay.preview} onConfirm={() => void confirmSimilar(overlay.item, overlay.preview)} onClose={close} />
      )}
      {overlay?.type === 'due' && <DuePopover analyses={analyses} anchor={overlay.anchor} now={now} hour12={s.hour12} onPick={reveal} onClose={close} />}
      {snack && <Snack key={snack.id} message={snack} onDismiss={dismissSnack} />}
    </div>
  );
}
