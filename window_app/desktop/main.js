const { app, BrowserWindow, protocol, net, powerSaveBlocker, dialog, crashReporter } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// A stable origin keeps saved presets across launches and portable extraction paths.
protocol.registerSchemesAsPrivileged([{
  scheme: 'metronome', privileges: { standard: true, secure: true, supportFetchAPI: true }
}]);
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const APP_ID = 'com.hyesungmoon.metronome';
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
let window;
let blocker;
let logPath;

function logEvent(event, details = {}) {
  if (!logPath) return;
  try {
    // Keep the log bounded, including during a repeated failure.
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > 1024 * 1024) {
      fs.copyFileSync(logPath, logPath + '.previous');
      fs.writeFileSync(logPath, '');
    }
    fs.appendFileSync(logPath, JSON.stringify({ time: new Date().toISOString(), event, ...details }) + '\n');
  } catch (_) { /* A logging failure must not stop the metronome. */ }
}

function configureDiagnostics() {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    logPath = path.join(app.getPath('userData'), 'diagnostics.log');
    logEvent('startup', { version: app.getVersion(), platform: process.platform, arch: process.arch });
  } catch (_) { /* The normal startup error handler will report any fatal failure. */ }
  process.on('uncaughtExceptionMonitor', error => logEvent('main-error', { message: error.stack || String(error) }));
  app.on('child-process-gone', (_event, details) => logEvent('child-process-gone', details));
  // Dumps remain on this computer; no crash reports are uploaded.
  try { crashReporter.start({ uploadToServer: false }); }
  catch (error) { logEvent('crash-reporter-error', { message: error.message }); }
}

function openWindow() {
  window = new BrowserWindow({
    width: 760, height: 960, minWidth: 420, minHeight: 640,
    title: 'Synced Metronome', backgroundColor: '#0e0e10', autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required'
    }
  });
  window.setMenu(null);
  if (process.platform === 'win32') {
    // A portable app runs from TEMP. Pin its original launcher, never the
    // temporary extracted executable. Installed builds use their stable path.
    const launcher = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
    window.setAppDetails({
      appId: APP_ID, appIconPath: launcher, appIconIndex: 0,
      relaunchCommand: `"${launcher}"`, relaunchDisplayName: 'Synced Metronome'
    });
  }
  window.webContents.on('console-message', event => {
    if (event.level === 'error') logEvent('renderer-error', { message: event.message.slice(0, 8000) });
  });
  window.webContents.on('did-fail-load', (_event, code, description) => {
    logEvent('load-error', { code, description });
  });
  window.on('unresponsive', () => logEvent('window-unresponsive'));
  window.webContents.on('render-process-gone', async (_event, details) => {
    logEvent('render-process-gone', details);
    if (details.reason === 'clean-exit' || !window || window.isDestroyed()) return;
    const affectedWindow = window;
    const result = await dialog.showMessageBox(affectedWindow, {
      type: 'error', title: 'Metronome stopped unexpectedly',
      message: 'The app window stopped. Your saved presets are still stored.',
      detail: `Reopen the window to continue. Diagnostic log: ${logPath || 'unavailable'}`,
      buttons: ['Reopen window', 'Close app'], defaultId: 0, cancelId: 1
    });
    if (result.response === 0 && !affectedWindow.isDestroyed()) affectedWindow.webContents.reload();
    else app.quit();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== 'metronome://app/') event.preventDefault();
  });
  window.loadURL('metronome://app/').catch(error => {
    logEvent('startup-load-error', { message: error.message });
    dialog.showErrorBox('Unable to open metronome', error.message);
    app.quit();
  });
  blocker = powerSaveBlocker.start('prevent-app-suspension');
  window.on('closed', () => {
    if (powerSaveBlocker.isStarted(blocker)) powerSaveBlocker.stop(blocker);
    window = null;
  });
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
else {
  app.on('second-instance', () => {
    if (window) { if (window.isMinimized()) window.restore(); window.focus(); }
  });
  app.whenReady().then(() => {
    configureDiagnostics();
    const root = path.join(__dirname, '..', 'public');
    protocol.handle('metronome', request => {
      const url = new URL(request.url);
      const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const file = path.resolve(root, '.' + relative);
      if (url.host !== 'app' || !file.startsWith(root + path.sep)) {
        return new Response('Not found', { status: 404 });
      }
      return net.fetch(pathToFileURL(file).toString());
    });
    openWindow();
    app.on('activate', () => { if (!window) openWindow(); });
  }).catch(error => { dialog.showErrorBox('Metronome startup failed', error.message); app.quit(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
