// path: ./config/env/production/database.js

const { parse } = require("pg-connection-string");

module.exports = ({ env }) => {
  const dbUrl = env("DATABASE_URL");

  if (dbUrl) {
    const { host, port, database, user, password } = parse(dbUrl);
    return {
      connection: {
        client: 'postgres',
        connection: {
          host,
          port,
          database,
          user,
          password,
          ssl: { rejectUnauthorized: false },
        },
        debug: false,
      },
    };
  }

  // Fallback if DATABASE_URL is not set
  return {
    connection: {
      client: 'sqlite',
      connection: {
        filename: env('DATABASE_FILENAME', '.tmp/data.db'),
      },
      useNullAsDefault: true,
    },
  };
};
