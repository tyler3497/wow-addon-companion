# Tyler's WoW Tools

A standalone Electron app for retail World of Warcraft, kept in its
own repo on purpose — separate from the addons themselves, so new
tools and features can grow here without touching addon code.

The addon it manages lives in its own repo:
https://github.com/tyler3497/wow-gear-audit

## Features

### 1. Updater (the first feature)
- Finds your WoW AddOns folder automatically
  (`…\World of Warcraft\_retail_\Interface\AddOns`), or lets you
  pick it once and remembers it.
- Shows your installed Gear Audit version vs the latest on GitHub.
- **Update / Install** downloads the `main` branch from GitHub,
  backs up your old version to a `GearAudit_backup_<date>` folder,
  and installs the new one.
- If WoW was already running, type `/reload` in game (or restart
  WoW) to load the new version.

### 2. Death Analyzer
- Open a `WoWCombatLog.txt` (or a zip of one) from
  `…\World of Warcraft\_retail_\Logs\` — turn logging on in game
  with `/combatlog` first, and Advanced Combat Logging for
  HP-after-hit on every line.
- Lists every pull (encounter, wipe/kill, duration) and every
  player death in it, including deaths outside encounters.
- Click a death and it expands in place under its row with:
  the killing blow (amount, overkill, effective damage),
  damage grouped by spell, healing gross vs net by source, a
  single timeline of every damage and healing event in the
  window before death (default 10s, 5/10/15s selectable),
  auras active at death as a real list, and defensives split
  into active / available (estimated from last cast +
  cooldown) / on cooldown.
- Player names are colored by class (with a class icon) and
  shown with their spec from the log (e.g. Warrior • Arms);
  the timeline color-codes damage red and healing green.
- Defensives are spec-aware: the available/on-cooldown lists
  are filtered to the player's spec where the database knows
  a restriction (e.g. a Protection Warrior does not see
  Die by the Sword, an Arms Warrior does not see Last Stand),
  while a defensive actually cast or active in the log is
  always shown even if it falls outside the spec list.
- Talents at pull start: each death shows the dead player's
  talent build from COMBATANT_INFO (spell IDs + ranks, with
  names and icons from Wowhead lookups), plus a collapsible
  talent-tree view (hidden by default) that shows the build
  as a grid of talent icons. The grid is in log order, not
  the in-game tree geometry — the log records which talents
  were picked, not where each node sits in the tree.
- Hover any spell name for what it does: defensives use the
  app's own database, other spells are looked up from
  Wowhead's public tooltip endpoint and cached (a failed
  lookup shows no description rather than a guessed one).
  When a death opens, every spell in it is looked up up
  front so the icons show immediately, not just on hover.
  Clicking a spell opens its Wowhead page.
- Spell-info caching (`src/core/spellCache.js`): a spell is
  fetched at most once per 30 days, or once when the game
  build changes (the dirty flag, since patches are when
  spell info can change), and only when actually shown;
  failed lookups are cached for 7 days, and concurrent
  requests for the same spell share one fetch.
- "Avoidable" is currently not shown at all: the combat log
  carries no avoidable flag, so it will come back only once
  a reliable source for it is settled on.
- Core parser: `src/core/deathAnalyzer.js` (pure Node, streams
  the file — a 187 MB / 648k-line raid log parses in ~6s),
  defensive database: `src/core/defensives.js`,
  tests: `src/core/deathAnalyzer.test.js`.

## Self-updates (the app updating itself)

Best way, and the one this app uses: **GitHub Releases +
electron-updater + electron-builder**.

- **Why Releases, not the `main` branch:** a release is versioned
  and immutable (tag `v1.2.0` + installer + `latest.yml`). The
  app can compare its own version against `latest.yml` and know
  for sure a newer build exists. `main` has no version and moves
  constantly, so it can't do that reliably.
- **Why electron-updater, not a hand-rolled zip swap:** on
  Windows a running .exe can't overwrite itself. electron-updater
  downloads the new installer, verifies it, and installs it on
  quit — that's the hard part, already solved.
- **In the app:** the App Updates view auto-checks on launch
  (silently — no popup if you're up to date). If an update is
  found, it downloads in the background, then installs silently
  (NSIS `/S`, no installer wizard) and relaunches on the new
  version — no clicks needed. The Download / Install & Restart
  buttons remain as a manual fallback.
- **Check freshness:** the check first asks api.github.com what
  the latest release actually is, because electron-updater's
  GitHub feed can lag a just-published release and falsely say
  "up to date" until a restart. If the feed is lagging, the app
  says so and retries in the same session instead of lying.
- **To ship a new version:** bump `version` in `package.json`,
  `git tag vX.Y.Z`, push the tag. The GitHub Actions workflow
  in `.github/workflows/release.yml` builds the Windows NSIS
  installer on a Windows runner and publishes the Release with
  `latest.yml`. (Building NSIS on Linux needs Wine, so CI is
  the reliable route.)
- **Limitation to know:** a folder build made with
  `npm run pack:win` (electron-packager) has no update feed, so
  it cannot self-update — its App Updates view will say so
  plainly. Only installer builds from a Release self-update.
  The first installer release is therefore the one that turns
  self-updates on for everyone after it.

## Run it on Windows

### Easy way — prebuilt app
Grab the latest `TylersWoWTools-win32-x64` folder from a release (or
the zip attached to a build), unzip it anywhere, and double-click
**TylersWoWTools.exe**. No install, no Python, no admin rights needed.

### From source
```sh
npm install
npm start
```

### Build the Windows app (from any machine)
```sh
npm install
npm run pack:win
# produces dist/TylersWoWTools-win32-x64/TylersWoWTools.exe
```
Zip that folder to hand it to someone — the .exe plus its
surrounding files are the whole app.

## Adding a feature later

This is why it's Electron instead of a one-off script:

1. Put the real work in a new module under `src/core/<feature>.js`
   (pure Node — no window code, so it can be tested headless).
2. Add an `ipcMain.handle` in `src/main.js` and expose it in
   `src/preload.js`.
3. Add a nav button + a `<section>` in
   `src/renderer/index.html` and a small init function in
   `src/renderer/renderer.js`.

That's it — the sidebar, settings storage, and window shell are
already shared.

## Tests

```sh
npm run test:core
```
That runs the updater's download/extract/replace path against
live GitHub and a mock AddOns folder — no window, no Electron
needed.

## Layout

- `src/main.js` — window + IPC handlers
- `src/preload.js` — the only bridge between window and Node
- `src/core/updater.js` — updater logic (download, extract, replace, backup)
- `src/core/updater.test.js` — headless core test
- `src/core/deathAnalyzer.js` — combat log parser (pulls, deaths, timelines, defensives)
- `src/core/defensives.js` — defensive cooldown database
- `src/core/deathAnalyzer.test.js` — headless parser test
- `src/renderer/` — HTML, CSS, and UI logic
