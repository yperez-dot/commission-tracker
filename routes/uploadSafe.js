'use strict';

const path = require('path');
const crypto = require('crypto');

const ALLOWED_UPLOAD_EXTS = new Set(['.xlsx', '.xls', '.csv', '.pdf']);

/**
 * Never trust client originalname for disk paths (path traversal).
 * Keep only a safe extension from an allowlist.
 */
function safeUploadFilename(originalname) {
  const ext = path.extname(String(originalname || '')).toLowerCase();
  const useExt = ALLOWED_UPLOAD_EXTS.has(ext) ? ext : '';
  return `${Date.now()}_${crypto.randomBytes(8).toString('hex')}${useExt}`;
}

function isAllowedUploadName(originalname) {
  return ALLOWED_UPLOAD_EXTS.has(path.extname(String(originalname || '')).toLowerCase());
}

module.exports = { safeUploadFilename, isAllowedUploadName, ALLOWED_UPLOAD_EXTS };
