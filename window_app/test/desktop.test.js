const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const createSocket = require('../public/local-socket');

const socket = createSocket(() => 1000);
let state;
socket.on('sync', data => { state = data; });
socket.emit('updateSettings', { bpm: 145, timeSignature: '6/8', subdivision: 3 });
assert.equal(state.bpm, 145);
assert.equal(state.timeSignature, '6/8');
assert.equal(state.subdivision, 3);
socket.emit('startMetronome');
assert.equal(state.isRunning, true);
assert.equal(state.startTime, 1100);
socket.emit('updateSettings', { bpm: 150, subdivision: 4, startTime: 1200 });
assert.equal(state.isRunning, true);
assert.equal(state.startTime, 1200);
socket.emit('setAccentEnabled', { enabled: false });
assert.equal(state.accentEnabled, false);
socket.emit('stopMetronome');
assert.equal(state.isRunning, false);
assert.equal(state.startTime, null);
socket.emit('startMetronome');
assert.equal(state.isRunning, true);
socket.emit('updateSettings', { bpm: 900, subdivision: -1 });
assert.equal(state.bpm, 300);
assert.equal(state.subdivision, 1);

const output = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
assert.doesNotMatch(html, /(?:src|href)="https?:/);
assert.doesNotMatch(html, /fetch\('\/version'\)/);
assert.match(html, /connect-src 'none'/);
assert.match(html, /setRole\('host', 1\)/);
for (const match of html.matchAll(/(?:src|href)="\/([^"#]+)"/g)) {
  assert.ok(fs.existsSync(path.join(output, match[1])), `Missing offline asset: ${match[1]}`);
}
console.log('Desktop offline adapter and bundled asset checks passed.');
