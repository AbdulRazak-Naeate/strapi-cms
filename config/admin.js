module.exports = ({ env }) => ({
  auth: {
    secret: env('ADMIN_JWT_SECRET','oMHnHDvwBcU/O3usB6gMGA=='),
  },
  apiToken: {
    salt: env('API_TOKEN_SALT','LZVn+Hhx/aQSowXXhVbcKg=='),
  },
});
