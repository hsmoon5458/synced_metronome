const assert = require('assert');
const { RoomManager, buildSyncPayload, DEFAULT_ROOM_ID } = require('../rooms');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('no rooms exist until one is created', () => {
  const rm = new RoomManager();
  assert.strictEqual(rm.getRoom(DEFAULT_ROOM_ID), null);
});

test('createRoom allocates sequential numbers starting at 1', () => {
  const rm = new RoomManager();
  assert.strictEqual(rm.createRoom(), 1);
  assert.strictEqual(rm.createRoom(), 2);
});

test('closeRoom removes the room and frees its number for reuse', () => {
  const rm = new RoomManager();
  const a = rm.createRoom();
  rm.createRoom();
  assert.strictEqual(rm.closeRoom(a), true);
  assert.strictEqual(rm.getRoom(a), null);
  assert.strictEqual(rm.createRoom(), 1);
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
  assert.strictEqual(rm.createRoom(), 1);
  assert.strictEqual(rm.createRoom(), 2);
  assert.strictEqual(rm.createRoom(), 4);
});

test('listRooms reflects participant/running state for every room', () => {
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
  assert.deepStrictEqual(rm.listRooms().map(r => r.roomId), [1, 2, 3]);
});

test('buildSyncPayload reflects room state and applies overrides', () => {
  const rm = new RoomManager();
  const roomId = rm.createRoom();
  const room = rm.getRoom(roomId);
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

test('createRoomWithId can claim the default room number', () => {
  const rm = new RoomManager();
  assert.strictEqual(rm.createRoomWithId(DEFAULT_ROOM_ID), DEFAULT_ROOM_ID);
  assert.ok(rm.getRoom(DEFAULT_ROOM_ID));
});

test('createRoomWithId fails if the number is already in use', () => {
  const rm = new RoomManager();
  rm.createRoomWithId(7);
  assert.strictEqual(rm.createRoomWithId(7), null);
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
  assert.strictEqual(rm.createRoomWithId(1), 1);
  assert.strictEqual(rm.createRoom(), 3);
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
