const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mori', { exportNote: (note) => ipcRenderer.invoke('export-note', note), importMarkdown: () => ipcRenderer.invoke('import-markdown') });
contextBridge.exposeInMainWorld('ksnoteAI', {
  run: (request) => ipcRenderer.invoke('ai-run', request),
  cancel: (requestId) => ipcRenderer.invoke('ai-cancel', requestId),
  onChunk: (listener) => {
    const handler = (_, payload) => listener(payload);
    ipcRenderer.on('ai-chunk', handler);
    return () => ipcRenderer.removeListener('ai-chunk', handler);
  },
});
contextBridge.exposeInMainWorld('ksnoteStorage', { load: () => ipcRenderer.invoke('storage-load'), save: (data) => ipcRenderer.invoke('storage-save', data), revisions: (noteId) => ipcRenderer.invoke('revision-list', noteId), revision: (id) => ipcRenderer.invoke('revision-get', id), saveAsset: (asset) => ipcRenderer.invoke('asset-save', asset) });
contextBridge.exposeInMainWorld('ksnoteDiagnostics', { test: (request) => ipcRenderer.invoke('command-test', request) });
contextBridge.exposeInMainWorld('ksnoteDiagram', { renderPlantUml: (request) => ipcRenderer.invoke('plantuml-render', request) });
