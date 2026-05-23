// src/controllers/remindersController.js — Reminders + cron job
const pool = require('../config/db');
const cron = require('node-cron');
const { sendReminder } = require('../config/socket');

// ─── POST /reminders/schedule ─────────────────────────────────────────────────
exports.scheduleReminder = async (req, res, next) => {
  try {
    const { appointmentId } = req.body;

    const apptResult = await pool.query(
      'SELECT id, patient_id, doctor_id, date, time FROM appointments WHERE id = $1',
      [appointmentId]
    );

    if (apptResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Appointment not found' });
    }

    const appt = apptResult.rows[0];

    // Upsert reminder
    await pool.query(
      `INSERT INTO reminders (appointment_id, scheduled_at, status)
       VALUES ($1, ($2::date + $3::time - INTERVAL '30 minutes'), 'pending')
       ON CONFLICT (appointment_id) DO UPDATE SET status = 'pending'`,
      [appointmentId, appt.date, appt.time]
    );

    res.json({ success: true, message: 'Reminder scheduled for 30 minutes before appointment' });
  } catch (err) {
    next(err);
  }
};

// ─── GET /reminders/status ────────────────────────────────────────────────────
exports.getReminderStatus = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT r.*, a.date, a.time, a.patient_name
       FROM reminders r
       JOIN appointments a ON a.id = r.appointment_id
       WHERE a.patient_id = $1 OR a.doctor_id = $1
       ORDER BY r.scheduled_at DESC`,
      [userId]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
};

// ─── Background cron: runs every minute ──────────────────────────────────────
// Checks for appointments in the next 30 minutes and sends reminders
function startReminderCron() {
  cron.schedule('* * * * *', async () => {
    try {
      const result = await pool.query(
        `SELECT
           r.id AS reminder_id,
           r.appointment_id,
           a.patient_id,
           a.doctor_id,
           a.date,
           a.time,
           a.patient_name,
           dp.name AS doctor_name
         FROM reminders r
         JOIN appointments a ON a.id = r.appointment_id
         JOIN doctor_profiles dp ON dp.user_id = a.doctor_id
         WHERE r.status = 'pending'
           AND a.status = 'booked'
           AND r.scheduled_at <= NOW()
           AND r.scheduled_at >= NOW() - INTERVAL '2 minutes'`
      );

      for (const row of result.rows) {
        // Send WebSocket reminder to both
        sendReminder(row.patient_id, row.doctor_id, {
          appointmentId: row.appointment_id,
          doctorName: row.doctor_name,
          patientName: row.patient_name,
          date: row.date,
          time: row.time,
        });

        // Mark as sent
        await pool.query(
          'UPDATE reminders SET status = $1, reminder_sent_at = NOW() WHERE id = $2',
          ['sent', row.reminder_id]
        );

        console.log(`⏰ Reminder sent for appointment ${row.appointment_id}`);
      }
    } catch (err) {
      console.error('Reminder cron error:', err.message);
    }
  });

  console.log('⏰ Reminder cron job started (runs every minute)');
}

module.exports = { scheduleReminder: exports.scheduleReminder, getReminderStatus: exports.getReminderStatus, startReminderCron };
