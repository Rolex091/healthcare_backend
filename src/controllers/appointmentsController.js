// src/controllers/appointmentsController.js — Appointments business logic
const pool = require('../config/db');
const { notifyDoctorAppointmentBooked, notifyDoctorAppointmentCancelled } = require('../config/socket');

// ─── GET /appointments/doctors?speciality=X ──────────────────────────────────
exports.getDoctorsBySpeciality = async (req, res, next) => {
  try {
    const { speciality } = req.query;

    let query = `
      SELECT
        u.id,
        dp.name,
        dp.specialization,
        dp.experience_years,
        dp.degree_certificate_url,
        dp.bio
      FROM users u
      JOIN doctor_profiles dp ON dp.user_id = u.id
      WHERE u.role = 'doctor' AND u.is_active = true
    `;
    const params = [];

    if (speciality) {
      params.push(`%${speciality}%`);
      query += ` AND LOWER(dp.specialization) LIKE LOWER($1)`;
    }

    query += ' ORDER BY dp.name';

    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
};

// ─── GET /appointments/doctors/:doctorId ─────────────────────────────────────
exports.getDoctorById = async (req, res, next) => {
  try {
    const { doctorId } = req.params;

    const result = await pool.query(
      `SELECT
        u.id,
        u.email,
        dp.name,
        dp.specialization,
        dp.experience_years,
        dp.degree_certificate_url,
        dp.bio,
        dp.phone
       FROM users u
       JOIN doctor_profiles dp ON dp.user_id = u.id
       WHERE u.id = $1 AND u.role = 'doctor'`,
      [doctorId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Doctor not found' });
    }

    // Fetch available slots
    const slotsResult = await pool.query(
      `SELECT id, date, time, is_available
       FROM available_slots
       WHERE doctor_id = $1 AND date >= CURRENT_DATE AND is_available = true
       ORDER BY date, time`,
      [doctorId]
    );

    res.json({
      success: true,
      data: { ...result.rows[0], available_slots: slotsResult.rows },
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /appointments/book ─────────────────────────────────────────────────
exports.bookAppointment = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { doctorId, slotId, patientDetails } = req.body;
    const patientId = req.user.id;

    await client.query('BEGIN');

    // Lock the slot row to prevent race conditions
    const slotResult = await client.query(
      'SELECT id, doctor_id, date, time, is_available FROM available_slots WHERE id = $1 FOR UPDATE',
      [slotId]
    );

    if (slotResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Slot not found' });
    }

    const slot = slotResult.rows[0];

    if (!slot.is_available) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'This slot has already been booked. Please choose another time.',
      });
    }

    if (slot.doctor_id !== doctorId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Slot does not belong to this doctor' });
    }

    // Check patient doesn't have another appointment at the same time
    const conflict = await client.query(
      `SELECT id FROM appointments
       WHERE patient_id = $1 AND date = $2 AND time = $3
       AND status NOT IN ('cancelled')`,
      [patientId, slot.date, slot.time]
    );

    if (conflict.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'You already have an appointment at this time.',
      });
    }

    // Mark slot as unavailable
    await client.query(
      'UPDATE available_slots SET is_available = false WHERE id = $1',
      [slotId]
    );

    // Create appointment
    const { v4: uuidv4 } = require('uuid');
    const appointmentId = uuidv4();

    const apptResult = await client.query(
      `INSERT INTO appointments
         (id, patient_id, doctor_id, slot_id, date, time, patient_name, patient_age,
          patient_gender, patient_blood_group, patient_medical_history, patient_mobile, patient_email, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'booked')
       RETURNING *`,
      [
        appointmentId,
        patientId,
        doctorId,
        slotId,
        slot.date,
        slot.time,
        patientDetails?.name || '',
        patientDetails?.age || null,
        patientDetails?.gender || '',
        patientDetails?.blood_group || '',
        patientDetails?.medical_history || '',
        patientDetails?.mobile || '',
        patientDetails?.email || '',
      ]
    );

    await client.query('COMMIT');

    const appointment = apptResult.rows[0];

    // Fetch doctor name for notification
    const doctorResult = await pool.query(
      'SELECT name FROM doctor_profiles WHERE user_id = $1',
      [doctorId]
    );

    // Real-time notify doctor
    notifyDoctorAppointmentBooked(doctorId, {
      appointmentId,
      patientName: patientDetails?.name,
      date: slot.date,
      time: slot.time,
    });

    // Schedule reminder (insert into reminders table)
    await pool.query(
      `INSERT INTO reminders (appointment_id, scheduled_at, status)
       VALUES ($1, $2 - INTERVAL '30 minutes', 'pending')`,
      [appointmentId, `${slot.date} ${slot.time}`]
    );

    res.status(201).json({
      success: true,
      message: 'Appointment booked successfully',
      data: appointment,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// ─── GET /appointments/patient ───────────────────────────────────────────────
exports.getPatientAppointments = async (req, res, next) => {
  try {
    const patientId = req.user.id;

    const result = await pool.query(
      `SELECT
        a.*,
        dp.name AS doctor_name,
        dp.specialization,
        dp.degree_certificate_url
       FROM appointments a
       JOIN doctor_profiles dp ON dp.user_id = a.doctor_id
       WHERE a.patient_id = $1
       ORDER BY a.date DESC, a.time DESC`,
      [patientId]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /appointments/:appointmentId/cancel ───────────────────────────────
exports.cancelAppointment = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { appointmentId } = req.params;
    const patientId = req.user.id;

    await client.query('BEGIN');

    const apptResult = await client.query(
      'SELECT * FROM appointments WHERE id = $1 AND patient_id = $2 FOR UPDATE',
      [appointmentId, patientId]
    );

    if (apptResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Appointment not found' });
    }

    const appt = apptResult.rows[0];

    if (appt.status === 'cancelled') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Appointment already cancelled' });
    }

    if (appt.status === 'completed') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Cannot cancel a completed appointment' });
    }

    // Update appointment status
    await client.query(
      'UPDATE appointments SET status = $1 WHERE id = $2',
      ['cancelled', appointmentId]
    );

    // Free the slot
    await client.query(
      'UPDATE available_slots SET is_available = true WHERE id = $1',
      [appt.slot_id]
    );

    await client.query('COMMIT');

    // Notify doctor
    notifyDoctorAppointmentCancelled(appt.doctor_id, {
      appointmentId,
      patientName: appt.patient_name,
      date: appt.date,
      time: appt.time,
    });

    res.json({ success: true, message: 'Appointment cancelled successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// ─── GET /appointments/doctor ─────────────────────────────────────────────────
exports.getDoctorAppointments = async (req, res, next) => {
  try {
    const doctorId = req.user.id;

    const result = await pool.query(
      `SELECT
        a.*,
        pp.name AS patient_name_profile,
        pp.age AS patient_age_profile,
        pp.gender AS patient_gender_profile,
        pp.blood_group AS patient_blood_group_profile
       FROM appointments a
       LEFT JOIN patient_profiles pp ON pp.user_id = a.patient_id
       WHERE a.doctor_id = $1
       ORDER BY a.date DESC, a.time DESC`,
      [doctorId]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /appointments/doctor/slots ────────────────────────────────────────
exports.updateDoctorSlots = async (req, res, next) => {
  try {
    const doctorId = req.user.id;
    const { action, date, time, slotId } = req.body;

    if (action === 'add') {
      // Prevent duplicate slots
      const existing = await pool.query(
        'SELECT id FROM available_slots WHERE doctor_id = $1 AND date = $2 AND time = $3',
        [doctorId, date, time]
      );
      if (existing.rows.length > 0) {
        return res.status(409).json({ success: false, message: 'Slot already exists for this date/time' });
      }

      const { v4: uuidv4 } = require('uuid');
      const result = await pool.query(
        'INSERT INTO available_slots (id, doctor_id, date, time, is_available) VALUES ($1,$2,$3,$4,true) RETURNING *',
        [uuidv4(), doctorId, date, time]
      );
      return res.status(201).json({ success: true, message: 'Slot added', data: result.rows[0] });
    }

    if (action === 'remove') {
      const slot = await pool.query(
        'SELECT * FROM available_slots WHERE id = $1 AND doctor_id = $2',
        [slotId, doctorId]
      );

      if (slot.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Slot not found' });
      }

      if (!slot.rows[0].is_available) {
        return res.status(400).json({ success: false, message: 'Cannot remove a booked slot' });
      }

      await pool.query('DELETE FROM available_slots WHERE id = $1', [slotId]);
      return res.json({ success: true, message: 'Slot removed' });
    }

    res.status(400).json({ success: false, message: 'Invalid action. Use "add" or "remove".' });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /appointments/:appointmentId/status ────────────────────────────────
exports.updateAppointmentStatus = async (req, res, next) => {
  try {
    const { appointmentId } = req.params;
    const { status } = req.body;
    const doctorId = req.user.id;

    const validStatuses = ['completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const result = await pool.query(
      `UPDATE appointments
       SET status = $1
       WHERE id = $2 AND doctor_id = $3
       RETURNING *`,
      [status, appointmentId, doctorId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Appointment not found' });
    }

    res.json({ success: true, message: `Appointment marked as ${status}`, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

// ─── GET /appointments/doctor/stats ──────────────────────────────────────────
exports.getDoctorStats = async (req, res, next) => {
  try {
    const doctorId = req.user.id;

    const result = await pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE date = CURRENT_DATE) AS today_total,
        COUNT(*) FILTER (WHERE date = CURRENT_DATE AND status = 'completed') AS today_completed,
        COUNT(*) FILTER (WHERE date = CURRENT_DATE AND status = 'booked') AS today_upcoming,
        COUNT(*) FILTER (WHERE status = 'booked' AND (date > CURRENT_DATE OR (date = CURRENT_DATE AND time > CURRENT_TIME))) AS total_upcoming
       FROM appointments
       WHERE doctor_id = $1`,
      [doctorId]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

// ─── GET /appointments/slots/:doctorId ────────────────────────────────────────
exports.getDoctorSlots = async (req, res, next) => {
  try {
    const { doctorId } = req.params;
    const { date } = req.query;

    let query = `
      SELECT id, date, time, is_available
      FROM available_slots
      WHERE doctor_id = $1
    `;
    const params = [doctorId];

    if (date) {
      params.push(date);
      query += ` AND date = $2`;
    } else {
      query += ` AND date >= CURRENT_DATE`;
    }

    query += ' ORDER BY date, time';

    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
};
