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
// them reconnecting. The room closes for good: everyone still in it is
// kicked back to the lobby, and its number is freed for reuse.
function finalizeHostLoss(roomId) {
  const room = roomManager.getRoom(roomId);
  if (!room) return;
  room.hostGraceTimer = null;
  console.log(`Host grace period elapsed for room ${roomId} — treating host as gone`);
  room.hostSocketId = null;

  // Stop the metronome for anyone still in the room before closing it. The
  // web client reacts to 'roomClosed' below and resets its whole UI, but
  // the iOS app doesn't know about rooms/closing at all — this is what
  // keeps an iOS follower's local ticking in sync with reality instead of
  // drifting forever with a host that's gone.
  if (room.metronomeState.isRunning) {
    room.metronomeState.isRunning = false;
    room.metronomeState.startTime = null;
    io.to(`room:${roomId}`).emit('sync', buildSyncPayload(room, { startTime: null }));
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
    if (socket.id === room.hostSocketId) {
      room.hostSocketId = null;
      io.to(`room:${roomId}`).emit('hostAvailability', true);
    }
    io.to(`room:${roomId}`).emit('clientCount', room.clients.size);
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
    const defaultRoom = roomManager.getRoom(DEFAULT_ROOM_ID);
    socket.emit('hostAvailability', !defaultRoom || defaultRoom.hostSocketId === null);
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
    const requestedId = Number.isInteger(data && data.roomId) && data.roomId >= DEFAULT_ROOM_ID ? data.roomId : null;
    const roomId = requestedId ? roomManager.createRoomWithId(requestedId) : roomManager.createRoom();
    if (roomId == null) {
      if (typeof callback === 'function') callback({ error: 'room_taken' });
      return;
    }
    const room = roomManager.getRoom(roomId);
    joinSocketToRoom(socket, roomId);
    claimHost(socket, roomId, room);
    socket.emit('sync', buildSyncPayload(room));
    console.log(`Room ${roomId} created, hosted by ${socket.id}`);
    broadcastRoomList();
    if (typeof callback === 'function') callback({ roomId });
  });

  // Join an existing room as a follower.
  socket.on('joinRoom', (data, callback) => {
    const roomId = Number.isInteger(data && data.roomId) ? data.roomId : null;
    const room = roomId != null ? roomManager.getRoom(roomId) : null;
    if (!room) {
      if (typeof callback === 'function') callback({ ok: false, error: 'not_found' });
      return;
    }
    joinSocketToRoom(socket, roomId);
    socket.emit('hostAvailability', room.hostSocketId === null);
    socket.emit('sync', buildSyncPayload(room));
    broadcastRoomList();
    if (typeof callback === 'function') callback({ ok: true });
  });

  // Handle role identification. Accepts either a bare role string (legacy —
  // this is what the iOS app sends today, and it always means "the default
  // room", auto-created on demand if it doesn't currently exist) or
  // { role, roomId } (the web client, mainly used to reclaim a room/host
  // seat after a reconnect — an explicit roomId must already exist).
  socket.on('identify', (payload) => {
    const role = typeof payload === 'string' ? payload : (payload && payload.role);
    const isLegacy = !(payload && typeof payload === 'object' && payload.roomId != null);
    const roomId = isLegacy ? DEFAULT_ROOM_ID : payload.roomId;

    const room = isLegacy ? roomManager.getOrCreateRoom(roomId) : roomManager.getRoom(roomId);
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
    broadcastRoomList();
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
      broadcastRoomList();
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
      broadcastRoomList();
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

        broadcastRoomList();
      }
    }

    console.log(`Client disconnected: ${socket.id}`);
  });
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
