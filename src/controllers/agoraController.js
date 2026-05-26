// src/controllers/agoraController.js — Agora RTC token generation
// ─────────────────────────────────────────────────────────────────────────────
// 🔑 API KEY LOCATION:
// Add AGORA_APP_ID and AGORA_APP_CERTIFICATE to your .env file
// ─────────────────────────────────────────────────────────────────────────────

const { RtcTokenBuilder, RtcRole } = require('agora-access-token');
const pool = require('../config/db');

// ─── POST /agora/token ────────────────────────────────────────────────────────
exports.generateToken = async (req, res, next) => {
  try {
    const { appointmentId } = req.body;
    const userId = req.user.id;

    // Check Agora credentials
    if (!process.env.AGORA_APP_ID || !process.env.AGORA_APP_CERTIFICATE) {
      return res.status(500).json({
        success: false,
        message:
          'Agora credentials not configured. Add AGORA_APP_ID and AGORA_APP_CERTIFICATE to .env',
      });
    }

    // Verify appointment
    const apptResult = await pool.query(
      `SELECT id, patient_id, doctor_id, status
       FROM appointments
       WHERE id = $1`,
      [appointmentId]
    );

    if (apptResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found',
      });
    }

    const appt = apptResult.rows[0];

    // Authorization check
    if (appt.patient_id !== userId && appt.doctor_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to join this call',
      });
    }

    // Appointment status check
    if (appt.status !== 'booked') {
      return res.status(400).json({
        success: false,
        message: `Cannot join call for appointment with status: ${appt.status}`,
      });
    }

    // ─── Agora Token Generation ──────────────────────────────────────────────

    // Unique channel per appointment
    const channelName = appointmentId.toString();

    // Generate random UID
    const uid = Math.floor(Math.random() * 100000);

    // User role
    const role = RtcRole.PUBLISHER;

    // Token expiry time (1 hour)
    const expirationTimeInSeconds = 3600;

    const currentTimestamp = Math.floor(Date.now() / 1000);

    const privilegeExpiredTs =
      currentTimestamp + expirationTimeInSeconds;

    // Generate Agora token
    const token = RtcTokenBuilder.buildTokenWithUid(
      process.env.AGORA_APP_ID,
      process.env.AGORA_APP_CERTIFICATE,
      channelName,
      uid,
      role,
      privilegeExpiredTs
    );

    // Send response
    res.json({
      success: true,
      data: {
        token,
        channelName,
        appId: process.env.AGORA_APP_ID,
        uid,
        expiresAt: new Date(
          privilegeExpiredTs * 1000
        ).toISOString(),
      },
    });
  } catch (err) {
    console.error('❌ Agora Token Error:', err);
    next(err);
  }
};

// ─── POST /agora/validate ─────────────────────────────────────────────────────
exports.validateCall = async (req, res, next) => {
  try {
    const { appointmentId } = req.body;
    const userId = req.user.id;

    const apptResult = await pool.query(
      `SELECT patient_id, doctor_id, status
       FROM appointments
       WHERE id = $1`,
      [appointmentId]
    );

    if (apptResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        authorized: false,
      });
    }

    const appt = apptResult.rows[0];

    const authorized =
      appt.patient_id === userId ||
      appt.doctor_id === userId;

    res.json({
      success: true,
      authorized,
      role: appt.patient_id === userId ? 'patient' : 'doctor',
      status: appt.status,
    });
  } catch (err) {
    console.error('❌ Agora Validate Error:', err);
    next(err);
  }
};