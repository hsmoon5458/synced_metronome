# Synced Metronome

Real-time multi-room metronome. A web client (plain HTML/JS, no build step)
connects to a Node/Express/Socket.IO server, which is the single source of
truth for tempo/timing per room.

Hosted at: https://synced-metronome.onrender.com/

## File map

```
server.js              Entrypoint: Express app, HTTP routes, http+io bootstrap.
rooms.js                RoomManager: pure, dependency-free room state/allocator.
socket/handlers.js      All io.on('connection', ...) event handlers.
socket/roomLifecycle.js Room-membership/host helpers used by handlers.js.
public/index.html       Entire web client: markup + inline <script>, one file.
public/style.css        Web client styles.
public/icons/*.svg      Subdivision note icons (quarter/eighth/triplet/sixteenth).
test/rooms.test.js      Plain-assert tests for rooms.js (no framework).
```

`rooms.js` has zero dependencies (no express/socket.io imports) specifically
so its logic can be unit-tested even in environments where the rest of the
app can't run (see Node version note below).

## Architecture

**Rooms.** `RoomManager` (`rooms.js`) owns a `Map<roomId, roomState>` plus a
number allocator (`nextRoomNumber` high-water mark + `freedPool` for reuse,
smallest-first, starting at `DEFAULT_ROOM_ID = 1`). `roomState` =
`{ metronomeState, hostSocketId, clients: Set<socketId>, hostGraceTimer }`.
Every room closes for good once its host is confirmed gone (15s grace
period, `HOST_GRACE_MS` in `socket/roomLifecycle.js`) and its number goes
back into the pool. `claimHost()` also lets a *different* socket claim the
seat while `hostGraceTimer` is still pending (not just the exact same
`socket.id` reconnecting) — that's what lets a host's own hard page refresh
reclaim the room instead of losing it; see the client-side half in
`attemptRejoinAsHost()`/`sessionStorage['hostedRoomId']` in `index.html`.

**Socket-to-room binding.** Each socket lives in one Socket.IO room
(`room:${roomId}`) plus, when unassigned, a shared `lobby` room used to push
the live room list. `socket.data.roomId` tracks current membership.
`socket/roomLifecycle.js` exports the join/leave/host-claim helpers;
`socket/handlers.js` wires socket events to them.

**Web client.** Single inline `<script>` in `public/index.html`, no bundler.
Landing page (`/`) has one "Host" button (creates a room) and a live "Open
Rooms" list — followers join by clicking a row; there's no manual
room-number entry and no generic "Follow" mode, so a follower with nothing
to click has nothing to join. `/r/:roomId` (SPA fallback route in
`server.js`) auto-joins that room on load, as host or follower depending on
`sessionStorage['hostedRoomId']` (see attemptRejoinAsHost above) — this is
also what a host's own `pushState` produces after creating a room, and what
a shared link/QR scan produces for everyone else. Asset paths in
`index.html` **must be root-relative** (`/style.css`, `/icons/x.svg`) — a
follower's page URL is `/r/N`, and a relative path there resolves against
the wrong base and 404s. (This exact bug shipped once; don't reintroduce it.)

**Time sync.** NTP-style 4-timestamp round-trip over the `timeSync` socket
event (client t0 → server stamps t1/t2 → client stamps t3, computes
offset+delay). The room's host is the authoritative clock and never applies
server-clock correction to its own local scheduling; followers do.

## Socket protocol (event: direction: payload)

| Event | Dir | Payload | Notes |
|---|---|---|---|
| `createRoom` | c→s | `{ roomId? }` | Ack `{ roomId }` or `{ error: 'room_taken' }`. |
| `joinRoom` | c→s | `{ roomId }` | Ack `{ ok: true }` or `{ ok: false, error: 'not_found' }`. |
| `identify` | c→s | `{ role, roomId }` | Ack `{ ok: true }` or `{ ok: false, error: 'not_found' \| 'host_taken' }`. Reclaims a room/host seat after a reconnect or page refresh. |
| `setAccentEnabled` | c→s | `{ enabled }` | Host-only, silently ignored otherwise. |
| `updateSettings` | c→s | `{ bpm, timeSignature, subdivision, startTime? }` | Host-only. |
| `startMetronome` / `stopMetronome` | c→s | — | Host-only. |
| `timeSync` | c→s | `{ t0 }`, ack `{ t0, t1, t2 }` | — |
| `sync` | s→c | full metronome state | Broadcast to `room:${roomId}` on any change. |
| `roomList` | s→c | `[{ roomId, participantCount, isRunning }]` | Broadcast to `lobby` on any room change. |
| `hostAvailability` | s→c | `boolean` | — |
| `clientCount` | s→c | `number` | — |
| `roomClosed` | s→c | `{ reason: 'host_left' \| 'not_found' }` | Client resets UI to landing page. |

## Running / testing

```bash
npm install
npm start          # node server.js — requires Node 18+ for Express 5
npm test           # node test/rooms.test.js — plain assert, runs on any Node
```

**Node version gotcha:** dev/CI sandboxes here sometimes only have Node 12,
which can't boot Express 5 (`node:`-prefixed core requires fail). If you hit
that, you can still: syntax-check with `node -c <file>`, `require()` any
pure module (like `rooms.js` or `socket/handlers.js` — requiring it just
returns the function, doesn't start listening) to catch wiring errors, and
run the full `rooms.js` test suite for real. Don't try to work around the
Node version itself; just fall back to static checks + `npm test` and say so.

## Conventions

- No build step for the web client — edit `public/index.html`/`style.css`
  directly, refresh to test.
- Keep `rooms.js` free of `express`/`socket.io` imports — that's what makes
  it independently testable.
- Bump `package.json` `version` and the `Last Modified` date in
  `public/index.html`'s `.version-meta` block on user-visible changes.
