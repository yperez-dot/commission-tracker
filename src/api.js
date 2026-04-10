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
  const res = await fetch(`${BASE}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  if (res.status === 401) {
    clearToken();
    window.location.reload();
    return;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

async function apiUpload(path, formData) {
  const token = getToken();
  const res = await fetch(`${BASE}/api${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Upload failed');
  }
  return res.json();
}

export { apiFetch, apiUpload, getToken, setToken, clearToken };
