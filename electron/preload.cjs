const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mori', { exportNote: (note) => ipcRenderer.invoke('export-note', note), importMarkdown: () => ipcRenderer.invoke('import-markdown') });
/** Subscribe to a main-process channel and hand back the removal function. */
const subscribe = (channel, cb) => {
  const handler = (_, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};
contextBridge.exposeInMainWorld('ksnoteAI', {
  run: (request) => ipcRenderer.invoke('ai-run', request),
  start: (request) => ipcRenderer.invoke('ai-start', request),
  cancel: (jobId) => ipcRenderer.invoke('ai-cancel', { jobId }),
  diagnose: (request) => ipcRenderer.invoke('ai-diagnose', request),
  onStream: (cb) => subscribe('ai-stream', cb),
  onDone: (cb) => subscribe('ai-done', cb),
  onError: (cb) => subscribe('ai-error', cb),
  auditAppend: (entry) => ipcRenderer.invoke('ai-audit-append', entry),
  auditList: (options) => ipcRenderer.invoke('ai-audit-list', options),
});
contextBridge.exposeInMainWorld('ksnoteStorage', { load: () => ipcRenderer.invoke('storage-load'), save: (data) => ipcRenderer.invoke('storage-save', data), revisions: (noteId) => ipcRenderer.invoke('revision-list', noteId), revision: (id) => ipcRenderer.invoke('revision-get', id), snapshotRevision: (request) => ipcRenderer.invoke('revision-snapshot', request), saveAsset: (asset) => ipcRenderer.invoke('asset-save', asset), onExternalChange: (cb) => ipcRenderer.on('storage-external-change', (_, state) => cb(state)) });
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
