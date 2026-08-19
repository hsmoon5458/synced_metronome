// Room-membership and host-lifecycle helpers shared by the socket event
// handlers in ./handlers.js. Bound to a specific `io`/`roomManager` pair via
// createRoomLifecycle() so callers don't have to thread them through every
// call.
// How long to wait after a room's host disconnects before assuming they
// really left (vs. a brief network blip / screen lock) and stopping/closing
// the room for everyone else.
const HOST_GRACE_MS = 15000;

function createRoomLifecycle(io, roomManager) {
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

  // Claims the host seat of `room` for `socket`, if it's free, if this is
  // the same host reclaiming (recovered session / re-identify keeps the
  // same socket.id — see connectionStateRecovery in server.js), or if the
  // room is mid-grace-period (hostGraceTimer set, i.e. the previous host's
  // disconnect has already been detected and they haven't reclaimed within
  // HOST_GRACE_MS yet). Returns false only if someone else already holds a
  // live host seat.
  function claimHost(socket, roomId, room) {
    const isReclaim = room.hostSocketId === socket.id;
    const isNewHost = room.hostSocketId === null;
    const isPendingGrace = !!room.hostGraceTimer;
    if (!isNewHost && !isReclaim && !isPendingGrace) return false;

    room.hostSocketId = socket.id;
    cancelHostGraceTimer(room);
    if (isReclaim) {
      console.log(`Host reclaimed seat in room ${roomId}: ${socket.id}`);
    } else {
      console.log(`Host identified for room ${roomId}: ${socket.id}`);
      io.to(`room:${roomId}`).emit('hostAvailability', false);
    }
    return true;
  }

  return {
    cancelHostGraceTimer,
    finalizeHostLoss,
    broadcastRoomList,
    joinSocketToRoom,
    removeSocketFromRoom,
    claimHost
  };
}

module.exports = { createRoomLifecycle, HOST_GRACE_MS };
