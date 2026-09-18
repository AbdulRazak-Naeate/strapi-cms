'use strict';

/**
 * DB Backup — exports all Strapi content-type tables to a JSON file.
 *
 * Usage (from project root):
 *   DATABASE_URL="postgres://..." node scripts/export-backup.js
 *   npm run db:backup
 *
 * Creates: backups/backup-<ISO-date>.json  (a plain { table: rows[] } map)
 *
 * Restore a single table from a backup (example):
 *   node -e "
 *     const { Pool } = require('pg');
 *     const b = require('./backups/backup-<date>.json');
 *     const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 *     for (const r of b['article_likes']) {
 *       pool.query('INSERT INTO article_likes (id, identifier, created_at, updated_at) VALUES (\$1,\$2,\$3,\$4) ON CONFLICT (id) DO NOTHING',
 *         [r.id, r.identifier, r.created_at, r.updated_at]);
 *     }
 *   "
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { resolveDatabaseUrl } = require('./lib/db-url');

const BACKUP_DIR = path.join(__dirname, '..', 'backups');

// All tables worth backing up: content data + link tables.
// Strapi internal tables (admin users, permissions, migrations) are skipped —
// they are rebuildable and may contain secrets.
const SKIP = [
  /^strapi_/,
  /^admin_/,
  /^up_permissions/,
  /^i18n_locale$/,
];

async function getTables(pool) {
  const res = await pool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );
  return res.rows.map((r) => r.tablename).filter((t) => !SKIP.some((re) => re.test(t)));
}

async function main() {
  const dbUrl = resolveDatabaseUrl();
  if (!dbUrl) {
    console.error(
      '✖ DATABASE_URL not found.\n' +
        '  Provide it via the environment:  DATABASE_URL="postgres://..." npm run db:backup\n' +
        '  Or add it to .env.production (gitignored):  DATABASE_URL=postgres://user:pass@host:5432/db'
    );
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

    const tables = await getTables(pool);
    const backup = {};
    const counts = {};

    for (const table of tables) {
      const res = await pool.query(`SELECT * FROM "${table}"`);
      backup[table] = res.rows;
      counts[table] = res.rows.length;
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(BACKUP_DIR, `backup-${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify(backup, null, 2));

    console.log(`✅ Backup written: ${file}\n`);
    console.log('Rows per table:');
    for (const [t, n] of Object.entries(counts)) {
      if (n > 0) console.log(`   ${t}: ${n}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error('Backup failed:', e.message);
  process.exit(1);
});
