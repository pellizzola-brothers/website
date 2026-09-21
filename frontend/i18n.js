/* ═══════════════════════════════════════════════════════════════
   i18n.js — Motor de internacionalização (PT-BR / EN)
   Pellizzola Brothers

   ESTRATÉGIA DE CARREGAMENTO (funciona em file:// e HTTP):
   1. Os scripts i18n/pt_BR.js e i18n/en.js são carregados via <script>
      e preenchem window.PB_I18N['pt_BR'] e window.PB_I18N['en'].
   2. Este motor lê o objeto correspondente ao idioma escolhido.
   3. Sem fetch → funciona diretamente no sistema de arquivos (file://).

   USO NOS HTMLs (adicionar ao <head> antes de config.js):
     <script src="i18n/pt_BR.js"></script>
     <script src="i18n/en.js"></script>
     <script src="i18n.js"></script>

   USO NOS TEMPLATES:
     data-i18n="chave"        → substitui textContent
     data-i18n-ph="chave"     → substitui placeholder
     data-i18n-title="chave"  → substitui title
     window.t('chave')        → retorna string traduzida (para JS dinâmico)
     window.getLang()         → retorna código do idioma atual ('pt_BR' | 'en')
     window.switchLang('en')  → troca idioma ao vivo
     window.i18nReady         → Promise que resolve quando pronto
═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var STORAGE_KEY  = 'pb_lang';
  var DEFAULT_LANG = 'pt_BR';
  var SUPPORTED    = ['pt_BR', 'en'];
  var TRANSLATIONS = {};
  var _lang        = DEFAULT_LANG;
  var _resolveReady;

  /* Promessa pública: aguardar i18nReady.then(...) antes de usar t() em JS dinâmico */
  window.i18nReady = new Promise(function (resolve) {
    _resolveReady = resolve;
  });

  /* ── Idioma fixo em PT-BR — sem seletor, sem autodetecção pelo navegador ── */
  function detectLang() {
    return DEFAULT_LANG;
  }

  /* ── Carrega traduções do objeto global window.PB_I18N ── */
  function loadTranslations(lang) {
    var data = (window.PB_I18N && window.PB_I18N[lang]);

    if (data) {
      /* Tradução já disponível (carregada via <script>) */
      TRANSLATIONS = data;
      _lang = lang;
      localStorage.setItem(STORAGE_KEY, lang);
      return Promise.resolve();
    }

    /* Fallback: tenta carregar dinamicamente via <script> */
    return new Promise(function (resolve) {
      var script = document.createElement('script');
      script.src = 'i18n/' + lang + '.js';
      script.onload = function () {
        var loaded = window.PB_I18N && window.PB_I18N[lang];
        if (loaded) {
          TRANSLATIONS = loaded;
          _lang = lang;
          localStorage.setItem(STORAGE_KEY, lang);
        } else if (lang !== DEFAULT_LANG) {
          /* Se falhou, tenta PT-BR */
          var fallback = window.PB_I18N && window.PB_I18N[DEFAULT_LANG];
          if (fallback) { TRANSLATIONS = fallback; _lang = DEFAULT_LANG; }
        }
        resolve();
      };
      script.onerror = function () {
        /* Último recurso: usa PT-BR inline se disponível */
        var fallback = window.PB_I18N && window.PB_I18N[DEFAULT_LANG];
        if (fallback) { TRANSLATIONS = fallback; _lang = DEFAULT_LANG; }
        resolve();
      };
      document.head.appendChild(script);
    });
  }

  /* ── Função pública: t('chave', {n: 3}) ── */
  window.t = function (key, vars) {
    var str = TRANSLATIONS[key] !== undefined ? TRANSLATIONS[key] : key;
    if (vars && typeof vars === 'object') {
      Object.keys(vars).forEach(function (k) {
        str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
      });
    }
    return str;
  };

  /* ── Retorna o código do idioma atual ── */
  window.getLang = function () { return _lang; };

  /* ── Aplica traduções a todos os [data-i18n*] ── */
  function applyTranslations(root) {
    root = root || document;

    root.querySelectorAll('[data-i18n]').forEach(function (el) {
      var val = t(el.getAttribute('data-i18n'));
      if (val !== el.getAttribute('data-i18n')) el.textContent = val;
    });

    root.querySelectorAll('[data-i18n-ph]').forEach(function (el) {
      var val = t(el.getAttribute('data-i18n-ph'));
      if (val !== el.getAttribute('data-i18n-ph')) el.setAttribute('placeholder', val);
    });

    root.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      var val = t(el.getAttribute('data-i18n-title'));
      if (val !== el.getAttribute('data-i18n-title')) el.setAttribute('title', val);
    });
  }

  /* ── Seletor de idioma na nav: desativado — site é PT-BR apenas ── */
  function renderLangSelector() {
    var existing = document.getElementById('lang-selector-li');
    if (existing) existing.remove();
  }

  /* ── Troca de idioma ao vivo ── */
  window.switchLang = function (lang) {
    if (SUPPORTED.indexOf(lang) === -1) return;
    loadTranslations(lang).then(function () {
      applyTranslations();
      renderLangSelector();
      document.dispatchEvent(new CustomEvent('langchange', { detail: { lang: lang } }));
    });
  };

  /* ── Inicialização ── */
  function init() {
    _lang = detectLang();
    loadTranslations(_lang).then(function () {
      applyTranslations();
      renderLangSelector();
      _resolveReady(_lang);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
