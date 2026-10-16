'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/visibly/webhook',
      handler: 'article.visiblyWebhook',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
};
