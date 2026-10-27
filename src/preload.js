'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// The only bridge between the window and Node. New features add
// their methods here and a matching ipcMain.handle in main.js.
contextBridge.exposeInMainWorld('gearAudit', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setPath: (game, p) => ipcRenderer.invoke('settings:set-path', game, p),
  pickAddOns: (game) => ipcRenderer.invoke('dialog:pick-addons', game),
  listAddons: () => ipcRenderer.invoke('addons:list'),
  checkAllAddons: () => ipcRenderer.invoke('updater:check-all'),
  update: (addonId) => ipcRenderer.invoke('updater:update', addonId),
  openFolder: (game) => ipcRenderer.invoke('updater:open-folder', game),
  onLog: (cb) => ipcRenderer.on('updater:log', (_e, msg) => cb(msg)),
  // Self-update
  appCurrentVersion: () => ipcRenderer.invoke('app-update:current'),
  appCheck: () => ipcRenderer.invoke('app-update:check'),
  appDownload: () => ipcRenderer.invoke('app-update:download'),
  appInstall: () => ipcRenderer.invoke('app-update:install'),
  onAppUpdate: (cb) => ipcRenderer.on('app-update:event', (_e, event) => cb(event)),
  // Custom title bar (frameless window)
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximizeToggle: () => ipcRenderer.invoke('window:maximize-toggle'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  onWindowMaxState: (cb) => ipcRenderer.on('window:max-state', (_e, maximized) => cb(maximized)),
});
