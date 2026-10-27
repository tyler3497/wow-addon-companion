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
