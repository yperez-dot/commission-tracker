import { apiDownload } from '../api';

/**
 * Download parsed rows for an upload on any Uploads tab.
 */
export async function exportUploadFile({ path, fallbackName }) {
  return apiDownload(path, fallbackName || 'upload_export.xlsx');
}

export function commissionUploadExportPath(uploadId, format = 'xlsx') {
  return `/files/uploads/${uploadId}/export?format=${encodeURIComponent(format)}`;
}

export function medicareProUploadExportPath(uploadId, format = 'xlsx') {
  return `/medicarepro/uploads/${uploadId}/export?format=${encodeURIComponent(format)}`;
}

export function agencyProductionUploadExportPath(uploadId, format = 'xlsx') {
  return `/agency-production/uploads/${uploadId}/export?format=${encodeURIComponent(format)}`;
}
