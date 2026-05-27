// src/controllers/authController.js

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const pool = require('../config/db');

// ✅ FIXED TRANSPORTER
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  connectionTimeout: 5000,
});

// OTP GENERATE
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// JWT
function signToken(userId, role) {
  return jwt.sign({ userId, role }, process.env.JWT_SECRET, {
    expiresIn: '7d',
  });
}

// ✅ SEND OTP (NON-BLOCKING + SAFE)
function sendOTPEmail(email, otp) {
  transporter
    .sendMail({
      from: `"HEALTH CARE+" <${process.env.SMTP_USER}>`, // ✅ CHANGED
      to: email,
      subject: 'Your OTP Code',
      html: `<h2>Your OTP is: ${otp}</h2><p>Valid for 10 minutes</p>`,
    })
    .then(() => console.log('OTP email sent'))
    .catch((err) => console.log('Email error:', err.message));
}

// ==========================
// ✅ SIGNUP
// ==========================
exports.signup = async (req, res) => {
  try {
    const { email, password, role, name, phone } = req.body;

    const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
    if (exists.rows.length) {
      return res.status(400).json({ message: 'Email already exists' });
    }

    const hash = await bcrypt.hash(password, 10);
    const userId = uuidv4();

    await pool.query(
      'INSERT INTO users (id,email,phone,password_hash,role) VALUES ($1,$2,$3,$4,$5)',
      [userId, email, phone, hash, role]
    );

    await pool.query(
      'INSERT INTO patient_profiles (user_id,name,email) VALUES ($1,$2,$3)',
      [userId, name || '', email]
    );

    const otp = generateOTP();

    await pool.query(
      'INSERT INTO otp_verifications (user_id,otp_code,contact,expiry_time) VALUES ($1,$2,$3,NOW()+INTERVAL \'10 minutes\')',
      [userId, otp, email]
    );

    // ✅ NON-BLOCKING EMAIL
    setImmediate(() => {
      sendOTPEmail(email, otp);
    });
    res.json({
      success: true,
      userId,
      message: 'OTP sent to email',
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: 'Signup error' });
  }
};

// ==========================
// ✅ LOGIN
// ==========================
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    if (!result.rows.length) {
      return res.status(400).json({ message: 'User not found' });
    }

    const user = result.rows[0];

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(400).json({ message: 'Wrong password' });
    }

    const otp = generateOTP();

    await pool.query(
      'INSERT INTO otp_verifications (user_id,otp_code,contact,expiry_time) VALUES ($1,$2,$3,NOW()+INTERVAL \'10 minutes\')',
      [user.id, otp, email]
    );

    setImmediate(() => {
      sendOTPEmail(email, otp);
    });

    res.json({
      success: true,
      userId: user.id,
      message: 'OTP sent to email',
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: 'Login error' });
  }
};

// ==========================
// ✅ VERIFY OTP
// ==========================
exports.verifyOtp = async (req, res) => {
  try {
    const { userId, otp } = req.body;

    const result = await pool.query(
      'SELECT * FROM otp_verifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',
      [userId]
    );

    if (!result.rows.length) {
      return res.status(400).json({ message: 'No OTP found' });
    }

    const record = result.rows[0];

    if (record.otp_code !== otp) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    if (new Date() > new Date(record.expiry_time)) {
      return res.status(400).json({ message: 'OTP expired' });
    }

    await pool.query('UPDATE users SET is_active=true WHERE id=$1', [userId]);

    const user = await pool.query('SELECT role FROM users WHERE id=$1', [userId]);

    const token = signToken(userId, user.rows[0].role);

    res.json({
      success: true,
      token,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: 'OTP verify error' });
  }
};