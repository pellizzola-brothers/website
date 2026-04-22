function saveSession(user, token) {
  localStorage.setItem('pb_user',  JSON.stringify(user));
  localStorage.setItem('pb_token', token || '');
}

function getToken() {
  return localStorage.getItem('pb_token') || '';
}

function getUser() {
  try {
    return JSON.parse(localStorage.getItem('pb_user') || 'null');
  } catch (_) {
    return null;
  }
}

function isLoggedIn() {
  return !!getToken() && !!getUser();
}

function clearSession() {
  localStorage.removeItem('pb_user');
  localStorage.removeItem('pb_token');
}
