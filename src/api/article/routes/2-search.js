
module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/articles/search',
      handler: 'searcharticle.search',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
}
