module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/ai-articles/generate',
      handler: 'ai-generate.aiGenerate',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/ai-articles/generate',
      handler: 'ai-generate.aiGenerate',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
};
