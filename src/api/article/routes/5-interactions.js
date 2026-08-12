module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/articles/:id/like',
      handler: 'article.likeArticle',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'DELETE',
      path: '/articles/:id/like',
      handler: 'article.unlikeArticle',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/articles/:id/like-status',
      handler: 'article.likeStatus',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/articles/:id/view',
      handler: 'article.markViewed',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/articles/:id/share',
      handler: 'article.markShared',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
