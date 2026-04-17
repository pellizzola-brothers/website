// ============================================================
//  frontend/auth.js — Gerenciamento de sessão centralizado
//  PROBLEMA 4 CORRIGIDO: usa localStorage em todas as páginas
//
//  COMO USAR: adicione <script src="auth.js"></script> em TODAS
//  as páginas, ANTES de qualquer script que precise do token/user.
// ============================================================

/**
 * Salva usuário e token no localStorage (persiste entre abas e sessões).
 */
function saveSession(user, token) {
  localStorage.setItem('pb_user',  JSON.stringify(user));
  localStorage.setItem('pb_token', token || '');
}

/**
 * Retorna o token JWT armazenado, ou string vazia se não houver.
 */
function getToken() {
  return localStorage.getItem('pb_token') || '';
}

/**
 * Retorna o objeto do usuário logado, ou null se não houver sessão.
 */
function getUser() {
  try {
    return JSON.parse(localStorage.getItem('pb_user') || 'null');
  } catch (_) {
    return null;
  }
}

/**
 * Retorna true se há um usuário logado com token válido.
 */
function isLoggedIn() {
  return !!getToken() && !!getUser();
}

/**
 * Remove a sessão do storage (logout).
 */
function clearSession() {
  localStorage.removeItem('pb_user');
  localStorage.removeItem('pb_token');
}
