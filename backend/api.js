// ============================================================
//  frontend/api.js — Módulo centralizado de chamadas à API
//  PROBLEMA 3 CORRIGIDO: URLs nunca duplicam /api
//
//  COMO USAR: adicione após config.js e auth.js:
//  <script src="config.js"></script>
//  <script src="auth.js"></script>
//  <script src="api.js"></script>
// ============================================================

const api = {

  // ── Levels ──────────────────────────────────────────────────

  levels: {
    /** Lista todos os levels (com busca opcional ?q=) */
    list: function(q) {
      var url = q ? (API + '/levels?q=' + encodeURIComponent(q)) : (API + '/levels');
      return fetch(url);
    },

    /** Busca por autor */
    byAuthor: function(authorId) {
      return fetch(API + '/levels?author_id=' + authorId);
    },

    /** Level em destaque */
    featured: function() { return fetch(API + '/levels/featured'); },

    /** Detalhe de um level */
    get: function(id) { return fetch(API + '/levels/' + id); },

    /** Cria um novo level (requer auth) */
    create: function(body) {
      return fetch(API + '/levels', {
        method: 'POST',
        headers: _authHeaders(),
        body: JSON.stringify(body),
      });
    },

    /** Deleta um level (requer auth) — PROBLEMA 3 CORRIGIDO AQUI */
    delete: function(id) {
      return fetch(API + '/levels/' + id, {
        method: 'DELETE',
        headers: _authHeaders(),
      });
    },

    /** Registra download */
    download: function(id, userId) {
      return fetch(API + '/levels/' + id + '/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userId ? { user_id: userId } : {}),
      });
    },

    /** Verifica se o usuário logado já curtiu o level */
    liked: function(id) {
      return fetch(API + '/levels/' + id + '/liked', {
        headers: _authHeaders(),
      });
    },

    /** Curte um level (requer auth) */
    like: function(id) {
      return fetch(API + '/levels/' + id + '/like', {
        method: 'POST',
        headers: _authHeaders(),
      });
    },

    /** Descurte um level (requer auth) */
    unlike: function(id) {
      return fetch(API + '/levels/' + id + '/unlike', {
        method: 'POST',
        headers: _authHeaders(),
      });
    },

    /** Posta um comentário (requer auth) */
    comment: function(id, content) {
      return fetch(API + '/levels/' + id + '/comment', {
        method: 'POST',
        headers: _authHeaders(),
        body: JSON.stringify({ content: content }),
      });
    },

    /** Deleta um comentário (requer auth) */
    deleteComment: function(levelId, commentId) {
      return fetch(API + '/levels/' + levelId + '/comment/' + commentId, {
        method: 'DELETE',
        headers: _authHeaders(),
      });
    },

    /** Denuncia um level (requer auth) */
    report: function(id, reason, detail) {
      return fetch(API + '/levels/' + id + '/report', {
        method: 'POST',
        headers: _authHeaders(),
        body: JSON.stringify({ reason: reason, detail: detail }),
      });
    },
  },

  // ── Users ───────────────────────────────────────────────────

  users: {
    /** Lista todos os usuários */
    list: function() { return fetch(API + '/users'); },

    /** Detalhe de um usuário */
    get: function(id) { return fetch(API + '/users/' + id); },

    /** Atualiza bio (requer auth) */
    update: function(id, body) {
      return fetch(API + '/users/' + id, {
        method: 'PUT',
        headers: _authHeaders(),
        body: JSON.stringify(body),
      });
    },

    /** Histórico de downloads do próprio usuário (requer auth) */
    downloadHistory: function(id) {
      return fetch(API + '/users/' + id + '/download-history', {
        headers: _authHeaders(),
      });
    },
  },

  // ── Auth ────────────────────────────────────────────────────

  auth: {
    login: function(username, password) {
      return fetch(API + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password }),
      });
    },

    register: function(username, bio, password) {
      return fetch(API + '/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, bio: bio, password: password }),
      });
    },
  },

  // ── Files ───────────────────────────────────────────────────

  files: {
    get: function(id) { return fetch(API + '/files/' + id); },
    downloadUrl: function(hash) { return API + '/upload/level/' + hash; },
  },
};

// ── Helpers privados ─────────────────────────────────────────

function _authHeaders() {
  var token = getToken(); // vem de auth.js
  var headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return headers;
}
