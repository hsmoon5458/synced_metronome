// server.js
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
  console.log('Client connected:', socket.id);
  io.emit('clientCount', clients.size);

  socket.on('identify', (role) => {
    if (role === 'host') {
      hostSocketId = socket.id;
      console.log('Host identified:', socket.id);
    }
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
      console.log('Settings updated by host:', settings);
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
      startTime = Date.now() + 1000; // 1 second in future
      isRunning = true;
      console.log('Metronome started at', new Date(startTime).toISOString());
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
      console.log('Metronome stopped by host');
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
      console.log('Host disconnected');
      hostSocketId = null;
    }
    console.log('Client disconnected:', socket.id);
    io.emit('clientCount', clients.size);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
