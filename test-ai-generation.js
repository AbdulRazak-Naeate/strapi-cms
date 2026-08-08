/**
 * Quick standalone test for the AI article generation.
 * Run: node test-ai-generation.js
 *
 * Requires provider API key in .env or environment.
 */
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { OpenAI } = require('openai');

try {
  require('dotenv').config();
} catch (err) {
  // dotenv is optional; environment variables may already be set by shell/runtime.
}

async function test() {
  const topic = 'Technology';
  const provider = (process.env.AI_PROVIDER || 'gemini').toLowerCase();

  if (provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.AI_OPENAI_MODEL || process.env.AI_MODEL || 'gpt-4o-mini';

    if (!apiKey) {
      console.error('ERROR: OPENAI_API_KEY not set in .env');
      process.exit(1);
    }

    console.log('Testing OpenAI connection...');
    const client = new OpenAI({ apiKey });
    console.log(`Generating article for topic: "${topic}"...`);

    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: 'You are a professional journalist.',
        },
        {
          role: 'user',
          content: `Write a short test article (100 words) about "${topic}". Respond in JSON: {"title":"...","content":"<p>...</p>","excerpt":"..."}. Return ONLY valid JSON.`,
        },
      ],
      temperature: 0.7,
      max_tokens: 1024,
    });

    const raw = (response.choices[0].message.content || '').trim();
    const cleaned = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    const article = JSON.parse(cleaned);

    console.log('\n--- SUCCESS ---');
    console.log('Provider:', provider);
    console.log('Model:', model);
    console.log('Title:', article.title);
    console.log('Excerpt:', article.excerpt);
    console.log('Content preview:', article.content.substring(0, 200) + '...');
    console.log('\nOpenAI integration is working!');
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.AI_GEMINI_MODEL || process.env.AI_MODEL || 'gemini-2.0-flash';
  if (!apiKey) {
    console.error('ERROR: GEMINI_API_KEY not set in .env');
    process.exit(1);
  }

  console.log('Testing Gemini connection...');
  const client = new GoogleGenerativeAI(apiKey);
  const modelClient = client.getGenerativeModel({ model });

  console.log(`Generating article for topic: "${topic}"...`);

  const response = await modelClient.generateContent({
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `You are a professional journalist. Write a short test article (100 words) about "${topic}". Respond in JSON: {"title":"...","content":"<p>...</p>","excerpt":"..."}. Return ONLY valid JSON.`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1024,
    },
  });

  const raw = response.response.text().trim();
  const cleaned = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  const article = JSON.parse(cleaned);

  console.log('\n--- SUCCESS ---');
  console.log('Provider:', provider);
  console.log('Model:', model);
  console.log('Title:', article.title);
  console.log('Excerpt:', article.excerpt);
  console.log('Content preview:', article.content.substring(0, 200) + '...');
  console.log('\nGemini integration is working!');
}

test().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
