const { app, BrowserWindow, protocol, net, powerSaveBlocker, dialog } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// A stable origin keeps saved presets across launches and portable extraction paths.
protocol.registerSchemesAsPrivileged([{
  scheme: 'metronome', privileges: { standard: true, secure: true, supportFetchAPI: true }
}]);
app.commandLine.appendSwitch('disable-renderer-backgrounding');
let window;
let blocker;

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
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== 'metronome://app/') event.preventDefault();
  });
  window.loadURL('metronome://app/').catch(error => {
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
