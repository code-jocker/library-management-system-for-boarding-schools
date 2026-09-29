// controllers/assistantController.js
// Chat endpoint for the in-app library assistant.
const asyncHandler = require('../utils/asyncHandler');
const { handleIntent, rephrase, llmConfigured } = require('../utils/libraryAssistant');

// POST /api/assistant/chat  { message, admissionNo?, useAi? }
const chat = asyncHandler(async (req, res) => {
  const { message = '', admissionNo = '', useAi } = req.body;
  if (!message.trim()) {
    return res.status(400).json({ success: false, message: 'Type a question first' });
  }
  if (message.length > 1000) {
    return res.status(400).json({ success: false, message: 'Question is too long' });
  }

  const result = await handleIntent(message, { admissionNo });
  const wantAi = useAi === undefined ? llmConfigured() : Boolean(useAi);
  const answer = wantAi ? await rephrase(message, result.answer) : result.answer;

  res.json({
    success: true,
    data: {
      answer,
      intent: result.intent,
      suggestions: result.suggestions || [],
      payload: result.data || null
    }
  });
});

// GET /api/assistant/status
const status = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: {
      ready: true,
      aiEnabled: llmConfigured(),
      capabilities: [
        'catalogue search and availability',
        'borrowing limits, loan periods, renewals, reservations',
        'fine rules and per-day charges',
        'member books and fines by admission number',
        'library contact details and categories'
      ]
    }
  });
});

module.exports = { chat, status };
