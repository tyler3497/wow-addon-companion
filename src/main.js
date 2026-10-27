'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const updater = require('./core/updater');

let mainWindow = null;
let settingsPath = null;
let settings = {};

function loadSettings() {
  settingsPath = path.join(app.getPath('userData'), 'settings.json');
  try {
    if (fs.existsSync(settingsPath)) settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (_) { settings = {}; }
  if (!settings.addOnsPath) settings.addOnsPath = updater.detectAddOnsPath();
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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Gear Audit',
    backgroundColor: '#18181c',
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
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
ipcMain.handle('settings:set-path', (_e, p) => {
  settings.addOnsPath = p;
  saveSettings();
  return settings;
});
ipcMain.handle('dialog:pick-addons', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Pick your WoW AddOns folder (…\\Interface\\AddOns)',
  });
  if (res.canceled || !res.filePaths[0]) return null;
  settings.addOnsPath = res.filePaths[0];
  saveSettings();
  return settings.addOnsPath;
});
ipcMain.handle('updater:installed', () => updater.getInstalledVersion(settings.addOnsPath));
ipcMain.handle('updater:latest', async () => updater.getLatestVersion());
ipcMain.handle('updater:update', async (event) => {
  const log = (msg) => event.sender.send('updater:log', msg);
  return updater.updateAddon(settings.addOnsPath, log);
});
ipcMain.handle('updater:open-folder', () => {
  if (settings.addOnsPath && fs.existsSync(settings.addOnsPath)) shell.openPath(settings.addOnsPath);
});
