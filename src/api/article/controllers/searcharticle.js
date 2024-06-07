'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::article.article', ({ strapi }) => ({
  async search(ctx) {
    const populateFields = 
    ['content','image', 'date_created','categories','title','author','likes','attributes']; 
    const { query } = ctx.request.query;

    if (!query) {
      return ctx.badRequest('Query parameter is required');
    }

    // Perform the search
    const entities = await strapi.db.query('api::article.article').findMany({
      where: {
        $or: [
          { title: { $containsi: query } },
          { content: { $containsi: query } },
        ],
      },
      populate: populateFields, // Populate all related data including images
    });

    return this.transformResponse(entities);
  },
}));
