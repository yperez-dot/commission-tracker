/**
 * Format dates consistently across OliComm as MM-DD-YYYY
 */

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  
  try {
    // Handle both "YYYY-MM-DD" and ISO timestamps
    const dateOnly = dateStr.split('T')[0];
    const [year, month, day] = dateOnly.split('-');
    
    if (!year || !month || !day) return dateStr; // Return original if parsing fails
    
    return `${month}-${day}-${year}`;
  } catch (e) {
    return dateStr;
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
