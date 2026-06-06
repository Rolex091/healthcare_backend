// src/config/socket.js — Socket.io initialization & event registry
let io;
const onlineUsers = new Map();

/**
 * Initialize Socket.io with the HTTP server.
 * Called once from src/index.js
 */
function initSocket(server) {
  const { Server } = require('socket.io');
  const allowedOrigins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  io = new Server(server, {
    cors: {
      origin(origin, callback) {
        callback(null, true);
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);

    // Client sends their userId after auth so we can address them
    socket.on('register', async (userId) => {
      socket.userId = userId;
      onlineUsers.set(userId, socket.id);
      socket.join(`user_${userId}`);
      console.log(`   User ${userId} joined room user_${userId}`);
      
      const pool = require('./db');
      try {
        await pool.query('UPDATE users SET last_seen = NOW() WHERE id = $1', [userId]);
      } catch (err) {
        console.error('Failed to update last_seen on register:', err.message);
      }
      
      io.emit('user_presence_change', { userId, status: 'online', lastSeen: new Date().toISOString() });
    });

    // Handle typing status
    socket.on('typing', (data) => {
      const { chatId, isTyping } = data;
      if (socket.userId) {
        socket.broadcast.to(`user_${data.recipientId}`).emit('typing_status', {
          chatId,
          userId: socket.userId,
          isTyping
        });
      }
    });

    socket.on('disconnect', async () => {
      console.log(`🔌 Client disconnected: ${socket.id}`);
      if (socket.userId) {
        const userId = socket.userId;
        onlineUsers.delete(userId);
        
        const pool = require('./db');
        const now = new Date();
        try {
          await pool.query('UPDATE users SET last_seen = $1 WHERE id = $2', [now, userId]);
        } catch (err) {
          console.error('Failed to update last_seen on disconnect:', err.message);
        }
        
        io.emit('user_presence_change', { userId, status: 'offline', lastSeen: now.toISOString() });
      }
    });
  });

  return io;
}

function isUserOnline(userId) {
  // We can access onlineUsers Map if defined in this scope
  // Since onlineUsers is defined inside initSocket, let's move onlineUsers outside initSocket to the top of the file!
  return onlineUsers.has(userId);
}

/**
 * Get the initialized io instance (use in controllers)
 */
function getIO() {
  if (!io) throw new Error('Socket.io not initialized. Call initSocket() first.');
  return io;
}

/**
 * Emit `appointment_booked` to a specific doctor
 */
function notifyDoctorAppointmentBooked(doctorId, appointmentData) {
  if (!io) return;
  io.to(`user_${doctorId}`).emit('appointment_booked', {
    type: 'appointment_booked',
    message: 'A new appointment has been booked',
    data: appointmentData,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Emit `appointment_cancelled` to a specific doctor
 */
function notifyDoctorAppointmentCancelled(doctorId, appointmentData) {
  if (!io) return;
  io.to(`user_${doctorId}`).emit('appointment_cancelled', {
    type: 'appointment_cancelled',
    message: 'An appointment has been cancelled',
    data: appointmentData,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Emit `reminder_sent` to both patient and doctor
 */
function sendReminder(patientId, doctorId, appointmentData) {
  if (!io) return;
  const payload = {
    type: 'reminder_sent',
    message: 'Your appointment is in 30 minutes',
    data: appointmentData,
    timestamp: new Date().toISOString(),
  };
  io.to(`user_${patientId}`).emit('reminder_sent', payload);
  io.to(`user_${doctorId}`).emit('reminder_sent', payload);
}

module.exports = { initSocket, getIO, notifyDoctorAppointmentBooked, notifyDoctorAppointmentCancelled, sendReminder, isUserOnline };
