'use strict';

/**
 * Resolves DATABASE_URL for the maintenance scripts.
 *
 * Precedence:
 *   1. Process environment (e.g. DATABASE_URL="..." npm run db:check) — always wins
 *   2. .env.production  (gitignored, recommended place for the Heroku Postgres URL)
 *   3. .env.local       (gitignored)
 *   4. .env             (only if it has a NON-EMPTY DATABASE_URL — the repo's .env
 *                        intentionally sets it empty to shield local dev from the
 *                        leaked Windows system variable)
 *
 * Returns '' when nowhere found; callers decide whether that's fatal.
 */

const fs = require('fs');
const path = require('path');

// This file lives in scripts/lib/ — project root is two levels up.
const ROOT = path.resolve(__dirname, '..', '..');

function readDbUrlFromEnvFile(file) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) return '';
  try {
    const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/);
      if (!m) continue;
      let value = m[1].trim();
      // Strip surrounding quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (value && !value.startsWith('#')) return value;
    }
  } catch (e) {
    console.error(`[db-url] warning: could not read ${file}: ${e.message}`);
  }
  return '';
}

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const file of ['.env.production', '.env.local', '.env']) {
    const url = readDbUrlFromEnvFile(file);
    if (url) return url;
  }
  return '';
}

module.exports = { resolveDatabaseUrl };
