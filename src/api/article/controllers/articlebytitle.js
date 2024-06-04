'use strict';

/**
 * article controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::article.article', ({ strapi }) => ({
    // Method to fetch an article by title
    async findOneByTitle(ctx) {
      const { title,populate } = ctx.query;
      console.log(title)
      const entity = await strapi.db.query('api::article.article').findOne({
        
        where: { title },
        populate:populate
      });
  
      if (!entity) {
        return ctx.notFound('Article not found');
      }
  
      return this.sanitizeOutput(entity, ctx);
    },
  }));
