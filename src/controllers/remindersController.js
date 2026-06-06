// src/controllers/remindersController.js — Reminders + cron job
const pool = require('../config/db');
const cron = require('node-cron');
const sgMail = require('@sendgrid/mail');
const twilio = require('twilio');
const { getIO } = require('../config/socket');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Helper to send email alerts
async function sendEmailAlert(email, subject, htmlContent) {
  if (!process.env.SENDGRID_API_KEY || process.env.SENDGRID_API_KEY === 'YOUR_NEW_KEY') {
    console.warn('SendGrid API key not configured. Skipping email reminder.');
    return false;
  }
  try {
    await sgMail.send({
      to: email,
      from: 'HEALTH CARE+ <hariships12@gmail.com>',
      subject,
      html: htmlContent
    });
    return true;
  } catch (err) {
    console.error('Email alert failed:', err.message);
    return false;
  }
}

// Helper to send SMS alerts via Twilio
async function sendSMSAlert(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;

  if (!sid || !token || !from || sid.includes('your_twilio') || token.includes('your_twilio')) {
    console.warn('Twilio credentials not configured. Skipping SMS reminder.');
    return false;
  }

  try {
    const client = twilio(sid, token);
    await client.messages.create({ to, from, body });
    return true;
  } catch (err) {
    console.error('SMS alert failed:', err.message);
    return false;
  }
}

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

    // Schedule entry in appointment_reminders table (default pending)
    await pool.query(
      `INSERT INTO appointment_reminders (appointment_id, patient_id, doctor_id, reminder_type, status)
       VALUES ($1, $2, $3, '15_min_before', 'pending')
       ON CONFLICT (appointment_id) DO NOTHING`,
      [appointmentId, appt.patient_id, appt.doctor_id]
    );

    res.json({ success: true, message: 'Reminder successfully scheduled' });
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
       FROM appointment_reminders r
       JOIN appointments a ON a.id = r.appointment_id
       WHERE a.patient_id = $1 OR a.doctor_id = $1
       ORDER BY r.created_at DESC`,
      [userId]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
};

// ─── Background cron: runs every minute ──────────────────────────────────────
// Checks for appointments in the next 15 minutes and sends reminders via Socket, Email, and SMS.
function startReminderCron() {
  cron.schedule('* * * * *', async () => {
    try {
      // Find booked appointments starting in the next 15 minutes that don't have a 15-min reminder logged
      const query = `
        SELECT 
          a.id AS appointment_id,
          a.patient_id,
          a.doctor_id,
          a.date,
          a.time,
          a.patient_name,
          a.patient_email,
          a.patient_mobile,
          dp.name AS doctor_name,
          dp.email AS doctor_email,
          dp.phone AS doctor_mobile
        FROM appointments a
        JOIN doctor_profiles dp ON dp.user_id = a.doctor_id
        LEFT JOIN appointment_reminders ar ON ar.appointment_id = a.id AND ar.reminder_type = '15_min_before'
        WHERE a.status = 'booked'
          AND (a.date + a.time) <= NOW() + INTERVAL '15 minutes'
          AND (a.date + a.time) >= NOW() - INTERVAL '15 minutes'
          AND ar.id IS NULL
      `;

      const result = await pool.query(query);

      for (const row of result.rows) {
        console.log(`⏰ Triggering 15-minute reminders for appointment: ${row.appointment_id}`);

        // 1. In-App Notification (Socket.io)
        const io = getIO();
        let inAppSent = false;
        if (io) {
          const payload = {
            type: 'reminder_sent',
            message: `Your appointment with Dr. ${row.doctor_name} starts in 15 minutes!`,
            data: {
              appointmentId: row.appointment_id,
              doctorName: row.doctor_name,
              patientName: row.patient_name,
              date: row.date,
              time: row.time
            },
            timestamp: new Date().toISOString(),
          };
          io.to(`user_${row.patient_id}`).emit('reminder_sent', payload);
          io.to(`user_${row.doctor_id}`).emit('reminder_sent', payload);
          inAppSent = true;
          console.log(`- Socket event sent to patient ${row.patient_id} and doctor ${row.doctor_id}`);
        }

        // 2. Email Notifications (SendGrid)
        const emailSubject = 'HEALTH CARE+ Appointment Reminder (15 Mins Left)';
        
        const patientEmailHtml = `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2 style="color: #1565C0;">HEALTH CARE+ Reminder</h2>
            <p>Dear <strong>${row.patient_name}</strong>,</p>
            <p>Your scheduled video consultation with <strong>Dr. ${row.doctor_name}</strong> starts in 15 minutes.</p>
            <p><strong>Date:</strong> ${row.date}<br><strong>Time:</strong> ${row.time}</p>
            <p>Please open the app to join the consultation call.</p>
          </div>
        `;
        
        const doctorEmailHtml = `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2 style="color: #1B5E20;">HEALTH CARE+ Reminder</h2>
            <p>Dear <strong>Dr. ${row.doctor_name}</strong>,</p>
            <p>Your upcoming appointment with patient <strong>${row.patient_name}</strong> starts in 15 minutes.</p>
            <p><strong>Date:</strong> ${row.date}<br><strong>Time:</strong> ${row.time}</p>
            <p>Please log in to your dashboard to join the video session.</p>
          </div>
        `;

        const patientEmailSent = await sendEmailAlert(row.patient_email || row.patient_id, emailSubject, patientEmailHtml);
        const doctorEmailSent = await sendEmailAlert(row.doctor_email || row.doctor_id, emailSubject, doctorEmailHtml);
        const emailSent = patientEmailSent || doctorEmailSent;

        // 3. SMS Reminder (Twilio)
        const smsBody = `Healthcare+ Alert: Your appointment starts in 15 minutes. Date: ${row.date}, Time: ${row.time}. Please join the app video call.`;
        const patientSmsSent = await sendSMSAlert(row.patient_mobile || '', smsBody);
        const doctorSmsSent = await sendSMSAlert(row.doctor_mobile || '', smsBody);
        const smsSent = patientSmsSent || doctorSmsSent;

        // 4. Log the reminder sent state in DB
        await pool.query(
          `INSERT INTO appointment_reminders (
            appointment_id, patient_id, doctor_id, reminded_at, reminder_type,
            email_sent, sms_sent, in_app_sent, status
           ) VALUES ($1, $2, $3, NOW(), '15_min_before', $4, $5, $6, 'sent')`,
          [row.appointment_id, row.patient_id, row.doctor_id, emailSent, smsSent, inAppSent]
        );
      }
    } catch (err) {
      console.error('Reminder cron error:', err.message);
    }
  });

  console.log('⏰ Dynamic 15-minute reminder cron job started');
}

module.exports = { scheduleReminder: exports.scheduleReminder, getReminderStatus: exports.getReminderStatus, startReminderCron };
