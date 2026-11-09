'use strict';

/**
 * 409 body for a commission upload that imports nothing because it is already in
 * OliComm (same filename in Uploads, or every parsed line matches existing records).
 * Upload.js shows `error` as a warning instead of "Upload successful — undefined".
 */
function alreadyUploadedPayload({ filename, existingUploadId, matchCount, totalCount, filenameTaken }) {
  const n = Number(matchCount) || 0;
  const total = Number(totalCount) || 0;
  const name = filename ? `"${filename}"` : 'This file';
  let message = `Already uploaded — ${n} of ${total} line${total === 1 ? '' : 's'} match existing records, nothing imported.`;
  if (filenameTaken) {
    message += ` ${name} is already in Uploads; delete that upload first if you need to re-import it.`;
  }
  return {
    alreadyUploaded: true,
    duplicateWarning: false,
    error: message,
    filename: filename || null,
    existingUploadId: existingUploadId != null ? existingUploadId : null,
    filenameTaken: !!filenameTaken,
    matchCount: n,
    totalCount: total,
    rowCount: 0,
  };
}

module.exports = { alreadyUploadedPayload };
