// src/routes/reminders.js
const express = require('express');
const router = express.Router();
const remindersController = require('../controllers/remindersController');
const { authenticate } = require('../middleware/auth');

router.post('/schedule', authenticate, remindersController.scheduleReminder);
router.get('/status', authenticate, remindersController.getReminderStatus);

module.exports = router;
