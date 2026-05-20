require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

// 🔥 ТИМЧАСОВО (для перевірки)
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function askClaude(prompt) {
  const response = await client.messages.create({
    model: "claude-3-opus-20240229",
    max_tokens: 300,
    messages: [
      { role: "user", content: prompt }
    ]
  });

  return response.content[0].text;
}

module.exports = { askClaude };