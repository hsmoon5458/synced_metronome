# Multi-room Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single global metronome session in `server.js` with support for any number of concurrent, independent rooms, each with its own host and metronome state, plus a landing page for creating/browsing/joining them.

**Architecture:** A new dependency-free `rooms.js` module owns room state and number allocation (`Map<roomNumber, Room>` + a reuse pool), unit-tested directly with plain Node. `server.js` wires that module into Socket.IO, using Socket.IO's built-in room feature (`socket.join`/`io.to`) to scope every broadcast. `public/index.html` gains URL-based room routing (`/r/:roomNumber`), a live lobby/room-list landing page, and updated join/create flows. Room `1` is permanent and reserved for the existing bare `identify(role)` call the iOS app already sends — zero iOS changes required.

**Tech Stack:** Node.js, Express 5, Socket.IO 4 (server + bundled client), vanilla JS/HTML/CSS (no build step, no framework) — unchanged from the existing project.

**Spec:** `docs/superpowers/specs/2026-08-17-multi-room-design.md`

## Global Constraints

- Zero code changes to `ios/` — any protocol change must stay backward compatible with the iOS app's existing bare-string `identify(role)` call and its assumption of a single always-available session.
- No new npm dependencies. Everything here is buildable with what's already in `package.json` (`express`, `socket.io`) plus plain Node for the new tests.
- This sandbox's Node is v12.22.9, too old to boot Express 5 (`node:events`-prefixed requires fail) — `server.js` cannot be run live here. `rooms.js` has zero framework dependencies and CAN be run and tested live here; lean on that for real verification, and use `node -c <file>` (syntax-only) plus careful manual-trace review for `server.js` and the inline script in `public/index.html`. Each task's steps say explicitly which kind of verification applies.
- Match existing code style: `const`/`let`, template literals, no semicolon-free style, 2-space indentation, `console.log` for server-side diagnostics (no logging framework).
- No custom/named rooms — auto-incrementing numeric IDs only, per the approved spec.
- Room `1` is never closed, never freed, never listed in the lobby room list.

---

## Task 1: Room manager module (`rooms.js`) + tests

**Files:**
- Create: `rooms.js` (project root, alongside `server.js`)
- Create: `test/rooms.test.js`
- Modify: `package.json` (wire up the `test` script)

**Interfaces:**
- Produces: `RoomManager` class with `isPermanent(roomId)`, `getRoom(roomId)`, `createRoom()`, `createRoomWithId(roomId)`, `closeRoom(roomId)`, `listRooms()`; `DEFAULT_ROOM_ID` constant (`1`); `buildSyncPayload(room, overrides)`; `createMetronomeState()`. `Room` shape: `{ metronomeState, hostSocketId, clients: Set<string>, hostGraceTimer }`. `metronomeState` shape: `{ bpm, timeSignature, subdivision, startTime, isRunning, accentEnabled }`. `listRooms()` returns `[{ roomId, participantCount, isRunning }]` sorted ascending by `roomId`, excluding the permanent room.
- Consumes: nothing (this is the foundation task).

- [ ] **Step 1: Write the failing test file**

Create `test/rooms.test.js`:

```javascript
const assert = require('assert');
const { RoomManager, buildSyncPayload, DEFAULT_ROOM_ID } = require('../rooms');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('room 1 exists immediately and is permanent', () => {
  const rm = new RoomManager();
  assert.ok(rm.getRoom(DEFAULT_ROOM_ID));
  assert.strictEqual(rm.isPermanent(DEFAULT_ROOM_ID), true);
});

test('createRoom allocates sequential numbers starting at 2', () => {
  const rm = new RoomManager();
  assert.strictEqual(rm.createRoom(), 2);
  assert.strictEqual(rm.createRoom(), 3);
});

test('closeRoom removes the room and frees its number for reuse', () => {
  const rm = new RoomManager();
  const a = rm.createRoom();
  rm.createRoom();
  assert.strictEqual(rm.closeRoom(a), true);
  assert.strictEqual(rm.getRoom(a), null);
  assert.strictEqual(rm.createRoom(), 2);
});

test('closeRoom never touches the permanent room', () => {
  const rm = new RoomManager();
  assert.strictEqual(rm.closeRoom(DEFAULT_ROOM_ID), false);
  assert.ok(rm.getRoom(DEFAULT_ROOM_ID));
});

test('closeRoom on an already-closed or unknown room is a safe no-op', () => {
  const rm = new RoomManager();
  assert.strictEqual(rm.closeRoom(999), false);
});

test('freed numbers are reused smallest-first, not LIFO', () => {
  const rm = new RoomManager();
  const a = rm.createRoom();
  const b = rm.createRoom();
  rm.createRoom();
  rm.closeRoom(b);
  rm.closeRoom(a);
  assert.strictEqual(rm.createRoom(), 2);
  assert.strictEqual(rm.createRoom(), 3);
  assert.strictEqual(rm.createRoom(), 5);
});

test('listRooms excludes the permanent room and reflects participant/running state', () => {
  const rm = new RoomManager();
  const a = rm.createRoom();
  const room = rm.getRoom(a);
  room.clients.add('socket-1');
  room.clients.add('socket-2');
  room.metronomeState.isRunning = true;
  assert.deepStrictEqual(rm.listRooms(), [{ roomId: a, participantCount: 2, isRunning: true }]);
});

test('listRooms is sorted ascending by room id even after reuse reorders the Map', () => {
  const rm = new RoomManager();
  rm.createRoom();
  const b = rm.createRoom();
  rm.createRoom();
  rm.closeRoom(b);
  rm.createRoom();
  assert.deepStrictEqual(rm.listRooms().map(r => r.roomId), [2, 3, 4]);
});

test('buildSyncPayload reflects room state and applies overrides', () => {
  const rm = new RoomManager();
  const room = rm.getRoom(DEFAULT_ROOM_ID);
  room.metronomeState.bpm = 140;
  room.metronomeState.startTime = 12345;
  const payload = buildSyncPayload(room);
  assert.strictEqual(payload.bpm, 140);
  assert.strictEqual(payload.startTime, 12345);
  const overridden = buildSyncPayload(room, { startTime: null });
  assert.strictEqual(overridden.startTime, null);
  assert.strictEqual(overridden.bpm, 140);
});

test('newly created room starts with default metronome state', () => {
  const rm = new RoomManager();
  const a = rm.createRoom();
  const room = rm.getRoom(a);
  assert.strictEqual(room.metronomeState.bpm, 120);
  assert.strictEqual(room.metronomeState.isRunning, false);
  assert.strictEqual(room.hostSocketId, null);
  assert.strictEqual(room.clients.size, 0);
});

test('createRoomWithId claims a specific unused number', () => {
  const rm = new RoomManager();
  assert.strictEqual(rm.createRoomWithId(7), 7);
  assert.ok(rm.getRoom(7));
});

test('createRoomWithId fails if the number is already in use', () => {
  const rm = new RoomManager();
  rm.createRoomWithId(7);
  assert.strictEqual(rm.createRoomWithId(7), null);
  assert.strictEqual(rm.createRoomWithId(DEFAULT_ROOM_ID), null, 'must not be able to steal the permanent room');
});

test('createRoomWithId bumps the high-water mark so future createRoom() never collides', () => {
  const rm = new RoomManager();
  rm.createRoomWithId(7);
  assert.strictEqual(rm.createRoom(), 8);
});

test('createRoomWithId removes the claimed number from the freed pool if present', () => {
  const rm = new RoomManager();
  const a = rm.createRoom();
  rm.createRoom();
  rm.closeRoom(a);
  assert.strictEqual(rm.createRoomWithId(2), 2);
  assert.strictEqual(rm.createRoom(), 4);
});

let failures = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`  ok - ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL - ${name}`);
    console.error(`    ${err.message}`);
  }
}
console.log(`\n${tests.length - failures}/${tests.length} passed`);
if (failures > 0) process.exit(1);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node test/rooms.test.js`
Expected: fails immediately with `Cannot find module '../rooms'` (the module doesn't exist yet).

- [ ] **Step 3: Create `rooms.js`**

```javascript
const DEFAULT_ROOM_ID = 1;

function createMetronomeState() {
  return {
    bpm: 120,
    timeSignature: '4/4',
    subdivision: 2,
    startTime: null,
    isRunning: false,
    accentEnabled: true
  };
}

function createRoomState() {
  return {
    metronomeState: createMetronomeState(),
    hostSocketId: null,
    clients: new Set(),
    hostGraceTimer: null
  };
}

class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.nextRoomNumber = DEFAULT_ROOM_ID + 1;
    this.freedPool = [];
    this.rooms.set(DEFAULT_ROOM_ID, createRoomState());
  }

  isPermanent(roomId) {
    return roomId === DEFAULT_ROOM_ID;
  }

  getRoom(roomId) {
    return this.rooms.get(roomId) || null;
  }

  createRoom() {
    const roomId = this.freedPool.length > 0 ? this.freedPool.shift() : this.nextRoomNumber++;
    this.rooms.set(roomId, createRoomState());
    return roomId;
  }

  // Claims a SPECIFIC room number (used only by the "host this room
  // instead" fallback when someone lands on a dead /r/N link). Returns null
  // if that number is already in use. Keeps the allocator's bookkeeping
  // consistent: removes the id from the freed pool if it was sitting there,
  // and bumps the high-water mark past it so future createRoom() calls
  // never collide with it again.
  createRoomWithId(roomId) {
    if (this.rooms.has(roomId)) return null;
    this.rooms.set(roomId, createRoomState());
    const idx = this.freedPool.indexOf(roomId);
    if (idx !== -1) this.freedPool.splice(idx, 1);
    if (roomId >= this.nextRoomNumber) this.nextRoomNumber = roomId + 1;
    return roomId;
  }

  closeRoom(roomId) {
    if (this.isPermanent(roomId)) return false;
    if (!this.rooms.has(roomId)) return false;
    this.rooms.delete(roomId);
    this._releaseNumber(roomId);
    return true;
  }

  _releaseNumber(roomId) {
    let i = 0;
    while (i < this.freedPool.length && this.freedPool[i] < roomId) i++;
    this.freedPool.splice(i, 0, roomId);
  }

  // Snapshot for the lobby room list. Room 1 is deliberately excluded --
  // it's the permanent legacy/iOS room, not part of the web multi-room
  // concept.
  listRooms() {
    const result = [];
    for (const [roomId, room] of this.rooms) {
      if (this.isPermanent(roomId)) continue;
      result.push({
        roomId,
        participantCount: room.clients.size,
        isRunning: room.metronomeState.isRunning
      });
    }
    result.sort((a, b) => a.roomId - b.roomId);
    return result;
  }
}

// Builds the payload broadcast on 'sync' for a given room. `overrides` lets
// callers substitute fields (e.g. startTime: null on stop) without
// duplicating the field list.
function buildSyncPayload(room, overrides = {}) {
  const s = room.metronomeState;
  return {
    bpm: s.bpm,
    startTime: s.startTime,
    isRunning: s.isRunning,
    timeSignature: s.timeSignature,
    subdivision: s.subdivision,
    accentEnabled: s.accentEnabled,
    ...overrides
  };
}

module.exports = { RoomManager, buildSyncPayload, DEFAULT_ROOM_ID, createMetronomeState };
```

- [ ] **Step 4: Run the tests again to verify they pass**

Run: `node test/rooms.test.js`
Expected: `14/14 passed`, exit code 0.

- [ ] **Step 5: Wire up `npm test`**

In `package.json`, change:

```json
    "test": "echo \"Error: no test specified\" && exit 1",
```

to:

```json
    "test": "node test/rooms.test.js",
```

Run: `npm test`
Expected: same `14/14 passed` output as Step 4.

- [ ] **Step 6: Commit**

```bash
git add rooms.js test/rooms.test.js package.json
git commit -m "feat: add room manager module with allocator + tests"
```

---

## Task 2: `server.js` — multi-room Socket.IO wiring

**Files:**
- Modify: `server.js` (full rewrite of the connection-handling section; `/version` and `/time` routes unchanged)

**Interfaces:**
- Consumes (from Task 1): `RoomManager`, `buildSyncPayload(room, overrides)`, `DEFAULT_ROOM_ID` from `./rooms`.
- Produces (for Tasks 3-4): the socket protocol the client relies on:
  - `createRoom({ roomId? }, callback)` → `callback({ roomId })` or `callback({ error: 'room_taken' })`
  - `joinRoom({ roomId }, callback)` → `callback({ ok: true })` or `callback({ ok: false, error: 'not_found' })`
  - `identify(payloadStringOrObject)` — string (legacy) or `{ role, roomId }`
  - Server→client: `roomList([{ roomId, participantCount, isRunning }])`, `roomClosed({ reason: 'host_left' | 'not_found' })`, plus existing `sync`, `hostAvailability`, `clientCount`, `hostStatus` (all now room-scoped).

- [ ] **Step 1: Replace `server.js` in full**

This is a full-file rewrite (every existing handler becomes room-scoped; new `createRoom`/`joinRoom`/SPA route are added). Replace the entire contents of `server.js` with:

```javascript
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const packageJson = require('./package.json');
const { RoomManager, buildSyncPayload, DEFAULT_ROOM_ID } = require('./rooms');

// Configuration
const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
// connectionStateRecovery lets a client that drops and reconnects within the
// window (e.g. a phone screen locking briefly) resume with the SAME socket.id
// (and, per the Socket.IO docs, its rooms and socket.data) instead of being
// treated as a brand-new connection. We rely on that below to give a room's
// host a grace period before treating a disconnect as final.
const io = socketIO(server, {
  connectionStateRecovery: {
    maxDisconnectionDuration: 30000
  }
});

const roomManager = new RoomManager();

// How long to wait after a room's host disconnects before assuming they
// really left (vs. a brief network blip / screen lock) and stopping/closing
// the room for everyone else.
const HOST_GRACE_MS = 15000;

function cancelHostGraceTimer(room) {
  if (room.hostGraceTimer) {
    clearTimeout(room.hostGraceTimer);
    room.hostGraceTimer = null;
  }
}

// Actually give up on a room's host once the grace period elapses without
// them reconnecting. The permanent room (1) just goes back to "available",
// exactly like today's single-room app. An ephemeral room (2+) closes for
// good: everyone still in it is kicked back to the lobby, and its number is
// freed for reuse.
function finalizeHostLoss(roomId) {
  const room = roomManager.getRoom(roomId);
  if (!room) return;
  room.hostGraceTimer = null;
  console.log(`Host grace period elapsed for room ${roomId} — treating host as gone`);
  room.hostSocketId = null;

  if (roomManager.isPermanent(roomId)) {
    io.to(`room:${roomId}`).emit('hostAvailability', true);
    if (room.metronomeState.isRunning) {
      room.metronomeState.isRunning = false;
      room.metronomeState.startTime = null;
      io.to(`room:${roomId}`).emit('sync', buildSyncPayload(room, { startTime: null }));
    }
    return;
  }

  io.to(`room:${roomId}`).emit('roomClosed', { reason: 'host_left' });
  const socketIdsInRoom = io.sockets.adapter.rooms.get(`room:${roomId}`);
  if (socketIdsInRoom) {
    for (const socketId of Array.from(socketIdsInRoom)) {
      const s = io.sockets.sockets.get(socketId);
      if (s) {
        s.leave(`room:${roomId}`);
        s.join('lobby');
        s.data.roomId = null;
      }
    }
  }
  roomManager.closeRoom(roomId);
  broadcastRoomList();
}

function broadcastRoomList() {
  io.to('lobby').emit('roomList', roomManager.listRooms());
}

// Moves a socket into a room: leaves 'lobby' (if present), joins the
// Socket.IO room, updates socket.data.roomId, and registers it in the
// room's participant set. Safe to call repeatedly (e.g. on every
// 'identify', including reconnects) — join/add are idempotent.
function joinSocketToRoom(socket, roomId) {
  const previousRoomId = socket.data.roomId;
  if (previousRoomId != null && previousRoomId !== roomId) {
    removeSocketFromRoom(socket);
  }
  socket.leave('lobby');
  socket.join(`room:${roomId}`);
  socket.data.roomId = roomId;
  const room = roomManager.getRoom(roomId);
  if (room) {
    room.clients.add(socket.id);
    io.to(`room:${roomId}`).emit('clientCount', room.clients.size);
  }
}

function removeSocketFromRoom(socket) {
  const roomId = socket.data.roomId;
  if (roomId == null) return;
  const room = roomManager.getRoom(roomId);
  if (room) {
    room.clients.delete(socket.id);
  }
  socket.leave(`room:${roomId}`);
  socket.data.roomId = null;
}

// Claims the host seat of `room` for `socket`, if it's free or if this is
// the same host reclaiming within the grace period (recovered session /
// re-identify keeps the same socket.id — see connectionStateRecovery
// above). Returns false if someone else already holds it.
function claimHost(socket, roomId, room) {
  const isReclaim = room.hostSocketId === socket.id;
  const isNewHost = room.hostSocketId === null;
  if (!isNewHost && !isReclaim) return false;

  room.hostSocketId = socket.id;
  cancelHostGraceTimer(room);
  if (isNewHost) {
    console.log(`Host identified for room ${roomId}: ${socket.id}`);
    io.to(`room:${roomId}`).emit('hostAvailability', false);
  } else {
    console.log(`Host reclaimed seat in room ${roomId} within grace period: ${socket.id}`);
  }
  return true;
}

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback so a direct visit/refresh on a room URL still serves the app
// (the room number itself is parsed client-side from the path).
app.get('/r/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Endpoint to get the version
app.get('/version', (req, res) => {
  res.json({ version: packageJson.version });
});

// Legacy HTTP time endpoint (kept for compatibility; clients now use the
// socket.io `timeSync` round-trip below, which is lower-jitter and yields a
// per-sample network delay estimate).
app.get('/time', (req, res) => {
  res.json({ serverTime: Date.now() });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  // A recovered connection (brief disconnect within the window) already has
  // its previous socket.data.roomId and Socket.IO room membership restored
  // by Socket.IO itself — don't clobber that. A fresh connection starts in
  // the lobby with no room.
  if (!socket.recovered) {
    socket.data.roomId = null;
    socket.join('lobby');
  }
  console.log(`Client connected: ${socket.id} (recovered: ${socket.recovered})`);

  if (socket.data.roomId == null) {
    socket.emit('roomList', roomManager.listRooms());
  }

  // Time synchronization round-trip (NTP-style, 4 timestamps).
  // Client sends t0 (its send time); we stamp t1 on receive and t2 on send.
  // Client stamps t3 on receipt and computes offset + delay from all four.
  socket.on('timeSync', (data, callback) => {
    const t1 = Date.now();
    if (typeof callback === 'function') {
      callback({ t0: data && data.t0, t1, t2: Date.now() });
    }
  });

  // Create a brand new ephemeral room and become its host. If data.roomId
  // is given, claims that specific number instead of auto-allocating one
  // (used by the "host this room instead" fallback when a /r/N link turns
  // out to be dead) -- fails with { error: 'room_taken' } if it's already
  // in use.
  socket.on('createRoom', (data, callback) => {
    const requestedId = data && data.roomId;
    const roomId = requestedId ? roomManager.createRoomWithId(requestedId) : roomManager.createRoom();
    if (roomId == null) {
      if (typeof callback === 'function') callback({ error: 'room_taken' });
      return;
    }
    const room = roomManager.getRoom(roomId);
    joinSocketToRoom(socket, roomId);
    claimHost(socket, roomId, room);
    console.log(`Room ${roomId} created, hosted by ${socket.id}`);
    broadcastRoomList();
    if (typeof callback === 'function') callback({ roomId });
  });

  // Join an existing room as a follower.
  socket.on('joinRoom', (data, callback) => {
    const roomId = data && data.roomId;
    const room = roomManager.getRoom(roomId);
    if (!room) {
      if (typeof callback === 'function') callback({ ok: false, error: 'not_found' });
      return;
    }
    joinSocketToRoom(socket, roomId);
    socket.emit('hostAvailability', room.hostSocketId === null);
    socket.emit('sync', buildSyncPayload(room));
    if (!roomManager.isPermanent(roomId)) broadcastRoomList();
    if (typeof callback === 'function') callback({ ok: true });
  });

  // Handle role identification. Accepts either a bare role string (legacy —
  // this is what the iOS app sends today, and it's always routed to the
  // permanent room 1) or { role, roomId } (the web client, mainly used to
  // reclaim a room/host seat after a reconnect).
  socket.on('identify', (payload) => {
    const role = typeof payload === 'string' ? payload : (payload && payload.role);
    const roomId = (payload && typeof payload === 'object' && payload.roomId != null)
      ? payload.roomId
      : DEFAULT_ROOM_ID;

    const room = roomManager.getRoom(roomId);
    if (!room) {
      removeSocketFromRoom(socket);
      socket.join('lobby');
      socket.emit('roomClosed', { reason: 'not_found' });
      return;
    }

    joinSocketToRoom(socket, roomId);

    if (role === 'host') {
      const claimed = claimHost(socket, roomId, room);
      if (!claimed) {
        console.log(`Client ${socket.id} attempted to become host of room ${roomId}, but a host already exists`);
        socket.emit('hostStatus', { isHost: false, message: 'Another host is already connected' });
        return;
      }
    }

    socket.emit('hostAvailability', room.hostSocketId === null);
    socket.emit('sync', buildSyncPayload(room));
  });

  // Handle accent beat enable/disable — host-only, mirrors updateSettings.
  socket.on('setAccentEnabled', (data) => {
    const roomId = socket.data.roomId;
    const room = roomId != null ? roomManager.getRoom(roomId) : null;
    if (room && socket.id === room.hostSocketId) {
      room.metronomeState.accentEnabled = !!(data && data.enabled);
      console.log(`Accent beat toggled by host of room ${roomId}:`, room.metronomeState.accentEnabled);
      io.to(`room:${roomId}`).emit('sync', buildSyncPayload(room));
    } else {
      console.log(`Non-host client ${socket.id} attempted to toggle accent beat`);
    }
  });

  // Handle metronome setting updates
  socket.on('updateSettings', (settings) => {
    const roomId = socket.data.roomId;
    const room = roomId != null ? roomManager.getRoom(roomId) : null;
    if (room && socket.id === room.hostSocketId) {
      const validatedBpm = Math.min(300, Math.max(30, settings.bpm || room.metronomeState.bpm));
      const validatedTimeSignature = settings.timeSignature || room.metronomeState.timeSignature;
      const validatedSubdivision = Math.min(4, Math.max(1, settings.subdivision || room.metronomeState.subdivision));

      room.metronomeState.bpm = validatedBpm;
      room.metronomeState.timeSignature = validatedTimeSignature;
      room.metronomeState.subdivision = validatedSubdivision;

      // If a new startTime is provided (e.g. for re-syncing on BPM change), update it
      if (settings.startTime) {
        room.metronomeState.startTime = settings.startTime;
      }

      console.log(`Settings updated by host of room ${roomId}:`, {
        bpm: validatedBpm,
        timeSignature: validatedTimeSignature,
        subdivision: validatedSubdivision,
        startTime: room.metronomeState.startTime
      });

      io.to(`room:${roomId}`).emit('sync', buildSyncPayload(room));
    } else {
      console.log(`Non-host client ${socket.id} attempted to update settings`);
    }
  });

  // Handle metronome start request
  socket.on('startMetronome', () => {
    const roomId = socket.data.roomId;
    const room = roomId != null ? roomManager.getRoom(roomId) : null;
    if (room && socket.id === room.hostSocketId) {
      // Start metronome with a 1-second future start time for synchronization
      room.metronomeState.startTime = Date.now() + 1000;
      room.metronomeState.isRunning = true;

      console.log(`Metronome started in room ${roomId} at`, new Date(room.metronomeState.startTime).toISOString());

      io.to(`room:${roomId}`).emit('sync', buildSyncPayload(room));
    } else {
      console.log(`Non-host client ${socket.id} attempted to start metronome`);
    }
  });

  // Handle metronome stop request
  socket.on('stopMetronome', () => {
    const roomId = socket.data.roomId;
    const room = roomId != null ? roomManager.getRoom(roomId) : null;
    if (room && socket.id === room.hostSocketId) {
      room.metronomeState.isRunning = false;

      console.log(`Metronome stopped by host of room ${roomId}`);

      io.to(`room:${roomId}`).emit('sync', buildSyncPayload(room, { startTime: null }));
    } else {
      console.log(`Non-host client ${socket.id} attempted to stop metronome`);
    }
  });

  // Handle client disconnection
  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (roomId != null) {
      const room = roomManager.getRoom(roomId);
      if (room) {
        room.clients.delete(socket.id);
        io.to(`room:${roomId}`).emit('clientCount', room.clients.size);

        // If the host disconnected, don't tear the room down immediately —
        // this fires on brief hiccups too (phone screen lock, WiFi roam, a
        // throttled background tab missing heartbeats), not just the host
        // actually leaving. Give them HOST_GRACE_MS to reconnect and
        // reclaim the seat via 'identify' before finalizing the loss.
        if (socket.id === room.hostSocketId) {
          console.log(`Host disconnected from room ${roomId} — starting ${HOST_GRACE_MS}ms grace period`);
          cancelHostGraceTimer(room);
          room.hostGraceTimer = setTimeout(() => finalizeHostLoss(roomId), HOST_GRACE_MS);
        }

        if (!roomManager.isPermanent(roomId)) {
          broadcastRoomList();
        }
      }
    }

    console.log(`Client disconnected: ${socket.id}`);
  });
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
```

- [ ] **Step 2: Syntax-check**

Run: `node -c server.js`
Expected: no output (success). This does NOT verify runtime behavior — this sandbox's Node (v12) can't boot Express 5. See the manual verification checklist in Task 5 for the real behavioral check, to run wherever a Node ≥18 environment is available (e.g. the deployed Render environment, or upgrade locally).

- [ ] **Step 3: Manual trace review (since this sandbox can't run it live)**

Re-read the file once with these five questions in mind, since the earlier `rooms.js` test run already validated allocator correctness — this review is only about the *Socket.IO wiring* around it:

1. Does every handler that touches `room.hostSocketId`/`room.metronomeState` derive `room` from `socket.data.roomId` (never a stale/global variable)? Yes — grep for `roomManager.getRoom(` to confirm every mutation site looks it up fresh.
2. Does every broadcast use `io.to(\`room:${roomId}\`)` instead of the old bare `io.emit`? Grep for `io.emit` — it should no longer appear anywhere in the file except none (the only remaining broadcast helpers are `io.to(...)`).
3. Does `finalizeHostLoss` correctly branch on `roomManager.isPermanent(roomId)` before deciding whether to kick everyone out?
4. Does `joinSocketToRoom` get called from all three entry points that put a socket in a room (`createRoom`, `joinRoom`, `identify`)?
5. Is `DEFAULT_ROOM_ID` (not a hardcoded `1`) used everywhere the permanent room is referenced?

Fix anything that fails this review before committing.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: multi-room Socket.IO wiring (createRoom/joinRoom/lobby, room-scoped broadcasts)"
```

---

## Task 3: Client — URL routing, room join/create flow, QR/room-number display

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes (from Task 2): `createRoom`, `joinRoom`, `identify`, `roomList`, `roomClosed` socket events as documented in Task 2's Interfaces block.
- Produces (for Task 4): `attemptJoinRoom(roomId)`, `handleCreateRoom()`, `showRoomNotFound(roomId)`, `updateRoomUrl(roomId)`, `setRole(role, roomId)` — Task 4's room-list click handler calls `attemptJoinRoom(roomId)` directly.

This task does NOT include the live room list rendering (that's Task 4) — landing on `/` after this task shows an empty-looking list until Task 4 adds the renderer, but Host/Follow/manual-entry/direct-link flows all work end-to-end.

- [ ] **Step 1: Replace the `roleChooser` markup**

In `public/index.html`, find:

```html
    <div id="roleChooser">
      <div class="button-group">
        <button id="btnChooseHost" onclick="setRole('host')">Host<span class="role-desc">Control the session</span></button>
        <button id="btnChooseClient" onclick="setRole('client')">Follow<span class="role-desc">Join and listen</span></button>
      </div>
      <p id="hostTakenMsg" style="display:none; color:#d32f2f; margin-top:0.5rem; font-size:0.9rem;">Host role is currently occupied.</p>
      <div id="qrJoin">
        <div id="qrCode"></div>
        <p class="qr-label">Scan to join on another device</p>
        <p class="qr-url" id="qrUrl"></p>
      </div>
    </div>
```

Replace with:

```html
    <div id="roleChooser">
      <div id="landingChooser">
        <div class="button-group">
          <button id="btnChooseHost" onclick="handleCreateRoom()">Host<span class="role-desc">Start a new room</span></button>
          <button id="btnChooseClient" onclick="showManualJoin()">Follow<span class="role-desc">Join a room</span></button>
        </div>
        <div id="manualJoin" style="display:none;">
          <input type="number" id="manualRoomInput" inputmode="numeric" placeholder="Room number">
          <button id="manualJoinButton" onclick="handleManualJoin()">Join</button>
        </div>
        <div id="roomListSection">
          <h3>Open Rooms</h3>
          <ul id="roomList"></ul>
          <p id="roomListEmpty" style="display:none;">No active rooms — create one!</p>
        </div>
      </div>
      <div id="roomNotFound" style="display:none;">
        <p>Room <span id="notFoundRoomId"></span> wasn't found.</p>
        <div class="button-group">
          <button onclick="handleHostFallback()">Host this room instead</button>
          <button onclick="goToLanding()">Go home</button>
        </div>
      </div>
    </div>
```

- [ ] **Step 2: Add room-number display + QR to the host controls**

Find (near the top of `#hostControls`):

```html
    <div id="hostControls" style="display:none;">
      <div class="settings-grid">
```

Replace with:

```html
    <div id="hostControls" style="display:none;">
      <div id="roomInfo">
        <h2 id="roomIdDisplay"></h2>
        <div id="qrJoin">
          <div id="qrCode"></div>
          <p class="qr-label">Scan to join on another device</p>
          <p class="qr-url" id="qrUrl"></p>
        </div>
      </div>
      <div class="settings-grid">
```

- [ ] **Step 3: Add a room-number line to the follower status area**

Find:

```html
      <div id="statusInfo">
        <p id="statusDisplay"></p>
        <p id="latencyDisplay"></p>
      </div>
```

Replace with:

```html
      <div id="statusInfo">
        <p id="roomIdStatusDisplay"></p>
        <p id="statusDisplay"></p>
        <p id="latencyDisplay"></p>
      </div>
```

- [ ] **Step 4: Remove the now-defunct `btnChooseHost`/`hostTakenMsg` element lookups**

Find:

```javascript
  const btnChooseHost = document.getElementById('btnChooseHost');
  const hostTakenMsg = document.getElementById('hostTakenMsg');
```

Delete these two lines entirely — the occupied-host chooser UX no longer applies (creating a room on the landing page always succeeds).

- [ ] **Step 5: Add room state variables**

Find:

```javascript
  let role = null;
```

Replace with:

```javascript
  let role = null;
  let currentRoomId = null;
  let pendingHostRoomId = null; // set by showRoomNotFound(); used by handleHostFallback()
```

- [ ] **Step 6: Replace the QR-rendering IIFE with a callable function**

Find:

```javascript
  // Render a QR code (home screen) pointing at this live URL so other phones
  // can scan to join the session. Uses window.location so it's always correct
  // for wherever the app is actually served.
  (function renderJoinQR() {
    const joinUrl = window.location.href.split('#')[0];
    const urlEl = document.getElementById('qrUrl');
    if (urlEl) urlEl.textContent = joinUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const target = document.getElementById('qrCode');
    if (target && typeof QRCode !== 'undefined') {
      new QRCode(target, {
        text: joinUrl,
        width: 168,
        height: 168,
        colorDark: '#0e0e10',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
    } else if (target) {
      // QR library failed to load (offline / CDN blocked) — hide the block.
      const wrap = document.getElementById('qrJoin');
      if (wrap) wrap.style.display = 'none';
      console.warn('QR library unavailable; join QR hidden.');
    }
  })();
```

Replace with:

```javascript
  // Renders a QR code + link pointing at a specific room's join URL. Called
  // once a host actually has a room number (there's nothing to share before
  // that), unlike the old version which rendered unconditionally at load.
  function renderJoinQR(roomId) {
    const joinUrl = `${window.location.origin}/r/${roomId}`;
    const urlEl = document.getElementById('qrUrl');
    if (urlEl) urlEl.textContent = joinUrl.replace(/^https?:\/\//, '');
    const target = document.getElementById('qrCode');
    if (target && typeof QRCode !== 'undefined') {
      target.innerHTML = '';
      new QRCode(target, {
        text: joinUrl,
        width: 168,
        height: 168,
        colorDark: '#0e0e10',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
    } else if (target) {
      // QR library failed to load (offline / CDN blocked) — hide the block.
      const wrap = document.getElementById('qrJoin');
      if (wrap) wrap.style.display = 'none';
      console.warn('QR library unavailable; join QR hidden.');
    }
  }
```

- [ ] **Step 7: Add URL helpers and the join/create/fallback functions**

Find:

```javascript
  function setRole(r) {
    role = r;
    roleChooser.style.display = 'none';
    metronomeControls.style.display = 'block';
    const isHost = r === 'host';
    document.body.classList.toggle('role-host', isHost);
    document.getElementById("hostControls").style.display = isHost ? 'block' : 'none';
    clientVisuals.style.display = isHost ? 'none' : 'flex';
    document.getElementById("bpmDisplay").style.display = isHost ? 'none' : 'block';
    document.getElementById("statusInfo").style.display = isHost ? 'none' : 'block';
    updateBeatDots();
    updateTimeSignatureVisual(timeSignature);
    updateSubdivisionVisual(subdivision);
    syncTime().then((success) => {
      if (success) {
        socket.emit('identify', r);
        startPeriodicReSync();
      }
    });
  }
```

Replace with:

```javascript
  function parseRoomIdFromPath() {
    const m = window.location.pathname.match(/^\/r\/(\d+)$/);
    return m ? parseInt(m[1], 10) : null;
  }

  function updateRoomUrl(roomId) {
    const newPath = `/r/${roomId}`;
    if (window.location.pathname !== newPath) {
      window.history.pushState({ roomId }, '', newPath);
    }
  }

  function goToLanding() {
    window.history.pushState({}, '', '/');
    pendingHostRoomId = null;
    document.getElementById('roomNotFound').style.display = 'none';
    document.getElementById('landingChooser').style.display = 'block';
  }

  function ensureTimeSynced() {
    if (timeSynced) return Promise.resolve(true);
    return syncTime();
  }

  // Sets up the room UI once a room has actually been joined (after a
  // createRoom/joinRoom ack succeeds). Unlike the old setRole(r), this no
  // longer does any socket.emit itself -- that already happened via
  // createRoom/joinRoom's callback.
  function setRole(r, roomId) {
    role = r;
    currentRoomId = roomId;
    roleChooser.style.display = 'none';
    metronomeControls.style.display = 'block';
    const isHost = r === 'host';
    document.body.classList.toggle('role-host', isHost);
    document.getElementById("hostControls").style.display = isHost ? 'block' : 'none';
    clientVisuals.style.display = isHost ? 'none' : 'flex';
    document.getElementById("bpmDisplay").style.display = isHost ? 'none' : 'block';
    document.getElementById("statusInfo").style.display = isHost ? 'none' : 'block';
    updateBeatDots();
    updateTimeSignatureVisual(timeSignature);
    updateSubdivisionVisual(subdivision);

    const label = `Room ${roomId}`;
    const roomIdDisplay = document.getElementById('roomIdDisplay');
    if (roomIdDisplay) roomIdDisplay.textContent = label;
    const roomIdStatusDisplay = document.getElementById('roomIdStatusDisplay');
    if (roomIdStatusDisplay) roomIdStatusDisplay.textContent = label;
    if (isHost) renderJoinQR(roomId);

    startPeriodicReSync();
  }

  function attemptJoinRoom(roomId) {
    socket.emit('joinRoom', { roomId }, (response) => {
      if (response && response.ok) {
        updateRoomUrl(roomId);
        setRole('client', roomId);
      } else {
        showRoomNotFound(roomId);
      }
    });
  }

  function showManualJoin() {
    document.getElementById('manualJoin').style.display = 'flex';
    document.getElementById('manualRoomInput').focus();
  }

  function handleManualJoin() {
    const input = document.getElementById('manualRoomInput');
    const roomId = parseInt(input.value, 10);
    if (!roomId || roomId < 1) return;
    attemptJoinRoom(roomId);
  }

  function showRoomNotFound(roomId) {
    pendingHostRoomId = roomId;
    document.getElementById('landingChooser').style.display = 'none';
    document.getElementById('roomNotFound').style.display = 'block';
    document.getElementById('notFoundRoomId').textContent = roomId;
  }

  function handleCreateRoom() {
    ensureTimeSynced().then((ok) => {
      if (!ok) return;
      socket.emit('createRoom', {}, (response) => {
        updateRoomUrl(response.roomId);
        setRole('host', response.roomId);
      });
    });
  }

  function handleHostFallback() {
    const roomId = pendingHostRoomId;
    if (!roomId) return;
    ensureTimeSynced().then((ok) => {
      if (!ok) return;
      socket.emit('createRoom', { roomId }, (response) => {
        if (response && response.roomId) {
          updateRoomUrl(response.roomId);
          setRole('host', response.roomId);
        } else {
          alert('That room number was just claimed by someone else. Please try again.');
        }
      });
    });
  }
```

- [ ] **Step 8: Update the `connect` handler for the new `identify` payload shape + an initial background sync**

Find:

```javascript
  socket.on('connect', () => {
    updateConnectionStatus(true);
    if (role) {
      socket.emit('identify', role);
      // Re-sync on reconnect for both roles — the socket (and thus the
      // sync round-trip path) is new, so refresh the clock estimate.
      syncTime(true);
    }
  });
```

Replace with:

```javascript
  socket.on('connect', () => {
    updateConnectionStatus(true);
    if (!timeSynced) {
      // Warm up the disciplined clock in the background as soon as we're
      // connected, even before a room is chosen, so it's ready by the time
      // Host/Follow is picked.
      syncTime(true);
    }
    if (role) {
      socket.emit('identify', { role, roomId: currentRoomId });
      // Re-sync on reconnect for both roles — the socket (and thus the
      // sync round-trip path) is new, so refresh the clock estimate.
      syncTime(true);
    }
  });
```

- [ ] **Step 9: Remove the old chooser-screen `hostAvailability` handler and add `roomClosed`**

Find:

```javascript
  socket.on('hostAvailability', (isAvailable) => {
    if (role) return; // Only update if still in role selection screen
    
    if (isAvailable) {
      btnChooseHost.disabled = false;
      btnChooseHost.innerHTML = 'Host<span class="role-desc">Control the session</span>';
      btnChooseHost.title = "";
      hostTakenMsg.style.display = 'none';
    } else {
      btnChooseHost.disabled = true;
      btnChooseHost.innerHTML = 'Host (Occupied)<span class="role-desc">Another user is hosting</span>';
      btnChooseHost.title = "Another user is already the host";
      hostTakenMsg.style.display = 'block';
    }
  });
```

Replace with:

```javascript
  // No client-side reaction needed to hostAvailability any more: creating a
  // room on the landing page always succeeds (it's always a fresh room), so
  // there's no "occupied" state to reflect before you've even joined one.
  // The event is still sent (a follower's room might currently be
  // hostless/mid-grace-period) but nothing here needs it today.
  socket.on('hostAvailability', () => {});

  socket.on('roomClosed', (data) => {
    const reason = data && data.reason;
    currentRoomId = null;
    role = null;
    isRunning = false;
    if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
    if (syncTimeout) { clearTimeout(syncTimeout); syncTimeout = null; }
    releaseScreenWake();
    document.body.classList.remove('role-host');
    document.body.classList.toggle('playing', false);
    metronomeControls.style.display = 'none';
    document.getElementById('hostControls').style.display = 'none';
    roleChooser.style.display = 'block';
    document.getElementById('roomNotFound').style.display = 'none';
    document.getElementById('landingChooser').style.display = 'block';
    window.history.pushState({}, '', '/');
    const message = reason === 'host_left'
      ? 'The host left — this room has closed.'
      : 'This room is no longer available.';
    alert(message);
  });
```

- [ ] **Step 10: Auto-join on load if the URL already names a room**

Find (this comment immediately follows the `renderJoinQR` function from Step 6 — it is unchanged by Step 6, still present verbatim right after it):

```javascript
  // Slider fill logic
```

Insert the following block immediately BEFORE that line (i.e. between the closing `}` of `renderJoinQR` and the `// Slider fill logic` comment):

```javascript
  // If we landed on /r/N (a shared link or QR scan), join it immediately —
  // no chooser click needed. Bare '/' leaves the landing chooser showing.
  (function autoJoinFromUrl() {
    const urlRoomId = parseRoomIdFromPath();
    if (urlRoomId) {
      attemptJoinRoom(urlRoomId);
    }
  })();

```

- [ ] **Step 11: Add Enter-to-submit on the manual room input**

Add near the other DOM-ready event wiring (e.g. right after Step 10's block):

```javascript
  document.getElementById('manualRoomInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleManualJoin();
    }
  });
```

- [ ] **Step 12: Syntax-check the inline script**

Run:

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');
const match = html.match(/<script>([\s\S]*)<\/script>/);
new Function(match[1]);
console.log('inline script parses OK');
"
```

Expected: `inline script parses OK`.

- [ ] **Step 13: Manual verification checklist (run wherever a working Node ≥18 + browser are available)**

- Visit `/`: landing chooser shows (list will look empty/static until Task 4 — that's expected).
- Click Host: a room is created, URL becomes `/r/<N>`, host controls show "Room N", QR code renders pointing at `/r/<N>`.
- Open `/r/<N>` in a second tab: auto-joins as follower immediately, no click required, room number shows in status info.
- Visit `/r/99999` (a room that doesn't exist): shows the "Room not found" panel with "Host this room instead" / "Go home".
- Click "Host this room instead": becomes host of room `99999` specifically (URL stays `/r/99999`).
- As host, click Stop then close the tab; in the follower tab, confirm playback stops and (after ~15s) the follower gets the "host left" alert and is returned to `/`.
- Open a second browser and visit the site's root `/`: manual room-number entry (Follow → type a number → Join) successfully joins an existing room.

- [ ] **Step 14: Commit**

```bash
git add public/index.html
git commit -m "feat: client-side room routing, create/join flow, QR + room number display"
```

---

## Task 4: Client — live lobby/room-list UI

**Files:**
- Modify: `public/index.html`
- Modify: `public/style.css`

**Interfaces:**
- Consumes (from Task 3): `attemptJoinRoom(roomId)`.
- Consumes (from Task 2): `roomList` socket event, payload `[{ roomId, participantCount, isRunning }]`.

- [ ] **Step 1: Add the room-list renderer and its socket listener**

Add this near the other `socket.on(...)` handlers (e.g. right after the `roomClosed` handler added in Task 3 Step 9):

```javascript
  function renderRoomList(rooms) {
    const list = document.getElementById('roomList');
    const empty = document.getElementById('roomListEmpty');
    if (!list || !empty) return;
    list.innerHTML = '';
    if (!rooms || rooms.length === 0) {
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';
    rooms.forEach((r) => {
      const li = document.createElement('li');
      li.className = 'room-row';
      li.setAttribute('role', 'button');
      li.setAttribute('tabindex', '0');
      const statusClass = r.isRunning ? 'playing' : 'stopped';
      const peopleLabel = r.participantCount === 1 ? 'person' : 'people';
      li.innerHTML = `
        <span class="room-row-label">Room ${r.roomId}</span>
        <span class="room-row-meta">
          <span class="room-status-dot ${statusClass}"></span>
          ${r.participantCount} ${peopleLabel}
        </span>
      `;
      li.addEventListener('click', () => attemptJoinRoom(r.roomId));
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          attemptJoinRoom(r.roomId);
        }
      });
      list.appendChild(li);
    });
  }

  socket.on('roomList', renderRoomList);
```

- [ ] **Step 2: Add CSS for the room list**

Append to `public/style.css`:

```css
/* ── Lobby room list ── */
#roomListSection {
    margin-top: 1.5rem;
    text-align: left;
    max-width: 280px;
    margin-left: auto;
    margin-right: auto;
}

#roomListSection h3 {
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--primary-dark);
    margin: 0 0 0.5rem;
    text-align: center;
}

#roomList {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.room-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.7rem 1rem;
    background: var(--bg-card);
    border: 1px solid var(--bg-card-border);
    border-radius: 0.8rem;
    cursor: pointer;
    transition: border-color var(--transition), transform var(--transition);
}

.room-row:hover,
.room-row:focus-visible {
    border-color: var(--accent);
    transform: scale(1.02);
    outline: none;
}

.room-row-label {
    font-weight: 600;
}

.room-row-meta {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.82rem;
    color: var(--primary-dark);
}

.room-status-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.25);
    display: inline-block;
}

.room-status-dot.playing {
    background: var(--accent);
    box-shadow: 0 0 6px var(--accent);
}

#roomListEmpty {
    text-align: center;
    font-size: 0.85rem;
    color: var(--primary-dark);
    margin-top: 0.5rem;
}

/* ── Manual room-number entry ── */
#manualJoin {
    display: flex;
    gap: 0.5rem;
    max-width: 280px;
    margin: 1rem auto 0;
}

#manualRoomInput {
    flex: 1;
    padding: 0.7rem 0.9rem;
    border-radius: 0.8rem;
    border: 1px solid var(--bg-card-border);
    background: var(--bg-input);
    color: var(--primary);
    font-size: 1rem;
}

/* ── Room-not-found fallback panel ── */
#roomNotFound {
    padding: 1rem 0;
}

#roomNotFound p {
    color: var(--primary-dark);
    margin-bottom: 1rem;
}

/* ── Host room info (number + QR) ── */
#roomInfo {
    margin-bottom: 1.5rem;
}

#roomIdDisplay {
    font-size: 1.4rem;
    font-weight: 800;
    margin: 0 0 0.5rem;
}
```

- [ ] **Step 3: Syntax-check the inline script again**

Run the same command as Task 3 Step 12.
Expected: `inline script parses OK`.

- [ ] **Step 4: Manual verification checklist**

- Open two browser tabs to `/`. In tab A, click Host — tab B's room list should update live (no refresh) to show the new room with 1 person.
- In tab B, click the new room's row — joins as a follower with no other click; tab A's list-if-visible... (tab A is now in the room, not viewing the lobby, which is correct — only sockets NOT in a room see `roomList` updates).
- Open a third tab to `/`, confirm it sees the room with 2 people now.
- Start playback from the host tab; confirm the status dot in the third tab's list turns to "playing".
- Close the host tab; after the 15s grace period, confirm the room disappears from the third tab's list (and the follower tab gets kicked per Task 3's checklist).
- With zero rooms open, confirm the empty state ("No active rooms — create one!") shows.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/style.css
git commit -m "feat: live lobby room list UI"
```

---

## Task 5: Version bump, iOS regression note, final integration pass

**Files:**
- Modify: `package.json` (version bump)
- Modify: `public/index.html` (Last Modified date, per existing repo convention)

**Interfaces:** none — this task is bookkeeping + a final consolidated manual pass.

- [ ] **Step 1: Bump version and date**

In `package.json`, bump `"version"` (minor bump — this is a new feature, matching this repo's convention of minor bumps for `feat:` commits and patch bumps for `fix:` commits, visible in `git log -p -- package.json`).

In `public/index.html`, update the `Last Modified` date in the `.version-meta` block to today's date.

- [ ] **Step 2: Full manual regression pass**

Beyond Task 3/4's checklists, specifically re-verify the parts of the app multi-room touches indirectly:

- Accent beat host-only toggle (added in an earlier session) still works, scoped correctly per room — toggling it in one room's host tab must NOT affect another room's followers.
- BPM/time-signature/subdivision changes broadcast only within their own room.
- The self-referential host clock behavior (host never re-syncs to the server clock; the local stall guard still applies) is unaffected by the room refactor — `role` gating in `tickLoop()` still reads the same `role` variable, now just also room-scoped via `currentRoomId`.
- iOS regression: since Node ≥14 isn't available in this sandbox, this specific check requires either the deployed server or a local Node upgrade — connect the iOS app (or simulate its exact handshake: `socket.emit('identify', 'host')` with a bare string, no roomId) against a running instance of the updated `server.js` and confirm it lands in room 1 and behaves exactly as before the multi-room change.

- [ ] **Step 3: Run the full test suite one more time**

Run: `npm test`
Expected: `14/14 passed`.

- [ ] **Step 4: Commit**

```bash
git add package.json public/index.html
git commit -m "chore: bump version for multi-room release"
```
