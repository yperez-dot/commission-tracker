'use strict';

/**
 * Validate a new uploads.original_name. Rename changes only the label — never
 * records, amounts, or periods. The "already uploaded by name" check uses this
 * column, so two uploads may not share a name.
 */
function normalizeUploadName(raw) {
  return String(raw == null ? '' : raw).trim();
}

function validateUploadRename(raw, opts) {
  const options = opts || {};
  const name = normalizeUploadName(raw);
  if (!name) return { ok: false, error: 'Name is required' };
  if (name.length > 255) return { ok: false, error: 'Name is too long (max 255 characters)' };
  if (/[\\/]/.test(name)) return { ok: false, error: 'Name cannot contain / or \\' };
  if (options.currentName && name === options.currentName) {
    return { ok: true, name: name, unchanged: true };
  }
  if (options.existingNames) {
    const set = options.existingNames instanceof Set
      ? options.existingNames
      : new Set(options.existingNames);
    if (set.has(name)) {
      return {
        ok: false,
        error: `Another upload is already named "${name}". Pick a different name.`,
        conflict: true,
      };
    }
  }
  return { ok: true, name: name, unchanged: false };
}

module.exports = { normalizeUploadName, validateUploadRename };
