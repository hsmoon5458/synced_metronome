// All Socket.IO event handling: connection bootstrap, room create/join,
// role identification (host/follower), metronome control, and disconnect
// cleanup. Registered once against a given `io`/`roomManager` pair by
// server.js.
const { buildSyncPayload, DEFAULT_ROOM_ID } = require('../rooms');
const { createRoomLifecycle, HOST_GRACE_MS } = require('./roomLifecycle');

function registerSocketHandlers(io, roomManager) {
  const {
    cancelHostGraceTimer,
    finalizeHostLoss,
    broadcastRoomList,
    joinSocketToRoom,
    removeSocketFromRoom,
    claimHost
  } = createRoomLifecycle(io, roomManager);

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

    // Handle role identification: { role, roomId }. Mainly used to reclaim
    // a room/host seat after a reconnect or a host's own page refresh (see
    // claimHost's grace-period reclaim) — the room must already exist.
    // Optional ack: { ok: true } or { ok: false, error: 'not_found' | 'host_taken' }.
    socket.on('identify', (payload, callback) => {
      const role = payload && payload.role;
      const roomId = payload && payload.roomId;
      const ack = (response) => { if (typeof callback === 'function') callback(response); };

      const room = roomId != null ? roomManager.getRoom(roomId) : null;
      if (!room) {
        removeSocketFromRoom(socket);
        socket.join('lobby');
        socket.emit('roomClosed', { reason: 'not_found' });
        ack({ ok: false, error: 'not_found' });
        return;
      }

      joinSocketToRoom(socket, roomId);

      let claimed = true;
      if (role === 'host') {
        claimed = claimHost(socket, roomId, room);
        if (!claimed) {
          console.log(`Client ${socket.id} attempted to become host of room ${roomId}, but a host already exists`);
          socket.emit('hostStatus', { isHost: false, message: 'Another host is already connected' });
        }
      }

      socket.emit('hostAvailability', room.hostSocketId === null);
      socket.emit('sync', buildSyncPayload(room));
      broadcastRoomList();
      ack(claimed ? { ok: true } : { ok: false, error: 'host_taken' });
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
}

module.exports = registerSocketHandlers;
