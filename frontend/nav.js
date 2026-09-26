// nav.js — comportamento compartilhado da nav (incluir antes de </body>, depois de auth.js)
(function () {
  // Sessão: troca "Entrar" pelo nome do usuário. Remove data-i18n para o i18n.js
  // não sobrescrever o nome com "Entrar" ao aplicar as traduções.
  var auth = document.getElementById('nav-auth');
  if (auth && isLoggedIn()) {
    var user = getUser();
    auth.textContent = user.username.toUpperCase();
    auth.href = 'perfil_do_usuario.html?id=' + encodeURIComponent(user.id);
    auth.removeAttribute('data-i18n');
    // Destaca o link só na página do próprio usuário (nas demais, o "active" já vem no HTML)
    var onOwnProfile = /perfil_do_usuario\.html$/.test(location.pathname) &&
      new URLSearchParams(location.search).get('id') === String(user.id);
    auth.classList.toggle('active', onOwnProfile);
  }

})();
