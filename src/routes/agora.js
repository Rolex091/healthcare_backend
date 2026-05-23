// src/routes/agora.js
const express = require('express');
const router = express.Router();
const agoraController = require('../controllers/agoraController');
const { authenticate } = require('../middleware/auth');

router.post('/token', authenticate, agoraController.generateToken);
router.post('/validate', authenticate, agoraController.validateCall);

module.exports = router;
