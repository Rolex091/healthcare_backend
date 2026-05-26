// src/routes/auth.js
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

// ✅ SIGNUP
router.post(
  '/signup',
  [
    body('email').isEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('role').isIn(['patient', 'doctor']).withMessage('Role must be patient or doctor'),
    body('name').notEmpty().withMessage('Name is required'),
  ],
  authController.signup
);

// ✅ LOGIN
router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password required'),
  ],
  authController.login
);

// ✅ OTP ROUTES (ONLY IF EXIST)
if (authController.requestOtp) {
  router.post('/request-otp', authController.requestOtp);
}

if (authController.verifyOtp) {
  router.post('/verify-otp', authController.verifyOtp);
}

// ✅ PASSWORD RESET (ONLY IF EXIST)
if (authController.forgotPassword) {
  router.post('/forgot-password', authController.forgotPassword);
}

if (authController.resetPassword) {
  router.post('/reset-password', authController.resetPassword);
}

// ✅ LOGOUT (ONLY IF EXIST)
if (authController.logout) {
  router.post('/logout', authenticate, authController.logout);
}

module.exports = router;