'use strict';

/**
 * Cron tasks for AI article generation.
 *
 * Schedule is configurable via AI_ARTICLE_CRON_SCHEDULE env var.
 * Default: "0 6 * * *" (daily at 6:00 AM server time).
 */
module.exports = {
  aiArticleGenerator: {
    task: async ({ strapi }) => {
      strapi.log.info('Cron: Starting AI article generation...');
      try {
        const service = strapi.service('api::article.ai-article-generator');
        const articles = await service.run();
        strapi.log.info(`Cron: AI article generation finished — ${articles.length} article(s) created`);
      } catch (err) {
        strapi.log.error(`Cron: AI article generation failed — ${err.message}`);
      }
    },
    options: {
      rule: process.env.AI_ARTICLE_CRON_SCHEDULE || '0 6 * * *',
    },
  },
};
