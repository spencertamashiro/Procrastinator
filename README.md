# Procrastinator

A calm desktop week planner for Windows and macOS. One board shows your calendar events, Canvas assignments, your own tasks and the weather, hour by hour. It works out how much free time is left before each deadline and sends a last-minute desktop reminder when something has to be started.

> **Status: early build (0.1.0).** On Windows it builds, starts and passes its unit tests. The live Google, iCloud, Canvas and Open-Meteo connections have not yet been tried against the real services, and no macOS build has been made. See [What has and hasn't been verified](#what-has-and-hasnt-been-verified).

## What it does

- **Week view by default**, an hour-by-hour grid for each day, with **Month** and **Day** views a click away. A toggle switches between **this week** and **the next 7 days**.
- **Weather for every day**: average temperature, conditions, chance of rain and UV. Day view adds an hourly strip plus sunrise and sunset. The data comes from [Open-Meteo](https://open-meteo.com/) and needs no key.
- **Calendar events** from Google Calendar, Apple iCloud and any `.ics` feed (Outlook, school timetables, public calendars). The app only reads them and never changes your calendars.
- **Canvas assignments**, through either a personal access token (which knows what you've submitted) or the Canvas calendar feed (no token needed).
- **Tasks** that you add yourself or import from CSV, JSON or iCalendar files.
- **Last-minute reminders**: desktop notifications based on how much free time remains before each deadline, after your events and quiet hours are taken out.
- **Right-click any item** to mark it important, mute it, mark it done, set how long it needs, or delete it. You can also delete all its repeats, or everything with the same or a near-identical name.
- Light, dark or system theme, and a compact density.
- **Works offline.** Everything is kept in one small local file, so the last synced week always opens.

## Requirements

- Node.js 22.12 or newer (vitest requires 22.12+ or 24+). Development used Node 24.22 and npm 11.19.
- Windows 10/11 or macOS.

## Getting started

```sh
npm install
npm run dev
```

| Script | What it does |
|---|---|
| `npm run dev` | Start the app with hot reload (electron-vite). |
| `npm run build` | Compile the main, preload and renderer code into `out/`. |
| `npm start` | Build into `out/`, then run that build without hot reload. |
| `npm test` | Run the unit tests (vitest). |
| `npm run typecheck` | Type-check the main/preload and renderer code. |
| `npm run icons` | Regenerate the app and tray icons in `resources/`. |
| `npm run dist:win` / `npm run dist:mac` | Package an installer into `release/` (see [Packaging](#packaging)). |

To look around without connecting anything, click **Try sample data** on the empty board, or use **Settings → Data & storage → Load sample data**.

If Electron starts but no window appears and the log says `app` is undefined, the shell has `ELECTRON_RUN_AS_NODE=1` set. Processes started from VS Code's extension host inherit it. Unset it before launching: `env -u ELECTRON_RUN_AS_NODE npm run dev`, or run `Remove-Item Env:ELECTRON_RUN_AS_NODE` in PowerShell.

## Connecting your accounts

Everything is set up in **Settings** (the gear icon). Passwords, tokens and private feed addresses are encrypted with the operating system's keychain and kept out of the main data file. The app only ever reads from these services.

### Weather

In **Settings → Weather**, search for your city, pick it and choose °F or °C. Daily forecasts run from 6 days back, so the whole current week has weather, to 16 days ahead. Hourly detail runs from yesterday through the coming week. The forecast refreshes at most every 30 minutes.

### Google Calendar

Google requires each desktop app to use its own OAuth client:

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create a project and enable the **Google Calendar API**.
2. Set up the **OAuth consent screen** as *External* and add your Google account as a **test user**.
3. Create an **OAuth client ID** of type **Desktop app**.
4. In **Settings → Calendars → Google Calendar → Set up**, paste the **client ID** and **client secret**, then press **Connect**. Your browser opens so you can sign in. The app receives the result on a temporary `127.0.0.1` port, secured with PKCE.

The app requests two read-only scopes: `calendar.calendarlist.readonly` and `calendar.events.readonly`. Use the chips under the connection to choose which calendars appear.

> While the consent screen is in *Testing*, Google expires refresh tokens after 7 days ([Google's OAuth docs](https://developers.google.com/identity/protocols/oauth2#expiration)), so you would have to reconnect every week. To avoid that without publishing the OAuth app, add the calendar's **Secret address in iCal format** (Google Calendar → Settings → your calendar → Integrate calendar) as an [.ics feed](#other-calendars-ics-feeds) instead.

### Apple iCloud

1. Sign in at [account.apple.com](https://account.apple.com/account/manage), open **Sign-In and Security → App-Specific Passwords** and create one named Procrastinator.
2. In **Settings → Calendars → Apple iCloud → Set up**, enter your Apple Account email and that password.

The app reads your event calendars over CalDAV (`caldav.icloud.com`). Reminders lists are skipped.

### Canvas

There are two ways to connect:

- **Access token** (recommended, because it knows what you've submitted). In Canvas open **Account → Settings → Approved Integrations → New access token**. Then, in **Settings → Canvas → Set up**, enter your school's Canvas address (for example `canvas.school.edu`) and the token. The address must use HTTPS, and the token is only ever sent to that host. The app reads `/api/v1/planner/items`.
- **Calendar feed** (no token needed; some schools turn personal tokens off). In Canvas open **Calendar → Calendar Feed**, copy the link and add it as an [.ics feed](#other-calendars-ics-feeds). The feed's assignments appear as assignments, but a feed can't tell whether you've submitted them.

If both are set up, the token's copy of an assignment wins over the feed's. **Settings → Canvas** also sets how long an assignment is assumed to take (60 minutes) until you give it your own estimate.

### Other calendars (.ics feeds)

In **Settings → Calendars → Subscribed feeds**, paste any `.ics` address. `webcal://` links work too. Good sources are Google's secret iCal address, public iCloud calendars, Outlook and Canvas. A feed address often works like a password, so it is stored encrypted and always fetched over https: `webcal://` and `http://` addresses are fetched as `https://`, and a server that only answers plain http can't be used.

## Using it

### Moving around

| Key | Action |
|---|---|
| ← / → | Previous / next week, month or day |
| T | Today |
| N | New task |
| M / W / D | Month / Week / Day view |

Click a day's header to open it in Day view, or double-click an empty spot in the grid to start a task there. On macOS, the app menu also has Today (⌘T), New task (⌘N) and Settings (⌘,).

### Adding tasks

**New task** asks for four things:

- **Name**.
- **Approximate duration**.
- **Preferred due**: when you'd like it finished. The work block is drawn ending there.
- **Final deadline**: the hard limit that reminders count down to.

**More details** adds a category, a repeat (every day, weekday, week, 2 weeks or month) with an optional end date, a location, a website link, notes and an *important* flag.

**Settings → Tasks** imports `.csv`, `.json` and `.ics` (VTODO) files and exports CSV or JSON. CSV files use these columns: `name, duration, preferred due, final deadline, category, repeats, repeat until, location, link, notes`. Durations can be written as `90`, `45 min`, `1h 30m` or `1.5h`.

### Right-click menu

| Item | Effect |
|---|---|
| Mark as important | Stars the item and starts its reminders twice as early. Applies to every repeat. |
| Mute | Stops its reminders and fades it on the board. Applies to every repeat. |
| Mark as done | Ticks off this occurrence. Work that Canvas reports as submitted is already done. |
| Time it needs | Your estimate, used for planning and reminders. |
| Edit details… / Open link / Open in Canvas | |
| Delete (or Delete this one) | Deletes this item or occurrence. |
| Delete every repeat | Deletes the whole recurring series. |
| Delete all like this… | Deletes everything with the same or a near-identical name, after showing you the matches. |

Deleting a task removes it. Deleting a synced event or assignment only hides it in this app, because Google, iCloud and Canvas are never changed. You can bring it back from **Settings → Data & storage → Deleted items**. Every delete can also be undone from the notice at the bottom of the window.

**How "near-identical" works.** Both titles are first simplified: case, accents, punctuation, dates and a trailing `[course code]` are removed, and every number is treated alike. That makes *Problem Set 6* match *Problem Set 7*. The simplified titles must then be identical or at least 90% similar (Sørensen–Dice similarity over letter pairs). Matches are limited to the same kind of item, and to the same course or calendar. For synced items the match is saved as a rule, so future items like it stay hidden too.

## How reminders decide

Once a minute, the app looks at every unfinished, unmuted task and assignment due in the next 14 days:

1. **Effort** is the task's duration or your estimate for the assignment, padded by 15% (adjustable in **Settings → Notifications**).
2. **Free time** is the time between now and the deadline, minus calendar events and quiet hours (midnight to 7:00 by default).
3. Work is scheduled **earliest deadline first**, so anything due sooner uses up free time first.
4. **Slack** is free time, minus earlier work, minus this item's effort.

| When | Notification |
|---|---|
| Slack drops to 90 minutes (180 for important items) | **Start soon**, with the latest time to start |
| Slack drops to 15 minutes | **Start now** |
| Slack is below zero | **Behind on**: it no longer fits |
| 30 minutes before the deadline | **Due in …**, the final reminder |

Each stage notifies at most once per item and deadline. When more than three reminders fall due at once, they are combined into one notification. Nothing is sent during quiet hours. Items already past their deadline get no reminders and only show in the app. Clicking a notification opens the item. An optional morning summary (off by default, sent at 8:00) lists the day's work. The toolbar's **On track / N due soon** button shows the same analysis inside the app.

## Offline and storage

All data lives in one JSON file, `store.json`, in the app's data folder:

- Windows: `%APPDATA%\Procrastinator`
- macOS: `~/Library/Application Support/Procrastinator`

Sync runs at launch, every 30 minutes (adjustable in **Settings → Calendars**), when the computer wakes, and when you press **Sync now**. A source that fails keeps its last copy, and the title bar says *Offline* or names the problem, so the board always opens.

To keep the file small, synced data is pruned after each sync:

| Data | Kept |
|---|---|
| Events and assignments | 30 days back to 120 days ahead (both adjustable) |
| Daily weather | From 6 days ago |
| Hourly weather | From yesterday, 8 days in total |
| Reminder history | 14 days |
| Flags on single occurrences | Until the occurrence leaves the "keep past items" window |
| Deleted-item list | The newest 2,000 |

Your own tasks are never pruned. **Settings → Data & storage** shows the file size and the deleted items. It can also clear the downloaded data and sync it again. Saves are batched and written atomically: to a temporary file first, which is then renamed. If the file can't be read at launch, the app moves it aside as `store.unreadable-<time>.json` and never overwrites it.

Secrets live in `secrets.json` in the same folder. These are the Google tokens and client secret, the iCloud password, the Canvas token and feed addresses. They are encrypted with Electron's `safeStorage` (DPAPI on Windows, Keychain on macOS). If the operating system can't encrypt, they are kept in memory only and must be re-entered after a restart.

## Security

The app reads from several outside services and shows what they send. It treats every reply, and the window that displays it, as untrusted.

**Where requests may go.** Every request goes through one transport (`src/main/services/net.ts`). It sends no cookies, keeps none and caches nothing. Each request names a policy (`egress.ts`), which is checked before connecting and again at every redirect:

| Policy | Used for | Redirects |
|---|---|---|
| `credentialed` | Canvas and Google, which carry a token | Same origin only, so a token is never handed to another server |
| `icloud` | iCloud, which carries your Apple app password | Every request and redirect must stay on `*.icloud.com` or `*.icloud.com.cn` |
| `public` | Feeds and weather | May change host, but not from the internet into this computer or your local network |

All three policies apply the same base rules:
- Only https is used, a redirect may not drop to http, and addresses with a user name or password in them are refused.
- At most 5 redirects are followed.
- Each request has a deadline (20 s by default) and a size limit (12 MB by default). The size is counted after decompression, so a small compressed bomb is cut off too.
- A server asking for a password gets no login prompt; its 401 goes back to the caller.
- Disconnecting Google also revokes the grant at Google, when online.

**What arrives.** Text from services is clipped: titles and locations to 300 characters, calendar and course names to 100. Over-long IDs are shortened to a hash. Links are kept only if they are `http(s)`.

Calendar files are parsed on a worker thread with a 20-second deadline and a memory cap. ical.js can loop forever on an impossible repeat rule such as `FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30`. That file is skipped with a message, and the saved copy stays.

Each file also has a work budget, shown in Settings as a warning when it bites. Long daily and weekly series start just before the visible window instead of at their first occurrence, so the budget only limits unusual files.

Exported CSV cells that a spreadsheet would run as a formula (`=`, `+`, `-`, `@`, …) get a leading `'`. Importing the file again removes it.

**The window.** The page runs sandboxed, with context isolation and a strict Content-Security-Policy:
- It cannot navigate, open windows or embed webviews.
- Browser permissions (camera, location, notifications, clipboard) are refused.
- Developer tools are off in packaged builds.

The main process checks every call from the page:
- Text lengths are limited.
- Item keys and feed IDs must exist.
- Settings are validated field by field, and also when `store.json` is read. Prototype keys like `__proto__` are dropped.
- A settings change can't alter which accounts are connected; only the connect and disconnect actions can.
- The page can't pass a web address to open: it names an item or a help topic, and the main process looks up the address.

Error messages shown in Settings and written to logs keep only the scheme and host of any address, because a feed's path can be its secret.

**The packaged program.** Electron fuses are set at build time:
- `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect` are ignored.
- Cookies are encrypted.
- The app loads only from its own `app.asar`, which is checked against a hash embedded in the executable.

**Known limits.**
- The local-network check looks at host names and IP addresses, not at what a name resolves to. A public name that resolves to a private address (DNS rebinding) is not caught.
- If the page itself were compromised, it could still use the normal actions, for example adding a feed or connecting Canvas with an address of its choosing. The CSP and React's escaping make that hard, but the main process can't tell such calls from yours.
- The page is loaded from `file://` rather than a custom protocol, and the CSP allows inline styles.
- The CSP doesn't restrict WebRTC. The page contains no WebRTC code, so this only matters if the page were compromised.
- The builds are not code-signed. The asar check stops a modified `app.asar`, but not someone who replaces the executable itself.
- The development switches below work in packaged builds. They need someone who can already run programs as you, so they are out of scope.
- Live Google, iCloud and Canvas traffic has not been tested (see the last section).

**How it was checked.**
- **Unit tests:** `tests/egress.test.ts`, `sources-egress`, `sanitize`, `settings`, `http`, `csv-guard`, `ics-limits`, `ics-parser`, `ics-skip`, `item-keys`, `mapping-limits` and `sync-warning`. `sources-egress` checks that the iCloud wrapper forces the iCloud rule whatever the caller asks for, that tsdav's sign-in requests go through it (none reach the global `fetch`), and that the Canvas token isn't sent to a next-page link on another site. tsdav's requests after sign-in use the same wrapper according to its source, but no test covers them. `ics-skip` compares the skip-ahead against a full walk for 250 generated series. Three of four deliberately broken versions of the skip-ahead made it fail. The fourth, which starts one period later than it should, was not detected.
- **Transport probe:** `scripts/transport-probe/` runs the real transport inside Electron against local https servers, with 23 checks covering redirects, iCloud pinning, size limits, cookies and timeouts. The commands to run it are at the top of `main.cjs`.
- **Packaged build:** the calendar worker was checked in the packaged build with `PROCRASTINATOR_PARSE_PROBE`. A normal file reads in about 0.1 s, and the impossible repeat rule is stopped at 20 s. A copy of the packaged app with one byte changed in `app.asar` refused to start (*ASAR Integrity Violation: got a hash mismatch*); the unchanged copy ran normally.

## Development switches

These environment variables are read at launch, in packaged builds too:

| Variable | Effect |
|---|---|
| `PROCRASTINATOR_USER_DATA=<dir>` | Use this data folder instead of the normal one. |
| `PROCRASTINATOR_DEMO=1` | Load the sample data at every launch. |
| `PROCRASTINATOR_OFFLINE=1` | Make every network request fail as if the computer were offline. |
| `PROCRASTINATOR_SHOT=<dir>` | Screenshot harness: save PNGs into `<dir>`, then quit. Reminders don't run. |
| `PROCRASTINATOR_SHOT_STEPS=a,b,…` | Choose which shots to take. Default: `week-light,week-dark,month-dark,day-light,dialog-light,menu-dark,settings-light,due-dark`. |
| `PROCRASTINATOR_SHOT_SIZE=980x640` | Set the window size for the shots (default 1440×900). |
| `PROCRASTINATOR_PARSE_PROBE=<file.ics>` | Read a local calendar file on the calendar worker, as a sync would; print the result and quit. Exit code 0 means it was read, 1 means it failed or hit the deadline, 2 means it isn't valid iCalendar. Use it to check the worker in a packaged build. |

Each step is a set of words joined by `-`, in any order:

- **View:** `month`, `week` or `day`.
- **Theme:** `light` or `dark`.
- **Options:** `rolling` (next 7 days) and `compact` (compact density).
- **One overlay:**
  - `dialog`: new task. `more` opens it with details expanded, and `edit` edits an existing task.
  - `menu`: the right-click menu. `similar`: "delete all like this".
  - `due`: the due-soon list. `snack`: the undo notice.
  - `settings` or `settings:<section>`, where the section is `general`, `calendars`, `canvas`, `weather`, `notifications`, `tasks` or `data`.

Each file is named after its step, with unsafe characters replaced (`settings:data-light` → `settings_data-light.png`). The harness loads `out/`, so build first. This example was run on Windows from Git Bash:

```sh
npm run build
env -u ELECTRON_RUN_AS_NODE PROCRASTINATOR_DEMO=1 PROCRASTINATOR_USER_DATA=.dev-profile \
  PROCRASTINATOR_SHOT=.shots PROCRASTINATOR_SHOT_STEPS="week-light,settings:calendars-dark" \
  npx electron .
```

Git ignores `.dev-profile/` and `.shots/`.

## How it's built

The app uses Electron, React 19 and TypeScript, bundled by electron-vite.

```
src/
  main/            Electron main process
    index.ts         app lifecycle, window, tray, notifications, IPC, screenshot harness
    store.ts         store.json: load, atomic save, pruning
    secrets.ts       keychain-encrypted secrets.json
    sync.ts          pulls each source into the store; a failure keeps the saved copy
    reminders.ts     the once-a-minute reminder check
    actions.ts       edits, flags and deletes the user makes to their own data
    demo.ts          sample data
    ics-worker.ts    worker thread that parses calendar files
    services/        one function per outside service (Open-Meteo, Google, iCloud, Canvas, .ics)
      net.ts           the only network transport
      egress.ts        where each kind of request may go
      icsParser.ts     runs the worker with a deadline
  preload/         the sandboxed bridge exposed to the window as window.api
  renderer/        React UI: App.tsx, components/, styles.css
  shared/          pure logic used by both sides, covered by unit tests
    items.ts         merges events, assignments and tasks into board items
    urgency.ts       free time, slack and reminder stages
    analysis.ts      the single entry point that reminders and the UI both use
    similarity.ts    "delete all like this" matching
    ics.ts, google.ts, canvas.ts, weather.ts      parsing each service's responses
    settings.ts      validates every settings change and the saved settings
    sanitize.ts      length and link limits for outside text
    recurrence.ts, tasks.ts, importers.ts, time.ts, defaults.ts, types.ts
tests/             vitest unit tests
resources/         app and tray icons
scripts/           icon generator; transport-probe/ (see "Security")
```

The main process owns all data. It pushes the full state to the window over IPC, and the window asks it to make changes. The window never writes files or calls an outside service itself. Each outside request is a read: nothing is ever written to a calendar or to Canvas.

## Packaging

```sh
npm run dist:win   # release/Procrastinator-Setup-<version>.exe (x64)
npm run dist:mac   # DMG for Apple silicon and Intel; must be run on a Mac
```

Both first run `npm run notices`, which writes `licenses/THIRD_PARTY_NOTICES.txt` with the licence of every package bundled into the app. The installer places it next to `Procrastinator.exe`, beside Electron's `LICENSE.electron.txt` and `LICENSES.chromium.html`.

- The Windows installer installs per user (no administrator rights), lets you choose the folder, adds Start menu and desktop shortcuts, and keeps your data on uninstall.
- The builds are not code-signed. Windows shows *Windows protected your PC* the first time; choose **More info → Run anyway**. Signing needs a certificate configured in electron-builder.
- `author` is not set in `package.json`, so the installer and *Installed apps* show no publisher. Add one to put your name there.
- `resources/` is unpacked from the asar archive so the notification and tray icons load from real files.

**Sending it to someone.** Many email services block `.exe` files, even inside a zip. Share `release/Procrastinator-Setup-<version>.exe` through a cloud-drive link instead. Each person connects their own accounts:
- **Google:** the simplest route is the calendar's *secret address in iCal format*, added as a feed under **Settings → Calendars**. Full Google sync needs each person to create their own OAuth client (steps above).
- **iCloud and Canvas:** each person uses their own app-specific password or Canvas token.
- `resources/` is unpacked from the asar archive so the notification and tray icons load from real files.

## What has and hasn't been verified

Verified on Windows 11:

- `npm run typecheck`, `npm test` (648 tests) and `npm run build` pass. On the development machine, vitest sometimes failed to load every test file when started from Git Bash, with *Cannot read properties of undefined (reading 'config')*. Started from PowerShell, it worked every time.
- Through the screenshot harness: every view and overlay in light and dark, all seven settings panes, compact density, a 980×640 window and the empty first run.
- The unpacked packaged app (`electron-builder --dir`) starts and renders with the fuses on. `npx @electron/fuses read` shows the fuses as configured, with `ELECTRON_RUN_AS_NODE=1` the packaged exe still starts the app, and a copy with a modified `app.asar` refuses to start.
- The transport probe (23 checks) and the packaged-build calendar worker check described under "Security".
- The Windows installer (`Procrastinator-Setup-0.1.0.exe`), installed silently (`/S /D=<folder>`) into a test folder: it adds the Start menu and desktop shortcuts, the uninstall entry and `THIRD_PARTY_NOTICES.txt`. The installed app reads a calendar file and renders. The silent uninstall removes the program, shortcuts and entry, and keeps the user's data.
- A real desktop notification is shown.
- `npm run dev`, driven by the screenshot harness (week view and new-task dialog), prints no renderer errors or Content-Security-Policy refusals.
- Offline start: with a saved forecast and `PROCRASTINATOR_OFFLINE=1`, the board opens with the saved weather and the title bar says *Offline*.

Not verified yet:

- Live Google, iCloud and Canvas sync, the live Open-Meteo fetch, and Google token revocation on disconnect. The development environment had no network access, so request building and response parsing are tested only against the services' documented formats. The transport's rules were tested against local servers, not the real services.
- Whether Google accepts a Desktop client without its client secret. The setup steps ask for both.
- The macOS build, and how notifications, the tray and the title bar behave there.
- The installer's wizard was not clicked through, and it hasn't been run on another computer. Only the silent install and uninstall were run on the development machine (see above).
- Code signing.

## Design

The look is paper and ink:
- **Surfaces:** warm neutrals with a faint grain and one soft light bloom; hairline borders instead of frosted glass.
- **Colour:** a single cool ink accent (`--accent`), plus a warm colour (`--alert`) kept for time pressure: the current-time line, due-soon items, deletion and errors.
- **Shapes:** small corner radii; only switches, the scrollbar and meters stay round.
- **Type:** Newsreader for dates and dialog titles, DM Sans for everything else. Uppercase is used only for weekday names.

Colours and spacing are CSS variables at the top of `src/renderer/src/styles.css`, and the dark theme overrides them. To change the hue, change `--accent` and its `-strong`, `-soft` and `-mid` companions in both themes.

The original Figma mock-ups show an earlier violet look and are not part of this repository.

## Third-party services and licences

- **Open-Meteo**: free for non-commercial use without a key. The data is licensed CC BY 4.0 and credited in **Settings → Weather**. Commercial use needs a paid API plan ([terms](https://open-meteo.com/en/terms)).
- **Google Calendar API**: used through your own OAuth client and subject to Google's API Services User Data Policy. Publishing the OAuth app for other people requires Google's verification for these scopes.
- **Canvas**: uses each person's own token or feed, subject to their school's policies.
- **Libraries**: at runtime, `ical.js` 2.2.1 (MPL-2.0, used unmodified) and `tsdav` 2.5.0 (MIT), with tsdav's `xml-js`, `sax` (Blue Oak 1.0.0), `debug` and `ms`. The bundled fonts, DM Sans and Newsreader, are SIL OFL 1.1 (via Fontsource), and the icons come from Lucide (ISC). Electron and React are MIT. `licenses/THIRD_PARTY_NOTICES.txt` lists them all with their licence texts.
- **Procrastinator itself** has no licence file yet. Sharing copies privately doesn't need one. Before publishing it, choose one, or state that all rights are reserved.
