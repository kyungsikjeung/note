const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mori', { exportNote: (note) => ipcRenderer.invoke('export-note', note), importMarkdown: () => ipcRenderer.invoke('import-markdown') });
contextBridge.exposeInMainWorld('ksnoteAI', {
  run: (request) => ipcRenderer.invoke('ai-run', request),
  diagnose: (request) => ipcRenderer.invoke('ai-diagnose', request),
  diagnoseRovo: (request) => ipcRenderer.invoke('rovo-diagnose', request),
  status: (request) => ipcRenderer.invoke('codex-app-status', request),
  account: (request) => ipcRenderer.invoke('codex-account-read', request),
  loginChatgpt: (request) => ipcRenderer.invoke('codex-login-chatgpt', request),
  models: (request) => ipcRenderer.invoke('codex-model-list', request),
  sessions: (request) => ipcRenderer.invoke('ai-session-list', request),
  turns: (request) => ipcRenderer.invoke('ai-turn-list', request),
  deleteSession: (sessionId) => ipcRenderer.invoke('ai-session-delete', sessionId),
  renameSession: (request) => ipcRenderer.invoke('ai-session-rename', request),
  resetContext: (sessionId) => ipcRenderer.invoke('ai-session-reset-context', sessionId),
  compactSession: (sessionId) => ipcRenderer.invoke('ai-session-compact', sessionId),
  markApplied: (request) => ipcRenderer.invoke('ai-turn-applied', request),
  cancel: (requestId) => ipcRenderer.invoke('ai-cancel', requestId),
  onChunk: (listener) => {
    const handler = (_, payload) => listener(payload);
    ipcRenderer.on('ai-chunk', handler);
    return () => ipcRenderer.removeListener('ai-chunk', handler);
  },
  onStatus: (listener) => {
    const handler = (_, payload) => listener(payload);
    ipcRenderer.on('codex-app-status', handler);
    return () => ipcRenderer.removeListener('codex-app-status', handler);
  },
  onAccount: (listener) => {
    const handler = (_, payload) => listener(payload);
    ipcRenderer.on('codex-account-event', handler);
    return () => ipcRenderer.removeListener('codex-account-event', handler);
  },
  onUsage: (listener) => {
    const handler = (_, payload) => listener(payload);
    ipcRenderer.on('ai-session-usage', handler);
    return () => ipcRenderer.removeListener('ai-session-usage', handler);
  },
  onCompacted: (listener) => {
    const handler = (_, payload) => listener(payload);
    ipcRenderer.on('ai-session-compacted', handler);
    return () => ipcRenderer.removeListener('ai-session-compacted', handler);
  },
});
contextBridge.exposeInMainWorld('ksnoteStorage', { load: () => ipcRenderer.invoke('storage-load'), save: (data) => ipcRenderer.invoke('storage-save', data), revisions: (noteId) => ipcRenderer.invoke('revision-list', noteId), revision: (id) => ipcRenderer.invoke('revision-get', id), saveAsset: (asset) => ipcRenderer.invoke('asset-save', asset) });
contextBridge.exposeInMainWorld('ksnoteMcp', {
  info: () => ipcRenderer.invoke('mcp-info'),
  registerCodex: (request) => ipcRenderer.invoke('mcp-codex-register', request),
  saveTarget: (target) => ipcRenderer.invoke('mcp-target-save', target),
  heartbeat: (payload) => ipcRenderer.invoke('mcp-heartbeat-save', payload),
  pending: (request) => ipcRenderer.invoke('mcp-operation-list', request),
  approve: (request) => ipcRenderer.invoke('mcp-operation-approve', request),
  reject: (request) => ipcRenderer.invoke('mcp-operation-reject', request),
  claim: (request) => ipcRenderer.invoke('mcp-operation-claim', request),
  complete: (result) => ipcRenderer.invoke('mcp-operation-complete', result),
  operation: (id) => ipcRenderer.invoke('mcp-operation-get', id),
});
contextBridge.exposeInMainWorld('ksnoteImage', { generate: (request) => ipcRenderer.invoke('image-generate', request) });
contextBridge.exposeInMainWorld('ksnoteDiagnostics', { test: (request) => ipcRenderer.invoke('command-test', request) });
contextBridge.exposeInMainWorld('ksnoteDiagram', {
  capabilities: (request) => ipcRenderer.invoke('plantuml-info', request),
  renderPlantUml: (request) => ipcRenderer.invoke('plantuml-render', request),
});
