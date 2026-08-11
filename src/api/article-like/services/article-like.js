'use strict';

/**
 * article-like service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::article-like.article-like');
