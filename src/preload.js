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
});
