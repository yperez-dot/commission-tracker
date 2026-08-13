const BASE = process.env.REACT_APP_API_URL || '';

function getToken() {
  return localStorage.getItem('he_token');
}
function setToken(token) {
  localStorage.setItem('he_token', token);
}
function clearToken() {
  localStorage.removeItem('he_token');
  localStorage.removeItem('he_user');
}

async function apiFetch(path, options = {}) {
  const token = getToken();
  const switcherValue = window.__olicomm_agency_override !== undefined
    ? window.__olicomm_agency_override
    : (localStorage.getItem('olicomm_agency_view') || '');
  // Fall back to user's own agency if no switcher active
  const storedUser = JSON.parse(localStorage.getItem('he_user') || '{}');
  const agencyOverride = switcherValue || storedUser.agency || '';

  const res = await fetch(`${BASE}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-Agency-Override': agencyOverride,
      ...(options.headers || {})
    }
  });
  if (res.status === 401) {
    // If we had no token to begin with, don't reload — the caller (App.checkAuth)
    // is expecting a thrown error so it can render the Login screen. Reloading
    // here causes an infinite loop on first visit / after JWT secret rotation.
    const hadToken = !!token;
    clearToken();
    if (hadToken) {
      window.location.reload();
      return;
    }
    // No token → throw so caller's try/catch handles it (renders Login).
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

async function apiUpload(path, formData) {
  const token = getToken();
  const switcherValue = window.__olicomm_agency_override !== undefined
    ? window.__olicomm_agency_override
    : (localStorage.getItem('olicomm_agency_view') || '');
  // Fall back to user's own agency if no switcher active
  const storedUser = JSON.parse(localStorage.getItem('he_user') || '{}');
  const agencyOverride = switcherValue || storedUser.agency || '';

  const res = await fetch(`${BASE}/api${path}`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-Agency-Override': agencyOverride,
    },
    body: formData
  });
  
  // Handle 409 duplicate warning specially - return data instead of throwing
  if (res.status === 409) {
    const data = await res.json().catch(() => ({ error: 'Duplicate detection failed' }));
    return { status: 409, ...data };
  }
  
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Upload failed');
  }
  return res.json();
}

async function apiDownload(path, fallbackFilename = 'download.bin') {
  const token = getToken();
  const switcherValue = window.__olicomm_agency_override !== undefined
    ? window.__olicomm_agency_override
    : (localStorage.getItem('olicomm_agency_view') || '');
  const storedUser = JSON.parse(localStorage.getItem('he_user') || '{}');
  const agencyOverride = switcherValue || storedUser.agency || '';

  const res = await fetch(`${BASE}/api${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-Agency-Override': agencyOverride,
    },
  });
  if (res.status === 401) {
    const hadToken = !!token;
    clearToken();
    if (hadToken) {
      window.location.reload();
      return;
    }
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Download failed');
  }
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const match = cd.match(/filename="([^"]+)"/i);
  const filename = match ? match[1] : fallbackFilename;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return { filename };
}

export { apiFetch, apiUpload, apiDownload, getToken, setToken, clearToken };
