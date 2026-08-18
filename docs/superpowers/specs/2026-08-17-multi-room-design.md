# Multi-room support — design spec

Date: 2026-08-17
Status: approved design, pending implementation plan

## Problem

`server.js` currently holds a single global session: one `metronomeState`,
one `hostSocketId`, one `clients` `Set`. Every connected socket — host or
follower — reads and writes that same state, and every `sync`/`hostAvailability`/
`clientCount` broadcast goes to literally everyone connected to the server.
There is no way for two independent groups to run separate metronome
sessions against the same server at once.

## Goals

- Support any number of concurrent, independent rooms, each with its own
  host, follower set, and metronome state (bpm, time signature, subdivision,
  accent, running/stopped).
- Auto-generated, sequential, reusable room numbers (no user-chosen names).
- A room's host is exclusive (one host per room), matching today's
  single-room host semantics, just scoped per room.
- A live, browsable list of open rooms on the landing page, plus manual
  entry and direct link/QR join.
- Zero changes required to the iOS app; it keeps working exactly as it does
  today.

## Non-goals (this pass)

- iOS app changes (room picker, multi-room `SocketService`/`MetronomeViewModel`
  work) — explicitly deferred to a future pass.
- Persisting room state across server restarts. The app already has no
  persistence today (in-memory only, and per `MetronomeViewModel.swift`'s
  `wakeAndConnect`, the server appears to run on a service that cold-starts
  after idling — e.g. Render's free tier). Multi-room doesn't change that;
  restart still wipes all rooms and resets numbering from scratch. Old
  bookmarked `/r/N` links may point at an unrelated room after a restart —
  a pre-existing class of risk, not new.
- Reload-survivable host identity. Today, a host who reloads their tab
  during the 15s disconnect grace period gets rejected if they try to
  re-claim host (new socket id, grace window still holding the old one).
  Multi-room carries this same limitation forward per room. A real fix
  (device-level host token, reclaimable independent of socket id) is future
  work, not required here.
- A cap on concurrent rooms. Personal-use scale; no need to guard against
  abuse in this pass.
- Custom/named rooms. Already decided: auto-incrementing numbers only.

## Architecture

Socket.IO's built-in "rooms" feature (`socket.join(name)`,
`io.to(name).emit(...)`) is the broadcast-scoping mechanism — no custom
membership tracking needed beyond what Socket.IO already provides.

Server state moves from three global variables to a `Map` keyed by room
number:

```
rooms: Map<number, Room>

Room = {
  metronomeState: { bpm, timeSignature, subdivision, startTime, isRunning, accentEnabled },
  hostSocketId: string | null,
  clients: Set<string>,        // socket ids currently in this room
  hostGraceTimer: Timeout | null
}
```

This is exactly today's three globals, cloned per room. The existing
`buildSyncPayload`, `finalizeHostLoss`, `cancelHostGraceTimer`, and the
`identify`/`updateSettings`/`startMetronome`/`stopMetronome`/`setAccentEnabled`/
`disconnect` handlers all become room-scoped: each looks up its `Room` from
`rooms` (via the socket's joined room, tracked in `socket.data.roomId`) before
acting, and broadcasts via `io.to(`room:${roomId}`).emit(...)` instead of
`io.emit(...)`.

### Room allocator

```
roomAllocator = {
  nextRoomNumber: number,   // high-water mark, starts at 2 (see "Room 1" below)
  freedPool: SortedSet<number>  // numbers from fully-closed rooms, reused first
}

function allocateRoomNumber():
  if freedPool is non-empty: return freedPool.popSmallest()
  else: return nextRoomNumber++

function releaseRoomNumber(n):
  freedPool.add(n)   // never touches room "1"
```

Smallest-first reuse keeps numbers compact rather than growing unbounded.

### Room "1" — the permanent default room, reserved for backward compatibility

Room `1` is created once at server startup and is **never destroyed**, even
when it becomes hostless. It behaves exactly like today's single-room app:
on host-disconnect-grace-expiry, it just goes back to "available" — it does
not close or kick anyone. `roomAllocator` never allocates or frees `1`; the
web client's "Create Room" flow only ever produces numbers `2+`.

Any `identify` call that doesn't specify a room — i.e. the bare string the
iOS app already sends today (`socketService.identify(role: role.rawValue)`)
— is routed to room `1`. This means the iOS app requires **zero code
changes** and behaves identically to today, indefinitely, without needing to
know multi-room exists.

### Ephemeral rooms (2+) — web-only lifecycle

- Created on demand via `createRoom`.
- Closed the moment their host is confirmed gone (15s disconnect grace
  period expires with no reclaim) — **immediately**, even if followers are
  still connected. Remaining followers receive a `roomClosed` event and are
  redirected to `/` with a "Host left, room closed" message.
- On close: room removed from `rooms`, number returned to `freedPool`.

## URL scheme

- `/r/:roomNumber` — a specific room. Express needs a small SPA-fallback
  route (`app.get('/r/:roomId', ...)` → serve `public/index.html`) since
  `express.static` won't otherwise resolve that path.
- `/` — plain landing page: room list + Create button + manual entry
  fallback.

## Client UI flow

**Landing on `/` (no room in URL):**
- Live list of open rooms (see "Lobby & room list" below).
- "Create Room" button: client emits `createRoom`, server allocates a
  number and makes the caller its host; client `history.pushState`s to
  `/r/<num>` and proceeds into the existing host controls UI, now showing
  the room number prominently (e.g. "Room 3") and re-rendering the QR code
  (currently built from `window.location.href` at page load) *after* the
  URL updates, so it always encodes the right room.
- Manual room-number entry field as a fallback for joining a number that
  isn't in the visible list (e.g. told verbally).

**Landing on `/r/N` (from a shared link or QR scan):**
- Auto-join as a follower immediately — no chooser, no click. This is the
  one fully-automatic path (per explicit request).
- If the room doesn't exist (`joinRoom` acks `{ ok: false, error: 'not_found' }`):
  show an inline "Room not found" message, then fall back to a small
  chooser: host this number instead / enter a different number / go home.
  This is the only case where `/r/N` shows manual choice instead of
  auto-joining.

**Room UI itself** (host controls / follower view) is unchanged from
today — bpm/time signature/subdivision/accent/start-stop — just scoped to
whichever room the socket has joined.

## Lobby & room list

Any socket not yet joined to a room is placed in a lightweight Socket.IO
room called `lobby` on connect. Whenever a room is created, closes, or its
participant count changes, the server broadcasts an updated summary to
`lobby`:

```
io.to('lobby').emit('roomList', [
  { roomId: 3, participantCount: 2, isRunning: true },
  { roomId: 7, participantCount: 1, isRunning: false },
  ...
])
```

The client renders this as the landing-page list — room number,
participant count, a playing/stopped status dot — no polling. A socket
leaves `lobby` when it joins a real room (`createRoom`/`joinRoom`) and
rejoins `lobby` if it's later kicked out via `roomClosed`.

Room `1` is excluded from the list (it's the iOS legacy room, not part of
the web multi-room concept) unless it happens to have a host and someone
wants it listed too — **open question, default to excluding it**; see
Open Questions.

Tapping a room row = `joinRoom({ roomId })`, same as the `/r/N` auto-join
path. If the room closed between listing and tap, same inline "Room
closed" + refreshed list.

Empty state: "No active rooms — create one," Create button prominent.

## Socket protocol changes

| Event | Direction | Payload | Notes |
|---|---|---|---|
| `createRoom` | client→server | (none) | Ack: `{ roomId }`. Allocates from pool/counter (2+), creates the room, joins caller as host, moves them out of `lobby`. |
| `joinRoom` | client→server | `{ roomId }` | Ack: `{ ok: true }` or `{ ok: false, error: 'not_found' }`. Joins as follower, moves out of `lobby`. |
| `identify` | client→server | `string` (legacy, room 1) or `{ role, roomId }` | Single handler branches on payload shape. Existing host-exclusivity/reclaim logic applies per-room. |
| `roomList` | server→client | `[{ roomId, participantCount, isRunning }]` | Broadcast to `lobby` on any change. |
| `roomClosed` | server→client | `{ reason: 'host_left' }` | Sent only to sockets in a closing ephemeral room; client redirects to `/` with a message and rejoins `lobby`. |
| `sync`, `hostAvailability`, `clientCount`, `setAccentEnabled`, `updateSettings`, `startMetronome`, `stopMetronome` | (existing) | (unchanged shape) | Now scoped via `io.to(`room:${roomId}`)` instead of `io.emit`. |

## Error handling

- `joinRoom` for a nonexistent room → `{ ok: false, error: 'not_found' }`,
  client shows inline message + fallback chooser (see UI flow above).
- `createRoom` has no failure mode under normal operation (allocator always
  produces a number); if it somehow raced into a collision, that's a bug,
  not a user-facing error path.
- All existing per-room error handling (non-host attempts to control
  playback, host-already-occupied) is unchanged, just now scoped to the
  right room via the socket's joined room instead of a global check.

## Testing strategy

No test framework exists in this repo (`npm test` is a stub) and this
sandbox's Node (v12) is too old to boot Express 5, so `server.js` can't be
run live here — consistent with how the timesync fixes earlier in this
project were verified. Plan:

- Extract the room allocator (`allocateRoomNumber`/`releaseRoomNumber`) as a
  small, pure, dependency-free unit so it can be exercised with a
  standalone Node script (create/close/reuse sequences, verifying smallest-
  first reuse and that `1` is never touched) — the same style of isolated
  logic verification used for the drift-check and stall-guard fixes.
- Manual verification checklist for the implementation plan: two browser
  tabs each creating a room, verifying no cross-talk (settings/accent/start-
  stop in room A don't affect room B); a third tab joining via `/r/N`
  link; a fourth via the lobby list; host-leaves-ephemeral-room kicks
  followers; room 1 (simulating iOS) survives host loss without closing.

## Open questions

- Should room `1` appear in the lobby list if it has an active host (so web
  users could join an iOS-hosted session)? Default: excluded, since it's
  positioned as the legacy/iOS room. Revisit if there's a real use case for
  mixed iOS/web sessions.
- Should the room list show more than participant count + running state
  (e.g. bpm)? Deferred — minimal list for v1, easy to extend later.

## Future work (explicitly out of scope here)

- iOS multi-room support (room picker UI, `SocketService`/`MetronomeViewModel`
  changes to join a specific room).
- Reload-survivable host identity via a device-level token.
- Persisting room/allocator state across server restarts.
