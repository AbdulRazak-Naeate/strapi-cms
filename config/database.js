const path = require('path');
const { parse } = require('pg-connection-string');

module.exports = ({ env }) => {
  // Only use PostgreSQL if USE_PG is explicitly set to 'true'
  // This prevents a leftover system-level DATABASE_URL from overriding SQLite
  const usePg = env('USE_PG', 'false') === 'true';
  const dbUrl = env('DATABASE_URL');

  if (usePg && dbUrl) {
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

  return {
    connection: {
      client: 'sqlite',
      connection: {
        filename: path.join(__dirname, '..', env('DATABASE_FILENAME', '.tmp/data.db')),
      },
      useNullAsDefault: true,
    },
  };
};
