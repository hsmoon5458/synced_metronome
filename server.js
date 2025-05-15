const express = require('express');
const http = require('http');
const socketIO = require('socket.io');

const PORT = 3000;
const app = express();
const server = http.createServer(app);
const io = socketIO(server);

let bpm = 120;
let timeSignature = '4/4';
let subdivision = 1;
let startTime = null;
let isRunning = false;
let hostSocketId = null;
let clients = new Set();

app.use(express.static('public'));

app.get('/time', (req, res) => {
  res.json({ serverTime: Date.now() });
});

io.on('connection', (socket) => {
  clients.add(socket.id);
  io.emit('clientCount', clients.size);

  // Always send current sync state to new clients
  socket.emit('sync', {
    bpm,
    startTime,
    isRunning,
    timeSignature,
    subdivision
  });

  socket.on('identify', (role) => {
    if (role === 'host') {
      hostSocketId = socket.id;
    }
    // Sync state again on identification (for late joiners)
    socket.emit('sync', {
      bpm,
      startTime,
      isRunning,
      timeSignature,
      subdivision
    });
  });

  socket.on('updateSettings', (settings) => {
    if (socket.id === hostSocketId) {
      bpm = settings.bpm;
      timeSignature = settings.timeSignature;
      subdivision = settings.subdivision;
      io.emit('sync', {
        bpm,
        startTime,
        isRunning,
        timeSignature,
        subdivision
      });
    }
  });

  socket.on('startMetronome', () => {
    if (socket.id === hostSocketId) {
      startTime = Date.now() + 1000;
      isRunning = true;
      io.emit('sync', {
        bpm,
        startTime,
        isRunning,
        timeSignature,
        subdivision
      });
    }
  });

  socket.on('stopMetronome', () => {
    if (socket.id === hostSocketId) {
      isRunning = false;
      startTime = null;
      io.emit('sync', {
        bpm,
        startTime: null,
        isRunning,
        timeSignature,
        subdivision
      });
    }
  });

  socket.on('disconnect', () => {
    clients.delete(socket.id);
    if (socket.id === hostSocketId) {
      hostSocketId = null;
    }
    io.emit('clientCount', clients.size);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
