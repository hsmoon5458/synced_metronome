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
