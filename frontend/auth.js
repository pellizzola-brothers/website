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

/**
 * Decodifica o payload de um JWT e verifica se ainda é válido.
 * Retorna true se o token existir e não estiver expirado.
 */
function isTokenValid() {
  var token = getToken();
  if (!token) return false;
  try {
    var parts = token.split('.');
    if (parts.length !== 3) return false;
    var payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (!payload.exp) return true; /* sem exp = sem expiração configurada */
    return Math.floor(Date.now() / 1000) < payload.exp;
  } catch (_) {
    return false;
  }
}

/**
 * Limpa a sessão se o token estiver expirado.
 * Chamar no início de qualquer página protegida.
 */
function clearSessionIfExpired() {
  if (getToken() && !isTokenValid()) {
    clearSession();
    return true; /* sessão foi limpa */
  }
  return false;
}

function isLoggedIn() {
  return isTokenValid() && !!getUser();
}

function clearSession() {
  localStorage.removeItem('pb_user');
  localStorage.removeItem('pb_token');
}
