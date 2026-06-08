function renderNavbar() {
  if (!document.body) return;

  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  const pages = [
    { href: 'index.html', i18nKey: 'nav.home', label: 'Home' },
    { href: 'levels.html', i18nKey: 'nav.fases', label: 'Levels' },
    { href: 'usuarios.html', i18nKey: 'nav.criadores', label: 'Criadores' },
    { href: 'download.html', i18nKey: 'nav.download', label: 'Download' },
    { href: 'little_coffee.html', i18nKey: 'nav.cafezinho', label: '☕ Cafézinho', emoji: '☕' },
    { href: 'shop.html', i18nKey: null, label: '🛒 Loja', emoji: '🛒' }
  ];

  let navHTML = `<nav>
  <a href="index.html" class="nav-brand">🎮 Pellizzola Brothers</a>
  <ul class="nav-links">`;

  pages.forEach(page => {
    const isActive = currentPage === page.href ? ' class="active"' : '';
    const i18n = page.i18nKey ? ` data-i18n="${page.i18nKey}"` : '';
    navHTML += `
    <li><a href="${page.href}"${isActive}${i18n}>${page.label}</a></li>`;
  });

  navHTML += `
    <li><a href="login.html" id="nav-auth" data-i18n="nav.entrar">Entrar</a></li>
    <li>
      <form class="nav-search-form" onsubmit="navSearch(event)">
        <input class="nav-search-input" id="nav-search" type="text" data-i18n-ph="nav.buscar" placeholder="🔍 Buscar fases..." autocomplete="off">
      </form>
    </li>
  </ul>
</nav>`;

  document.body.insertAdjacentHTML('afterBegin', navHTML);

  // Restore user session in nav
  const user = getUser();
  if (user) {
    const navAuthEl = document.getElementById('nav-auth');
    if (navAuthEl) {
      navAuthEl.textContent = user.username.toUpperCase();
      navAuthEl.href = 'perfil_do_usuario.html?id=' + user.id;
      navAuthEl.removeAttribute('data-i18n');
    }
  }
}

// Auto-render navbar when DOM is ready
document.addEventListener('DOMContentLoaded', renderNavbar);
if (document.readyState === 'complete') {
  renderNavbar();
}
