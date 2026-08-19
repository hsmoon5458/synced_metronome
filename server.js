const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const packageJson = require('./package.json');
const { RoomManager } = require('./rooms');
const registerSocketHandlers = require('./socket/handlers');

// Configuration
const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
// connectionStateRecovery lets a client that drops and reconnects within the
// window (e.g. a phone screen locking briefly) resume with the SAME socket.id
// (and, per the Socket.IO docs, its rooms and socket.data) instead of being
// treated as a brand-new connection. socket/roomLifecycle.js relies on that
// to give a room's host a grace period before treating a disconnect as final.
const io = socketIO(server, {
  connectionStateRecovery: {
    maxDisconnectionDuration: 30000
  }
});

const roomManager = new RoomManager();

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
// socket.io `timeSync` round-trip in socket/handlers.js, which is
// lower-jitter and yields a per-sample network delay estimate).
app.get('/time', (req, res) => {
  res.json({ serverTime: Date.now() });
});

registerSocketHandlers(io, roomManager);

// Start the server
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
