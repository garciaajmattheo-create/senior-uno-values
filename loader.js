// =====================================================================
//  SENIOR UNO VALUES — page-change loading animation
//  The screen goes dark, a soft beam of light sweeps across the tagline,
//  the emblem glows in, then the next page is revealed.
//  Load this file in <head> (not as a module) on every page.
// =====================================================================
(function () {
  var KEY = 'su-loader';
  var html = document.documentElement;
  var incoming = false;
  try { incoming = sessionStorage.getItem(KEY) === '1'; sessionStorage.removeItem(KEY); } catch (e) {}
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.SU_FROM_LOADER = incoming;

  function overlay(cls) {
    var el = document.createElement('div');
    el.id = 'su-loader';
    el.className = cls;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-label', 'Loading');
    el.innerHTML =
      '<div class="ld-em"><span class="ld-glow"></span><img src="assets/logo.png" alt=""></div>' +
      '<p class="ld-text">Shaping Senior UNOs of character<br>Nasugbu Senior High School 1 &middot; Senior UNO Values</p>' +
      '<p class="ld-sub">MAKA-DIYOS &middot; MAKATAO &middot; MAKAKALIKASAN &middot; MAKABANSA</p>';
    return el;
  }

  // Arriving on a page after clicking a link: play the animation, then reveal.
  if (incoming && !reduce) {
    html.classList.add('su-loading');
    var start = function () {
      var el = overlay('play');
      document.body.appendChild(el);
      html.classList.remove('su-loading');
      setTimeout(function () { el.classList.add('out'); }, 3300);
      setTimeout(function () { el.remove(); document.dispatchEvent(new Event('su-loader-done')); }, 4000);
    };
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  }

  // Leaving: fade to dark, then go to the next page (which plays the animation).
  window.suGo = function (url, replace) {
    if (reduce) { replace ? location.replace(url) : (location.href = url); return; }
    try { sessionStorage.setItem(KEY, '1'); } catch (e) {}
    var el = overlay('leave');
    document.body.appendChild(el);
    setTimeout(function () { replace ? location.replace(url) : (location.href = url); }, 380);
  };

  // Links to our own pages use the loader. Same-page links (#…) do not.
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
    var url;
    try { url = new URL(a.getAttribute('href'), location.href); } catch (err) { return; }
    if (url.origin !== location.origin || !/\/(index|login|app)\.html$|\/$/.test(url.pathname)) return;
    if (url.pathname === location.pathname) return;
    e.preventDefault();
    window.suGo(url.href);
  });

  // Coming back with the browser's Back button: don't leave a dark screen.
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) { var el = document.getElementById('su-loader'); if (el) el.remove(); }
  });
})();
