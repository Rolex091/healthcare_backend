// src/controllers/profileController.js — Profile management
const pool = require('../config/db');

// ─── GET /profile/:userId ────────────────────────────────────────────────────
exports.getProfile = async (req, res, next) => {
  try {
    const { userId } = req.params;

    if (req.user.id !== userId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const userResult = await pool.query(
      'SELECT id, email, phone, role FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const user = userResult.rows[0];

    let profile = null;

    if (user.role === 'patient') {
      const r = await pool.query(
        'SELECT * FROM patient_profiles WHERE user_id = $1',
        [userId]
      );
      profile = r.rows[0] || null;
    }

    if (user.role === 'doctor') {
      const r = await pool.query(
        'SELECT * FROM doctor_profiles WHERE user_id = $1',
        [userId]
      );
      profile = r.rows[0] || null;
    }

    res.json({ success: true, data: { ...user, profile } });
  } catch (err) {
    console.error(err);
    next(err);
  }
};

// ─── PATCH /profile/:userId ──────────────────────────────────────────────────
exports.updateProfile = async (req, res, next) => {
  try {
    const { userId } = req.params;

    console.log("USER ID:", userId);
    console.log("BODY DATA:", req.body); // 🔥 DEBUG

    if (req.user.id !== userId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const userResult = await pool.query(
      'SELECT role FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const role = userResult.rows[0].role;

    // ───── PATIENT ─────
    if (role === 'patient') {
      const {
        name,
        age,
        gender,
        blood_group,
        medical_history,
        mobile,
        email
      } = req.body;

      const result = await pool.query(
        `UPDATE patient_profiles
         SET name = COALESCE($1, name),
             age = COALESCE($2, age),
             gender = COALESCE($3, gender),
             blood_group = COALESCE($4, blood_group),
             medical_history = COALESCE($5, medical_history),
             mobile = COALESCE($6, mobile),
             email = COALESCE($7, email),
             updated_at = NOW()
         WHERE user_id = $8
         RETURNING *`,
        [
          name ?? null,
          age ?? null,
          gender ?? null,
          blood_group ?? null,
          medical_history ?? null,
          mobile ?? null,
          email ?? null,
          userId
        ]
      );

      return res.json({ success: true, data: result.rows[0] });
    }

    // ───── DOCTOR ─────
    if (role === 'doctor') {
      const {
        name,
        specialization,
        experience_years,
        bio,
        phone
      } = req.body;

      const result = await pool.query(
        `UPDATE doctor_profiles
         SET name = COALESCE($1, name),
             specialization = COALESCE($2, specialization),
             experience_years = COALESCE($3, experience_years),
             bio = COALESCE($4, bio),
             phone = COALESCE($5, phone),
             updated_at = NOW()
         WHERE user_id = $6
         RETURNING *`,
        [
          name ?? null,
          specialization ?? null,
          experience_years ?? null,
          bio ?? null,
          phone ?? null,
          userId
        ]
      );

      return res.json({ success: true, data: result.rows[0] });
    }

    res.status(400).json({ success: false, message: 'Unknown role' });
  } catch (err) {
    console.error("UPDATE ERROR:", err); // 🔥 DEBUG
    next(err);
  }
};

// ─── POST /profile/upload-certificate ────────────────────────────────────────
exports.uploadCertificate = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const userId = req.user.id;
    const fileUrl = `/uploads/${req.file.filename}`;

    await pool.query(
      `UPDATE doctor_profiles 
       SET degree_certificate_url = $1, updated_at = NOW() 
       WHERE user_id = $2`,
      [fileUrl, userId]
    );

    res.json({
      success: true,
      message: 'Certificate uploaded successfully',
      data: { fileUrl },
    });
  } catch (err) {
    console.error(err);
    next(err);
  }
};