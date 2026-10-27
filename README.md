# WoW Addon Companion

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
  found, Download runs in the background, then Install & Restart
  appears. Nothing installs or restarts without you pressing it.
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
Grab the latest `GearAudit-win32-x64` folder from a release (or
the zip attached to a build), unzip it anywhere, and double-click
**GearAudit.exe**. No install, no Python, no admin rights needed.

### From source
```sh
npm install
npm start
```

### Build the Windows app (from any machine)
```sh
npm install
npm run pack:win
# produces dist/GearAudit-win32-x64/GearAudit.exe
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
- `src/renderer/` — HTML, CSS, and UI logic
