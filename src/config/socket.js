// src/config/socket.js — Socket.io initialization & event registry
let io;

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
        if (!origin) {
          return callback(null, true);
        }

        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }

        return callback(new Error(`Socket origin blocked: ${origin}`));
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);

    // Client sends their userId after auth so we can address them
    socket.on('register', (userId) => {
      socket.join(`user_${userId}`);
      console.log(`   User ${userId} joined room user_${userId}`);
    });

    socket.on('disconnect', () => {
      console.log(`🔌 Client disconnected: ${socket.id}`);
    });
  });

  return io;
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

module.exports = { initSocket, getIO, notifyDoctorAppointmentBooked, notifyDoctorAppointmentCancelled, sendReminder };
