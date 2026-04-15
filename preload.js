'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveGPX: (content, filename) => ipcRenderer.invoke('save-gpx', { content, filename }),
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close:    () => ipcRenderer.send('window-close'),
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  openLogWindow: () => ipcRenderer.invoke('open-log-window'),
  getLogContent: () => ipcRenderer.invoke('get-log-content'),
  getAppInfo: () => ({
    platform: process.platform,
    version: '2.0.0-W11'
  }),
  // Renderer-Fehler → main.js → Log-Datei
  logRendererError: (data) => ipcRenderer.invoke('renderer-log', data)
});