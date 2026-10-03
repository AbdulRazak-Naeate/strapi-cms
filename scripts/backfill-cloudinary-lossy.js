/**
 * Backfill: add the Cloudinary format + lossy transform
 * (f_auto,q_auto,fl_lossy) to existing file URLs in the production
 * PostgreSQL database.
 *
 *   npm run db:backfill
 *
 * DATABASE_URL is resolved automatically (env, .env.production, .env.local,
 * .env — see scripts/lib/db-url.js).
 *
 * Also upgrades URLs saved by older versions of this script (f_auto,q_auto →
 * f_auto,q_auto,fl_lossy). Idempotent — URLs already containing fl_lossy are
 * left untouched. Run, then update and delete the file after running.
 */

const { Pool } = require('pg');
const { parse } = require('pg-connection-string');
const { resolveDatabaseUrl } = require('./lib/db-url');

const TRANSFORM = 'f_auto,q_auto,fl_lossy';

/**
 * Applies the transform to EVERY Cloudinary URL in the value — the `formats`
 * JSON contains several URLs (large/small/thumbnail/...), so this must be
 * global, and each occurrence is handled independently (mixed states allowed).
 */
function applyLossyTransform(str) {
  if (typeof str !== 'string' || !str.includes('/upload/')) return str;
  let out = str;
  // 1. comma form f_auto,q_auto → add fl_lossy (skip when already present)
  out = out.replace(/\/upload\/f_auto,q_auto(?!,fl_lossy)\//g, '/upload/f_auto,q_auto,fl_lossy/');
  // 2. slash form f_auto/q_auto → add fl_lossy (skip when already present)
  out = out.replace(/\/upload\/f_auto\/q_auto\/(?!fl_lossy\/)/g, '/upload/f_auto/q_auto/fl_lossy/');
  // 3. bare segment after /upload/ (version, folder, other transform) → insert.
  //    Runs last; the f_auto lookahead protects the forms produced above.
  out = out.replace(/\/upload\/(?!f_auto[,/])/g, `/upload/${TRANSFORM}/`);
  return out;
}

function transformJsonField(value) {
  if (!value) return value;
  try {
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    return JSON.parse(applyLossyTransform(str));
  } catch (e) {
    return value;
  }
}

async function main() {
  const dbUrl = resolveDatabaseUrl();
  if (!dbUrl) {
    console.error('ERROR: DATABASE_URL not found (set it in .env.production or pass DATABASE_URL="..." on the command line)');
    process.exit(1);
  }

  const config = parse(dbUrl);
  const pool = new Pool({ ...config, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();

  try {
    const { rows } = await client.query(
      `SELECT id, url, preview_url, formats FROM files WHERE url LIKE '%/upload/%'`
    );
    console.log(`Found ${rows.length} cloudinary files`);

    let updated = 0;
    for (const row of rows) {
      const newUrl = applyLossyTransform(row.url);
      const newPreview = applyLossyTransform(row.preview_url);
      const newFormats = transformJsonField(row.formats);

      // pg parses JSON columns into objects — compare via JSON string, not ===.
      const before = JSON.stringify(row.formats ?? null);
      const after = JSON.stringify(newFormats ?? null);
      if (newUrl === row.url && newPreview === row.preview_url && after === before) {
        continue; // already has the transform
      }

      await client.query(
        `UPDATE files SET url = $1, preview_url = $2, formats = $3 WHERE id = $4`,
        [newUrl, newPreview, newFormats, row.id]
      );
      updated++;
    }

    console.log(`✅ Backfilled ${updated}/${rows.length} file URLs with ${TRANSFORM}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
