'use strict';

/**
 * DB Safety Check — deploy guard for Strapi's destructive schema sync.
 *
 * Why this exists:
 *   Strapi's schema sync (run at every boot) drops any table it doesn't find
 *   in the current build's content-types. If you deploy or roll back to a
 *   build that predates a content-type (article-like, user-activity, ...),
 *   boot silently destroys those tables and all their data. This happened
 *   on 2026-09-18 and took 647 article likes with it.
 *
 * What it does:
 *   1. Loads the pluralNames of every content-type defined in the code being
 *      deployed (no Strapi boot needed — reads schema.json files under
 *      src/api directly).
 *   2. Reads Strapi's persisted schema registry from Postgres
 *      (strapi_database_schema.schema) and lists every table the live DB
 *      currently knows about.
 *   3. A registry table is "covered" if a content-type in this build derives
 *      it (article-like -> article_likes and its *_links junction tables).
 *      Any registry table NOT covered => would be dropped at boot.
 *
 * Runs automatically on every Heroku deploy via the release-phase task in
 * the Procfile: if it exits non-zero, the new release is NOT deployed.
 *
 * Usage:
 *   npm run db:check                      (resolves DATABASE_URL from env/files)
 *   DATABASE_URL="postgres://..." npm run db:check
 *
 * Exit codes: 0 = safe · 1 = this build would drop tables (blocks deploy)
 *             2 = setup error
 *
 * Note on exit code 2: on Heroku the release phase would abort on any
 * non-zero exit — including setup errors. A missing/broken DATABASE_URL on
 * Heroku would fail the boot anyway, and an unreachable DB (network blip)
 * blocking deploys forever is worse than proceeding; Strapi's own sync will
 * surface the problem at boot. So setup errors log loudly but exit 0 there.
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { resolveDatabaseUrl } = require('./lib/db-url');

const ROOT = path.resolve(__dirname, '..');

// Tables owned by Strapi core / bundled node_modules plugins. These never
// depend on this repo's src code, so they are always considered covered.
const INTERNAL_PATTERNS = [
  /^strapi_/, // core registry, migrations, api tokens, transfer tokens
  /^admin_/, // admin panel users/roles/permissions
  /^up_/, // users-permissions plugin
  /^files/, // upload plugin: files, files_related_morphs, files_folder_links
  /^upload_/, // upload plugin folders
  /^i18n_locale$/,
  /^fcm_/, // strapi-plugin-fcm (npm dependency)
];

// ---------------------------------------------------------------------------
// 1. Collect content-type pluralNames from the code being deployed
// ---------------------------------------------------------------------------
function collectContentTypes() {
  const apiDir = path.join(ROOT, 'src', 'api');
  const found = new Map(); // pluralName -> uid

  if (!fs.existsSync(apiDir)) return found;

  for (const api of fs.readdirSync(apiDir)) {
    const ctDir = path.join(apiDir, api, 'content-types');
    if (!fs.existsSync(ctDir)) continue;
    for (const ct of fs.readdirSync(ctDir)) {
      const schemaPath = path.join(ctDir, ct, 'schema.json');
      if (!fs.existsSync(schemaPath)) continue;
      try {
        const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
        const pluralName = schema.info && schema.info.pluralName;
        if (pluralName) {
          found.set(pluralName, `api::${api}.${ct}`);
        }
      } catch (e) {
        console.warn(`⚠️  Could not parse ${schemaPath}: ${e.message}`);
      }
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// 2. Read the persisted schema registry from Postgres
// ---------------------------------------------------------------------------
async function getLiveDbTables(pool) {
  const res = await pool.query(
    `SELECT schema FROM strapi_database_schema ORDER BY id DESC LIMIT 1`
  );
  if (res.rows.length === 0) {
    return { tables: [], registered: false };
  }
  const raw = res.rows[0].schema;
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;

  // Registry shape: { tables: [ { name, columns, indexes, ... }, ... ] }
  let tables = [];
  if (Array.isArray(parsed.tables)) {
    tables = parsed.tables.map((t) => (typeof t === 'string' ? t : t.name));
  } else if (parsed.tables && typeof parsed.tables === 'object') {
    tables = Object.keys(parsed.tables);
  }
  return { tables: tables.filter(Boolean), registered: true };
}

// ---------------------------------------------------------------------------
// 3. Compare
// ---------------------------------------------------------------------------
function toTableName(pluralName) {
  // Strapi v4 table name = pluralName with dashes -> underscores
  return pluralName.replace(/-/g, '_');
}

function isInternal(table) {
  return INTERNAL_PATTERNS.some((re) => re.test(table));
}

function isCoveredByBuild(table, buildTables) {
  for (const base of buildTables) {
    if (table === base) return true;
    // Link tables are named <table>_<target>_links — prefix match covers
    // article_likes_article_links, articles_localizations_links, etc.
    if (table.startsWith(`${base}_`)) return true;
  }
  return false;
}

async function main() {
  const runningOnHeroku = Boolean(process.env.DYNO);
  const dbUrl = resolveDatabaseUrl();
  if (!dbUrl) {
    console.error(
      '✖ DATABASE_URL not found.\n' +
        '  Provide it via the environment:  DATABASE_URL="postgres://..." npm run db:check\n' +
        '  Or add it to .env.production (gitignored):  DATABASE_URL=postgres://user:pass@host:5432/db'
    );
    // On Heroku this is a broken deploy config — let the deploy proceed so
    // the app itself fails loudly at boot (DATABASE_URL is required there).
    process.exit(runningOnHeroku ? 0 : 2);
  }

  const contentTypes = collectContentTypes();
  const buildTables = [...contentTypes.keys()].map(toTableName);
  console.log(`\n📦 Code (this build) defines ${contentTypes.size} content-types:`);
  for (const [pn, uid] of contentTypes) {
    console.log(`   • ${uid}  (table: ${toTableName(pn)})`);
  }

  const pool = new Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    let live;
    try {
      live = await getLiveDbTables(pool);
    } catch (e) {
      // Registry unreadable: log and pass. An unreachable DB blocks deploys
      // forever on a transient network blip, and a fresh/missing registry is
      // normal for new databases (nothing to protect yet).
      console.error(
        `\n⚠️  Could not read strapi_database_schema (${e.message}).\n` +
          '   Proceeding without the check — Strapi schema sync will run at boot.'
      );
      process.exit(runningOnHeroku ? 0 : 1);
    }

    if (!live.registered) {
      console.log('\n⚠️  strapi_database_schema is empty — first boot. Nothing to compare.');
      process.exit(0);
    }

    console.log(`\n🗄️  Live DB schema registry knows ${live.tables.length} tables.`);

    const suspect = live.tables.filter(
      (t) => !isInternal(t) && !isCoveredByBuild(t, buildTables)
    );

    if (suspect.length === 0) {
      console.log('\n✅ SAFE: every non-internal table in the DB is covered by this build.');
      console.log('   Booting this build will not drop any tables.');
      process.exit(0);
    }

    console.log('\n🚨 DANGER — this build would DROP the following tables at boot:');
    for (const t of suspect) console.log(`   ✖ ${t}`);
    console.log(
      '\nThese tables exist in the DB registry but no content-type in this build matches them.'
    );
    console.log('\nOptions:');
    console.log('  1. Do NOT deploy this build. Deploy one containing all content-types.');
    console.log('  2. Back up first (npm run db:backup) and accept the data loss.');
    process.exit(1); // Fails the Heroku release phase — deploy is aborted.
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((e) => {
  console.error('Safety check failed to run:', e.message);
  process.exit(process.env.DYNO ? 0 : 2);
});
