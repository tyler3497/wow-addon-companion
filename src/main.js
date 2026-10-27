'use strict';
const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
// No File/Edit/View menu at all — the app has no use for one, and
// with a frameless window it would otherwise be the only chrome left.
Menu.setApplicationMenu(null);
const path = require('path');
const fs = require('fs');
const updater = require('./core/updater');
const { ADDONS, getAddon } = require('./core/addons');
const appUpdater = require('./core/appUpdater');

let mainWindow = null;
let settingsPath = null;
let settings = {};

function loadSettings() {
  settingsPath = path.join(app.getPath('userData'), 'settings.json');
  try {
    if (fs.existsSync(settingsPath)) settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (_) { settings = {}; }
  // Per-game AddOns folders, set in the Settings menu.
  // Migration: the old single addOnsPath was always the retail
  // folder (Gear Audit is retail), so it becomes retail's path.
  if (!settings.addOnsPaths || typeof settings.addOnsPaths !== 'object') {
    settings.addOnsPaths = {};
    if (settings.addOnsPath) settings.addOnsPaths.retail = settings.addOnsPath;
  }
  if (!settings.addOnsPaths.retail) settings.addOnsPaths.retail = updater.detectAddOnsPath('retail');
  if (!settings.addOnsPaths.forever) settings.addOnsPaths.forever = updater.detectAddOnsPath('forever');
}
function addOnsPathFor(game) {
  return (settings.addOnsPaths && settings.addOnsPaths[game]) || '';
}
function saveSettings() {
  try { fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2)); } catch (_) {}
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 860,
    height: 620,
    minWidth: 700,
    minHeight: 500,
    // Frameless: no Windows title bar, no standard min/max/close.
    // The renderer draws its own title bar (see index.html), styled
    // like the rest of the app, and drives these via IPC below.
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: "Tyler's WoW Tools",
    backgroundColor: '#18181c',
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
  // Keep the custom maximize/restore glyph in sync when the window
  // is maximized by other means (double-click, Win+arrow, snap).
  const sendMaxState = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:max-state', mainWindow.isMaximized());
    }
  };
  mainWindow.on('maximize', sendMaxState);
  mainWindow.on('unmaximize', sendMaxState);
  // Self-update: auto-check on launch, once the window is ready to
  // receive events. Silent when up to date or when this build has
  // no update feed — the result just lands in the App Updates view,
  // never as a popup. A found update only enables Download there.
  mainWindow.webContents.on('did-finish-load', () => {
    appUpdater.init((event) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('app-update:event', event);
      }
    });
    appUpdater.check().catch(() => {});
  });
}

app.whenReady().then(() => {
  loadSettings();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC: the feature API. New features add their own handlers here,
// ---- or in their own module under src/core/, and expose them in preload.js.
ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:set-path', (_e, game, p) => {
  if (game !== 'retail' && game !== 'forever') return settings;
  if (!settings.addOnsPaths) settings.addOnsPaths = {};
  settings.addOnsPaths[game] = p;
  saveSettings();
  return settings;
});
ipcMain.handle('dialog:pick-addons', async (_e, game) => {
  const label = game === 'forever' ? 'WoW Forever' : 'WoW Retail';
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: `Pick your ${label} AddOns folder (…\\Interface\\AddOns)`,
  });
  if (res.canceled || !res.filePaths[0]) return null;
  if (!settings.addOnsPaths) settings.addOnsPaths = {};
  settings.addOnsPaths[game] = res.filePaths[0];
  saveSettings();
  return settings.addOnsPaths[game];
});
// The addon registry, so the renderer builds its cards from it
// instead of hard-coding one addon.
ipcMain.handle('addons:list', () => ADDONS);
// One check for every registered addon, in parallel — this is
// the "Check All for Updates" button. Each entry carries its own
// installed/latest versions and whether an update is available.
ipcMain.handle('updater:check-all', async () => {
  const results = await Promise.all(ADDONS.map(async (addon) => {
    const addOnsPath = addOnsPathFor(addon.game);
    const installed = updater.getInstalledVersion(addOnsPath, addon);
    try {
      const latest = await updater.getLatestVersion(addon);
      return { id: addon.id, name: addon.name, game: addon.game, installed, latest, updateAvailable: installed !== 'not installed' && latest !== null && installed !== latest, error: null };
    } catch (e) {
      return { id: addon.id, name: addon.name, game: addon.game, installed, latest: null, updateAvailable: false, error: e.message };
    }
  }));
  return results;
});
ipcMain.handle('updater:update', async (event, addonId) => {
  const addon = getAddon(addonId);
  if (!addon) throw new Error(`Unknown addon: ${addonId}`);
  const log = (msg) => event.sender.send('updater:log', msg);
  // Tell the self-updater an addon update is running, so a
  // seamless app auto-install waits for it instead of
  // restarting the app mid-addon-update.
  appUpdater.setAddonUpdateRunning(true);
  try {
    return await updater.updateAddon(addOnsPathFor(addon.game), addon, log);
  } finally {
    appUpdater.setAddonUpdateRunning(false);
  }
});
ipcMain.handle('updater:open-folder', (_e, game) => {
  const p = addOnsPathFor(game);
  if (p && fs.existsSync(p)) shell.openPath(p);
});

// ---- Custom title bar controls (frameless window) ----
ipcMain.handle('window:minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.handle('window:maximize-toggle', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
});
ipcMain.handle('window:close', () => { if (mainWindow) mainWindow.close(); });

// ---- Self-update (the app itself, not the addon) ----
ipcMain.handle('app-update:current', () => appUpdater.currentVersion());
ipcMain.handle('app-update:check', () => appUpdater.check());
ipcMain.handle('app-update:download', () => appUpdater.download());
ipcMain.handle('app-update:install', () => appUpdater.install());
