'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::article.article', ({ strapi }) => ({
  /**
  * POST /ai-articles/generate
   *
   * Manually trigger AI article generation.
   * Query params:
   *   - categoryId (optional): specific category ID to generate for
   *   - count (optional): number of articles to generate (default: 1, max: 5)
   */
  async aiGenerate(ctx) {
    const { categoryId, count } = ctx.request.query;

    const articleCount = Math.min(parseInt(count || '1', 10), 5);

    if (articleCount < 1 || isNaN(articleCount)) {
      return ctx.badRequest('count must be a number between 1 and 5');
    }

    const options = { count: articleCount };

    if (categoryId) {
      const parsedId = parseInt(categoryId, 10);
      if (isNaN(parsedId)) {
        return ctx.badRequest('categoryId must be a valid number');
      }
      options.categoryId = parsedId;
    }

    try {
      const service = strapi.service('api::article.ai-article-generator');
      const articles = await service.run(options);

      return ctx.send({
        message: `${articles.length} article(s) generated successfully`,
        articles: articles.map((a) => ({
          id: a.id,
          title: a.title,
          publishedAt: a.publishedAt,
        })),
      });
    } catch (err) {
      strapi.log.error('AI article generation error:', err.message);
      return ctx.internalServerError('Failed to generate articles: ' + err.message);
    }
  },
}));
