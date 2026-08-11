'use strict';

/**
 * user-activity service
 */

const { createCoreService } = require('@strapi/strapi').factories;

const ACTIVITY_UID = 'api::user-activity.user-activity';

module.exports = createCoreService(ACTIVITY_UID, ({ strapi }) => ({
  async logActivity({ userId, articleId, actionType, metadata = null }) {
    if (!userId || !articleId || !actionType) {
      return null;
    }

    return strapi.entityService.create(ACTIVITY_UID, {
      data: {
        user: userId,
        article: articleId,
        actionType,
        metadata,
      },
    });
  },
}));
