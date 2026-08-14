// nav.js — Easter egg: clicar 9x na marca da nav leva para creditos.html
(function () {
  var brand = document.querySelector('.nav-brand');
  if (!brand) return;
  brand.addEventListener('click', function (e) {
    var n = parseInt(sessionStorage.getItem('pb_brand_clicks') || '0', 10) + 1;
    if (n >= 9) {
      sessionStorage.removeItem('pb_brand_clicks');
      e.preventDefault();
      window.location.href = 'creditos.html';
    } else {
      sessionStorage.setItem('pb_brand_clicks', n);
    }
  });
})();
