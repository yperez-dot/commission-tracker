const user = {
  name: 'Yahoska Perez',
  role: 'admin',
  agency: 'The Health Experts Insurance',
};

async function apiFetch(path) {
  if (path === '/auth/me') return { user };
  return {};
}

function clearToken() {}
function setToken() {}

module.exports = { apiFetch, clearToken, setToken };
