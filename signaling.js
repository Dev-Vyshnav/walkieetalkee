const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*", // Adjust as needed for production
    methods: ["GET", "POST"]
  }
});

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  socket.on('join-room', (roomId) => {
    const room = io.sockets.adapter.rooms.get(roomId);
    const numClients = room ? room.size : 0;
    
    if (numClients >= 8) {
      socket.emit('room-full');
      console.log(`Room ${roomId} is full. User ${socket.id} rejected.`);
      return;
    }
    
    socket.join(roomId);
    console.log(`User ${socket.id} joined room: ${roomId}`);
    
    // Notify others in the room
    socket.to(roomId).emit('user-joined', { userId: socket.id });
    
    // Send current users in the room to the new user (excluding themselves)
    const clientsInRoom = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
    const otherClients = clientsInRoom.filter(id => id !== socket.id);
    socket.emit('current-users', otherClients);
  });

  // WebRTC Signaling
  socket.on('offer', (data) => {
    socket.to(data.roomId).emit('offer', { sdp: data.sdp, sender: socket.id });
  });

  socket.on('answer', (data) => {
    socket.to(data.roomId).emit('answer', { sdp: data.sdp, sender: socket.id });
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.roomId).emit('ice-candidate', { candidate: data.candidate, sender: socket.id });
  });

  // PTT State Change
  socket.on('ptt-state', (data) => {
    socket.to(data.roomId).emit('ptt-state', { isSpeaking: data.isSpeaking, sender: socket.id });
  });

  socket.on('disconnecting', () => {
    // Notify rooms before disconnect
    socket.rooms.forEach(roomId => {
      if (roomId !== socket.id) {
        socket.to(roomId).emit('user-left', { userId: socket.id });
      }
    });
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

const PORT = 3001;
httpServer.listen(PORT, () => {
  console.log(`> Signaling server ready on http://localhost:${PORT}`);
});
