
module.exports = {
    routes: [
      {
        method: 'GET',
        path: '/articles/by-title',
        handler: 'articlebytitle.findOneByTitle',
      },
    ],
  }
