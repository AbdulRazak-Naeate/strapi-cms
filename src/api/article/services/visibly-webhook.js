'use strict';

const crypto = require('crypto');
const { Readable } = require('stream');
const responseCache = require('../utils/response-cache');

const ARTICLE_UID = 'api::article.article';
const MAPPING_UID = 'api::visibly-article-mapping.visibly-article-mapping';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const RAW_BODY = Symbol.for('unparsedBody');

function safeEqual(actual, expected) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function validSignature(signature, rawBody, secret) {
  if (!/^[a-f\d]{64}$/i.test(signature) || (!Buffer.isBuffer(rawBody) && typeof rawBody !== 'string')) {
    return false;
  }

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), expected);
}

function getPublicUrl(slug) {
  const baseUrl = process.env.VISIBLY_PUBLIC_SITE_URL || 'https://www.pifiatconvert.com';

  const parsedBaseUrl = new URL(baseUrl);
  if (parsedBaseUrl.protocol !== 'https:') {
    throw new Error('VISIBLY_PUBLIC_SITE_URL must use HTTPS');
  }

  return `${parsedBaseUrl.origin}/blog/${encodeURIComponent(slug)}`;
}

function imageExtension(contentType) {
  return {
    'image/avif': 'avif',
    'image/gif': 'gif',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  }[contentType];
}

async function downloadImage(url) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (error) {
    throw new Error('Visibly image URL is invalid');
  }

  if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) {
    throw new Error('Visibly image URLs must be HTTPS URLs without embedded credentials');
  }

  const response = await fetch(parsedUrl, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    throw new Error(`Visibly image download failed with HTTP ${response.status}`);
  }

  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const contentLength = Number(response.headers.get('content-length'));
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
    throw new Error(`Visibly image has unsupported content type: ${contentType || 'unknown'}`);
  }
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
    throw new Error('Visibly image exceeds the 10 MB limit');
  }
  if (!response.body) {
    throw new Error('Visibly image response has no body');
  }

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new Error('Visibly image exceeds the 10 MB limit');
    }
    chunks.push(Buffer.from(value));
  }

  if (size === 0) {
    throw new Error('Visibly image response is empty');
  }

  return {
    buffer: Buffer.concat(chunks),
    contentType,
    extension: imageExtension(contentType),
  };
}

async function uploadImage(strapi, url, altText, name) {
  if (!url) return null;

  const { buffer, contentType, extension } = await downloadImage(url);
  const [uploadedFile] = await strapi.plugins.upload.services.upload.upload({
    data: {
      fileInfo: {
        name: `${name}.${extension}`,
        alternativeText: altText || '',
      },
    },
    files: {
      path: null,
      name: `${name}.${extension}`,
      type: contentType,
      size: buffer.length,
      stream: Readable.from(buffer),
    },
  });

  if (!uploadedFile?.id) {
    throw new Error('Strapi did not return an uploaded media ID');
  }
  return uploadedFile.id;
}

function sourceMetadata(article) {
  return {
    published_url: article.published_url || null,
    metaDescription: article.metaDescription || '',
    keywords: Array.isArray(article.keywords) ? article.keywords : [],
    metaKeywords: article.metaKeywords || null,
    faqSchema: article.faqSchema || null,
    languageCode: article.languageCode || null,
    sourceArticleId: article.sourceArticleId || null,
    heroImageUrl: article.heroImageUrl || null,
    heroImageAlt: article.heroImageAlt || null,
    infographicImageUrl: article.infographicImageUrl || null,
    status: article.status || null,
    publishedAt: article.publishedAt || null,
    updatedAt: article.updatedAt || null,
    createdAt: article.createdAt || null,
  };
}

function validateArticle(article) {
  if (!article || typeof article !== 'object' || Array.isArray(article)) {
    return 'A JSON object is required';
  }
  if (!['article.published', 'article.updated', 'test'].includes(article.event)) {
    return 'event must be article.published, article.updated, or test';
  }
  if (article.event === 'test') return null;
  if (!Number.isSafeInteger(article.id) || article.id <= 0) {
    return 'id must be a positive integer';
  }
  if (typeof article.title !== 'string' || !article.title.trim()) {
    return 'title is required';
  }
  if (typeof article.slug !== 'string' || !article.slug.trim()) {
    return 'slug is required';
  }
  if (typeof article.content_html !== 'string' && typeof article.content_markdown !== 'string') {
    return 'content_html or content_markdown is required';
  }
  return null;
}

module.exports = ({ strapi }) => ({
  async receive(ctx) {
    const secret = process.env.VISIBLY_WEBHOOK_TOKEN;
    const authorization = ctx.get('Authorization');
    if (!secret || !safeEqual(authorization, `Bearer ${secret}`)) {
      ctx.status = 401;
      ctx.body = { error: 'Unauthorized' };
      return;
    }

    const signature = ctx.get('X-Visibly-Signature');
    if (signature && !validSignature(signature, ctx.request.body?.[RAW_BODY], secret)) {
      ctx.status = 401;
      ctx.body = { error: 'Invalid signature' };
      return;
    }

    const article = ctx.request.body;
    const validationError = validateArticle(article);
    if (validationError) {
      ctx.status = 400;
      ctx.body = { error: validationError };
      return;
    }

    if (article.event === 'test') {
      ctx.status = 200;
      ctx.body = { url: 'https://mysite.com/test' };
      return;
    }

    const headerEvent = ctx.get('X-Visibly-Event');
    if (headerEvent && headerEvent !== article.event) {
      ctx.status = 400;
      ctx.body = { error: 'X-Visibly-Event does not match the event in the request body' };
      return;
    }

    try {
      const publishedUrl = getPublicUrl(article.slug);
      const mapping = await strapi.db.query(MAPPING_UID).findOne({
        where: { visiblyId: article.id },
      });
      const existingArticle = mapping?.articleId
        ? await strapi.entityService.findOne(ARTICLE_UID, mapping.articleId)
        : null;

      const existingMetadata = mapping?.sourceMetadata || {};
      const heroUrl = article.heroImageUrl || null;
      const infographicUrl = article.infographicImageUrl || null;
      const heroImageId =
        heroUrl && heroUrl === existingMetadata.heroImageUrl && mapping.heroImageMediaId
          ? mapping.heroImageMediaId
          : await uploadImage(strapi, heroUrl, article.heroImageAlt, `visibly-${article.id}-hero`);
      const infographicImageId =
        infographicUrl && infographicUrl === existingMetadata.infographicImageUrl && mapping.infographicImageMediaId
          ? mapping.infographicImageMediaId
          : await uploadImage(strapi, infographicUrl, '', `visibly-${article.id}-infographic`);
      const content = article.content_html || article.content_markdown;
      const publishedAt = article.publishedAt ? new Date(article.publishedAt) : new Date();
      if (Number.isNaN(publishedAt.getTime())) {
        throw new Error('Visibly publishedAt must be a valid ISO 8601 timestamp');
      }

      const articleData = {
        title: article.title.trim(),
        content,
        Excerpt: (article.metaDescription || '').slice(0, 300),
        date_created: article.createdAt || publishedAt.toISOString(),
        publishedAt: publishedAt.toISOString(),
        ...(heroImageId ? { image: heroImageId } : heroUrl === null ? { image: null } : {}),
      };

      let savedArticle;
      if (existingArticle) {
        savedArticle = await strapi.entityService.update(ARTICLE_UID, existingArticle.id, {
          data: articleData,
        });
      } else {
        const duplicateTitle = await strapi.db.query(ARTICLE_UID).findOne({
          where: { title: articleData.title },
        });
        if (duplicateTitle) {
          throw new Error(`An unrelated article already uses the title "${articleData.title}"`);
        }
        savedArticle = await strapi.entityService.create(ARTICLE_UID, { data: articleData });
      }

      const mappingData = {
        visiblyId: article.id,
        articleId: savedArticle.id,
        slug: article.slug,
        sourceMetadata: sourceMetadata(article),
        heroImageMediaId: heroImageId,
        infographicImageMediaId: infographicImageId,
      };
      if (mapping) {
        await strapi.entityService.update(MAPPING_UID, mapping.id, { data: mappingData });
      } else {
        await strapi.entityService.create(MAPPING_UID, { data: mappingData });
      }

      responseCache.clear('articles-find');
      ctx.status = 200;
      ctx.body = { url: publishedUrl };
    } catch (error) {
      strapi.log.error(`Visibly webhook failed for article ${article.id}: ${error.message}`, error);
      ctx.status = 500;
      ctx.body = { error: 'Unable to process Visibly article' };
    }
  },
});
