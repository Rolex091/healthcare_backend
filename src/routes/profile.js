// src/routes/profile.js
const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');
const { authenticate, authorize } = require('../middleware/auth');
const upload = require('../middleware/upload');

router.get('/:userId', authenticate, profileController.getProfile);
router.patch('/:userId', authenticate, profileController.updateProfile);
router.post(
  '/upload-certificate',
  authenticate,
  authorize('doctor'),
  upload.single('certificate'),
  profileController.uploadCertificate
);

module.exports = router;
