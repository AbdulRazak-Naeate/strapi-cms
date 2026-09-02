/**
 * Migration script: Import pifiat_articles.json + libCachedImageData_cacheObject.json
 * into the production PostgreSQL database used by Strapi.
 *
 * Usage:
 *   DATABASE_URL="postgres://..." node scripts/migrate-backup-to-pg.js
 *
 * Uses batch inserts for performance.
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { parse } = require('pg-connection-string');

const ARTICLES_FILE = path.join(__dirname, '..', 'pifiat_articles.json');
const IMAGE_CACHE_FILE = path.join(__dirname, '..', 'libCachedImageData_cacheObject.json');

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractCategories(categoriesData) {
  if (!categoriesData || !categoriesData.data) return [];
  return categoriesData.data.map((c) => ({
    id: c.id,
    title: c.attributes.title,
    createdAt: c.attributes.createdAt,
    updatedAt: c.attributes.updatedAt,
    publishedAt: c.attributes.publishedAt,
  }));
}

function extractArticleLikes(likesData) {
  if (!likesData || !likesData.data) return [];
  return likesData.data.map((l) => ({
    id: l.id,
    identifier: l.attributes.identifier,
    createdAt: l.attributes.createdAt,
    updatedAt: l.attributes.updatedAt,
  }));
}

function extractImage(imageData) {
  if (!imageData || !imageData.data) return null;
  const img = imageData.data;
  const attrs = img.attributes;
  return {
    id: img.id,
    name: attrs.name,
    alternativeText: attrs.alternativeText || null,
    caption: attrs.caption || null,
    width: attrs.width || null,
    height: attrs.height || null,
    ext: attrs.ext || null,
    mime: attrs.mime || null,
    size: attrs.size || null,
    url: attrs.url || null,
    previewUrl: attrs.previewUrl || null,
    provider: attrs.provider || null,
    provider_metadata: attrs.provider_metadata ? JSON.stringify(attrs.provider_metadata) : null,
    formats: attrs.formats ? JSON.stringify(attrs.formats) : null,
    hash: attrs.hash || null,
    createdAt: attrs.createdAt,
    updatedAt: attrs.updatedAt,
  };
}

/**
 * Batch upsert using parameterized queries.
 * cols: array of column names
 * rows: array of arrays (each inner array = values for one row)
 */
async function batchUpsert(client, table, cols, rows, conflictCols) {
  if (rows.length === 0) return 0;
  const onConflict = conflictCols ? ` ON CONFLICT (${conflictCols.join(', ')}) DO UPDATE SET ` : '';
  let conflictClause = '';
  if (onConflict) {
    const updates = cols
      .filter(c => !conflictCols.includes(c))
      .map(c => `${c} = EXCLUDED.${c}`);
    conflictClause = onConflict + updates.join(', ');
  }
  // Insert in batches of 500
  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const values = [];
    const placeholders = batch.map((row, rowIdx) => {
      const rowPlaceholders = row.map((val, colIdx) => `$${values.push(val)}`);
      return `(${rowPlaceholders.join(', ')})`;
    });
    const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES ${placeholders.join(', ')}${conflictClause}`;
    await client.query(sql, values);
    inserted += batch.length;
  }
  return inserted;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('Reading backup files...');
  const articlesRaw = JSON.parse(fs.readFileSync(ARTICLES_FILE, 'utf8'));
  const imageCache = JSON.parse(fs.readFileSync(IMAGE_CACHE_FILE, 'utf8'));
  console.log(`  ${articlesRaw.length} article records, ${imageCache.length} cached images`);

  // Parse all articles
  const articles = [];
  for (const row of articlesRaw) {
    try {
      const parsed = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      articles.push({ rowId: row.id, ...parsed });
    } catch (err) {
      console.error(`  ⚠ Skip article row id=${row.id}: ${err.message}`);
    }
  }
  console.log(`  Parsed ${articles.length} articles`);

  // Connect
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('ERROR: DATABASE_URL not set');
    process.exit(1);
  }

  const config = parse(dbUrl);
  const pool = new Pool({ ...config, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  console.log('Connected to PostgreSQL\n');

  try {
    await client.query('BEGIN');

    // ── 1. Categories ───────────────────────────────────────────────────
    console.log('--- Categories ---');
    const allCategories = new Map();
    for (const article of articles) {
      for (const cat of extractCategories(article.attributes?.categories)) {
        allCategories.set(cat.id, cat);
      }
    }

    const catRows = [];
    for (const [, cat] of allCategories) {
      catRows.push([cat.id, cat.title, cat.createdAt, cat.updatedAt, cat.publishedAt]);
    }
    await batchUpsert(client, 'categories',
      ['id', 'title', 'created_at', 'updated_at', 'published_at'],
      catRows, ['id']
    );
    console.log(`  ${catRows.length} categories upserted`);

    // ── 2. Files ────────────────────────────────────────────────────────
    console.log('\n--- Files ---');
    const imageMap = new Map(); // file_id → image data
    for (const article of articles) {
      const img = extractImage(article.attributes?.image);
      if (img && !imageMap.has(img.id)) imageMap.set(img.id, img);
    }

    const fileRows = [];
    for (const [, img] of imageMap) {
      fileRows.push([
        img.id, img.name, img.alternativeText, img.caption,
        img.width, img.height, img.ext, img.mime, img.size,
        img.url, img.previewUrl, img.provider,
        img.provider_metadata, img.formats, img.hash,
        img.createdAt, img.updatedAt
      ]);
    }
    await batchUpsert(client, 'files',
      ['id', 'name', 'alternative_text', 'caption', 'width', 'height',
       'ext', 'mime', 'size', 'url', 'preview_url', 'provider',
       'provider_metadata', 'formats', 'hash', 'created_at', 'updated_at'],
      fileRows, ['id']
    );
    console.log(`  ${fileRows.length} files upserted`);

    // ── 3. Files Related Morphs ─────────────────────────────────────────
    console.log('\n--- Files Related Morphs ---');
    const morphRows = [];
    for (const article of articles) {
      const img = extractImage(article.attributes?.image);
      if (img) {
        morphRows.push([img.id, article.id, 'api::article.article', 'image', 1]);
      }
    }
    // These don't have a natural unique key; we check existence
    // Use INSERT ... ON CONFLICT to handle duplicates
    if (morphRows.length > 0) {
      // Delete existing morph links for these files/relations first
      const fileIds = [...new Set(morphRows.map(r => r[0]))];
      const relIds = [...new Set(morphRows.map(r => r[1]))];
      if (fileIds.length > 0 && relIds.length > 0) {
        await client.query(
          `DELETE FROM files_related_morphs
           WHERE related_type = 'api::article.article' AND field = 'image'
           AND file_id = ANY($1) AND related_id = ANY($2)`,
          [fileIds, relIds]
        );
      }
      await batchUpsert(client, 'files_related_morphs',
        ['file_id', 'related_id', 'related_type', 'field', '"order"'],
        morphRows, null
      );
    }
    console.log(`  ${morphRows.length} morph links created`);

    // ── 4. Articles ─────────────────────────────────────────────────────
    console.log('\n--- Articles ---');
    const articleRows = [];
    for (const article of articles) {
      const a = article.attributes;
      if (!a) continue;
      articleRows.push([
        article.id,
        a.title,
        a.content || '',
        a.Excerpt || null,
        a.author || 'Abdul Razak Abubakari',
        a.likes || 0,
        a.date_created || null,
        a.locale || 'en',
        a.createdAt,
        a.updatedAt,
        a.publishedAt,
      ]);
    }
    await batchUpsert(client, 'articles',
      ['id', 'title', 'content', 'excerpt', 'author', 'likes',
       'date_created', 'locale', 'created_at', 'updated_at', 'published_at'],
      articleRows, ['id']
    );
    console.log(`  ${articleRows.length} articles upserted`);

    // ── 5. Article Likes ────────────────────────────────────────────────
    console.log('\n--- Article Likes ---');
    const likeRows = [];
    const likeLinks = [];
    let order = 0;
    for (const article of articles) {
      const likes = extractArticleLikes(article.attributes?.articleLikes);
      for (const like of likes) {
        likeRows.push([like.id, like.identifier || null, like.createdAt, like.updatedAt]);
        likeLinks.push([like.id, article.id, ++order]);
      }
    }

    // Deduplicate likes (same like might appear in multiple articles' data)
    const uniqueLikes = new Map();
    for (const row of likeRows) {
      uniqueLikes.set(row[0], row);
    }
    const dedupedLikeRows = [...uniqueLikes.values()];

    // Deduplicate links
    const uniqueLinks = new Map();
    for (const link of likeLinks) {
      uniqueLinks.set(`${link[0]}-${link[1]}`, link);
    }
    const dedupedLinks = [...uniqueLinks.values()];

    await batchUpsert(client, 'article_likes',
      ['id', 'identifier', 'created_at', 'updated_at'],
      dedupedLikeRows, ['id']
    );
    console.log(`  ${dedupedLikeRows.length} article_likes upserted`);

    // Links - delete existing then insert
    const likeIds = dedupedLinks.map(l => l[0]);
    const likedArticleIds = [...new Set(dedupedLinks.map(l => l[1]))];
    if (likeIds.length > 0) {
      await client.query(
        'DELETE FROM article_likes_article_links WHERE article_like_id = ANY($1)',
        [likeIds]
      );
      await batchUpsert(client, 'article_likes_article_links',
        ['article_like_id', 'article_id', 'article_like_order'],
        dedupedLinks, null
      );
    }
    console.log(`  ${dedupedLinks.length} like→article links created`);

    // ── 6. Article ↔ Category Links ─────────────────────────────────────
    console.log('\n--- Article ↔ Category Links ---');
    const catLinkRows = [];
    for (const article of articles) {
      const cats = extractCategories(article.attributes?.categories);
      for (let i = 0; i < cats.length; i++) {
        catLinkRows.push([article.id, cats[i].id, i + 1, i + 1]);
      }
    }
    // Delete existing then insert
    const catLinkArticleIds = [...new Set(catLinkRows.map(r => r[0]))];
    if (catLinkArticleIds.length > 0) {
      await client.query(
        'DELETE FROM categories_articles_links WHERE article_id = ANY($1)',
        [catLinkArticleIds]
      );
      await batchUpsert(client, 'categories_articles_links',
        ['article_id', 'category_id', 'article_order', 'category_order'],
        catLinkRows, null
      );
    }
    console.log(`  ${catLinkRows.length} article↔category links created`);

    // ── 7. Reset Sequences ──────────────────────────────────────────────
    console.log('\n--- Resetting Sequences ---');
    const seqTables = ['articles', 'article_likes', 'categories', 'files'];
    for (const table of seqTables) {
      const seq = table + '_id_seq';
      const res = await client.query(
        `SELECT setval('${seq}', COALESCE((SELECT MAX(id) FROM ${table}), 1), true)`
      );
      console.log(`  ${seq} → ${res.rows[0].setval}`);
    }

    // ── Commit ──────────────────────────────────────────────────────────
    await client.query('COMMIT');
    console.log('\n✅ Migration completed successfully!\n');

    console.log('=== Summary ===');
    console.log(`  Categories:     ${allCategories.size}`);
    console.log(`  Articles:       ${articles.length}`);
    console.log(`  Files:          ${imageMap.size}`);
    console.log(`  Morph Links:    ${morphRows.length}`);
    console.log(`  Article Likes:  ${dedupedLikeRows.length}`);
    console.log(`  Like Links:     ${dedupedLinks.length}`);
    console.log(`  Category Links: ${catLinkRows.length}`);

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
