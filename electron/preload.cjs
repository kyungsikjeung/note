const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mori', { exportNote: (note) => ipcRenderer.invoke('export-note', note) });
contextBridge.exposeInMainWorld('ksnoteAI', { run: (request) => ipcRenderer.invoke('ai-run', request) });
