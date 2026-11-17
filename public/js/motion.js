// =====================================================================
//  SENIOR UNO VALUES — scroll reveals and gentle parallax
// =====================================================================
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var els = document.querySelectorAll('[data-anim]');
  if (reduce || !('IntersectionObserver' in window)) {
    els.forEach(function (el) { el.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -6% 0px' });
    var start = function () { els.forEach(function (el) { io.observe(el); }); };
    // Wait for the page loader to lift so reveals aren't hidden behind it.
    if (document.documentElement.classList.contains('su-ready')) start();
    else document.addEventListener('su-loader-out', start);
  }

  // Slow parallax on the big photo backgrounds (not on low-power phones).
  if (reduce || document.documentElement.classList.contains('lite')) return;
  var layers = document.querySelectorAll('.hero-slides, .ph-slides');
  if (!layers.length) return;
  var ticking = false;
  function update() {
    var vh = window.innerHeight;
    layers.forEach(function (l) {
      var r = l.parentElement.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh) return;
      var shift = (r.top + r.height / 2 - vh / 2) * -0.08;
      l.style.transform = 'translate3d(0,' + shift.toFixed(1) + 'px,0) scale(1.08)';
    });
    ticking = false;
  }
  window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  update();
})();
