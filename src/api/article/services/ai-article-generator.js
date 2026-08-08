'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Readable } = require('stream');

/**
 * AI Article Generator Service
 *
 * Generates professional daily articles using Google Gemini or OpenAI,
 * sources cover images from Unsplash, and creates article entries in Strapi.
 */
module.exports = ({ strapi }) => {
  let gemini = null;
  let openai = null;

  function getProvider() {
    return (process.env.AI_PROVIDER || 'gemini').toLowerCase();
  }

  function getOpenAIApiKey() {
    return process.env.OPENAI_API_KEY || strapi.config.get('server.env.OPENAI_API_KEY');
  }

  function getGeminiApiKey() {
    return process.env.GEMINI_API_KEY || strapi.config.get('server.env.GEMINI_API_KEY');
  }

  function getOpenAIClient() {
    if (!openai) {
      const { OpenAI } = require('openai');
      const apiKey = getOpenAIApiKey();
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY environment variable is not set');
      }
      openai = new OpenAI({ apiKey });
    }
    return openai;
  }

  function isModelNotFoundError(err) {
    const message = (err && err.message) || '';
    return message.includes('404') || message.includes('not found') || message.includes('models/');
  }

  function getCandidateModels() {
    const primary = process.env.AI_MODEL || 'gemini-2.0-flash';
    const fallbackFromEnv = (process.env.AI_MODEL_FALLBACKS || '')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);

    const defaults = ['gemini-2.5-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-pro'];
    return [...new Set([primary, ...fallbackFromEnv, ...defaults])];
  }

  /**
   * Lazily initialize the Gemini client (avoids crash if key not set).
   */
  function getGeminiClient() {
    if (!gemini) {
      const apiKey = getGeminiApiKey();
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY environment variable is not set');
      }
      gemini = new GoogleGenerativeAI(apiKey);
    }
    return gemini;
  }

  async function listAvailableGenerateModels(apiKey) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
      );
      if (!res.ok) {
        strapi.log.warn(`Could not list Gemini models: ${res.status} ${res.statusText}`);
        return [];
      }

      const payload = await res.json();
      const models = Array.isArray(payload.models) ? payload.models : [];

      return models
        .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
        .map((m) => (m.name || '').replace(/^models\//, ''))
        .filter(Boolean);
    } catch (err) {
      strapi.log.warn(`Could not list Gemini models: ${err.message}`);
      return [];
    }
  }

  function parseJsonArticle(rawText, providerName) {
    const cleaned = rawText.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      strapi.log.error(`Failed to parse ${providerName} response as JSON:`, cleaned);
      throw new Error(`${providerName} returned invalid JSON for article generation`);
    }

    if (!parsed.title || !parsed.content || !parsed.excerpt) {
      throw new Error(`${providerName} response missing required fields (title, content, excerpt)`);
    }

    if (parsed.excerpt.length > 300) {
      parsed.excerpt = parsed.excerpt.substring(0, 297) + '...';
    }

    return parsed;
  }

  function buildPrompts(categoryTitle) {
    const wordCount = parseInt(process.env.AI_ARTICLE_WORD_COUNT || '800', 10);
    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const systemPrompt = `You are a professional journalist and content writer. You write authoritative, well-researched, and engaging articles. Your writing is clear, informative, and avoids generic filler content. You produce publication-ready HTML content.`;

    const userPrompt = `Write a professional article about "${categoryTitle}".

Requirements:
- Today's date is ${today}. Make the article timely and relevant to current trends.
- Target length: approximately ${wordCount} words.
- Format the article body as clean HTML using <h2>, <h3>, <p>, <ul>, <li>, <strong>, <em> tags. Do NOT include <html>, <head>, <body>, or <h1> tags.
- Write an engaging, specific title (not generic). The title must be unique and include a fresh angle.
- Write a compelling excerpt/summary of maximum 250 characters (plain text, no HTML).

Respond in exactly this JSON format:
{
  "title": "Your Article Title Here",
  "content": "<h2>...</h2><p>...</p>...",
  "excerpt": "A short compelling summary..."
}

Return ONLY valid JSON. No markdown fences, no extra text.`;

    return { systemPrompt, userPrompt };
  }

  async function generateWithGemini(categoryTitle) {
    const client = getGeminiClient();
    const apiKey = getGeminiApiKey();
    const { systemPrompt, userPrompt } = buildPrompts(categoryTitle);

    const preferredModels = [
      process.env.AI_GEMINI_MODEL || process.env.AI_MODEL || 'gemini-2.0-flash',
      ...getCandidateModels(),
    ];
    const availableModels = await listAvailableGenerateModels(apiKey);

    let models = preferredModels;
    if (availableModels.length > 0) {
      const availableSet = new Set(availableModels);
      const preferredAvailable = preferredModels.filter((m) => availableSet.has(m));

      models = preferredAvailable.length > 0 ? preferredAvailable : availableModels;
      strapi.log.info(
        `Gemini model selection: trying ${models.slice(0, 5).join(', ')}${models.length > 5 ? ', ...' : ''}`
      );
    }

    let raw = '';
    let lastError = null;

    for (const model of models) {
      try {
        const modelClient = client.getGenerativeModel({ model });
        const response = await modelClient.generateContent({
          contents: [
            {
              role: 'user',
              parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 4096,
          },
        });

        raw = response.response.text().trim();
        if (model !== models[0]) {
          strapi.log.warn(`Primary model unavailable; generated using fallback model: ${model}`);
        }
        break;
      } catch (err) {
        lastError = err;
        if (isModelNotFoundError(err)) {
          strapi.log.warn(`Gemini model unavailable: ${model}. Trying next fallback model...`);
          continue;
        }
        throw err;
      }
    }

    if (!raw) {
      throw new Error(
        `No usable Gemini model found. Tried: ${models.join(', ')}. Last error: ${lastError ? lastError.message : 'unknown error'}`
      );
    }

    return parseJsonArticle(raw, 'Gemini');
  }

  async function generateWithOpenAI(categoryTitle) {
    const client = getOpenAIClient();
    const { systemPrompt, userPrompt } = buildPrompts(categoryTitle);

    const model = process.env.AI_OPENAI_MODEL || process.env.AI_MODEL || 'gpt-4o-mini';

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 4096,
    });

    const raw = (response.choices[0].message.content || '').trim();
    return parseJsonArticle(raw, 'OpenAI');
  }

  /**
   * Generate an article using configured provider for a given topic/category.
   *
   * @param {string} categoryTitle - The category/topic to write about
   * @returns {Promise<{title: string, content: string, excerpt: string}>}
   */
  async function generateArticle(categoryTitle) {
    const provider = getProvider();

    if (provider === 'openai') {
      return generateWithOpenAI(categoryTitle);
    }

    return generateWithGemini(categoryTitle);
  }

  /**
   * Fetch a cover image from Unsplash and upload it to Strapi's media library.
   *
   * @param {string} query - Search query for the image
   * @returns {Promise<number|null>} - The uploaded media entry ID, or null on failure
   */
  async function fetchCoverImage(query) {
    const accessKey = process.env.UNSPLASH_ACCESS_KEY;
    if (!accessKey) {
      strapi.log.warn('UNSPLASH_ACCESS_KEY not set — skipping cover image');
      return null;
    }

    try {
      // Search for a relevant photo
      const searchUrl = new URL('https://api.unsplash.com/search/photos');
      searchUrl.searchParams.set('query', query);
      searchUrl.searchParams.set('per_page', '5');
      searchUrl.searchParams.set('orientation', 'landscape');

      const searchRes = await fetch(searchUrl.toString(), {
        headers: { Authorization: `Client-ID ${accessKey}` },
      });

      if (!searchRes.ok) {
        strapi.log.warn(`Unsplash search failed: ${searchRes.status} ${searchRes.statusText}`);
        return null;
      }

      const searchData = await searchRes.json();
      if (!searchData.results || searchData.results.length === 0) {
        strapi.log.warn(`No Unsplash images found for query: "${query}"`);
        return null;
      }

      // Pick a random image from results
      const photo = searchData.results[Math.floor(Math.random() * searchData.results.length)];
      const imageUrl = photo.urls.regular;
      const photographerName = photo.user.name || 'Unsplash';

      // Download the image
      const imageRes = await fetch(imageUrl);
      if (!imageRes.ok) {
        strapi.log.warn(`Failed to download Unsplash image: ${imageRes.status}`);
        return null;
      }

      const arrayBuffer = await imageRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const fileName = `ai-article-${Date.now()}.jpg`;

      // Upload to Strapi media library (Cloudinary)
      const uploadService = strapi.plugins.upload.services.upload;
      const [uploadedFile] = await uploadService.upload({
        data: {
          fileInfo: {
            name: fileName,
            caption: `Photo by ${photographerName} on Unsplash`,
            alternativeText: query,
          },
        },
        files: {
          path: null,
          name: fileName,
          type: 'image/jpeg',
          size: buffer.length,
          stream: Readable.from(buffer),
        },
      });

      strapi.log.info(`Uploaded cover image: ${uploadedFile.id} (by ${photographerName})`);
      return uploadedFile.id;
    } catch (err) {
      strapi.log.error('Error fetching/uploading cover image:', err.message);
      return null;
    }
  }

  /**
   * Check if a title already exists and make it unique if needed.
   *
   * @param {string} title - The proposed title
   * @returns {Promise<string>} - A unique title
   */
  async function ensureUniqueTitle(title) {
    const existing = await strapi.db.query('api::article.article').findOne({
      where: { title },
    });

    if (!existing) {
      return title;
    }

    // Append date to make unique
    const dateSuffix = new Date().toISOString().split('T')[0];
    const uniqueTitle = `${title} — ${dateSuffix}`;

    // Check again with suffix
    const existingWithSuffix = await strapi.db.query('api::article.article').findOne({
      where: { title: uniqueTitle },
    });

    if (!existingWithSuffix) {
      return uniqueTitle;
    }

    // Last resort: append timestamp
    return `${title} — ${Date.now()}`;
  }

  /**
   * Create an article entry in Strapi.
   *
   * @param {object} params
   * @param {string} params.title
   * @param {string} params.content
   * @param {string} params.excerpt
   * @param {number|null} params.imageId
   * @param {number[]} params.categoryIds
   * @returns {Promise<object>} - The created article entity
   */
  async function createArticleEntry({ title, content, excerpt, imageId, categoryIds }) {
    const autoPublish = process.env.AI_ARTICLE_AUTO_PUBLISH === 'true';
    const author = process.env.AI_ARTICLE_AUTHOR || 'AI Writer';

    const uniqueTitle = await ensureUniqueTitle(title);

    const data = {
      title: uniqueTitle,
      content,
      Excerpt: excerpt,
      author,
      date_created: new Date().toISOString(),
      likes: 0,
      categories: categoryIds,
      publishedAt: autoPublish ? new Date().toISOString() : null,
    };

    if (imageId) {
      data.image = imageId;
    }

    const article = await strapi.entityService.create('api::article.article', {
      data,
      populate: ['categories', 'image'],
    });

    strapi.log.info(
      `AI article created: "${uniqueTitle}" [ID: ${article.id}] — ${autoPublish ? 'published' : 'draft'}`
    );

    return article;
  }

  /**
   * Get random categories from Strapi to use as article topics.
   *
   * @param {number} count - Number of categories to pick
   * @returns {Promise<Array<{id: number, title: string}>>}
   */
  async function getRandomCategories(count) {
    const allCategories = await strapi.db.query('api::category.category').findMany({
      select: ['id', 'title'],
    });

    if (allCategories.length === 0) {
      throw new Error('No categories found in Strapi. Please create at least one category.');
    }

    // Shuffle and pick
    const shuffled = [...allCategories].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, shuffled.length));
  }

  /**
   * Main orchestrator — generates articles for random categories.
   *
   * @param {object} [options]
   * @param {number} [options.categoryId] - Specific category ID (overrides random selection)
   * @param {number} [options.count] - Number of articles to generate
   * @returns {Promise<object[]>} - Array of created article entities
   */
  async function run({ categoryId, count } = {}) {
    const articleCount = count || parseInt(process.env.AI_ARTICLE_COUNT || '1', 10);
    const results = [];
    const failures = [];

    // Query param > env var > random
    const resolvedCategoryId = categoryId || process.env.AI_ARTICLE_CATEGORY_ID || null;

    let categories;

    if (resolvedCategoryId) {
      const category = await strapi.db.query('api::category.category').findOne({
        where: { id: parseInt(resolvedCategoryId, 10) },
        select: ['id', 'title'],
      });
      if (!category) {
        throw new Error(`Category with ID ${resolvedCategoryId} not found`);
      }
      categories = [category];
    } else {
      categories = await getRandomCategories(articleCount);
    }

    for (const category of categories) {
      try {
        strapi.log.info(`Generating AI article for category: "${category.title}"...`);

        // Generate article content
        const { title, content, excerpt } = await generateArticle(category.title);

        // Fetch and upload cover image
        const imageId = await fetchCoverImage(category.title);

        // Create the article entry
        const article = await createArticleEntry({
          title,
          content,
          excerpt,
          imageId,
          categoryIds: [category.id],
        });

        results.push(article);

        // Small delay between articles to respect rate limits
        if (categories.length > 1) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } catch (err) {
        failures.push({
          category: category.title,
          message: err.message,
        });
        strapi.log.error(
          `Failed to generate article for category "${category.title}": ${err.message}`
        );
      }
    }

    strapi.log.info(`AI article generation complete: ${results.length}/${categories.length} articles created`);

    if (results.length === 0 && failures.length > 0) {
      const firstFailure = failures[0];
      throw new Error(
        `All generations failed. First failure for "${firstFailure.category}": ${firstFailure.message}`
      );
    }

    return results;
  }

  return {
    generateArticle,
    fetchCoverImage,
    createArticleEntry,
    getRandomCategories,
    ensureUniqueTitle,
    run,
  };
};
