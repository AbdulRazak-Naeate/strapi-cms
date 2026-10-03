# Operations Runbook

Operational procedures, maintenance scripts, and incident history for the NTS Strapi CMS.

> **Production:** https://naeatestudio-cms-f6767b576785.herokuapp.com (Heroku app `naeatestudio-cms`, PostgreSQL)
> **Local dev:** SQLite (`.tmp/data.db`) via `npm run develop` — see [Local vs Production database](#local-vs-production-database)

---

## ⚠️ Golden rule of deployment

> **Automated guardrail:** the repo's `Procfile` defines `release: npm run db:check`. Heroku runs it before every new release — deploys, config-var changes, pipeline promotions, **and rollbacks**. If the check detects tables that this build would drop, it exits 1 and **the release is aborted**; the current (safe) release keeps serving. The manual steps below are the local second line of defense.

**Strapi's schema sync runs at every boot and drops any table not defined in the deployed build's content-types.**

Deploying (or restarting, or rolling back to) a build that predates a content-type **silently deletes that content-type's tables and all their data**. This actually happened on 2026-09-18: an outdated Heroku build dropped `article_likes` and `user_activities`, taking 647 likes with it.

### Automated guard: release-phase task

The repo has a `Procfile` with:

```
release: npm run db:check
web:     npm run start
```

Heroku runs the release command in a one-off dyno **before every new release** — deploys, config-var changes, pipeline promotions, **and rollbacks**. If `db:check` exits non-zero, **the release is aborted and the current (safe) release keeps running**. This means:

- ✅ A deploy of a build missing content-types is blocked before it can boot
- ✅ A **rollback** to an old build is blocked too (the exact incident scenario)
- ℹ️ `db:check` exits 0 on setup errors while on Heroku (`DYNO` set) — a missing registry or transient DB outage logs a warning but never blocks a deploy; the check only blocks when it positively detects tables that would be dropped
- 📧 Heroku emails you on release-phase failures; see output with `heroku releases:output <version> -a naeatestudio-cms`

To bypass the guard deliberately (e.g. you really do want to deploy without a content-type after backing up), remove the `release:` line from the Procfile in a dedicated commit, deploy, then restore it — the friction is intentional.

### Manual pre-deploy workflow (local double-check)

```bash
# 1. Verify the build is safe to boot (exits 1 if it would drop tables)
DATABASE_URL="postgres://..." npm run db:check

# 2. Snapshot all content data
DATABASE_URL="postgres://..." npm run db:backup

# 3. Only then deploy (Heroku also re-runs db:check automatically in release phase)
git push heroku master
```

Or as a single chain that stops on failure:

```bash
DATABASE_URL="postgres://..." npm run db:check && \
DATABASE_URL="postgres://..." npm run db:backup && \
git push heroku master
```

**`db:check` output meanings:**

| Output | Meaning | Action |
|--------|---------|--------|
| `✅ SAFE` | Every DB table is covered by this build's content-types | Deploy is safe |
| `🚨 DANGER` + table list | This build would DROP those tables at boot | **Deploy is blocked** (release phase fails). Deploy a build containing all content-types, or back up first and accept the loss |
| `⚠️ Could not read strapi_database_schema` | Registry missing/unreachable | Warning only on Heroku — deploy proceeds; locally exits 1 |

This applies **double for rollbacks** — an old build is exactly what triggers the wipe.

---

## Scripts

All scripts are idempotent unless noted. They resolve `DATABASE_URL` from the environment or env files automatically (see [Getting DATABASE_URL](#getting-database_url)).

| Script | npm alias | Purpose |
|--------|-----------|---------|
| `scripts/db-safety-check.js` | `npm run db:check` | Pre-deploy guard: fails if booting this build would drop DB tables. Runs automatically on every Heroku deploy/rollback via the Procfile release-phase task |
| `scripts/export-backup.js` | `npm run db:backup` | JSON snapshot of all content tables → `backups/backup-<timestamp>.json` |
| `scripts/migrate-backup-to-pg.js` | — | Import `pifiat_articles.json` + image cache into Postgres (upserts, re-runnable) |
| `scripts/recreate-missing-tables.js` | — | Recreate Strapi-v4-conformant `article_likes` / `user_activities` tables + restore likes |
| `scripts/backfill-cloudinary-lossy.js` | — | One-off: add `f_auto,q_auto` transform to existing Cloudinary URLs (already applied) |

### `db:check` — pre-deploy safety check

Compares the `pluralName` of every content-type in `src/api/**/schema.json` against Strapi's persisted schema registry (`strapi_database_schema` in Postgres). Any registry table not derivable from the current code (table itself or its `<table>_*_links` junctions) is flagged as "would be dropped".

Strapi-internal tables (`strapi_*`, `admin_*`, `up_*`, `files*`, `upload_*`, `i18n_locale`, `fcm_*`) are always considered covered — they come from Strapi core and npm plugins, not this repo.

Exit codes: `0` safe · `1` would drop tables · `2` setup error (e.g. missing `DATABASE_URL`).

### `db:backup` — JSON snapshot

Exports every non-internal table to `backups/backup-<ISO-timestamp>.json` as a plain `{ table: rows[] }` map. The `backups/` directory is gitignored (may contain user data).

Restoring a single table from a backup:

```bash
node -e "
  const { Pool } = require('pg');
  const b = require('./backups/backup-<date>.json');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  for (const r of b['article_likes']) {
    pool.query(
      'INSERT INTO article_likes (id, identifier, created_at, updated_at) VALUES (\$1,\$2,\$3,\$4) ON CONFLICT (id) DO NOTHING',
      [r.id, r.identifier, r.created_at, r.updated_at]
    );
  }
"
```

### `migrate-backup-to-pg.js` — restore from Android backup

Imports articles, categories, article likes, and Cloudinary image references from the backup JSONs at the repo root. Upserts by ID (won't duplicate), links images via `files_related_morphs`, and resets Postgres sequences past the max imported ID (prevents `duplicate key` errors on new inserts — see [Incident log](#incident-log)).

---

## Local vs Production database

| | Local dev | Production (Heroku) |
|---|---|---|
| Database | SQLite (`.tmp/data.db`) | PostgreSQL (`DATABASE_URL`) |
| Activation | Default when `DATABASE_URL` is unset | `DATABASE_URL` config var set on the Heroku app |

`config/database.js` uses PostgreSQL **only when `USE_PG=true`** is set alongside `DATABASE_URL`. This exists because a leftover **Windows user environment variable** `DATABASE_URL` (an old RDS URL) used to leak into local runs and break SQLite. When running the scripts above locally against production, pass `DATABASE_URL` explicitly on the command line.

Local dev never touches production data — the backup/restore scripts are the only sanctioned bridge.

### Getting `DATABASE_URL`

`db:check` and `db:backup` resolve the URL automatically in this order:

1. The process environment — `DATABASE_URL="postgres://..." npm run db:check` (always wins)
2. **`.env.production`** (gitignored) — the recommended place; keep the Heroku Postgres URL there once and never think about it again:
   ```bash
   heroku config:get DATABASE_URL -a naeatestudio-cms > .env.production
   ```
3. `.env.local`, then `.env` (only if it contains a **non-empty** `DATABASE_URL`)

To grab the URL manually (e.g. for a one-off command):

```bash
heroku config:get DATABASE_URL -a naeatestudio-cms
```

---

## API notes

### Pagination & caching (articles)

- `GET /api/articles` defaults to `page=1&pageSize=10` when no `pagination` params are supplied (controller override in `src/api/article/controllers/article.js`).
- List responses are cached in-memory for 60s with `X-Cache: HIT/MISS` headers. Like/unlike and admin edits invalidate the cache.
- Cache is per-dyno — fine for a single dyno; swap the helper internals for Redis if scaling out (interface stays the same).

### Fetching articles by category

Articles are filtered by their related categories with Strapi's built-in deep filtering — **no custom route needed**:

```text
# by category title (URL-encode spaces as %20)
GET /api/articles?filters[categories][title][$eq]=Pi%20Network&populate=*&sort=publishedAt:desc&pagination[pageSize]=10

# by category id
GET /api/articles?filters[categories][id][$eq]=1&populate=*

# the categories list itself (public read enabled)
GET /api/categories
```

Notes:

- `[$eq]` on title is **case-sensitive** — `pi network` will not match. Use `[$eqi]` for case-insensitive comparison.
- Filter params combine normally with `pagination[...]`, `sort`, and `populate`.
- **Permission gotcha:** the Public role must have `find` on every content-type you populate or filter on. If a role can't read a related type, Strapi silently **strips that field from the response** (and 403s the direct endpoint) instead of erroring. This bit us: `categories` vanished from every article response until `api::category.category.find` / `findOne` were granted to Public (2026-09-19). Remember this for any future public relation (e.g. author profiles).
- Category IDs as of 2026-09-19: 1 Pi Network · 2 JavaScript · 3 Python · 7 Web · 8 Crypto · 9 AI · 10 Business · 11 Technology.

### Anonymous likes

Likes are identified by a client-generated device ID, sent as `identifier`. **DELETE request bodies are not parsed by Strapi's body middleware** (`koa-body` `parsedMethods` defaults to POST/PUT/PATCH only), so unlike calls must send the identifier in the URL or a header:

```js
// like
fetch(`/api/articles/${id}/like`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: deviceId }),
});
// unlike — identifier via query param or header, NOT body
fetch(`/api/articles/${id}/like?identifier=${deviceId}`, { method: 'DELETE' });
```

### Cloudinary delivery transforms

All stored image URLs carry `f_auto,q_auto,fl_lossy` after `/upload/` (auto format + auto quality + explicit lossy flag). New uploads get it via the upload extension (`src/extensions/upload/strapi-server.js`); existing URLs were backfilled with `scripts/backfill-cloudinary-lossy.js` (re-run it after adding a Cloudinary account — it upgrades older `f_auto,q_auto` URLs too). The transform is a URL segment only — originals remain intact, removing the segment fetches the raw asset.

---

## Incident log

### 2026-09-18 — Schema sync wiped `article_likes` & `user_activities`

**Symptom:** Strapi dashboard missing content-types; article likes gone.

**Root cause:** Deployed Heroku build predated the `article-like` and `user-activity` content-types. At boot, its schema sync saw their tables in Postgres but not in its content-type registry and dropped them (647 likes lost). During crash-looping restarts it also dropped the `content`/`excerpt` columns from `articles`.

**Recovery:** `scripts/recreate-missing-tables.js` rebuilt the tables to Strapi v4's exact conventions (including UNIQUE **constraints**, not indexes — see below); likes restored from `pifiat_articles.json`; article content re-imported with `migrate-backup-to-pg.js`. Articles created after the backup (9 AI-generated posts) had no backup source and remain empty by choice.

**Lesson / prevention:** See [Golden rule](#️-golden-rule-of-deployment). Never deploy or restart a build whose content-types don't cover every table in the registry — `npm run db:check` enforces this.

### 2026-09-18 — Boot crash: `drop constraint ... does not exist`

**Symptom:** H10 app crash at boot; error `alter table "article_likes_article_links" drop constraint "..._unique" - constraint does not exist`.

**Root cause:** Hand-recreated tables defined uniqueness as plain unique **indexes**; Strapi's schema diff expects unique **constraints** (`DROP CONSTRAINT` can't drop an index) and crashed trying.

**Fix:** Converted all four link-table unique indexes to proper UNIQUE constraints. Any future hand-written DDL must match Strapi's conventions exactly — mirror the DDL Strapi generates for an existing table (e.g. `categories_articles_links`) as the template.

### 2026-09-02 — `duplicate key value violates unique constraint "article_likes_pkey"`

**Symptom:** 500 on `POST /api/articles/:id/like` after restoring backup data.

**Root cause:** Backup rows were inserted with explicit IDs, but the Postgres auto-increment sequence was still at 1 — new inserts collided with restored rows.

**Fix:** `setval()` all sequences past their table's max ID. `migrate-backup-to-pg.js` now does this automatically on every run.

### 2026-08-30 — Local dev failures (port + database)

- **`bind EACCES 127.0.0.1:1600`** — port fell inside a Windows Hyper-V/WinNAT excluded port range. Fix: moved local dev to port 3000.
- **`knex: Required configuration option 'client' is missing`** — two stacked causes: (1) a system-level Windows `DATABASE_URL` env var pointing at an unreachable RDS instance overrode `.env`, and (2) no SQLite driver was installed (`better-sqlite3` was missing, so Strapi's client remap produced `undefined`). Fixes: `USE_PG` gate in `config/database.js`, explicit empty `DATABASE_URL` in `.env`, `npm install better-sqlite3`.
