// ============================================================
// boot-guard.js — visible error reporter (2026-07-04, after the
// betting-engine deploy killed boot silently on Brandon's iPad).
// Any uncaught error or unhandled rejection paints a red banner with
// the exact message and source line, so a broken deploy is diagnosable
// from a screenshot instead of presenting as mysteriously dead buttons.
// Loaded FIRST in app.html so it catches failures in every later file.
// No dependencies, no BTHG namespace requirement.
// ============================================================
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  var shown = 0;
  function banner(msg) {
    try {
      if (shown >= 3) return; // cap so a loop cannot wallpaper the screen
      shown++;
      var el = document.createElement('div');
      el.setAttribute('style',
        'position:fixed;top:' + (34 + shown * 54) + 'px;left:8px;right:8px;z-index:99999;' +
        'background:#3a0a0a;color:#ffb3b3;border:1px solid #ff3300;border-radius:6px;' +
        'padding:8px 12px;font:12px/1.4 monospace;word-break:break-all;');
      el.textContent = 'APP ERROR: ' + msg + '  (screenshot this)';
      var add = function () { document.body.appendChild(el); };
      if (document.body) add();
      else document.addEventListener('DOMContentLoaded', add);
    } catch (e) { /* the reporter itself must never throw */ }
  }
  window.addEventListener('error', function (e) {
    var src = e.filename ? e.filename.split('/').pop() + ':' + e.lineno : '';
    banner((e.message || 'unknown error') + (src ? ' at ' + src : ''));
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    banner('async: ' + (r && r.message ? r.message : String(r)));
  });
})();
