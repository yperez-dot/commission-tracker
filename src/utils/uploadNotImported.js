/**
 * POST /files/upload replies that imported nothing but are not the duplicate
 * picker (409 duplicateWarning). Returns the message to show, or '' for a real import.
 * Before this, a bare 409 ("already been uploaded") fell through to the success banner
 * as "Upload successful — undefined records imported · $0.00 · Carriers:".
 */
export function uploadNotImportedMessage(result) {
  if (!result || typeof result !== 'object') return 'Upload failed — no response from server.';
  if (result.status === 409 && result.duplicateWarning) return '';
  if (result.alreadyUploaded || result.status === 409) {
    return result.error || 'Already uploaded — nothing imported.';
  }
  if (typeof result.rowCount !== 'number') {
    return result.error || 'Upload finished but the server did not report any imported records. Nothing was imported.';
  }
  if (result.rowCount === 0) {
    return result.error || 'No records imported.';
  }
  return '';
}
