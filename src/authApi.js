// Sign-in calls that happen before the user has a full session.
// Kept separate from apiFetch so a wrong code (401) shows an error instead of
// clearing storage and reloading the page.
const BASE = process.env.REACT_APP_API_URL || '';

export async function authPost(path, body) {
  let res;
  try {
    res = await fetch(`${BASE}/api/auth${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  } catch {
    throw Object.assign(new Error('Could not reach OliComm. Check your connection.'), { status: 0 });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Sign-in failed');
    err.status = res.status;
    throw err;
  }
  return data;
}
