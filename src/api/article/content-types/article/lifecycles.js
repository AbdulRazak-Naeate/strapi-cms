'use strict';

const responseCache = require('../../utils/response-cache');

module.exports = {
  async afterCreate(event) {
    responseCache.clear('articles-find');
  },

  async afterUpdate(event) {
    responseCache.clear('articles-find');
  },

  async afterDelete(event) {
    responseCache.clear('articles-find');
  },

  async afterDeleteMany(event) {
    responseCache.clear('articles-find');
  },
};
