/**
 * Format dates consistently across OliComm as MM-DD-YYYY
 */

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function formatDate(dateStr) {
  if (dateStr == null || dateStr === '') return '—';

  try {
    if (dateStr instanceof Date && !Number.isNaN(dateStr.getTime())) {
      return `${pad2(dateStr.getUTCMonth() + 1)}-${pad2(dateStr.getUTCDate())}-${dateStr.getUTCFullYear()}`;
    }

    const s = String(dateStr).trim();
    if (!s) return '—';

    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[2]}-${iso[3]}-${iso[1]}`;

    const us = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (us) return `${pad2(us[1])}-${pad2(us[2])}-${us[3]}`;

    return s;
  } catch (e) {
    return String(dateStr);
  }
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '—';

  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;

    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();

    return `${month}-${day}-${year}`;
  } catch (e) {
    return dateStr;
  }
}
