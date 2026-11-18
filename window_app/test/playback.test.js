// Exercise the actual browser scheduler with a deterministic Web Audio clock.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync(require('path').join(__dirname, '../public/index.html'), 'utf8');
function client(role = 'host', delivery = data => data) {
  let now = 0, serial = 0;
  const timers = new Map(), sources = [], heard = [];
  const context = vm.createContext({ console, Math, JSON, Set, Promise });
  context.setTimeout = (callback, ms) => { const id = ++serial; timers.set(id, { callback, at: now + ms / 1000 }); return id; };
  context.clearTimeout = id => timers.delete(id);
  context.requestAnimationFrame = () => ++serial;
  context.cancelAnimationFrame = () => {};
  const parameter = () => ({ setValueAtTime() {}, linearRampToValueAtTime() {} });
  function source(isNoise) {
    const node = { connect() { return this; }, disconnect() {}, frequency: parameter(), gain: parameter(),
      start(time) { this.time = time; if (isNoise) sources.push(this); },
      stop(time) { if (time === undefined) this.cancelled = true; else this.endTime = time; }
    };
    return node;
  }
  context.audioCtx = { get currentTime() { return now; }, outputLatency: 0.04, baseLatency: 0.01,
    createBufferSource: () => source(true), createGain: () => source(false),
    createOscillator: () => source(false), resume: () => Promise.resolve() };
  const control = value => ({ value, disabled: false, textContent: '', classList: { toggle() {} } });
  const elements = { timeSigInput: control('4/4'), subdivisionInput: control('2'), bpmDisplay: control('120') };
  context.document = { getElementById: id => elements[id] || control(''), body: control(''), querySelectorAll: () => [] };
  context.globalNow = () => 100000 + now * 1000;
  context.socket = { emit(event, data) {
    if (event === 'updateSettings') { context.lastPayload = data; const delivered = delivery(data); if (delivered) vm.runInContext(`syncClock(${JSON.stringify({ ...delivered, isRunning: true, accentEnabled: true })})`, context); }
  } };
  vm.runInContext(`
    let bpm=120, subdivision=2, timeSignature='4/4', accentEnabled=true, isRunning=false,
      startTime=null, nextTick=0, beatCount=0, tickTimer=null, syncTimeout=null,
      timeSynced=true, lastDriftCheck=0, playbackGeneration=0, visualFrame=null, pendingVisual=null;
    const role=${JSON.stringify(role)}, scheduledSounds=new Set(), clickBuffers={normal:{},accent:{}},
      bpmInput={}, bpmSlider={}, startButton={}, stopButton={};
    function updateSliderFill(){} function updateTimeSignatureVisual(){} function updateSubdivisionVisual(){}
    function updateBeatDots(){} function acquireScreenWake(){} function releaseScreenWake(){}
  `, context);
  const from = html.indexOf('  function clearScheduledPlayback()');
  const to = html.indexOf("  socket.on('sync', syncClock);", from);
  vm.runInContext(html.slice(from, to), context);
  const updateFrom = html.indexOf('  function updateSettings()');
  const updateTo = html.indexOf('  document.getElementById("timeSigInput").addEventListener', updateFrom);
  vm.runInContext(html.slice(updateFrom, updateTo), context);
  const run = code => vm.runInContext(code, context);
  function advance(target) {
    while (true) {
      const entry = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      const until = entry && entry[1].at <= target ? entry[1].at : target;
      for (const node of sources) {
        if (!node.heard && !node.cancelled && node.time <= until) { node.heard = true; heard.push(node.time); }
      }
      now = until;
      if (!entry || until === target && entry[1].at > target) break;
      timers.delete(entry[0]); entry[1].callback();
      if (now === target) break;
    }
  }
  return { run, advance, heard, timers, context, settings: elements,
    sync(data) { run(`syncClock(${JSON.stringify(data)})`); },
    change(bpm, subdivision = 2) { elements.subdivisionInput.value = String(subdivision); run(`bpm=${bpm}; updateSettings()`); return context.lastPayload; }
  };
}
function near(actual, expected, message) { assert.ok(Math.abs(actual - expected) < 1e-7, `${message}: ${actual} != ${expected}`); }
async function start(c, overrides = {}) {
  c.sync({ bpm:120, subdivision:2, timeSignature:'4/4', startTime:100100, isRunning:true, ...overrides });
  await Promise.resolve();
}
(async () => {
  for (const [oldBpm, newBpm, oldSub, newSub] of [[120,180,2,2],[180,60,4,4],[30,300,1,4],[300,30,4,1]]) {
    const c = client(); c.settings.subdivisionInput.value=String(oldSub);
    await start(c, { bpm:oldBpm, subdivision:oldSub });
    c.advance(1.37);
    const payload = c.change(newBpm,newSub), change=payload.tempoChange;
    const at = (change.at-100000)/1000-0.05;
    assert.ok(at > 1.37, 'transition is in the future');
    c.advance(at+3);
    const expected=[];
    for (let t=.05; t<at-1e-7; t+=60/oldBpm/oldSub) expected.push(t);
    for (let t=at; t<=at+3+1e-7; t+=60/newBpm/newSub) expected.push(t);
    assert.equal(c.heard.length,expected.length, 'one click per old/new grid position');
    c.heard.forEach((time,i)=>near(time,expected[i],'continuous tempo grid'));
    assert.equal(c.timers.size,1,'one scheduling timer');
  }
  const host=client(); await start(host); host.advance(1.37);
  let payload=host.change(150), boundary=payload.tempoChange.at;
  // Drag through the lookahead boundary, including after its first click is queued.
  for (let t=1.38;t<(boundary-100000)/1000-.06;t+=.02) {
    host.advance(t); payload=host.change(Math.round(100+t*30));
    near(payload.tempoChange.at,boundary,'slider drag retains its boundary');
  }
  host.advance(4);
  for (let i=1;i<host.heard.length;i++) assert.ok(host.heard[i]-host.heard[i-1]>.09,'no doubled slider clicks');
  const before=host.run('playbackGeneration');
  host.sync({...payload,isRunning:true,accentEnabled:false});
  host.sync({...payload,isRunning:true,accentEnabled:false});
  assert.equal(host.run('playbackGeneration'),before,'accent and duplicate sync do not restart');
  // Followers, including a client joining mid-transition, use the host boundary.
  const h=client(),f=client('follower'),joining=client('follower');
  await start(h);await start(f); h.advance(1.37);f.advance(1.47);joining.advance(1.47);
  payload=h.change(200,3);const state={...payload,isRunning:true};
  f.sync(state);joining.sync(state);await Promise.resolve();
  h.advance(4);f.advance(4);joining.advance(4);
  assert.equal(f.heard.length,h.heard.length); f.heard.forEach((t,i)=>near(t,h.heard[i],'host/follower grids agree'));
  const joinHeard=h.heard.filter(t=>t>=1.47);
  assert.equal(joining.heard.length,joinHeard.length); joining.heard.forEach((t,i)=>near(t,joinHeard[i],'new follower grid'));
  // A late update replaces queued future clicks without replaying past ones.
  const late=client('follower');await start(late);late.advance(2.4);late.sync(state);late.advance(4);
  for(let i=1;i<late.heard.length;i++) assert.ok(late.heard[i]>late.heard[i-1]+1e-7,'late sync never doubles a click');
  host.sync({...payload,isRunning:false,startTime:null});host.advance(5);
  assert.equal(host.timers.size,0,'Stop cancels the timer');
  assert.equal(host.run('scheduledSounds.size'),0,'Stop cancels queued audio');
  console.log('Playback regression checks passed: tempo up/down, limits, subdivisions, rapid dragging, duplicate sync, followers, late join/delivery, Stop.');
})().catch(error=>{console.error(error);process.exitCode=1;});
