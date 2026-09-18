/**
 * Recreates the missing Strapi v4 tables in production PostgreSQL:
 *   - article_likes
 *   - article_likes_article_links
 *   - article_likes_user_links
 *   - user_activities
 *   - user_activities_article_links
 *   - user_activities_user_links
 *
 * Matches the exact schema Strapi v4 generates (mirrors conventions from
 * categories_articles_links / articles) so the running app can use them
 * immediately without a schema-sync migration.
 *
 * Then restores the likes from pifiat_articles.json and fixes sequences.
 *
 *   DATABASE_URL="postgres://..." node scripts/recreate-missing-tables.js
 *
 * Safe to re-run (IF NOT EXISTS everywhere, data restore is idempotent).
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { parse } = require('pg-connection-string');

const ARTICLES_FILE = path.join(__dirname, '..', 'pifiat_articles.json');

async function createTables(client) {
  // ── article_likes ────────────────────────────────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS "article_likes" (
      "id" SERIAL NOT NULL,
      "identifier" varchar(255),
      "created_at" timestamptz,
      "updated_at" timestamptz,
      "created_by_id" integer,
      "updated_by_id" integer,
      CONSTRAINT "article_likes_pkey" PRIMARY KEY ("id")
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS "article_likes_created_by_id_fk" ON "article_likes" ("created_by_id");`);
  await client.query(`CREATE INDEX IF NOT EXISTS "article_likes_updated_by_id_fk" ON "article_likes" ("updated_by_id");`);
  await client.query(`CREATE INDEX IF NOT EXISTS "article_likes_identifier_idx" ON "article_likes" ("identifier");`);

  // ── article_likes_article_links (many-to-one link table) ─────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS "article_likes_article_links" (
      "id" SERIAL NOT NULL,
      "article_like_id" integer NOT NULL,
      "article_id" integer NOT NULL,
      "article_like_order" integer,
      CONSTRAINT "article_likes_article_links_pkey" PRIMARY KEY ("id")
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS "article_likes_article_links_fk" ON "article_likes_article_links" ("article_like_id");`);
  await client.query(`CREATE INDEX IF NOT EXISTS "article_likes_article_links_inv_fk" ON "article_likes_article_links" ("article_id");`);
  await client.query(`CREATE INDEX IF NOT EXISTS "article_likes_article_links_order_fk" ON "article_likes_article_links" ("article_like_order");`);
  await client.query(`
    ALTER TABLE "article_likes_article_links"
      ADD CONSTRAINT "article_likes_article_links_fk" FOREIGN KEY ("article_like_id") REFERENCES "article_likes"("id") ON DELETE CASCADE,
      ADD CONSTRAINT "article_likes_article_links_inv_fk" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE;
  `);
  // Strapi v4 expects the unique as a TABLE CONSTRAINT (not a plain unique index),
  // otherwise its schema diff crashes trying to DROP CONSTRAINT on restart.
  await client.query(`ALTER TABLE "article_likes_article_links" DROP CONSTRAINT IF EXISTS "article_likes_article_links_unique";`);
  await client.query(`ALTER TABLE "article_likes_article_links" ADD CONSTRAINT "article_likes_article_links_unique" UNIQUE ("article_like_id", "article_id");`);

  // ── article_likes_user_links (optional user relation) ────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS "article_likes_user_links" (
      "id" SERIAL NOT NULL,
      "article_like_id" integer NOT NULL,
      "user_id" integer NOT NULL,
      "user_order" integer,
      CONSTRAINT "article_likes_user_links_pkey" PRIMARY KEY ("id")
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS "article_likes_user_links_fk" ON "article_likes_user_links" ("article_like_id");`);
  await client.query(`CREATE INDEX IF NOT EXISTS "article_likes_user_links_inv_fk" ON "article_likes_user_links" ("user_id");`);
  await client.query(`
    ALTER TABLE "article_likes_user_links"
      ADD CONSTRAINT "article_likes_user_links_fk" FOREIGN KEY ("article_like_id") REFERENCES "article_likes"("id") ON DELETE CASCADE,
      ADD CONSTRAINT "article_likes_user_links_inv_fk" FOREIGN KEY ("user_id") REFERENCES "up_users"("id") ON DELETE CASCADE;
  `);
  await client.query(`ALTER TABLE "article_likes_user_links" DROP CONSTRAINT IF EXISTS "article_likes_user_links_unique";`);
  await client.query(`ALTER TABLE "article_likes_user_links" ADD CONSTRAINT "article_likes_user_links_unique" UNIQUE ("article_like_id", "user_id");`);

  // ── user_activities ──────────────────────────────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS "user_activities" (
      "id" SERIAL NOT NULL,
      "action_type" varchar(255) NOT NULL,
      "metadata" jsonb,
      "created_at" timestamptz,
      "updated_at" timestamptz,
      "created_by_id" integer,
      "updated_by_id" integer,
      CONSTRAINT "user_activities_pkey" PRIMARY KEY ("id")
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS "user_activities_created_by_id_fk" ON "user_activities" ("created_by_id");`);
  await client.query(`CREATE INDEX IF NOT EXISTS "user_activities_updated_by_id_fk" ON "user_activities" ("updated_by_id");`);

  // ── user_activities_article_links ────────────────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS "user_activities_article_links" (
      "id" SERIAL NOT NULL,
      "user_activity_id" integer NOT NULL,
      "article_id" integer NOT NULL,
      "article_order" integer,
      CONSTRAINT "user_activities_article_links_pkey" PRIMARY KEY ("id")
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS "user_activities_article_links_fk" ON "user_activities_article_links" ("user_activity_id");`);
  await client.query(`CREATE INDEX IF NOT EXISTS "user_activities_article_links_inv_fk" ON "user_activities_article_links" ("article_id");`);
  await client.query(`
    ALTER TABLE "user_activities_article_links"
      ADD CONSTRAINT "user_activities_article_links_fk" FOREIGN KEY ("user_activity_id") REFERENCES "user_activities"("id") ON DELETE CASCADE,
      ADD CONSTRAINT "user_activities_article_links_inv_fk" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE;
  `);
  await client.query(`ALTER TABLE "user_activities_article_links" DROP CONSTRAINT IF EXISTS "user_activities_article_links_unique";`);
  await client.query(`ALTER TABLE "user_activities_article_links" ADD CONSTRAINT "user_activities_article_links_unique" UNIQUE ("user_activity_id", "article_id");`);

  // ── user_activities_user_links ───────────────────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS "user_activities_user_links" (
      "id" SERIAL NOT NULL,
      "user_activity_id" integer NOT NULL,
      "user_id" integer NOT NULL,
      "user_order" integer,
      CONSTRAINT "user_activities_user_links_pkey" PRIMARY KEY ("id")
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS "user_activities_user_links_fk" ON "user_activities_user_links" ("user_activity_id");`);
  await client.query(`CREATE INDEX IF NOT EXISTS "user_activities_user_links_inv_fk" ON "user_activities_user_links" ("user_id");`);
  await client.query(`
    ALTER TABLE "user_activities_user_links"
      ADD CONSTRAINT "user_activities_user_links_fk" FOREIGN KEY ("user_activity_id") REFERENCES "user_activities"("id") ON DELETE CASCADE,
      ADD CONSTRAINT "user_activities_user_links_inv_fk" FOREIGN KEY ("user_id") REFERENCES "up_users"("id") ON DELETE CASCADE;
  `);
  await client.query(`ALTER TABLE "user_activities_user_links" DROP CONSTRAINT IF EXISTS "user_activities_user_links_unique";`);
  await client.query(`ALTER TABLE "user_activities_user_links" ADD CONSTRAINT "user_activities_user_links_unique" UNIQUE ("user_activity_id", "user_id");`);
}

async function restoreLikes(client) {
  const raw = JSON.parse(fs.readFileSync(ARTICLES_FILE, 'utf8'));
  const likes = new Map(); // id → like data
  let order = 0;
  for (const row of raw) {
    try {
      const parsed = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      const articleId = row.id;
      for (const l of parsed?.attributes?.articleLikes?.data || []) {
        if (!likes.has(l.id)) {
          likes.set(l.id, {
            id: l.id,
            identifier: l.attributes?.identifier || null,
            createdAt: l.attributes?.createdAt || null,
            updatedAt: l.attributes?.updatedAt || null,
            articleId,
            order: ++order,
          });
        }
      }
    } catch (e) {
      console.error(`  skip article row id=${row.id}: ${e.message}`);
    }
  }
  console.log(`  ${likes.size} unique likes found in backup`);

  const likeRows = [...likes.values()];
  const BATCH = 200;
  let insertedLikes = 0;
  let insertedLinks = 0;

  for (let i = 0; i < likeRows.length; i += BATCH) {
    const batch = likeRows.slice(i, i + BATCH);

    // article_likes rows
    const likeValues = [];
    const likePh = batch.map((l) => {
      likeValues.push(l.id, l.identifier, l.createdAt, l.updatedAt);
      const base = likeValues.length - 4;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
    });
    const likeSql = `
      INSERT INTO article_likes (id, identifier, created_at, updated_at)
      VALUES ${likePh.join(', ')}
      ON CONFLICT (id) DO NOTHING
    `;
    const lr = await client.query(likeSql, likeValues);
    insertedLikes += lr.rowCount;

    // link rows
    const linkValues = [];
    const linkPh = batch.map((l) => {
      linkValues.push(l.id, l.articleId, l.order);
      const base = linkValues.length - 3;
      return `($${base + 1}, $${base + 2}, $${base + 3})`;
    });
    const linkSql = `
      INSERT INTO article_likes_article_links (article_like_id, article_id, article_like_order)
      VALUES ${linkPh.join(', ')}
      ON CONFLICT (article_like_id, article_id) DO NOTHING
    `;
    const lkr = await client.query(linkSql, linkValues);
    insertedLinks += lkr.rowCount;
  }

  console.log(`  inserted ${insertedLikes} like rows, ${insertedLinks} link rows (idempotent)`);
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('ERROR: DATABASE_URL not set');
    process.exit(1);
  }

  const config = parse(dbUrl);
  const pool = new Pool({ ...config, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    console.log('Creating missing tables...');
    await createTables(client);
    console.log('  tables created (or already exist)');

    console.log('\nRestoring likes from pifiat_articles.json...');
    await restoreLikes(client);

    console.log('\nFixing sequences...');
    for (const table of ['article_likes', 'user_activities']) {
      const res = await client.query(
        `SELECT setval('${table}_id_seq', COALESCE((SELECT MAX(id) FROM ${table}), 1), true)`
      );
      console.log(`  ${table}_id_seq → ${res.rows[0].setval}`);
    }

    console.log('\nSyncing articles.likes counters...');
    const sync = await client.query(`
      UPDATE articles a
      SET likes = (
        SELECT COUNT(*)::int
        FROM article_likes_article_links l
        WHERE l.article_id = a.id
      )
    `);
    console.log(`  ${sync.rowCount} articles' likes counters synced`);

    await client.query('COMMIT');
    console.log('\n✅ Done. Tables recreated and data restored.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Rolled back:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
