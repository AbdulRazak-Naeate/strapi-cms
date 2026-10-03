'use strict';

/**
 * Extends the Upload plugin so every Cloudinary file gets the format + lossy
 * flags in its stored URL:
 *
 *   .../upload/.../photo.jpg  →  .../upload/f_auto,q_auto,fl_lossy/.../photo.jpg
 *
 * - `f_auto`   → Cloudinary picks the best supported format per browser (webp/avif/jpg)
 * - `q_auto`   → quality is optimized automatically (smallest good-looking size)
 * - `fl_lossy` → explicit lossy-compression flag (same as addFlag('lossy'))
 *
 * The transform is a URL segment only — Cloudinary still serves the ORIGINAL
 * asset, so nothing is destructively re-encoded.
 */

const TRANSFORM = 'f_auto,q_auto,fl_lossy';
// Match the "/upload/" delivery segment (also matches nested folders / raw assets).
const UPLOAD_SEGMENT = /\/upload\//;

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
  if (value === undefined || value === null) return value;
  try {
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    return JSON.parse(applyLossyTransform(str));
  } catch (e) {
    return value;
  }
}

module.exports = (plugin) => {
  // Inside the plugin object, content-types are keyed by their short name
  // ("file"), not the full UID ("plugin::upload.file").
  const fileCTKey = Object.keys(plugin.contentTypes || {}).find((key) => {
    const ct = plugin.contentTypes[key];
    return ct?.schema?.info?.singularName === 'file' || key === 'file';
  });

  if (!fileCTKey) {
    strapi?.log?.warn?.('upload extension: file content-type not found, skipping');
    return plugin;
  }

  const clearCache = () => {
    try {
      require('../../api/article/utils/response-cache').clear('articles-find');
    } catch (e) {
      // article cache helper not present — ignore
    }
  };

  const originalLifecycles = plugin.contentTypes[fileCTKey].lifecycles;

  plugin.contentTypes[fileCTKey].lifecycles = {
    async beforeCreate(event) {
      const { data } = event.params;
      if (data.url) data.url = applyLossyTransform(data.url);
      if (data.previewUrl) data.previewUrl = applyLossyTransform(data.previewUrl);
      if (data.formats) data.formats = transformJsonField(data.formats);
    },

    async beforeUpdate(event) {
      const { data } = event.params;
      // Only rewrites when the URL itself is being set (e.g. re-upload / replace)
      if (data.url) data.url = applyLossyTransform(data.url);
      if (data.previewUrl) data.previewUrl = applyLossyTransform(data.previewUrl);
      if (data.formats) data.formats = transformJsonField(data.formats);
    },

    async afterCreate() {
      clearCache();
    },

    async afterUpdate() {
      clearCache();
    },

    async afterDelete() {
      clearCache();
    },

    async afterDeleteMany() {
      clearCache();
    },

    // Preserve any lifecycles that already existed on the plugin
    ...(originalLifecycles && typeof originalLifecycles === 'object' ? originalLifecycles : {}),
  };

  return plugin;
};
