// Path: ./config/env/production/server.js
// starting from Strapi v 4.6.1 server.js has to be the following

module.exports = ({ env }) => ({
    proxy: true,
    host: "0.0.0.0",
    port: process.env.PORT,
    url: env('PUBLIC_URL', 'https://naeatestudio-cms-f6767b576785.herokuapp.com'),
    app: { 
      keys: env.array('APP_KEYS')
    },
    admin: {
      auth: {
        secret: env('ADMIN_JWT_SECRET'),
      },
    },
  })
  