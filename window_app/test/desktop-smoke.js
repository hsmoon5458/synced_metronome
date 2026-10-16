// Run with: electron test/desktop-smoke.js
const { app, BrowserWindow, session, dialog } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'metronome-smoke-')));
require('../desktop/main');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
setTimeout(() => { console.error('Desktop smoke timed out.'); app.exit(1); }, 30000).unref();
app.whenReady().then(async () => {
  let externalRequests = 0;
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => {
    externalRequests++;
    callback({ cancel: true });
  });
  const window = BrowserWindow.getAllWindows()[0];
  const errors = [];
  window.webContents.on('console-message', event => {
    if (event.level === 'error') errors.push(event.message);
  });
  await new Promise(resolve => window.webContents.once('did-finish-load', resolve));
  const run = script => window.webContents.executeJavaScript(script, true);
  assert.deepEqual(await run(`({ role, timeSynced, controls: hostControls.style.display,
    offline: document.getElementById('connectionLabel').textContent })`),
    { role: 'host', timeSynced: true, controls: 'block', offline: 'Offline · Local metronome' });
  // Stop during the initial lead-in must cancel pending scheduling.
  await run(`
    window.originalResume = audioCtx.resume.bind(audioCtx);
    window.resumeWaiters = [];
    audioCtx.resume = () => new Promise(resolve => resumeWaiters.push(resolve));
    startMetronome(); stopMetronome();
    resumeWaiters.forEach(resolve => resolve());
    audioCtx.resume = originalResume;
    void 0;
  `);
  await pause(400);
  assert.equal(await run('isRunning === false && tickTimer === null && syncTimeout === null && scheduledSounds.size === 0'), true);
  await run('changeBpm(10); document.getElementById("startButton").click();');
  await pause(800);
  assert.equal(await run('isRunning && beatCount > 0 && audioCtx.state === "running"'), true);
  // A burst of control changes must leave just one active scheduler and a
  // bounded number of scheduled voices, including while the window is hidden.
  await run('for (let i = 0; i < 20; i++) { stopMetronome(); startMetronome(); }');
  await pause(600);
  assert.equal(await run('isRunning && scheduledSounds.size > 0 && scheduledSounds.size < 12'), true);
  const beforeMinimize = await run('beatCount');
  window.minimize();
  await pause(1500);
  assert.equal(await run(`isRunning && audioCtx.state === 'running' && beatCount > ${beforeMinimize} && scheduledSounds.size < 12`), true);
  window.restore();
  await run('document.dispatchEvent(new KeyboardEvent("keydown", { key: "b", bubbles: true }));');
  assert.equal(await run('accentEnabled'), false);
  await run('stopMetronome(); handleSavePreset();');
  assert.equal(await run('getPresets()[0].bpm'), 130);
  const loaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
  window.webContents.reload();
  await loaded;
  assert.equal(await run('getPresets()[0].bpm'), 130);
  await run('handleLoadPreset(0)');
  assert.equal(await run('bpm'), 130);
  assert.equal(await run('document.querySelectorAll("#presetList li").length'), 1);
  // Exercise real renderer loss and the recovery action without a manual dialog.
  const originalDialog = dialog.showMessageBox;
  let recoveryPrompted = false;
  dialog.showMessageBox = async (_window, options) => {
    assert.equal(options.title, 'Metronome stopped unexpectedly');
    recoveryPrompted = true;
    return { response: 0 };
  };
  const recovered = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
  window.webContents.forcefullyCrashRenderer();
  await recovered;
  dialog.showMessageBox = originalDialog;
  assert.equal(recoveryPrompted, true);
  assert.equal(await run('getPresets()[0].bpm'), 130);
  assert.equal(await run('isRunning'), false);
  const log = fs.readFileSync(path.join(app.getPath('userData'), 'diagnostics.log'), 'utf8');
  assert.match(log, /render-process-gone/);
  assert.equal(externalRequests, 0);
  assert.deepEqual(errors, []);
  console.log('Desktop smoke passed: offline playback, delayed-start cancellation, rapid restart, minimize, preset persistence, renderer crash logging/recovery; zero external requests.');
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
