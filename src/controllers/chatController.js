// src/controllers/chatController.js — OpenRouter AI chatbot proxy
// ─────────────────────────────────────────────────────────────────────────────
// 🔑 API KEY LOCATION:
//    Add OPENROUTER_API_KEY to your .env file
//    Get it from: https://openrouter.ai/keys
// ─────────────────────────────────────────────────────────────────────────────

const pool = require('../config/db');
const { v4: uuidv4 } = require('uuid');

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
          model: 'deepseek/deepseek-chat',
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
