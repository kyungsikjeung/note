const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { spawn } = require('child_process');

const isDev = !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 980, minHeight: 680,
    backgroundColor: '#f4f6f7', titleBarStyle: 'hiddenInset',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true }
  });
  if (isDev) win.loadURL('http://127.0.0.1:5173');
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

ipcMain.handle('export-note', async (_, { title, content }) => {
  const result = await dialog.showSaveDialog({ defaultPath: `${title || 'Untitled'}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] });
  if (result.canceled) return false;
  await fs.writeFile(result.filePath, content, 'utf8');
  return true;
});

function runCli(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: app.getPath('documents'), shell: process.platform === 'win32', windowsHide: true });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('AI 응답 시간이 초과되었습니다.')); }, 180000);
    child.stdout.on('data', d => { if (stdout.length < 4_000_000) stdout += d.toString(); });
    child.stderr.on('data', d => { if (stderr.length < 200_000) stderr += d.toString(); });
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || `${command} 실행 실패 (${code})`)); });
    child.stdin.end(input);
  });
}

ipcMain.handle('ai-run', async (_, request) => {
  const system = request.mode === 'ask'
    ? 'You answer questions about the supplied note. Answer in Korean, concisely. Do not use tools. Do not modify files.'
    : 'You are a document editor. Return ONLY the complete replacement HTML for the requested target. Preserve unrelated content and valid semantic HTML. Do not use markdown fences, explanations, or tools.';
  const prompt = `${system}\n\nUSER INSTRUCTION:\n${request.instruction}\n\nTARGET: ${request.target}\n\nNOTE HTML:\n${request.content}\n\nSELECTED TEXT:\n${request.selection || '(none)'}`;
  const command = String(request.command || request.provider || '').trim();
  if (!command || /[;&|<>\r\n]/.test(command)) throw new Error('AI Agent 실행 명령을 확인해 주세요.');
  if (request.provider === 'claude') return runCli(command, ['--print', '--tools', '', '--permission-mode', 'plan'], prompt);
  return runCli(command, ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--ask-for-approval', 'never', '--ephemeral', '--color', 'never', '-'], prompt);
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
