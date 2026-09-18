/**
 * One-off backfill: add the Cloudinary "lossy" transform (f_auto,q_auto) to
 * existing file URLs in the production PostgreSQL database.
 *
 *   DATABASE_URL="postgres://..." node scripts/backfill-cloudinary-lossy.js
 *
 * Idempotent — URLs already containing the transform are left untouched.
 * Update and delete the file after running.
 */

const { Pool } = require('pg');
const { parse } = require('pg-connection-string');

const TRANSFORM = 'f_auto,q_auto';
const UPLOAD_SEGMENT = /\/upload\//;

function applyLossyTransform(url) {
  if (
    typeof url === 'string' &&
    !url.includes(`/${TRANSFORM}/`) &&
    UPLOAD_SEGMENT.test(url)
  ) {
    return url.replace(UPLOAD_SEGMENT, `/upload/${TRANSFORM}/`);
  }
  return url;
}

function transformJsonField(value) {
  if (!value) return value;
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  const transformed = applyLossyTransform(str);
  return transformed;
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
    const { rows } = await client.query(
      `SELECT id, url, preview_url, formats FROM files WHERE url LIKE '%/upload/%'`
    );
    console.log(`Found ${rows.length} cloudinary files`);

    let updated = 0;
    for (const row of rows) {
      const newUrl = applyLossyTransform(row.url);
      const newPreview = applyLossyTransform(row.preview_url);
      const newFormats = transformJsonField(row.formats);

      if (newUrl === row.url && newPreview === row.preview_url && newFormats === row.formats) {
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
