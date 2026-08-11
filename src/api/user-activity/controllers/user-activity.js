'use strict';

/**
 * user-activity controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

const ACTIVITY_UID = 'api::user-activity.user-activity';
const ALLOWED_ACTIVITY_TYPES = ['liked', 'unliked', 'created', 'viewed', 'shared'];

module.exports = createCoreController(ACTIVITY_UID, ({ strapi }) => ({
  async createForCurrentUser(ctx) {
    const user = ctx.state.user;
    const { articleId, actionType, metadata } = ctx.request.body || {};

    if (!user) {
      return ctx.unauthorized('Authentication required');
    }

    if (!articleId || !actionType) {
      return ctx.badRequest('articleId and actionType are required');
    }

    if (!ALLOWED_ACTIVITY_TYPES.includes(actionType)) {
      return ctx.badRequest('Unsupported actionType');
    }

    const article = await strapi.entityService.findOne('api::article.article', Number(articleId), {
      fields: ['id'],
    });

    if (!article) {
      return ctx.notFound('Article not found');
    }

    const entry = await strapi.service(ACTIVITY_UID).logActivity({
      userId: user.id,
      articleId: Number(articleId),
      actionType,
      metadata,
    });

    return this.transformResponse(entry);
  },

  async mine(ctx) {
    return this.me(ctx);
  },

  async me(ctx) {
    const user = ctx.state.user;

    if (!user) {
      return ctx.unauthorized('Authentication required');
    }

    const page = Math.max(parseInt(ctx.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(ctx.query.pageSize, 10) || 20, 1), 100);
    const start = (page - 1) * pageSize;

    const [entries, total] = await Promise.all([
      strapi.entityService.findMany(ACTIVITY_UID, {
        filters: { user: user.id },
        sort: { createdAt: 'desc' },
        start,
        limit: pageSize,
        populate: {
          article: {
            fields: ['title'],
          },
        },
      }),
      strapi.db.query(ACTIVITY_UID).count({
        where: { user: user.id },
      }),
    ]);

    return {
      data: entries,
      meta: {
        pagination: {
          page,
          pageSize,
          pageCount: Math.ceil(total / pageSize),
          total,
        },
      },
    };
  },
}));
