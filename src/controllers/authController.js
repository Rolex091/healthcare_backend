// src/controllers/authController.js — Authentication business logic
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const { validationResult } = require('express-validator');
const pool = require('../config/db');

// ─── Email transporter ───────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ─── Helper: generate 6-digit OTP ────────────────────────────────────────────
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ─── Helper: sign JWT ────────────────────────────────────────────────────────
function signToken(userId, role) {
  return jwt.sign({ userId, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

// ─── Helper: send OTP email ──────────────────────────────────────────────────
async function sendOTPEmail(toEmail, otp, purpose = 'verification') {
  const subjects = {
    verification: 'HEALTH CARE+ — Email Verification OTP',
    login: 'HEALTH CARE+ — Login OTP',
    forgot_password: 'HEALTH CARE+ — Password Reset OTP',
  };

  await transporter.sendMail({
    from: `"HEALTH CARE+" <${process.env.FROM_EMAIL}>`,
    to: toEmail,
    subject: subjects[purpose] || subjects.verification,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:500px;margin:auto;padding:20px;border:1px solid #e0e0e0;border-radius:8px;">
        <h2 style="color:#1976D2;text-align:center;">HEALTH CARE+</h2>
        <p>Your One-Time Password (OTP) is:</p>
        <h1 style="text-align:center;color:#2E7D32;letter-spacing:8px;font-size:36px;">${otp}</h1>
        <p style="color:#666;">This OTP is valid for <strong>10 minutes</strong>. Do not share it with anyone.</p>
        <hr style="border:none;border-top:1px solid #eee;"/>
        <p style="font-size:12px;color:#999;text-align:center;">HEALTH CARE+ — Your Health, Our Priority</p>
      </div>
    `,
  });
}

// ─── POST /auth/signup ───────────────────────────────────────────────────────
exports.signup = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { email, password, role, name, phone } = req.body;

    // Check duplicate email
    const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (exists.rows.length > 0) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const userId = uuidv4();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Insert user
      await client.query(
        'INSERT INTO users (id, email, phone, password_hash, role) VALUES ($1,$2,$3,$4,$5)',
        [userId, email, phone || null, passwordHash, role]
      );

      // Create empty profile
      if (role === 'patient') {
        await client.query(
          'INSERT INTO patient_profiles (user_id, name, email) VALUES ($1,$2,$3)',
          [userId, name || '', email]
        );
      } else if (role === 'doctor') {
        await client.query(
          'INSERT INTO doctor_profiles (user_id, name, email) VALUES ($1,$2,$3)',
          [userId, name || '', email]
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Generate and send OTP
    const otp = generateOTP();
    const expiryTime = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await pool.query(
      `INSERT INTO otp_verifications (user_id, otp_code, contact, expiry_time)
       VALUES ($1,$2,$3,$4)`,
      [userId, otp, email, expiryTime]
    );

    //await sendOTPEmail(email, otp, 'verification');

    res.status(201).json({
      success: true,
      message: 'Account created. OTP sent to your email.',
      data: { userId, email, role },
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /auth/login ────────────────────────────────────────────────────────
exports.login = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { email, password } = req.body;

    const result = await pool.query(
      'SELECT id, email, password_hash, role, is_active FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const user = result.rows[0];
    if (!user.is_active) {
      return res.status(401).json({ success: false, message: 'Account deactivated. Contact support.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    // Send login OTP
    const otp = generateOTP();
    const expiryTime = new Date(Date.now() + 10 * 60 * 1000);
    await pool.query(
      `INSERT INTO otp_verifications (user_id, otp_code, contact, expiry_time)
       VALUES ($1,$2,$3,$4)`,
      [user.id, otp, email, expiryTime]
    );
    //await sendOTPEmail(email, otp, 'login');

    res.json({
      success: true,
      message: 'OTP sent to your email. Please verify to complete login.',
      data: { userId: user.id, email: user.email, role: user.role },
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /auth/request-otp ──────────────────────────────────────────────────
exports.requestOtp = async (req, res, next) => {
  try {
    const { email, purpose } = req.body;

    const result = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'No account found with this email' });
    }

    const userId = result.rows[0].id;
    const otp = generateOTP();
    const expiryTime = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query(
      `INSERT INTO otp_verifications (user_id, otp_code, contact, expiry_time)
       VALUES ($1,$2,$3,$4)`,
      [userId, otp, email, expiryTime]
    );

    //await sendOTPEmail(email, otp, purpose || 'verification');

    res.json({ success: true, message: 'OTP sent to email' });
  } catch (err) {
    next(err);
  }
};

// ─── POST /auth/verify-otp ───────────────────────────────────────────────────
exports.verifyOtp = async (req, res, next) => {
  try {
    const { userId, otp } = req.body;

    const result = await pool.query(
      `SELECT id, otp_code, expiry_time, verified
       FROM otp_verifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'No OTP found. Please request a new one.' });
    }

    const record = result.rows[0];

    if (record.verified) {
      return res.status(400).json({ success: false, message: 'OTP already used. Please request a new one.' });
    }

    if (new Date() > new Date(record.expiry_time)) {
      return res.status(400).json({ success: false, message: 'OTP expired. Please request a new one.' });
    }

    if (record.otp_code !== otp.toString()) {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }

    // Mark OTP as verified
    await pool.query('UPDATE otp_verifications SET verified = true WHERE id = $1', [record.id]);

    // Activate user account
    await pool.query('UPDATE users SET is_active = true WHERE id = $1', [userId]);

    // Fetch user for token
    const userResult = await pool.query('SELECT id, role FROM users WHERE id = $1', [userId]);
    const user = userResult.rows[0];
    const token = signToken(user.id, user.role);

    res.json({
      success: true,
      message: 'OTP verified successfully',
      data: { token, userId: user.id, role: user.role },
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /auth/forgot-password ──────────────────────────────────────────────
exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    const result = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      // Return success anyway to prevent user enumeration
      return res.json({ success: true, message: 'If the email exists, a reset OTP has been sent.' });
    }

    const userId = result.rows[0].id;
    const otp = generateOTP();
    const expiryTime = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query(
      `INSERT INTO otp_verifications (user_id, otp_code, contact, expiry_time)
       VALUES ($1,$2,$3,$4)`,
      [userId, otp, email, expiryTime]
    );

    //await sendOTPEmail(email, otp, 'forgot_password');

    res.json({ success: true, message: 'If the email exists, a reset OTP has been sent.' });
  } catch (err) {
    next(err);
  }
};

// ─── POST /auth/reset-password ───────────────────────────────────────────────
exports.resetPassword = async (req, res, next) => {
  try {
    const { userId, otp, newPassword } = req.body;

    // Verify OTP first
    const otpResult = await pool.query(
      `SELECT id, otp_code, expiry_time, verified
       FROM otp_verifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );

    if (otpResult.rows.length === 0 || otpResult.rows[0].verified) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }

    const record = otpResult.rows[0];
    if (new Date() > new Date(record.expiry_time) || record.otp_code !== otp.toString()) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
    await pool.query('UPDATE otp_verifications SET verified = true WHERE id = $1', [record.id]);

    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    next(err);
  }
};

// ─── POST /auth/logout ───────────────────────────────────────────────────────
exports.logout = async (req, res) => {
  // JWT is stateless; client must delete the token
  res.json({ success: true, message: 'Logged out successfully' });
};
