// src/routes/chat.js
const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const { authenticate } = require('../middleware/auth');

router.post('/message', authenticate, chatController.sendMessage);
router.get('/history', authenticate, chatController.getChatHistory);
router.delete('/history', authenticate, chatController.clearChatHistory);

module.exports = router;
