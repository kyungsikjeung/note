const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mori', { exportNote: (note) => ipcRenderer.invoke('export-note', note), importMarkdown: () => ipcRenderer.invoke('import-markdown') });
contextBridge.exposeInMainWorld('ksnoteAI', { run: (request) => ipcRenderer.invoke('ai-run', request) });
contextBridge.exposeInMainWorld('ksnoteStorage', { load: () => ipcRenderer.invoke('storage-load'), save: (data) => ipcRenderer.invoke('storage-save', data), revisions: (noteId) => ipcRenderer.invoke('revision-list', noteId), revision: (id) => ipcRenderer.invoke('revision-get', id), saveAsset: (asset) => ipcRenderer.invoke('asset-save', asset), onExternalChange: (cb) => ipcRenderer.on('storage-external-change', (_, state) => cb(state)) });
contextBridge.exposeInMainWorld('ksnoteMcp', {
  pendingList: () => ipcRenderer.invoke('mcp-pending-list'),
  resolvePending: (id, approve) => ipcRenderer.invoke('mcp-pending-resolve', { id, approve }),
  onPendingChanged: (cb) => ipcRenderer.on('mcp-pending-changed', (_, pending) => cb(pending)),
  setContext: (context) => ipcRenderer.invoke('mcp-set-context', context),
  serverInfo: () => ipcRenderer.invoke('mcp-server-info'),
  readLog: (count) => ipcRenderer.invoke('mcp-read-log', count),
  writeCodexConfig: () => ipcRenderer.invoke('mcp-write-codex-config'),
});
contextBridge.exposeInMainWorld('ksnoteDiagnostics', { test: (request) => ipcRenderer.invoke('command-test', request) });
contextBridge.exposeInMainWorld('ksnoteDiagram', { renderPlantUml: (request) => ipcRenderer.invoke('plantuml-render', request) });
