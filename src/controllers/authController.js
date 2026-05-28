// src/controllers/authController.js

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');

const pool = require('../config/db');
//debugger//
console.log("SMTP DEBUG:");

console.log({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  user: process.env.SMTP_USER,
  passExists: !!process.env.SMTP_PASS,
});
// ==========================
// BREVO SMTP CONFIG
// ==========================
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ==========================
// OTP GENERATE
// ==========================
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ==========================
// JWT TOKEN
// ==========================
function signToken(userId, role) {
  return jwt.sign(
    { userId, role },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    }
  );
}

// ==========================
// SEND OTP EMAIL
// ==========================
async function sendOTPEmail(email, otp) {
  transporter.sendMail({
    from: `"HEALTH CARE+" <${process.env.SMTP_USER}>`,
    to: email,
    subject: 'HEALTH CARE+ OTP',
    html: `
      <div style="font-family:Arial;padding:20px">
        <h2>HEALTH CARE+</h2>
        <h1>${otp}</h1>
        <p>Your OTP is valid for 10 minutes.</p>
      </div>
    `,
  })
    .then(() => console.log('✅ OTP email sent'))
    .catch((err) => console.log('❌ Email error:', err.message));
}

// ==========================
// SIGNUP
// ==========================
exports.signup = async (req, res) => {
  try {
    const { email, password, role, name, phone } = req.body;

    const exists = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (exists.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Email already exists',
      });
    }

    const hash = await bcrypt.hash(password, 10);

    const userId = uuidv4();

    // CREATE USER
    await pool.query(
      `INSERT INTO users
      (id, email, phone, password_hash, role, is_active)
      VALUES ($1,$2,$3,$4,$5,true)`,
      [
        userId,
        email,
        phone || '',
        hash,
        role,
      ]
    );

    // CREATE PROFILE
    if (role === 'doctor') {
      await pool.query(
        `INSERT INTO doctor_profiles
        (user_id, name, email)
        VALUES ($1,$2,$3)`,
        [
          userId,
          name || '',
          email,
        ]
      );
    } else {
      await pool.query(
        `INSERT INTO patient_profiles
        (user_id, name, email)
        VALUES ($1,$2,$3)`,
        [
          userId,
          name || '',
          email,
        ]
      );
    }

    // GENERATE OTP
    const otp = generateOTP();

    await pool.query(
      `INSERT INTO otp_verifications
      (user_id, otp_code, contact, expiry_time)
      VALUES ($1,$2,$3,NOW() + INTERVAL '10 minutes')`,
      [
        userId,
        otp,
        email,
      ]
    );

    // SEND EMAIL
    sendOTPEmail(email, otp);

    res.json({
      success: true,
      message: 'Signup successful. OTP sent.',
      userId,
    });

  } catch (err) {
    console.log('❌ Signup error:', err);

    res.status(500).json({
      success: false,
      message: 'Signup failed',
    });
  }
};

// ==========================
// LOGIN
// ==========================
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'User not found',
      });
    }

    const user = result.rows[0];

    const match = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!match) {
      return res.status(400).json({
        success: false,
        message: 'Wrong password',
      });
    }

    // GENERATE OTP
    const otp = generateOTP();

    await pool.query(
      `INSERT INTO otp_verifications
      (user_id, otp_code, contact, expiry_time)
      VALUES ($1,$2,$3,NOW() + INTERVAL '10 minutes')`,
      [
        user.id,
        otp,
        email,
      ]
    );

    // SEND EMAIL
    sendOTPEmail(email, otp);

    res.json({
      success: true,
      message: 'OTP sent successfully',
      userId: user.id,
    });

  } catch (err) {
    console.log('❌ Login error:', err);

    res.status(500).json({
      success: false,
      message: 'Login failed',
    });
  }
};

// ==========================
// VERIFY OTP
// ==========================
exports.verifyOtp = async (req, res) => {
  try {
    const { userId, otp } = req.body;

    const result = await pool.query(
      `SELECT *
       FROM otp_verifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No OTP found',
      });
    }

    const record = result.rows[0];

    if (record.otp_code !== otp.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP',
      });
    }

    if (new Date() > new Date(record.expiry_time)) {
      return res.status(400).json({
        success: false,
        message: 'OTP expired',
      });
    }

    // MARK VERIFIED
    await pool.query(
      'UPDATE otp_verifications SET verified = true WHERE id = $1',
      [record.id]
    );

    // GET ROLE
    const userResult = await pool.query(
      'SELECT role FROM users WHERE id = $1',
      [userId]
    );

    const role = userResult.rows[0].role;

    // CREATE TOKEN
    const token = signToken(userId, role);

    res.json({
      success: true,
      message: 'OTP verified',
      token,
      role,
      userId,
    });

  } catch (err) {
    console.log('❌ OTP verify error:', err);

    res.status(500).json({
      success: false,
      message: 'OTP verification failed',
    });
  }
};