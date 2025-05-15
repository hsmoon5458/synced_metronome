const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

// Configuration
const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Metronome state
let metronomeState = {
  bpm: 120,
  timeSignature: '4/4',
  subdivision: 1,
  startTime: null,
  isRunning: false
};

// Connection tracking
let hostSocketId = null;
let clients = new Set();

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Time synchronization endpoint
app.get('/time', (req, res) => {
  res.json({ serverTime: Date.now() });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  // Add client to tracking
  clients.add(socket.id);
  console.log(`Client connected: ${socket.id} (total: ${clients.size})`);
  
  // Notify all clients about new connection count
  io.emit('clientCount', clients.size);
  
  // Send current state to the new client
  socket.emit('sync', {
    bpm: metronomeState.bpm,
    startTime: metronomeState.startTime,
    isRunning: metronomeState.isRunning,
    timeSignature: metronomeState.timeSignature,
    subdivision: metronomeState.subdivision
  });

  // Handle role identification
  socket.on('identify', (role) => {
    if (role === 'host') {
      // If there's already a host, this becomes a backup
      const isNewHost = hostSocketId === null;
      
      if (isNewHost) {
        hostSocketId = socket.id;
        console.log(`Host identified: ${socket.id}`);
      } else {
        console.log(`Client ${socket.id} attempted to become host, but a host already exists`);
        socket.emit('hostStatus', { isHost: false, message: 'Another host is already connected' });
        return;
      }
    }
    
    // Re-sync this client with current state
    socket.emit('sync', {
      bpm: metronomeState.bpm,
      startTime: metronomeState.startTime,
      isRunning: metronomeState.isRunning,
      timeSignature: metronomeState.timeSignature,
      subdivision: metronomeState.subdivision
    });
  });

  // Handle metronome setting updates
  socket.on('updateSettings', (settings) => {
    if (socket.id === hostSocketId) {
      // Validate settings
      const validatedBpm = Math.min(300, Math.max(30, settings.bpm || metronomeState.bpm));
      const validatedTimeSignature = settings.timeSignature || metronomeState.timeSignature;
      const validatedSubdivision = Math.min(4, Math.max(1, settings.subdivision || metronomeState.subdivision));
      
      // Update state
      metronomeState.bpm = validatedBpm;
      metronomeState.timeSignature = validatedTimeSignature;
      metronomeState.subdivision = validatedSubdivision;
      
      console.log('Settings updated by host:', {
        bpm: validatedBpm,
        timeSignature: validatedTimeSignature,
        subdivision: validatedSubdivision
      });
      
      // Broadcast updated settings to all clients
      io.emit('sync', {
        bpm: metronomeState.bpm,
        startTime: metronomeState.startTime,
        isRunning: metronomeState.isRunning,
        timeSignature: metronomeState.timeSignature,
        subdivision: metronomeState.subdivision
      });
    } else {
      console.log(`Non-host client ${socket.id} attempted to update settings`);
    }
  });

  // Handle metronome start request
  socket.on('startMetronome', () => {
    if (socket.id === hostSocketId) {
      // Start metronome with a 1-second future start time for synchronization
      metronomeState.startTime = Date.now() + 1000;
      metronomeState.isRunning = true;
      
      console.log('Metronome started at', new Date(metronomeState.startTime).toISOString());
      
      // Broadcast start command to all clients
      io.emit('sync', {
        bpm: metronomeState.bpm,
        startTime: metronomeState.startTime,
        isRunning: metronomeState.isRunning,
        timeSignature: metronomeState.timeSignature,
        subdivision: metronomeState.subdivision
      });
    } else {
      console.log(`Non-host client ${socket.id} attempted to start metronome`);
    }
  });

  // Handle metronome stop request
  socket.on('stopMetronome', () => {
    if (socket.id === hostSocketId) {
      metronomeState.isRunning = false;
      
      console.log('Metronome stopped by host');
      
      // Broadcast stop command to all clients
      io.emit('sync', {
        bpm: metronomeState.bpm,
        startTime: null,
        isRunning: metronomeState.isRunning,
        timeSignature: metronomeState.timeSignature,
        subdivision: metronomeState.subdivision
      });
    } else {
      console.log(`Non-host client ${socket.id} attempted to stop metronome`);
    }
  });

  // Handle client disconnection
  socket.on('disconnect', () => {
    clients.delete(socket.id);
    
    // If the host disconnected, clear the host ID
    if (socket.id === hostSocketId) {
      console.log('Host disconnected');
      hostSocketId = null;
      
      // If metronome was running, stop it
      if (metronomeState.isRunning) {
        metronomeState.isRunning = false;
        metronomeState.startTime = null;
        
        // Notify remaining clients
        io.emit('sync', {
          bpm: metronomeState.bpm,
          startTime: null,
          isRunning: false,
          timeSignature: metronomeState.timeSignature,
          subdivision: metronomeState.subdivision
        });
      }
    }
    
    console.log(`Client disconnected: ${socket.id} (remaining: ${clients.size})`);
    io.emit('clientCount', clients.size);
  });
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});