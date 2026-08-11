module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/activities',
      handler: 'user-activity.mine',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/activities',
      handler: 'user-activity.createForCurrentUser',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/activities/me',
      handler: 'user-activity.me',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
