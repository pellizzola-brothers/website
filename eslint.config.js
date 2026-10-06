// Frontend files are plain <script> tags sharing globals, hence sourceType "script".
const names = o => Object.fromEntries(o.map(n => [n, 'readonly']));
module.exports = [{
  files: ['frontend/**/*.js'],
  languageOptions: {
    ecmaVersion: 2021,
    sourceType: 'script',
    globals: names([
      'window', 'document', 'localStorage', 'sessionStorage', 'fetch', 'console', 'navigator', 'location',
      'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'URL', 'URLSearchParams', 'FormData',
      'XMLHttpRequest', 'Event', 'AbortController', 'alert', 'confirm', 'atob', 'btoa',
      'CustomEvent', 't', 'API', 'saveSession', 'getToken', 'getUser', 'clearSession', 'isLoggedIn', 'api',
    ]),
  },
  rules: { 'no-undef': 'error' },
}];
