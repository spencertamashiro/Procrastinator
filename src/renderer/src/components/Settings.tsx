import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CalendarDays, Cloud, GraduationCap, RefreshCw, Rss, Search, Trash2, X } from 'lucide-react';
import type { ActionResult, AppState, DeepPartial, Place, Settings as SavedSettings, SourceStatus } from '../../../shared/types';
import { Field, Modal, NumberInput, Segmented, Switch } from '../ui/controls';
import { fmtAgo, fmtBytes } from '../lib/format';

export type SettingsSection = 'general' | 'calendars' | 'canvas' | 'weather' | 'notifications' | 'tasks' | 'data';
export const SETTINGS_SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'calendars', label: 'Calendars' },
  { id: 'canvas', label: 'Canvas' },
  { id: 'weather', label: 'Weather' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'data', label: 'Data & storage' },
];

export interface SettingsProps {
  state: AppState;
  now: number;
  section: SettingsSection;
  onSection: (s: SettingsSection) => void;
  onClose: () => void;
  notify: (message: string) => void;
}

type PaneProps = Pick<SettingsProps, 'state' | 'now' | 'notify' | 'onSection'>;
type Update = (patch: DeepPartial<SavedSettings>) => void;

function Status({ status, now, prefix = '' }: { status?: SourceStatus; now: number; prefix?: string }) {
  const bad = !status?.syncing && !!status?.lastError;
  const synced = status?.lastSync ? `synced ${fmtAgo(status.lastSync, now)}${status.warning ? ` · ${status.warning}` : ''}` : 'not synced yet';
  const text = status?.syncing ? 'Syncing…' : status?.lastError || synced;
  return <div className={`status${bad ? ' bad error' : ' t3'}`}>{prefix && `${prefix} · `}{text}</div>;
}

function Row({ label, sub, children }: { label: string; sub?: string; children: ReactNode }) {
  return <div className="setting"><div className="text"><div>{label}</div>{sub && <div className="sub">{sub}</div>}</div>{children}</div>;
}

function Numeric({ label, value, min, max, unit = 'min', onCommit }: {
  label: string; value: number; min: number; max: number; unit?: string; onCommit: (n: number) => void;
}) {
  return <div className="input short"><NumberInput aria-label={label} value={value} min={min} max={max} onCommit={onCommit} /><span className="t3">{unit}</span></div>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

function host(address: string): string {
  try { return new URL(address.includes('://') ? address : `https://${address}`).host; }
  catch { return address; }
}

function useActions() {
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const locks = useRef(new Set<string>());
  async function run(key: string, action: () => Promise<void>) {
    if (locks.current.has(key)) return;
    locks.current.add(key);
    setPending((p) => ({ ...p, [key]: true }));
    setErrors((e) => ({ ...e, [key]: '' }));
    try { await action(); }
    catch (error) { setErrors((e) => ({ ...e, [key]: errorMessage(error) })); }
    finally {
      locks.current.delete(key);
      setPending((p) => ({ ...p, [key]: false }));
    }
  }
  return { pending, errors, run };
}

function requireSuccess(result: ActionResult): void {
  if (!result.ok) throw new Error(result.message || 'Could not complete the action. Try again.');
}

function General({ settings: s, update }: { settings: SavedSettings; update: Update }) {
  return <>
    <h4>General</h4>
    <div className="group">
      <Row label="Theme"><Segmented label="Theme" value={s.theme} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} onChange={(theme) => update({ theme })} /></Row>
      <Row label="Density"><Segmented label="Density" value={s.density} options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} onChange={(density) => update({ density })} /></Row>
      <Row label="Week starts on"><Segmented<0 | 1> label="Week starts on" value={s.weekStartsOn} options={[{ value: 1, label: 'Monday' }, { value: 0, label: 'Sunday' }]} onChange={(weekStartsOn) => update({ weekStartsOn })} /></Row>
      <Row label="Time format"><Segmented label="Time format" value={s.hour12 ? '12' : '24'} options={[{ value: '12', label: '12-hour' }, { value: '24', label: '24-hour' }]} onChange={(v) => update({ hour12: v === '12' })} /></Row>
    </div>
    <div className="group">
      <Row label="Keep running in the tray" sub="Closing the window keeps reminders running. Quit from the tray icon."><Switch label="Keep running in the tray" checked={s.keepInTray} onChange={(keepInTray) => update({ keepInTray })} /></Row>
      <Row label="Open at login" sub="Applies to the installed app."><Switch label="Open at login" checked={s.launchAtLogin} onChange={(launchAtLogin) => update({ launchAtLogin })} /></Row>
    </div>
  </>;
}

function Connection({ source, state, now, notify, update }: PaneProps & { source: 'google' | 'icloud' | 'canvas'; update: Update }) {
  const s = state.settings;
  const [open, setOpen] = useState(false);
  const [identity, setIdentity] = useState(source === 'google' ? s.google.clientId : source === 'icloud' ? s.icloud.username : s.canvas.baseUrl);
  const [secret, setSecret] = useState('');
  const { pending, errors, run } = useActions();
  const connected = state.connections[source].connected;
  const calendars = source === 'canvas' ? [] : s[source].calendars;
  const count = calendars.filter((c) => c.enabled).length;
  const name = source === 'google' ? 'Google Calendar' : source === 'icloud' ? 'Apple iCloud' : 'Canvas';
  const Icon = source === 'google' ? CalendarDays : source === 'icloud' ? Cloud : GraduationCap;
  const prefix = source === 'google' ? `Connected · ${count} calendars`
    : source === 'icloud' ? `Connected as ${s.icloud.username} · ${count} calendars`
      : `Connected to ${host(s.canvas.baseUrl)} · ${state.sync.canvas?.count ?? state.assignments.filter((a) => a.sourceId === 'canvas').length} assignments`;
  async function connect() {
    let result: ActionResult;
    if (source === 'google') {
      await window.api.updateSettings({ google: { clientId: identity.trim() } });
      result = await window.api.connectGoogle(secret || undefined);
    } else if (source === 'icloud') result = await window.api.connectICloud(identity.trim(), secret);
    else result = await window.api.connectCanvas(identity.trim(), secret);
    requireSuccess(result);
    notify(result.message || `${name} connected`);
    setIdentity('');
    setSecret('');
    setOpen(false);
  }
  const busy = !!pending.connect;
  return <section className="source">
    <div className="head">
      <Icon size={18} />
      <div className="text"><div className="name">{name}</div>{connected ? <Status status={state.sync[source]} now={now} prefix={prefix} /> : <div className="status">Not connected</div>}</div>
      {connected ? <>
        <button type="button" className="pill calm" disabled={pending.sync || state.sync[source]?.syncing} onClick={() => void run('sync', () => window.api.sync(source))}>{pending.sync || state.sync[source]?.syncing ? 'Syncing…' : 'Sync now'}</button>
        <button type="button" className="pill ghost" disabled={pending.disconnect} onClick={() => void run('disconnect', async () => {
          await window.api.disconnect(source);
          setIdentity(source === 'google' ? s.google.clientId : '');
          setSecret('');
          notify(`${name} disconnected`);
        })}>{pending.disconnect ? 'Disconnecting…' : 'Disconnect'}</button>
      </> : <button type="button" className="pill" aria-expanded={open} disabled={busy} onClick={() => setOpen(!open)}>Set up</button>}
    </div>
    {connected && calendars.length > 0 && <div className="cals">{calendars.map((cal) => <button type="button" key={cal.id} className={`pill${cal.enabled ? ' active' : ''}`} aria-pressed={cal.enabled} onClick={() => {
      const next = calendars.map((c) => c.id === cal.id ? { ...c, enabled: !c.enabled } : c);
      update(source === 'google' ? { google: { calendars: next } } : { icloud: { calendars: next } });
    }}>{cal.name}</button>)}</div>}
    {!connected && open && <div className="form">
      {source === 'google' ? <>
        <ol><li>In Google Cloud Console, create a project and enable the Google Calendar API.</li><li>Set up the OAuth consent screen as External and add yourself as a test user.</li><li>Create an OAuth client ID of type Desktop app.</li><li>Paste its client ID and client secret below and connect; your browser opens to sign in.</li></ol>
        <button type="button" className="linkish" onClick={() => void window.api.openHelp('google-console')}>Google Cloud Console</button>
      </> : source === 'icloud' ? <>
        <ol><li>Sign in at account.apple.com.</li><li>Open Sign-In and Security → App-Specific Passwords and create one named Procrastinator.</li><li>Paste it here.</li></ol>
        <button type="button" className="linkish" onClick={() => void window.api.openHelp('apple-account')}>Apple Account</button>
      </> : <ol><li>In Canvas, open Account → Settings.</li><li>Under Approved integrations choose New access token, name it Procrastinator and copy the token.</li></ol>}
      <Field label={source === 'google' ? 'Client ID' : source === 'icloud' ? 'Apple Account email' : "School's Canvas address"}>
        <div className={`input${errors.connect ? ' invalid' : ''}`}>
          <input aria-label={source === 'google' ? 'Client ID' : source === 'icloud' ? 'Apple Account email' : "School's Canvas address"} value={identity} onChange={(e) => setIdentity(e.target.value)} disabled={busy} placeholder={source === 'canvas' ? 'canvas.school.edu' : undefined} type={source === 'icloud' ? 'email' : 'text'} spellCheck={false} autoComplete="off" />
        </div>
      </Field>
      <Field label={source === 'google' ? 'Client secret' : source === 'icloud' ? 'App-specific password' : 'Access token'}>
        <div className={`input${errors.connect ? ' invalid' : ''}`}><input aria-label={source === 'google' ? 'Client secret' : source === 'icloud' ? 'App-specific password' : 'Access token'} type="password" value={secret} disabled={busy} onChange={(e) => setSecret(e.target.value)} /></div>
      </Field>
      <button type="button" className="pill primary flat" disabled={busy} onClick={() => void run('connect', connect)}>{busy ? source === 'google' ? 'Waiting for browser…' : 'Checking…' : 'Connect'}</button>
      {source === 'google' && <div className="hint">No setup? In Google Calendar's settings, copy a calendar's secret address in iCal format and add it as a feed below.</div>}
      {source === 'canvas' && <div className="hint">Some schools turn off personal tokens. The calendar feed below works without one.</div>}
    </div>}
    {Object.entries(errors).map(([key, error]) => error && <div key={key} className="error" role="alert">{error}</div>)}
  </section>;
}

function Feeds({ state, now, notify }: PaneProps) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const { pending, errors, run } = useActions();
  return <section className="source">
    <div className="head"><Rss size={18} /><div className="text"><div className="name">Subscribed feeds (.ics)</div><div className="status">{state.settings.feeds.length} feeds · refreshed every {state.settings.sync.intervalMin} min</div></div></div>
    <div className="list-plain">{state.settings.feeds.map((feed) => <div className="list-row" key={feed.id}>
      <div className="text"><div>{feed.name} <span className="t3">{feed.host}</span></div><Status now={now} status={state.sync[`feed:${feed.id}`]} /></div>
      <button type="button" className="icon-btn" aria-label={`Sync ${feed.name}`} disabled={pending[`sync:${feed.id}`] || state.sync[`feed:${feed.id}`]?.syncing} onClick={() => void run(`sync:${feed.id}`, () => window.api.sync(`feed:${feed.id}`))}><RefreshCw size={15} /></button>
      <button type="button" className="icon-btn" aria-label={`Remove ${feed.name}`} disabled={pending[`remove:${feed.id}`]} onClick={() => void run(`remove:${feed.id}`, () => window.api.removeFeed(feed.id))}><Trash2 size={15} /></button>
    </div>)}</div>
    <div className="form">
      <Field label="Name (optional)"><div className="input"><input aria-label="Name (optional)" value={name} disabled={pending.add} onChange={(e) => setName(e.target.value)} /></div></Field>
      <Field label="Address"><div className={`input${errors.add ? ' invalid' : ''}`}><input aria-label="Address" value={url} disabled={pending.add} onChange={(e) => setUrl(e.target.value)} /></div></Field>
      <button type="button" className="pill primary flat" disabled={pending.add} onClick={() => void run('add', async () => {
        const result = await window.api.addFeed(name.trim(), url.trim());
        requireSuccess(result);
        notify(`Added ${name.trim() || 'feed'}${result.message ? ` · ${result.message}` : ''}`);
        setName(''); setUrl('');
      })}>{pending.add ? 'Checking…' : 'Add feed'}</button>
      <div className="hint">Works with Google's secret iCal address, public iCloud calendars, Outlook and Canvas's calendar feed. The address is stored encrypted.</div>
    </div>
    {Object.entries(errors).map(([key, error]) => error && <div className="error" role="alert" key={key}>{error}</div>)}
  </section>;
}

function Calendars(props: PaneProps & { update: Update }) {
  const { state, update } = props;
  const s = state.settings.sync;
  return <>
    {!state.connections.secureStorage && <p>Secure storage is unavailable on this computer, so passwords and tokens are kept only until the app quits.</p>}
    <h4>Calendars</h4>
    <p>Events are copied to this computer so the week still opens offline. Nothing in your calendars is ever changed.</p>
    <Connection {...props} source="google" />
    <Connection {...props} source="icloud" />
    <Feeds {...props} />
    <div className="group">
      <Row label="Sync automatically" sub={`Every ${s.intervalMin} minutes, and when the computer wakes`}><Switch label="Sync automatically" checked={s.auto} onChange={(auto) => update({ sync: { auto } })} /></Row>
      <Row label="Sync every"><Numeric label="Sync every" value={s.intervalMin} min={5} max={1440} onCommit={(intervalMin) => update({ sync: { intervalMin } })} /></Row>
      <Row label="Keep past items for" sub="Older events and assignments are cleared to save space."><Numeric label="Keep past items for" value={s.keepPastDays} min={1} max={365} unit="days" onCommit={(keepPastDays) => update({ sync: { keepPastDays } })} /></Row>
      <Row label="Look ahead"><Numeric label="Look ahead" value={s.horizonDays} min={14} max={366} unit="days" onCommit={(horizonDays) => update({ sync: { horizonDays } })} /></Row>
    </div>
  </>;
}

function Canvas(props: PaneProps & { update: Update }) {
  const { state, onSection, update } = props;
  return <>
    <h4>Canvas</h4><p>Assignments are read from Canvas, never changed.</p>
    <Connection {...props} source="canvas" />
    <section className="source">
      <div className="head"><Rss size={18} /><div className="text"><div className="name">Calendar feed, no token needed</div></div></div>
      <p>In Canvas open Calendar → Calendar Feed, copy the link and add it as a subscribed feed. Its assignments appear just like the ones above.</p>
      <button type="button" className="pill" onClick={() => onSection('calendars')}>Add a feed</button>
    </section>
    <div className="group">
      <Row label="Default time per assignment" sub="Used for planning and reminders until you set an estimate by right-clicking an assignment."><Numeric label="Default time per assignment" value={state.settings.canvas.defaultEffortMin} min={5} max={1440} onCommit={(defaultEffortMin) => update({ canvas: { defaultEffortMin } })} /></Row>
      <Row label="Show submitted work" sub="Submitted assignments stay on the board, crossed out."><Switch label="Show submitted work" checked={state.settings.canvas.showSubmitted} onChange={(showSubmitted) => update({ canvas: { showSubmitted } })} /></Row>
    </div>
  </>;
}

function placeLabel(place: Place): string {
  return [place.name, place.region, place.country].filter(Boolean).join(', ');
}

function Weather({ state, now, notify, update }: PaneProps & { update: Update }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const generation = useRef(0);
  const { pending, errors, run } = useActions();
  useEffect(() => {
    const version = ++generation.current;
    const q = query.trim();
    setResults([]); setSearched(false);
    if (q.length < 2) { setSearching(false); return; }
    setSearching(true);
    let active = true;
    const timer = setTimeout(() => {
      void window.api.searchPlaces(q).then((places) => {
        if (active && version === generation.current) { setResults(places); setSearched(true); setSearching(false); }
      }).catch(() => {
        if (active && version === generation.current) { setResults([]); setSearched(true); setSearching(false); }
      });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [query]);
  const weather = state.settings.weather;
  return <>
    <h4>Weather</h4><p>Daily forecasts for 16 days and hourly detail for the next week, from Open-Meteo.</p>
    {weather.place ? <div className="list-row"><div className="text"><div>{placeLabel(weather.place)}</div><Status status={state.sync.weather} now={now} /></div><button type="button" className="icon-btn" aria-label="Refresh weather" disabled={pending.sync || state.sync.weather?.syncing} onClick={() => void run('sync', () => window.api.sync('weather'))}><RefreshCw size={15} /></button></div>
      : <div className="hint">{state.weather?.place.country === 'Sample data' ? 'Showing sample weather. Choose a place to get a real forecast.' : 'Choose a place to see the forecast.'}</div>}
    <Field label="Search for a city"><div className="input"><Search size={16} /><input aria-label="Search for a city" placeholder="Search for a city" value={query} onChange={(e) => { generation.current++; setQuery(e.target.value); setResults([]); setSearched(false); }} /></div></Field>
    {searching && <div className="hint" role="status">Searching…</div>}
    {results.length > 0 && <div className="places">{results.map((place, i) => <button type="button" key={`${place.lat}:${place.lon}:${i}`} disabled={pending.place} onClick={() => void run('place', async () => {
      await window.api.updateSettings({ weather: { place } });
      generation.current++; setQuery(''); setResults([]); setSearched(false);
      notify(`Weather set to ${place.name}`);
    })}>{placeLabel(place)}</button>)}</div>}
    {searched && results.length === 0 && <div className="hint">No places found</div>}
    {Object.entries(errors).map(([key, error]) => error && <div className="error" key={key} role="alert">{error}</div>)}
    <div className="group"><Row label="Units"><Segmented label="Weather units" value={weather.units} options={[{ value: 'fahrenheit', label: '°F' }, { value: 'celsius', label: '°C' }]} onChange={(units) => update({ weather: { units } })} /></Row></div>
    <p>Weather data by <button type="button" className="linkish" onClick={() => void window.api.openHelp('open-meteo')}>Open-Meteo.com</button>, licensed CC BY 4.0.</p>
  </>;
}

function Notifications({ settings: s, update, notify }: { settings: SavedSettings; update: Update; notify: SettingsProps['notify'] }) {
  const n = s.notify;
  const { pending, errors, run } = useActions();
  return <>
    <h4>Notifications</h4>
    <div className="group">
      <Row label="Last-minute reminders" sub="Checks every minute how much free time is left before each deadline."><Switch label="Last-minute reminders" checked={n.enabled} onChange={(enabled) => update({ notify: { enabled } })} /></Row>
      <Row label="Heads-up when spare time drops below" sub="Doubled for anything marked important."><Numeric label="Heads-up when spare time drops below" value={n.headsUpMin} min={15} max={1440} onCommit={(headsUpMin) => update({ notify: { headsUpMin } })} /></Row>
      <Row label="Pad every estimate by"><Numeric label="Pad every estimate by" value={n.bufferPct} min={0} max={200} unit="%" onCommit={(bufferPct) => update({ notify: { bufferPct } })} /></Row>
    </div>
    <div className="group">
      <Row label="Quiet hours" sub="No reminders, and this time never counts as free time."><Switch label="Quiet hours" checked={n.respectSleep} onChange={(respectSleep) => update({ notify: { respectSleep } })} /></Row>
      <Row label="Quiet from"><div className="input short"><input aria-label="Quiet hours start" type="time" value={n.sleepStart} disabled={!n.respectSleep} onChange={(e) => { if (e.target.value) update({ notify: { sleepStart: e.target.value } }); }} /></div></Row>
      <Row label="Quiet until"><div className="input short"><input aria-label="Quiet hours end" type="time" value={n.sleepEnd} disabled={!n.respectSleep} onChange={(e) => { if (e.target.value) update({ notify: { sleepEnd: e.target.value } }); }} /></div></Row>
    </div>
    <div className="group">
      <Row label="Morning summary"><Switch label="Morning summary" checked={n.dailyDigest} onChange={(dailyDigest) => update({ notify: { dailyDigest } })} /></Row>
      <Row label="Summary time"><div className="input short"><input aria-label="Morning summary time" type="time" value={n.digestTime} disabled={!n.dailyDigest} onChange={(e) => { if (e.target.value) update({ notify: { digestTime: e.target.value } }); }} /></div></Row>
    </div>
    <div><button type="button" className="pill" disabled={pending.test} onClick={() => void run('test', async () => {
      const result = await window.api.testNotification();
      notify(result.message || (result.ok ? 'Test notification sent' : 'Could not send a test notification'));
      requireSuccess(result);
    })}>{pending.test ? 'Sending…' : 'Send a test notification'}</button></div>
    {errors.test && <div className="error" role="alert">{errors.test}</div>}
    <p>The final reminder arrives 30 minutes before a deadline. On Windows, reminders are hidden while Do Not Disturb is on.</p>
  </>;
}

function Tasks({ state, notify, update }: PaneProps & { update: Update }) {
  const [category, setCategory] = useState('');
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const { pending, errors, run } = useActions();
  const categories = state.settings.categories;
  const next = category.trim();
  const duplicate = categories.some((c) => c.toLocaleLowerCase() === next.toLocaleLowerCase());
  async function addCategory() {
    if (!next || duplicate) return;
    await window.api.updateSettings({ categories: [...categories, next] });
    setCategory('');
  }
  return <>
    <h4>Tasks</h4>
    <div className="group">
      <div><button type="button" className="pill" disabled={pending.import} onClick={() => void run('import', async () => {
        const result = await window.api.importTasks();
        if (!result) return;
        setImportErrors(result.errors.slice(0, 5));
        notify(`Imported ${result.added}${result.skipped ? `, skipped ${result.skipped}` : ''}`);
      })}>{pending.import ? 'Importing…' : 'Import tasks…'}</button></div>
      <div className="hint">CSV with a header row: name, duration, preferred due, final deadline, category, repeats, repeat until, location, link, notes. Durations like 45m, 1h30m or 90. JSON exported from this app and iCalendar to-dos also work.</div>
      {importErrors.map((error, i) => <div className="error" role="alert" key={i}>{error}</div>)}
      <div className="presets">{(['csv', 'json'] as const).map((format) => <button type="button" className="pill" key={format} disabled={pending.export} onClick={() => void run('export', async () => {
        const result = await window.api.exportTasks(format);
        if (!result) return;
        requireSuccess(result);
        notify(result.message || 'Tasks exported');
      })}>{pending.export ? 'Exporting…' : `Export ${format.toUpperCase()}`}</button>)}</div>
    </div>
    <div className="group">
      <h4>Categories</h4>
      <div className="list-plain">{categories.map((c) => <div className="list-row" key={c}><div className="text">{c}</div><button type="button" className="icon-btn" aria-label={`Remove category ${c}`} onClick={() => update({ categories: categories.filter((item) => item !== c) })}><X size={15} /></button></div>)}</div>
      <div className="row"><Field label="New category"><div className="input"><input aria-label="New category" value={category} disabled={pending.category} onChange={(e) => setCategory(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void run('category', addCategory); } }} /></div></Field><button type="button" className="pill" style={{ alignSelf: 'flex-end' }} disabled={!next || duplicate || pending.category} onClick={() => void run('category', addCategory)}>{pending.category ? 'Adding…' : 'Add'}</button></div>
    </div>
    {Object.entries(errors).map(([key, error]) => error && <div className="error" role="alert" key={key}>{error}</div>)}
  </>;
}

function Data({ state, notify }: PaneProps) {
  const { pending, errors, run } = useActions();
  const removed = [
    ...state.suppressed.ids.map((item) => ({ target: `id:${item.key}`, title: item.title, detail: item.kind })),
    ...state.suppressed.rules.map((rule) => ({ target: `rule:${rule.id}`, title: `Everything like “${rule.sample}”`, detail: rule.scope || '' })),
  ];
  return <>
    <div className="group">
      <h4>Stored on this computer</h4><div>{fmtBytes(state.storageBytes)}</div>
      <div className="meter"><i style={{ width: `${Math.min(100, state.storageBytes / (5 * 1024 * 1024) * 100)}%` }} /></div>
      <p>One small file holds everything. Synced items older than {state.settings.sync.keepPastDays} days or more than {state.settings.sync.horizonDays} days ahead are pruned automatically.</p>
    </div>
    <div className="group">
      <h4>Deleted items</h4><p>Deleting a synced item only hides it here. Your calendars and Canvas are never changed.</p>
      {removed.length ? <>
        <div className="list-plain">{removed.slice(0, 50).map((item) => <div className="list-row" key={item.target}><div className="text"><div>{item.title}</div>{item.detail && <div className="t3">{item.detail}</div>}</div><button type="button" className="pill" disabled={pending[item.target] || pending.all} onClick={() => void run(item.target, () => window.api.restoreSuppressed(item.target))}>{pending[item.target] ? 'Restoring…' : 'Restore'}</button></div>)}</div>
        {removed.length > 50 && <div className="hint">{removed.length - 50} more deleted items</div>}
        <div><button type="button" className="pill" disabled={pending.all} onClick={() => void run('all', () => window.api.restoreSuppressed('all'))}>{pending.all ? 'Restoring…' : 'Restore all'}</button></div>
      </> : <div className="hint">Nothing deleted.</div>}
    </div>
    <div className="group"><h4>Sample data</h4><div><button type="button" className="pill" disabled={pending.demo} onClick={() => void run('demo', async () => {
      if (state.demo) await window.api.clearDemo(); else await window.api.loadDemo();
      notify(state.demo ? 'Sample data removed' : 'Sample data loaded');
    })}>{pending.demo ? 'Updating…' : state.demo ? 'Remove sample data' : 'Load sample data'}</button></div></div>
    <div className="group"><h4>Clear downloaded data</h4><p>Removes downloaded events, assignments and weather and downloads them again. Your tasks, flags and deletions stay.</p><div><button type="button" className="pill" disabled={pending.cache} onClick={() => void run('cache', async () => {
      await window.api.clearCache(); notify('Downloaded data refreshed');
    })}>{pending.cache ? 'Syncing…' : 'Clear and sync again'}</button></div></div>
    {Object.entries(errors).map(([key, error]) => error && <div className="error" key={key} role="alert">{error}</div>)}
  </>;
}

export function Settings({ state, now, section, onSection, onClose, notify }: SettingsProps): React.JSX.Element {
  const [settingsError, setSettingsError] = useState('');
  const update: Update = (patch) => {
    setSettingsError('');
    void window.api.updateSettings(patch).catch((error: unknown) => setSettingsError(errorMessage(error)));
  };
  const props = { state, now, onSection, notify, update };
  let pane: ReactNode;
  switch (section) {
    case 'general': pane = <General settings={state.settings} update={update} />; break;
    case 'calendars': pane = <Calendars {...props} />; break;
    case 'canvas': pane = <Canvas {...props} />; break;
    case 'weather': pane = <Weather {...props} />; break;
    case 'notifications': pane = <Notifications settings={state.settings} update={update} notify={notify} />; break;
    case 'tasks': pane = <Tasks {...props} />; break;
    case 'data': pane = <Data {...props} />; break;
  }
  return <Modal title="Settings" className="settings" onClose={onClose} initialFocus=".settings-nav [aria-current='true']">
    <div className="settings-body">
      <nav className="settings-nav" aria-label="Settings sections">{SETTINGS_SECTIONS.map(({ id, label }) => <button type="button" key={id} aria-current={id === section} onClick={() => onSection(id)}>{label}</button>)}</nav>
      <div className="settings-pane" key={section}>{pane}{settingsError && <div className="error" role="alert">{settingsError}</div>}</div>
    </div>
  </Modal>;
}
