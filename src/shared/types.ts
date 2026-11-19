// Domain types shared by the main process, the renderer and the tests.
// Everything here is plain JSON so it can cross IPC and be written to disk as-is.

export type ItemKind = 'event' | 'task' | 'assignment';
export type ViewMode = 'month' | 'week' | 'day';
/** 'calendar' = the current calendar week, 'rolling' = the next 7 days starting today. */
export type RangeMode = 'calendar' | 'rolling';
export type ThemeChoice = 'system' | 'light' | 'dark';
export type TempUnit = 'fahrenheit' | 'celsius';

export type RecurrenceFreq = 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly';

export interface Recurrence {
  freq: RecurrenceFreq;
  /** Last day the task repeats on, as a local YYYY-MM-DD (inclusive). */
  until?: string;
}

export interface Task {
  /** `task:<uuid>` */
  id: string;
  title: string;
  durationMin: number;
  /** When the user would like to be finished (ISO instant). */
  preferredDue: string;
  /** The hard deadline (ISO instant). Never earlier than preferredDue. */
  finalDeadline: string;
  category?: string;
  recurrence?: Recurrence;
  location?: string;
  url?: string;
  notes?: string;
  createdAt: string;
}

export interface TaskInput {
  id?: string;
  title: string;
  durationMin: number;
  preferredDue: string;
  finalDeadline: string;
  category?: string;
  recurrence?: Recurrence;
  location?: string;
  url?: string;
  notes?: string;
  important?: boolean;
}

export interface CalEvent {
  /** Unique per occurrence. */
  key: string;
  /** Shared by every occurrence of a repeating event. */
  seriesKey: string;
  /** 'google' | 'icloud' | 'feed:<id>' | 'demo' */
  sourceId: string;
  calendar?: string;
  title: string;
  /** ISO instant, or a local YYYY-MM-DD when allDay. */
  start: string;
  /** ISO instant, or an exclusive local YYYY-MM-DD when allDay. */
  end: string;
  allDay: boolean;
  recurring?: boolean;
  location?: string;
  url?: string;
  notes?: string;
}

export interface Assignment {
  /** `canvas:<type>:<id>` */
  key: string;
  /** 'canvas' | 'feed:<id>' | 'demo' */
  sourceId: string;
  title: string;
  course?: string;
  /** ISO instant, or a local YYYY-MM-DD when allDay. */
  dueAt: string;
  allDay: boolean;
  url?: string;
  points?: number;
  submitted: boolean;
  missing?: boolean;
  type: string;
}

/** Local-only annotations layered over synced items, keyed by item key or series key. */
export interface ItemOverlay {
  important?: boolean;
  muted?: boolean;
  done?: boolean;
  effortMin?: number;
}

export interface SuppressedId {
  key: string;
  title: string;
  kind: ItemKind;
  at: string;
}

export interface SuppressRule {
  id: string;
  /** Normalised title pattern (see similarity.ts). */
  pattern: string;
  kind: ItemKind;
  /** Course for assignments, calendar for events; empty matches any. */
  scope?: string;
  sample: string;
  at: string;
}

export interface Suppressed {
  ids: SuppressedId[];
  rules: SuppressRule[];
}

export interface Place {
  name: string;
  region?: string;
  country?: string;
  lat: number;
  lon: number;
}

export interface DayWeather {
  /** Local YYYY-MM-DD at the forecast location. */
  date: string;
  mean: number;
  max: number;
  min: number;
  /** Max chance of precipitation in percent, when the model provides it. */
  rain: number | null;
  uv: number | null;
  /** WMO weather code. */
  code: number;
  sunrise?: string;
  sunset?: string;
}

export interface HourWeather {
  /** Local `YYYY-MM-DDTHH:00` at the forecast location. */
  t: string;
  temp: number;
  rain: number | null;
  uv: number | null;
  code: number;
}

export interface WeatherCache {
  fetchedAt: string;
  place: Place;
  units: TempUnit;
  days: DayWeather[];
  hours: HourWeather[];
}

export interface CalendarRef {
  id: string;
  name: string;
  enabled: boolean;
}

export interface Feed {
  id: string;
  name: string;
  /** Host only. The full address is a bearer secret and lives in encrypted storage. */
  host: string;
}

export interface Settings {
  theme: ThemeChoice;
  view: ViewMode;
  rangeMode: RangeMode;
  weekStartsOn: 0 | 1;
  hour12: boolean;
  density: 'comfortable' | 'compact';
  keepInTray: boolean;
  launchAtLogin: boolean;
  weather: { place: Place | null; units: TempUnit };
  canvas: { baseUrl: string; defaultEffortMin: number; showSubmitted: boolean };
  google: { clientId: string; calendars: CalendarRef[] };
  icloud: { username: string; calendars: CalendarRef[] };
  feeds: Feed[];
  sync: { auto: boolean; intervalMin: number; keepPastDays: number; horizonDays: number };
  notify: {
    enabled: boolean;
    /** Warn when this little spare time is left before work has to start. */
    headsUpMin: number;
    /** Extra time added on top of every estimate, in percent. */
    bufferPct: number;
    respectSleep: boolean;
    /** Local HH:mm */
    sleepStart: string;
    sleepEnd: string;
    dailyDigest: boolean;
    digestTime: string;
  };
  categories: string[];
}

export interface SourceStatus {
  lastSync?: string;
  lastError?: string;
  /** The last sync worked but left something out (an oversized or partly unreadable calendar). */
  warning?: string;
  count?: number;
  syncing?: boolean;
}

/** Fixed help pages the window may ask to open; the addresses live in the main process. */
export type HelpTopic = 'google-console' | 'apple-account' | 'open-meteo';

export interface Connections {
  google: { connected: boolean };
  icloud: { connected: boolean };
  canvas: { connected: boolean };
  /** False when the OS keychain is unavailable, in which case secrets are not saved. */
  secureStorage: boolean;
}

/** Everything the renderer needs. Contains no secrets. */
export interface AppState {
  settings: Settings;
  tasks: Task[];
  events: CalEvent[];
  assignments: Assignment[];
  overlay: Record<string, ItemOverlay>;
  suppressed: Suppressed;
  weather: WeatherCache | null;
  sync: Record<string, SourceStatus>;
  connections: Connections;
  demo: boolean;
  platform: string;
  storageBytes: number;
}

/** What is written to disk. */
export interface Persisted {
  version: 1;
  settings: Settings;
  tasks: Task[];
  events: CalEvent[];
  assignments: Assignment[];
  overlay: Record<string, ItemOverlay>;
  suppressed: Suppressed;
  weather: WeatherCache | null;
  sync: Record<string, SourceStatus>;
  /** Highest reminder stage already shown, keyed by `<itemKey>|<deadline>`. */
  reminders: Record<string, number>;
  demo: boolean;
}

export interface SimilarPreview {
  rule: Omit<SuppressRule, 'id' | 'at'>;
  /** How many items match right now. */
  total: number;
  /** The first matches, for the confirmation dialog. */
  matches: { key: string; title: string; when: string }[];
}

export interface ImportResult {
  added: number;
  skipped: number;
  errors: string[];
}

export interface ActionResult {
  ok: boolean;
  message?: string;
}

export type DeepPartial<T> = T extends (infer U)[]
  ? U[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/** The IPC surface exposed to the renderer as `window.api`. */
export interface Api {
  getState(): Promise<AppState>;
  onState(cb: (state: AppState) => void): () => void;
  onCommand(cb: (command: string, arg?: string) => void): () => void;

  saveTask(input: TaskInput): Promise<ActionResult>;
  /** Deletes one item or occurrence; `series` removes every occurrence of a repeating item. */
  deleteItem(key: string, scope?: 'one' | 'series'): Promise<ActionResult>;
  setFlags(key: string, flags: Partial<ItemOverlay>): Promise<void>;
  previewSimilar(key: string): Promise<SimilarPreview | null>;
  deleteSimilar(key: string): Promise<number>;
  restoreSuppressed(target: string): Promise<void>;

  updateSettings(patch: DeepPartial<Settings>): Promise<void>;
  sync(source?: string): Promise<void>;
  searchPlaces(query: string): Promise<Place[]>;

  connectGoogle(clientSecret?: string): Promise<ActionResult>;
  connectICloud(username: string, appPassword: string): Promise<ActionResult>;
  connectCanvas(baseUrl: string, token: string): Promise<ActionResult>;
  disconnect(source: 'google' | 'icloud' | 'canvas'): Promise<void>;
  addFeed(name: string, url: string): Promise<ActionResult>;
  removeFeed(id: string): Promise<void>;

  importTasks(): Promise<ImportResult | null>;
  exportTasks(format: 'json' | 'csv'): Promise<ActionResult | null>;

  loadDemo(): Promise<void>;
  clearDemo(): Promise<void>;
  clearCache(): Promise<void>;
  testNotification(): Promise<ActionResult>;
  /** Opens an item's own link in the browser. The window names the item, never an address. */
  openItem(key: string): Promise<void>;
  openHelp(topic: HelpTopic): Promise<void>;
}
