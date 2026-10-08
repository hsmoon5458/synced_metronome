// A local event adapter for the existing metronome UI. No network or server.
(function (root) {
  function createLocalSocket(now = Date.now) {
    const listeners = new Map();
    const state = {
      bpm: 120, timeSignature: '4/4', subdivision: 2,
      accentEnabled: true, isRunning: false, startTime: null
    };
    function publish(event, data) {
      for (const listener of listeners.get(event) || []) listener(data);
    }
    return {
      on(event, listener) {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event).push(listener);
      },
      emit(event, data, callback) {
        switch (event) {
          case 'timeSync':
            if (callback) callback({ t0: data.t0, t1: now(), t2: now() });
            return;
          case 'updateSettings':
            state.bpm = Math.max(30, Math.min(300, Number(data.bpm) || state.bpm));
            if (['4/4', '3/4', '6/8'].includes(data.timeSignature)) state.timeSignature = data.timeSignature;
            state.subdivision = Math.max(1, Math.min(4, Math.round(Number(data.subdivision) || state.subdivision)));
            if (Number.isFinite(data.startTime)) state.startTime = data.startTime;
            break;
          case 'setAccentEnabled':
            state.accentEnabled = !!data.enabled;
            break;
          case 'startMetronome':
            if (state.isRunning) return;
            // Brief lead-in gives Web Audio time to schedule the first beat.
            state.startTime = now() + 100;
            state.isRunning = true;
            break;
          case 'stopMetronome':
            state.isRunning = false;
            state.startTime = null;
            break;
          default:
            return;
        }
        publish('sync', { ...state });
      }
    };
  }
  if (typeof module !== 'undefined') module.exports = createLocalSocket;
  else {
    root.io = createLocalSocket;
    // Electron's main process prevents suspension while the app is open.
    root.NoSleep = class {
      constructor() { this.isEnabled = false; }
      async enable() { this.isEnabled = true; }
      disable() { this.isEnabled = false; }
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
