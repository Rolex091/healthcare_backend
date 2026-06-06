// src/controllers/chatController.js — OpenRouter AI chatbot proxy
// ─────────────────────────────────────────────────────────────────────────────
// 🔑 API KEY LOCATION:
//    Add OPENROUTER_API_KEY to your .env file
//    Get it from: https://openrouter.ai/keys
// ─────────────────────────────────────────────────────────────────────────────

const pool = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const { getIO } = require('../config/socket');
const { uploadFile } = require('../utils/storage');

// ─── POST /chat/message ───────────────────────────────────────────────────────
exports.sendMessage = async (req, res, next) => {
  try {
    const { message } = req.body;
    const userId = req.user.id;

    if (!message || message.trim() === '') {
      return res.status(400).json({ success: false, message: 'Message cannot be empty' });
    }

    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(500).json({
        success: false,
        message: 'OpenRouter API key not configured. Add OPENROUTER_API_KEY to .env',
      });
    }

    // Fetch last 10 messages for context
    const historyResult = await pool.query(
      `SELECT sender_id, message, is_ai_response
       FROM chat_messages
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [userId]
    );

    const history = historyResult.rows.reverse();

    // System Prompt and messages array
    const systemPrompt = `You are a healthcare AI assistant.

Rules:
- Give short and clear answers.
- Keep responses under 3 lines.
- Use simple English.
- Be professional and calm.
- Suggest consulting a doctor for serious symptoms.
- Do not give dangerous medical advice.
- Do not invent medicines or dosages.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.map((msg) => ({
        role: msg.is_ai_response ? 'assistant' : 'user',
        content: msg.message,
      })),
      { role: 'user', content: message }
    ];

    console.log("Calling OpenRouter API...");
    let response;
    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'deepseek/deepseek-chat:free',
          messages: messages
        })
      });
    } catch (e) {
      console.warn("First attempt failed with exception:", e.message);
    }

    if (!response || !response.ok) {
      const statusText = response ? `status ${response.status}` : "network error";
      console.log(`Failed to call 'deepseek/deepseek-chat:free' (${statusText}). Falling back to 'deepseek/deepseek-chat'...`);
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: "openai/gpt-3.5-turbo",
          messages: messages
        })
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    if (!data.choices || data.choices.length === 0 || !data.choices[0].message) {
      throw new Error('Invalid response structure from OpenRouter API');
    }

    const aiResponse = data.choices[0].message.content;

    // Save user message to DB
    const userMsgId = uuidv4();
    await pool.query(
      `INSERT INTO chat_messages (id, user_id, sender_id, message, is_ai_response)
       VALUES ($1,$2,$3,$4,false)`,
      [userMsgId, userId, userId, message]
    );

    // Save AI response to DB
    const aiMsgId = uuidv4();
    await pool.query(
      `INSERT INTO chat_messages (id, user_id, sender_id, message, is_ai_response)
       VALUES ($1,$2,'ai',$3,true)`,
      [aiMsgId, userId, aiResponse]
    );

    res.json({
      success: true,
      data: {
        userMessageId: userMsgId,
        aiMessageId: aiMsgId,
        response: aiResponse,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    const errMsg = err.message || '';
    console.error('❌ OpenRouter Error:', err);
    if (
      errMsg.includes('API_KEY_INVALID') ||
      errMsg.includes('API key not valid') ||
      errMsg.includes('Invalid API key') ||
      errMsg.includes('Unauthorized') ||
      errMsg.includes('401') ||
      errMsg.includes('403')
    ) {
      return res.status(500).json({
        success: false,
        message: 'Invalid or unconfigured OpenRouter API key. Please update OPENROUTER_API_KEY in healthcare_backend/.env and restart the backend server.',
      });
    }
    next(err);
  }
};

// ─── GET /chat/history ────────────────────────────────────────────────────────
exports.getChatHistory = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const result = await pool.query(
      `SELECT id, sender_id, message, is_ai_response, created_at
       FROM chat_messages
       WHERE user_id = $1
       ORDER BY created_at ASC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /chat/history ─────────────────────────────────────────────────────
exports.clearChatHistory = async (req, res, next) => {
  try {
    const userId = req.user.id;
    await pool.query('DELETE FROM chat_messages WHERE user_id = $1', [userId]);
    res.json({ success: true, message: 'Chat history cleared' });
  } catch (err) {
    next(err);
  }
};

// ==========================================
// DOCTOR-PATIENT CHAT EXTENSIONS
// ==========================================

const { isUserOnline } = require('../config/socket');

// ─── GET /chat/contacts ──────────────────────────────────────────────────────
exports.getContacts = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const role = req.user.role;

    let result;
    if (role === 'patient') {
      // Find all doctors this patient has booked
      result = await pool.query(
        `SELECT DISTINCT 
          dp.user_id AS id, 
          dp.name, 
          dp.specialization, 
          dp.degree_certificate_url, 
          dp.bio, 
          dp.email, 
          dp.phone,
          u.last_seen,
          (
            SELECT COALESCE(COUNT(*)::int, 0)
            FROM chat_messages m
            JOIN chat_participants cp ON cp.chat_id = m.chat_id
            WHERE cp.user_id = $1 AND m.sender_id = dp.user_id AND m.is_read = false
          ) AS unread_count
         FROM appointments a
         JOIN doctor_profiles dp ON dp.user_id = a.doctor_id
         JOIN users u ON u.id = dp.user_id
         WHERE a.patient_id = $1
         ORDER BY dp.name`,
        [userId]
      );
    } else if (role === 'doctor') {
      // Find all patients who have booked this doctor
      result = await pool.query(
        `SELECT DISTINCT 
          pp.user_id AS id, 
          pp.name, 
          pp.age, 
          pp.gender, 
          pp.blood_group, 
          pp.medical_history, 
          pp.mobile, 
          pp.email,
          u.last_seen,
          (
            SELECT COALESCE(COUNT(*)::int, 0)
            FROM chat_messages m
            JOIN chat_participants cp ON cp.chat_id = m.chat_id
            WHERE cp.user_id = $1 AND m.sender_id = pp.user_id AND m.is_read = false
          ) AS unread_count
         FROM appointments a
         JOIN patient_profiles pp ON pp.user_id = a.patient_id
         JOIN users u ON u.id = pp.user_id
         WHERE a.doctor_id = $1
         ORDER BY pp.name`,
        [userId]
      );
    } else {
      return res.status(400).json({ success: false, message: 'Invalid role' });
    }

    // Add dynamic online status to each contact
    const contacts = result.rows.map(contact => ({
      ...contact,
      is_online: isUserOnline(contact.id)
    }));

    res.json({ success: true, data: contacts });
  } catch (err) {
    next(err);
  }
};

// ─── POST /chat/rooms ────────────────────────────────────────────────────────
exports.getOrCreateRoom = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { recipientId } = req.body;

    if (!recipientId) {
      return res.status(400).json({ success: false, message: 'Recipient ID is required' });
    }

    // Access check: there must be at least one appointment between them
    const appointmentCheck = await pool.query(
      `SELECT id FROM appointments 
       WHERE (patient_id = $1 AND doctor_id = $2) 
          OR (patient_id = $2 AND doctor_id = $1)
       LIMIT 1`,
      [userId, recipientId]
    );

    if (appointmentCheck.rows.length === 0) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied: You can only chat with users with whom you have appointments.' 
      });
    }

    // Check if room exists
    const roomCheck = await pool.query(
      `SELECT cp1.chat_id
       FROM chat_participants cp1
       JOIN chat_participants cp2 USING (chat_id)
       WHERE cp1.user_id = $1 AND cp2.user_id = $2
       LIMIT 1`,
      [userId, recipientId]
    );

    if (roomCheck.rows.length > 0) {
      return res.json({ success: true, data: { chatId: roomCheck.rows[0].chat_id } });
    }

    // Create a new room
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const roomResult = await client.query(
        `INSERT INTO doctor_patient_chats DEFAULT VALUES RETURNING id`
      );
      const chatId = roomResult.rows[0].id;

      await client.query(
        `INSERT INTO chat_participants (chat_id, user_id) 
         VALUES ($1, $2), ($1, $3)`,
        [chatId, userId, recipientId]
      );

      await client.query('COMMIT');
      res.status(201).json({ success: true, data: { chatId } });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};

// ─── POST /chat/send-message ──────────────────────────────────────────────────
exports.sendChatMessage = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { chatId, message } = req.body;

    if (!chatId) {
      return res.status(400).json({ success: false, message: 'Chat ID is required' });
    }

    // Check if user is a participant
    const participantCheck = await pool.query(
      `SELECT id FROM chat_participants WHERE chat_id = $1 AND user_id = $2`,
      [chatId, userId]
    );

    if (participantCheck.rows.length === 0) {
      return res.status(403).json({ success: false, message: 'Access denied to this chat room' });
    }

    let fileUrl = null;
    let fileMeta = null;

    if (req.file) {
      let bucketName = 'chat-files';
      if (req.body.fileType === 'prescription') {
        bucketName = 'prescriptions';
      } else if (req.body.fileType === 'report') {
        bucketName = 'medical-reports';
      }
      fileUrl = await uploadFile(bucketName, req.file);
      fileMeta = {
        file_url: fileUrl,
        file_name: req.file.originalname,
        file_type: req.file.mimetype,
        file_size: req.file.size
      };
    }

    const messageText = message || (fileUrl ? `Sent a file: ${req.file.originalname}` : '');
    
    if (!messageText) {
      return res.status(400).json({ success: false, message: 'Message cannot be empty' });
    }

    const messageId = uuidv4();

    // Save message
    const msgResult = await pool.query(
      `INSERT INTO chat_messages (id, chat_id, user_id, sender_id, message, is_ai_response, is_read, created_at)
       VALUES ($1, $2, $3, $4, $5, false, false, NOW())
       RETURNING id, created_at`,
      [messageId, chatId, userId, userId, messageText]
    );

    const messageData = {
      id: messageId,
      chat_id: chatId,
      sender_id: userId,
      message: messageText,
      is_read: false,
      created_at: msgResult.rows[0].created_at,
      file: null
    };

    // Save message file if uploaded
    if (fileUrl && fileMeta) {
      await pool.query(
        `INSERT INTO chat_messages_files (id, message_id, file_url, file_name, file_type, file_size)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [uuidv4(), messageId, fileUrl, fileMeta.file_name, fileMeta.file_type, fileMeta.file_size]
      );
      messageData.file = fileMeta;
    }

    // Find recipient to notify in real time
    const recipientResult = await pool.query(
      `SELECT user_id FROM chat_participants WHERE chat_id = $1 AND user_id != $2`,
      [chatId, userId]
    );

    if (recipientResult.rows.length > 0) {
      const recipientId = recipientResult.rows[0].user_id;
      const io = getIO();
      if (io) {
        io.to(`user_${recipientId}`).emit('chat_message_received', {
          chatId,
          message: messageData
        });
      }
    }

    res.status(201).json({ success: true, data: messageData });
  } catch (err) {
    next(err);
  }
};

// ─── GET /chat/history/:chatId ───────────────────────────────────────────────
exports.getChatRoomHistory = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { chatId } = req.params;

    // Verify participation
    const participantCheck = await pool.query(
      `SELECT id FROM chat_participants WHERE chat_id = $1 AND user_id = $2`,
      [chatId, userId]
    );

    if (participantCheck.rows.length === 0) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const messagesResult = await pool.query(
      `SELECT 
        m.id, 
        m.sender_id, 
        m.message, 
        m.is_read, 
        m.created_at,
        f.file_url,
        f.file_name,
        f.file_type,
        f.file_size
       FROM chat_messages m
       LEFT JOIN chat_messages_files f ON f.message_id = m.id
       WHERE m.chat_id = $1
       ORDER BY m.created_at ASC`,
      [chatId]
    );

    const messages = messagesResult.rows.map(row => ({
      id: row.id,
      sender_id: row.sender_id,
      message: row.message,
      is_read: row.is_read,
      created_at: row.created_at,
      file: row.file_url ? {
        file_url: row.file_url,
        file_name: row.file_name,
        file_type: row.file_type,
        file_size: row.file_size
      } : null
    }));

    res.json({ success: true, data: messages });
  } catch (err) {
    next(err);
  }
};

// ─── POST /chat/read ──────────────────────────────────────────────────────────
exports.markMessagesAsRead = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { chatId } = req.body;

    if (!chatId) {
      return res.status(400).json({ success: false, message: 'Chat ID is required' });
    }

    // Verify participation
    const participantCheck = await pool.query(
      `SELECT id FROM chat_participants WHERE chat_id = $1 AND user_id = $2`,
      [chatId, userId]
    );

    if (participantCheck.rows.length === 0) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Mark messages sent by others as read
    await pool.query(
      `UPDATE chat_messages 
       SET is_read = true 
       WHERE chat_id = $1 AND sender_id != $2 AND is_read = false`,
      [chatId, userId]
    );

    // Update read tracking
    await pool.query(
      `INSERT INTO chat_read_status (chat_id, user_id, last_read_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (chat_id, user_id) 
       DO UPDATE SET last_read_at = NOW()`,
      [chatId, userId]
    );

    // Notify other participant of read event
    const recipientResult = await pool.query(
      `SELECT user_id FROM chat_participants WHERE chat_id = $1 AND user_id != $2`,
      [chatId, userId]
    );

    if (recipientResult.rows.length > 0) {
      const recipientId = recipientResult.rows[0].user_id;
      const io = getIO();
      if (io) {
        io.to(`user_${recipientId}`).emit('chat_read_status_change', {
          chatId,
          readerId: userId
        });
      }
    }

    res.json({ success: true, message: 'Messages marked as read' });
  } catch (err) {
    next(err);
  }
};
