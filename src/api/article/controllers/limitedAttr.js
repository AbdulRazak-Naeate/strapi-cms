'use strict';

/**
 * article controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::article.article', ({ strapi }) => ({
    // Method to fetch an article by title
    async limitedAttributes(ctx) {

      const { title,populate } = ctx.query;
      // Define the fields to populate
    const populateFields = 
    ['content','image','title']; 

      console.log(title)
      const entity = await strapi.db.query('api::article.article').findOne({
        
        where: { title },
        populate:populateFields
      });
       
      if (!entity) {

        return ctx.notFound('Article not found');
      }
  
      return this.sanitizeOutput(entity, ctx);
    },
  }));
