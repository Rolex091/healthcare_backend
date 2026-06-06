// src/routes/chat.js
const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const { authenticate } = require('../middleware/auth');
const upload = require('../middleware/upload');

// AI Chatbot Routes
router.post('/message', authenticate, chatController.sendMessage);
router.get('/history', authenticate, chatController.getChatHistory);
router.delete('/history', authenticate, chatController.clearChatHistory);

// Doctor-Patient Chat Routes
router.get('/contacts', authenticate, chatController.getContacts);
router.post('/rooms', authenticate, chatController.getOrCreateRoom);
router.post('/send-message', authenticate, upload.single('file'), chatController.sendChatMessage);
router.get('/history/:chatId', authenticate, chatController.getChatRoomHistory);
router.post('/read', authenticate, chatController.markMessagesAsRead);

module.exports = router;
