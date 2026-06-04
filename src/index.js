// src/index.js — HEALTH CARE+ Backend Entry Point
require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');

const { initSocket } = require('./config/socket');
const { startReminderCron } = require('./controllers/remindersController');
const errorHandler = require('./middleware/errorHandler');

// ─── Routes ───────────────────────────────────────────────────────────────────
const authRoutes = require('./routes/auth');
const appointmentsRoutes = require('./routes/appointments');
const profileRoutes = require('./routes/profile');
const agoraRoutes = require('./routes/agora');
const remindersRoutes = require('./routes/reminders');
const chatRoutes = require('./routes/chat');

const app = express();
const server = http.createServer(app);

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
}));
// ─── Body Parsers ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Static Files (uploaded certificates) ────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'HEALTH CARE+ API is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/auth', authRoutes);
app.use('/appointments', appointmentsRoutes);
app.use('/profile', profileRoutes);
app.use('/agora', agoraRoutes);
app.use('/reminders', remindersRoutes);
app.use('/chat', chatRoutes);

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` });
});

// ─── Global Error Handler ────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Initialize Socket.io ─────────────────────────────────────────────────────
initSocket(server);

// ─── Start Reminder Cron ─────────────────────────────────────────────────────
startReminderCron();

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════╗
  ║         HEALTH CARE+ Backend              ║
  ║   Server running on port ${PORT}             ║
  ║   Environment: ${(process.env.NODE_ENV || 'development').padEnd(12)}        ║
  ╚═══════════════════════════════════════════╝
  `);
});

module.exports = { app, server };
