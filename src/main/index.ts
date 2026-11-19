import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification, powerMonitor, session, shell, Tray, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeBaseUrl } from '../shared/canvas';
import { mergeDeep } from '../shared/defaults';
import { exportTasksCsv, exportTasksJson } from '../shared/importers';
import { normalizeFeedUrl } from '../shared/ics';
import { sanitizeSettings, toggleOnly } from '../shared/settings';
import { addDays } from '../shared/time';
import type { ActionResult, AppState, DeepPartial, HelpTopic, ItemOverlay, Settings, TaskInput } from '../shared/types';
import * as actions from './actions';
import { applyDemo, stripDemo } from './demo';
import createIcsWorker from './ics-worker?nodeWorker';
import { ReminderService, type Toast } from './reminders';
import { Secrets } from './secrets';
import { describeError, type FetchFn } from './services/http';
import { workerParser, type IcsParser } from './services/icsParser';
import { createTransport } from './services/net';
import { fetchCanvas, fetchFeed, fetchICloud, googleAuthorize, googleRevoke, searchPlaces, type GoogleTokens } from './services/sources';
import { Store } from './store';
import { SECRET, SyncService } from './sync';

// ---- development switches (see README "Developing") ----
const ENV = {
  userData: process.env.PROCRASTINATOR_USER_DATA,
  demo: process.env.PROCRASTINATOR_DEMO === '1',
  shotDir: process.env.PROCRASTINATOR_SHOT,
  shotSteps: process.env.PROCRASTINATOR_SHOT_STEPS,
  /** "WIDTHxHEIGHT" for screenshot runs, e.g. 980x640 for the smallest window. */
  shotSize: /^(\d{3,4})x(\d{3,4})$/.exec(process.env.PROCRASTINATOR_SHOT_SIZE ?? ''),
  offline: process.env.PROCRASTINATOR_OFFLINE === '1',
  /** A local .ics file to read on the calendar worker; prints the outcome and quits (checks a packaged build). */
  parseProbe: process.env.PROCRASTINATOR_PARSE_PROBE,
};
if (ENV.userData) app.setPath('userData', path.resolve(ENV.userData));

const APP_ID = 'com.procrastinator.app';
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const isMac = process.platform === 'darwin';

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let flushed = false;
let trayHintShown = false;
let syncTimer: NodeJS.Timeout | null = null;
let pushTimer: NodeJS.Timeout | null = null;
const liveNotifications = new Set<Notification>();

let store: Store;
let secrets: Secrets;
let sync: SyncService;
let reminders: ReminderService;

// Every network request goes through this transport, which enforces where it may go (services/egress.ts).
const fetchFn: FetchFn = createTransport({ offline: () => ENV.offline });

// Calendar files are parsed on a worker thread that is stopped if it runs too long.
const parser: IcsParser = workerParser(() => createIcsWorker({ resourceLimits: { maxOldGenerationSizeMb: 512 } }));

/** Help pages the window may open, by name. */
const HELP_LINKS: Record<HelpTopic, string> = {
  'google-console': 'https://console.cloud.google.com/apis/credentials',
  'apple-account': 'https://account.apple.com/account/manage',
  'open-meteo': 'https://open-meteo.com/',
};

// Icons are unpacked from the asar archive (package.json "asarUnpack"): Windows toasts and the
// tray need a real file path, not one inside app.asar.
const resource = (name: string): string =>
  path.join(app.getAppPath(), 'resources', name).replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

// ------------------------------------------------------------------ state

function publicState(): AppState {
  const d = store.data;
  return {
    settings: d.settings,
    tasks: d.tasks,
    events: d.events,
    assignments: d.assignments,
    overlay: d.overlay,
    suppressed: d.suppressed,
    weather: d.weather,
    sync: d.sync,
    connections: {
      google: { connected: secrets.has(SECRET.googleTokens) },
      icloud: { connected: secrets.has(SECRET.icloudPassword) },
      canvas: { connected: secrets.has(SECRET.canvasToken) },
      secureStorage: secrets.available,
    },
    demo: d.demo,
    platform: process.platform,
    storageBytes: store.sizeBytes(),
  };
}

function pushState(): void {
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    if (win && !win.isDestroyed()) win.webContents.send('state', publicState());
  }, 40);
}

// ------------------------------------------------------------------ window, tray, theme

function overlayFor(dark: boolean): Electron.TitleBarOverlayOptions {
  return { color: '#00000000', symbolColor: dark ? '#A9A59C' : '#57544D', height: 44 };
}

function applyTheme(): void {
  nativeTheme.themeSource = store.data.settings.theme;
  const dark = nativeTheme.shouldUseDarkColors;
  if (win && !win.isDestroyed()) {
    win.setBackgroundColor(dark ? '#131311' : '#F2F0EB');
    if (!isMac) win.setTitleBarOverlay(overlayFor(dark));
  }
}

function showWindow(): void {
  if (!win || win.isDestroyed()) {
    createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow(): void {
  const dark = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    width: ENV.shotDir && ENV.shotSize ? Number(ENV.shotSize[1]) : 1440,
    height: ENV.shotDir && ENV.shotSize ? Number(ENV.shotSize[2]) : 900,
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: 'Procrastinator',
    backgroundColor: dark ? '#131311' : '#F2F0EB',
    icon: isMac ? undefined : resource('icon.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 16, y: 14 } } : { titleBarOverlay: overlayFor(dark) }),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      // Developer tools only in development builds.
      devTools: !app.isPackaged,
    },
  });

  win.once('ready-to-show', () => {
    if (!ENV.shotDir) win?.show();
  });

  win.on('close', (event) => {
    if (quitting || !store.data.settings.keepInTray) return;
    event.preventDefault();
    win?.hide();
    if (!trayHintShown && !isMac) {
      trayHintShown = true;
      showToast({ title: 'Procrastinator is still running', body: 'It stays in the tray so reminders can reach you. Right-click the tray icon to quit.' });
    }
  });
  win.on('closed', () => {
    win = null;
  });

  // Navigation, new windows and webviews are refused for every page (see 'web-contents-created').

  // During development, renderer warnings and errors (CSP violations, React) show in the terminal.
  if (!app.isPackaged) {
    win.webContents.on('console-message', (e) => {
      if (e.level === 'warning' || e.level === 'error') console.log(`[renderer:${e.level}] ${e.message}`);
    });
  }

  const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
  const query = ENV.shotDir ? { harness: '1' } : undefined;
  if (devUrl) void win.loadURL(query ? `${devUrl}?harness=1` : devUrl);
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'), { query });

  if (ENV.shotDir) win.webContents.once('did-finish-load', () => void runScreenshots(ENV.shotDir!));
}

function createTray(): void {
  const image = nativeImage.createFromPath(resource(isMac ? 'trayTemplate.png' : 'tray.png'));
  if (image.isEmpty()) {
    console.warn('[tray] icon missing; run `npm run icons`');
    return;
  }
  tray = new Tray(image);
  tray.setToolTip('Procrastinator');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Procrastinator', click: showWindow },
      { label: 'New task…', click: () => { showWindow(); win?.webContents.send('command', 'new-task'); } },
      { label: 'Sync now', click: () => void sync.syncAll(true) },
      { type: 'separator' },
      { label: 'Quit', click: () => { quitting = true; app.quit(); } },
    ]),
  );
  tray.on('click', showWindow);
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Today', accelerator: 'CmdOrCtrl+T', click: () => win?.webContents.send('command', 'today') },
        { label: 'New task…', accelerator: 'CmdOrCtrl+N', click: () => win?.webContents.send('command', 'new-task') },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => win?.webContents.send('command', 'settings') },
        { type: 'separator' },
        { role: 'reload' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }]),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ------------------------------------------------------------------ notifications

function showToast(toast: Toast): void {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: toast.title, body: toast.body, icon: isMac ? undefined : resource('icon.png') });
  // Keep a reference until it goes away, or the click handler can be garbage-collected.
  liveNotifications.add(n);
  const release = (): void => void liveNotifications.delete(n);
  n.on('click', () => {
    release();
    showWindow();
    if (toast.itemKey) win?.webContents.send('command', 'reveal', toast.itemKey);
  });
  n.on('close', release);
  // Visible when launched from a terminal; useful when a reminder seems not to arrive.
  n.on('show', () => console.info('[notify] shown:', toast.title));
  n.on('failed', (_e, error) => {
    release();
    console.warn('[notify] failed:', error);
  });
  n.show();
}

// ------------------------------------------------------------------ helpers

function openExternal(url: string): void {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'http:') void shell.openExternal(u.toString());
  } catch {
    // not a URL; ignore
  }
}

function armSyncTimer(): void {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = null;
  const { auto, intervalMin } = store.data.settings.sync;
  if (auto) syncTimer = setInterval(() => void sync.syncAll(), Math.max(5, intervalMin) * 60_000);
}

/** Text arguments from the window: a string of at most `max` characters, else null. */
function arg(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length <= max ? value : null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const fail = (err: unknown): ActionResult => ({ ok: false, message: describeError(err) });

// ------------------------------------------------------------------ IPC handlers

type Handler = (...args: never[]) => unknown;

// Every argument comes from the page, which only renders data but is treated as untrusted:
// strings are length-checked, IDs must name something that exists, and settings are
// validated field by field.
const handlers: Record<string, Handler> = {
  getState: () => publicState(),

  saveTask: (input: unknown) => (isRecord(input) ? actions.saveTask(store, input as unknown as TaskInput, Date.now()) : { ok: false, message: 'The task could not be saved.' }),
  deleteItem: (key: unknown, scope?: unknown) => {
    if (!actions.isItemKey(key)) return { ok: false, message: 'That item no longer exists.' };
    return actions.deleteItem(store, key, scope === 'series' ? 'series' : 'one', Date.now());
  },
  setFlags: (key: unknown, flags: unknown) => {
    if (actions.isItemKey(key) && isRecord(flags)) actions.setFlags(store, key, flags as Partial<ItemOverlay>);
  },
  previewSimilar: (key: unknown) => (actions.isItemKey(key) ? actions.previewSimilar(store, key, Date.now()) : null),
  deleteSimilar: (key: unknown) => (actions.isItemKey(key) ? actions.deleteSimilar(store, key, Date.now()) : 0),
  restoreSuppressed: (target: unknown) => {
    if (actions.isItemKey(target)) actions.restoreSuppressed(store, target);
  },

  updateSettings: async (patch: unknown) => {
    if (!isRecord(patch)) return;
    const before = store.data.settings;
    const next = sanitizeSettings(mergeDeep(structuredClone(before), patch as DeepPartial<Settings>), before);
    // Connection identity is changed through the connect/disconnect calls, never a settings
    // patch; a patch may only switch the account's existing calendars on or off.
    next.feeds = before.feeds;
    next.icloud.username = before.icloud.username;
    next.canvas.baseUrl = before.canvas.baseUrl;
    next.google.calendars = toggleOnly(before.google.calendars, next.google.calendars);
    next.icloud.calendars = toggleOnly(before.icloud.calendars, next.icloud.calendars);
    store.update((d) => {
      d.settings = next;
    });
    if (next.theme !== before.theme) applyTheme();
    if (next.launchAtLogin !== before.launchAtLogin && app.isPackaged) app.setLoginItemSettings({ openAtLogin: next.launchAtLogin });
    if (next.sync.auto !== before.sync.auto || next.sync.intervalMin !== before.sync.intervalMin) armSyncTimer();
    const placeChanged = JSON.stringify(next.weather) !== JSON.stringify(before.weather);
    if (placeChanged && next.weather.place) void sync.sync('weather', true);
    if (JSON.stringify(next.google.calendars) !== JSON.stringify(before.google.calendars)) void sync.sync('google', true);
    if (JSON.stringify(next.icloud.calendars) !== JSON.stringify(before.icloud.calendars)) void sync.sync('icloud', true);
  },

  sync: (source?: unknown) => {
    if (source === undefined || source === null) return sync.syncAll(true);
    // Only sources that are actually configured; anything else would leave a stray status entry.
    if (typeof source !== 'string' || !sync.sources().includes(source)) return undefined;
    return sync.sync(source, true);
  },

  searchPlaces: async (query: unknown) => {
    const q = (arg(query, 200) ?? '').trim();
    if (q.length < 2) return [];
    try {
      return await searchPlaces(fetchFn, q.slice(0, 100));
    } catch {
      return [];
    }
  },

  connectGoogle: async (clientSecret?: unknown): Promise<ActionResult> => {
    const clientId = store.data.settings.google.clientId.trim();
    if (!clientId) return { ok: false, message: 'Enter your Google OAuth client ID first.' };
    const secret = clientSecret === undefined || clientSecret === null ? '' : arg(clientSecret, 200);
    if (secret === null) return { ok: false, message: 'That client secret does not look right.' };
    try {
      if (secret.trim()) await secrets.set(SECRET.googleClientSecret, secret.trim());
      const tokens = await googleAuthorize(fetchFn, clientId, await secrets.get(SECRET.googleClientSecret), openExternal);
      await secrets.set(SECRET.googleTokens, JSON.stringify(tokens));
      await sync.sync('google', true);
      pushState();
      return { ok: true };
    } catch (err) {
      return fail(err);
    }
  },

  connectICloud: async (username: unknown, appPassword: unknown): Promise<ActionResult> => {
    const user = (arg(username, 320) ?? '').trim();
    const pass = (arg(appPassword, 100) ?? '').trim();
    if (!user || !pass) return { ok: false, message: 'Enter your Apple Account email and an app-specific password.' };
    try {
      const now = Date.now();
      await fetchICloud(fetchFn, parser, user, pass, [], { start: now, end: addDays(now, 1) }); // proves the sign-in works
      await secrets.set(SECRET.icloudPassword, pass);
      store.update((d) => {
        d.settings.icloud.username = user;
      });
      await sync.sync('icloud', true);
      return { ok: true };
    } catch (err) {
      return fail(err);
    }
  },

  connectCanvas: async (baseUrl: unknown, token: unknown): Promise<ActionResult> => {
    const base = normalizeBaseUrl(arg(baseUrl, 2048) ?? '');
    const tok = (arg(token, 1024) ?? '').trim();
    if (!base) return { ok: false, message: 'Enter your school’s Canvas address, for example canvas.school.edu.' };
    if (!tok) return { ok: false, message: 'Paste an access token from Canvas.' };
    try {
      const now = Date.now();
      await fetchCanvas(fetchFn, base, tok, { start: now, end: addDays(now, 1) }); // proves the token works
      await secrets.set(SECRET.canvasToken, tok);
      store.update((d) => {
        d.settings.canvas.baseUrl = base;
      });
      await sync.sync('canvas', true);
      return { ok: true };
    } catch (err) {
      return fail(err);
    }
  },

  disconnect: async (source: unknown) => {
    if (source === 'google') {
      const raw = await secrets.get(SECRET.googleTokens);
      await secrets.set(SECRET.googleTokens, null);
      await secrets.set(SECRET.googleClientSecret, null);
      store.update((d) => {
        d.settings.google.calendars = [];
      });
      // Also cancel the grant at Google so the old tokens stop working (best effort; offline is fine).
      if (raw) {
        try {
          void googleRevoke(fetchFn, JSON.parse(raw) as GoogleTokens).catch(() => undefined);
        } catch {
          // unreadable token record; nothing to revoke
        }
      }
    } else if (source === 'icloud') {
      await secrets.set(SECRET.icloudPassword, null);
      store.update((d) => {
        d.settings.icloud = { username: '', calendars: [] };
      });
    } else if (source === 'canvas') {
      await secrets.set(SECRET.canvasToken, null);
      store.update((d) => {
        d.settings.canvas.baseUrl = '';
      });
    } else return;
    sync.dropSource(source);
  },

  addFeed: async (name: unknown, url: unknown): Promise<ActionResult> => {
    const address = normalizeFeedUrl(arg(url, 4096) ?? '');
    if (!address) return { ok: false, message: 'Paste the full calendar address (it usually ends in .ics).' };
    const id = randomUUID().slice(0, 8);
    try {
      const now = Date.now();
      const probe = await fetchFeed(fetchFn, parser, address, `feed:${id}`, '', { start: now, end: addDays(now, 1) });
      const label = (arg(name, 200) ?? '').trim() || probe.calendarName || new URL(address).hostname;
      await secrets.set(SECRET.feed(id), address);
      store.update((d) => {
        d.settings.feeds.push({ id, name: label.slice(0, 60), host: new URL(address).hostname });
      });
      await sync.sync(`feed:${id}`, true);
      return { ok: true, message: secrets.available ? undefined : 'Added for this session only: secure storage is unavailable on this computer.' };
    } catch (err) {
      return fail(err);
    }
  },

  removeFeed: async (id: unknown) => {
    if (typeof id !== 'string' || !store.data.settings.feeds.some((f) => f.id === id)) return;
    await secrets.set(SECRET.feed(id), null);
    store.update((d) => {
      d.settings.feeds = d.settings.feeds.filter((f) => f.id !== id);
    });
    sync.dropSource(`feed:${id}`);
  },

  importTasks: async () => {
    if (!win) return null;
    const pick = await dialog.showOpenDialog(win, {
      title: 'Import tasks',
      properties: ['openFile'],
      filters: [{ name: 'Tasks (CSV, JSON, iCalendar)', extensions: ['csv', 'json', 'ics'] }],
    });
    if (pick.canceled || pick.filePaths.length === 0) return null;
    const file = pick.filePaths[0];
    try {
      if ((await stat(file)).size > MAX_IMPORT_BYTES) return { added: 0, skipped: 0, errors: ['That file is too large to import.'] };
      return actions.importTasks(store, path.basename(file), await readFile(file, 'utf8'), Date.now());
    } catch (err) {
      return { added: 0, skipped: 0, errors: [(err as Error).message] };
    }
  },

  exportTasks: async (format: unknown): Promise<ActionResult | null> => {
    if (!win) return null;
    const ext = format === 'csv' ? 'csv' : 'json';
    const pick = await dialog.showSaveDialog(win, { title: 'Export tasks', defaultPath: `procrastinator-tasks.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (pick.canceled || !pick.filePath) return null;
    try {
      await writeFile(pick.filePath, ext === 'csv' ? exportTasksCsv(store.data.tasks) : exportTasksJson(store.data.tasks), 'utf8');
      return { ok: true, message: `Saved ${store.data.tasks.length} tasks.` };
    } catch (err) {
      return fail(err);
    }
  },

  loadDemo: () => store.update((d) => applyDemo(d, Date.now())),
  clearDemo: () => store.update((d) => stripDemo(d)),
  clearCache: async () => {
    actions.clearCache(store);
    await sync.syncAll(true);
  },

  testNotification: (): ActionResult => {
    if (!Notification.isSupported()) return { ok: false, message: 'This system does not support notifications.' };
    showToast({ title: 'Start soon: Example assignment', body: 'About 2 h of work, due today 5:00 PM. This is a test from Procrastinator.' });
    return { ok: true };
  },

  // The page names an item or a help topic; the address itself always comes from saved data.
  openItem: (key: unknown) => {
    if (!actions.isItemKey(key)) return;
    const url = actions.findItem(store.data, key, Date.now())?.url;
    if (url) openExternal(url);
  },
  openHelp: (topic: unknown) => {
    if (typeof topic === 'string' && Object.hasOwn(HELP_LINKS, topic)) openExternal(HELP_LINKS[topic as HelpTopic]);
  },
};

function trusted(event: IpcMainInvokeEvent): boolean {
  return !!win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame;
}

// ------------------------------------------------------------------ screenshots (development)

async function runScreenshots(dir: string): Promise<void> {
  const out = path.resolve(dir);
  await mkdir(out, { recursive: true });
  const steps = (ENV.shotSteps ?? 'week-light,week-dark,month-dark,day-light,dialog-light,menu-dark,settings-light,due-dark').split(',');
  const wc = win!.webContents;
  win!.showInactive();
  let failed = false;
  try {
    for (const step of steps) {
      await wc.executeJavaScript(`window.__harness.apply(${JSON.stringify(step)})`, true);
      await new Promise((r) => setTimeout(r, 700));
      const image = await wc.capturePage();
      // "settings:data-light" -> "settings_data-light.png" (a colon would make an NTFS stream).
      await writeFile(path.join(out, `${step.replace(/[^\w.-]/g, '_')}.png`), image.toPNG());
      console.log(`[shot] ${step}`);
    }
  } catch (err) {
    failed = true;
    console.error('[shot] failed:', err);
  }
  quitting = true;
  await store.flush();
  app.exit(failed ? 1 : 0);
}

/** Reads a calendar file on the worker thread exactly as a sync would, prints the outcome and quits. */
async function runParseProbe(file: string): Promise<void> {
  const started = Date.now();
  let code = 0;
  try {
    const now = Date.now();
    const text = await readFile(path.resolve(file), 'utf8');
    const [outcome] = await parser([{ text, options: { sourceId: 'probe', rangeStart: addDays(now, -30), rangeEnd: addDays(now, 120) } }]);
    const ms = Date.now() - started;
    if (outcome.ok) {
      console.log(`[parse-probe] read ${outcome.result.events.length} events in ${ms} ms${outcome.result.truncated ? ' (truncated)' : ''}`);
    } else {
      code = 2;
      console.log(`[parse-probe] the file is not a readable calendar (${ms} ms): ${outcome.error}`);
    }
  } catch (err) {
    code = 1;
    console.log(`[parse-probe] ${describeError(err)} (${Date.now() - started} ms)`);
  }
  app.exit(code);
}

// ------------------------------------------------------------------ lifecycle

// No page in the app may open windows, embed webviews or navigate away from the app's own page.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.on('will-navigate', (event, url) => {
    if (url !== contents.getURL()) event.preventDefault();
  });
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  void app.whenReady().then(async () => {
    if (ENV.parseProbe) {
      await runParseProbe(ENV.parseProbe);
      return;
    }
    if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? APP_ID : process.execPath);

    store = new Store(app.getPath('userData'));
    secrets = new Secrets(path.join(app.getPath('userData'), 'secrets.json'));
    await secrets.init();
    sync = new SyncService(store, secrets, fetchFn, parser);
    reminders = new ReminderService(store, showToast);

    if (ENV.demo) store.update((d) => applyDemo(d, Date.now()));
    store.update(() => store.prune(Date.now()));
    store.onChange(pushState);

    // The page needs no browser permissions (camera, location, notifications, clipboard...).
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);

    ipcMain.handle('api', async (event, method: string, ...args: unknown[]) => {
      if (!trusted(event)) throw new Error('Rejected call from an untrusted frame.');
      const handler = Object.hasOwn(handlers, method) ? handlers[method] : undefined;
      if (!handler) throw new Error(`Unknown call "${String(method)}"`);
      return (handler as (...a: unknown[]) => unknown)(...args);
    });

    applyTheme();
    nativeTheme.on('updated', applyTheme);
    buildMenu();
    createWindow();
    createTray();

    if (store.loadError) dialog.showErrorBox('Procrastinator', store.loadError);

    if (!ENV.shotDir) reminders.start();
    void sync.syncAll();
    armSyncTimer();
    powerMonitor.on('resume', () => {
      void sync.syncAll();
      reminders.tick();
    });

    app.on('activate', showWindow);
  });

  app.on('window-all-closed', () => {
    if (!isMac && !store?.data.settings.keepInTray) app.quit();
  });

  app.on('before-quit', (event) => {
    if (!store) return;
    if (quitting && flushed) return;
    quitting = true;
    event.preventDefault();
    void store.flush().finally(() => {
      flushed = true;
      app.quit();
    });
  });
}
