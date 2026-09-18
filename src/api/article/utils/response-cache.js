'use strict';

/**
 * Tiny in-memory response cache with TTL.
 * Good enough for a single-dyno Heroku app; swap for Redis later if you scale out.
 */

const DEFAULT_TTL_MS = 60 * 1000; // 1 minute
const MAX_ENTRIES = 100;

const store = new Map(); // key → { expiresAt, value }

function buildKey(prefix, query) {
  // Sort keys so `?a=1&b=2` and `?b=2&a=1` hit the same cache entry
  const normalized = Object.keys(query || {})
    .sort()
    .map((k) => `${k}=${JSON.stringify(query[k])}`)
    .join('&');
  return `${prefix}?${normalized}`;
}

function get(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  // Refresh recency for simple LRU behavior
  store.delete(key);
  store.set(key, entry);
  return entry.value;
}

function set(key, value, ttlMs = DEFAULT_TTL_MS) {
  if (store.size >= MAX_ENTRIES) {
    // Evict the oldest entry
    const oldestKey = store.keys().next().value;
    if (oldestKey !== undefined) store.delete(oldestKey);
  }
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function clear(prefix) {
  if (!prefix) {
    store.clear();
    return;
  }
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

module.exports = { buildKey, get, set, clear };
