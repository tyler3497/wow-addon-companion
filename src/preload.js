'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// The only bridge between the window and Node. New features add
// their methods here and a matching ipcMain.handle in main.js.
contextBridge.exposeInMainWorld('gearAudit', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setPath: (p) => ipcRenderer.invoke('settings:set-path', p),
  pickAddOns: () => ipcRenderer.invoke('dialog:pick-addons'),
  getInstalled: () => ipcRenderer.invoke('updater:installed'),
  getLatest: () => ipcRenderer.invoke('updater:latest'),
  update: () => ipcRenderer.invoke('updater:update'),
  openFolder: () => ipcRenderer.invoke('updater:open-folder'),
  onLog: (cb) => ipcRenderer.on('updater:log', (_e, msg) => cb(msg)),
  // Self-update
  appCurrentVersion: () => ipcRenderer.invoke('app-update:current'),
  appCheck: () => ipcRenderer.invoke('app-update:check'),
  appDownload: () => ipcRenderer.invoke('app-update:download'),
  appInstall: () => ipcRenderer.invoke('app-update:install'),
  onAppUpdate: (cb) => ipcRenderer.on('app-update:event', (_e, event) => cb(event)),
});
