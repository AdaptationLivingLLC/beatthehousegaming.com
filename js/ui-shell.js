// ============================================================
// ui-shell.js — Layout manager + theme cycling (BTHG.UI)
// BTHG Roulette Breaker Web App
// Contains: applyLayout (device-class body classes: layout-phone-land,
//   layout-phone-port, layout-tablet, layout-desktop), cycleTheme
//   (casino -> midnight -> paper -> casino, persisted via
//   BTHG.Storage.Settings settings.theme), restoreTheme (applies the
//   persisted theme on boot), and the DOMContentLoaded/resize wiring
//   for #btn-theme and the layout classes.
//
// Kept in its own file, separate from app.js, on purpose: app.js has a
// top-level `document.addEventListener('DOMContentLoaded', ...)` call
// that assumes a real DOM, which throws in the Node vm test sandbox
// (tests/_load.mjs) that has no `document`. This file guards its own
// DOM wiring behind a `typeof document` check so BTHG.UI.applyLayout()
// and BTHG.UI.cycleTheme() stay callable/testable headlessly, while the
// automatic boot wiring still runs normally in a real browser. Loaded
// before app.js in app.html so BTHG.UI exists app-wide by the time
// app.js's own DOMContentLoaded handler runs.
// ============================================================

(function() {
  const BTHG = window.BTHG;

  const THEMES = ['casino', 'midnight', 'paper'];

  const UI = BTHG.UI = {
    THEMES,

    // Classifies the current viewport into exactly one of the four
    // layout body classes. "Phone" is decided by the SHORT side (so a
    // phone in landscape and the same phone in portrait both count as
    // phone), then split into landscape/portrait by which side is
    // longer. Anything bigger than phone is tablet up to 1366px wide,
    // desktop beyond that.
    applyLayout() {
      const w = innerWidth, h = innerHeight, phone = Math.min(w, h) <= 480;
      document.body.classList.remove('layout-phone-land', 'layout-phone-port', 'layout-tablet', 'layout-desktop');
      document.body.classList.add(
        phone ? (w > h ? 'layout-phone-land' : 'layout-phone-port')
              : (w <= 1366 ? 'layout-tablet' : 'layout-desktop'));
    },

    // Advances body[data-theme] to the next theme in THEMES order and
    // persists the choice via Storage.Settings so it survives reload.
    cycleTheme() {
      const cur = document.body.dataset.theme || 'casino';
      const next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
      document.body.dataset.theme = next;
      const s = BTHG.Storage.Settings.load();
      s.theme = next;
      BTHG.Storage.Settings.save(s);
      return next;
    },

    // Applies whatever theme is in Storage.Settings (falling back to
    // 'casino' if nothing valid is stored yet — e.g. a fresh install, or
    // the pre-Task-7 default of 'classic'). Called on boot, before the
    // first paint settles, to avoid a flash of the wrong theme.
    restoreTheme() {
      const s = BTHG.Storage.Settings.load();
      const theme = THEMES.indexOf(s.theme) !== -1 ? s.theme : 'casino';
      document.body.dataset.theme = theme;
      return theme;
    },

    // Toggles the intel feed panel out of the layout entirely (Brandon,
    // 2026-07-04, from the floor: on tablet layout the feed owns two
    // thirds of the screen; he needs a one-tap way to drop it and give
    // the table the whole viewport). The #ss-signal chip keeps showing
    // the BET/HOLD/STOP call while the panel is hidden. Persisted like
    // the theme so it survives reload mid-session.
    toggleFeed() {
      const hidden = document.body.classList.toggle('feed-hidden');
      const s = BTHG.Storage.Settings.load();
      s.feedHidden = hidden;
      BTHG.Storage.Settings.save(s);
      return hidden;
    },

    restoreFeed() {
      const s = BTHG.Storage.Settings.load();
      document.body.classList.toggle('feed-hidden', !!s.feedHidden);
      return !!s.feedHidden;
    },

    // Real Time switch. ON (default): each number tap is stamped as an
    // actual ball-drop moment and feeds the cycle-timing engine. OFF:
    // you are back-filling historical numbers, so their timestamps are
    // ignored for cadence (they still record fully). BTHG._realTime is
    // the live flag read at tap time in roulette-table.js; persisted so
    // it survives reload mid-session.
    setRealTime(on) {
      BTHG._realTime = !!on;
      const btn = document.getElementById('btn-realtime');
      if (btn) {
        btn.classList.toggle('ss-btn-rt-on', !!on);
        btn.classList.toggle('ss-btn-rt-off', !on);
        btn.title = on ? 'Real Time: ON (taps are live drops)' : 'Real Time: OFF (back-filling history)';
      }
      const s = BTHG.Storage.Settings.load();
      s.realTime = !!on;
      BTHG.Storage.Settings.save(s);
      return !!on;
    },

    toggleRealTime() { return UI.setRealTime(BTHG._realTime === false); },

    restoreRealTime() {
      const s = BTHG.Storage.Settings.load();
      // Default ON when nothing stored (a fresh install is assumed live).
      return UI.setRealTime(s.realTime !== false);
    },
  };

  // ---- Boot wiring ----------------------------------------------
  // Skipped when there's no real document (the Node test sandbox) so
  // this file stays loadable/testable headlessly.
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('DOMContentLoaded', () => {
      UI.restoreTheme();
      UI.restoreFeed();
      UI.restoreRealTime();
      UI.applyLayout();
      window.addEventListener('resize', () => UI.applyLayout());
      window.addEventListener('orientationchange', () => UI.applyLayout());
      const btn = document.getElementById('btn-theme');
      if (btn) btn.addEventListener('click', () => UI.cycleTheme());
      const feedBtn = document.getElementById('btn-feed');
      if (feedBtn) feedBtn.addEventListener('click', () => {
        const hidden = UI.toggleFeed();
        feedBtn.title = hidden ? 'Show insight feed' : 'Hide insight feed';
      });
      const rtBtn = document.getElementById('btn-realtime');
      if (rtBtn) rtBtn.addEventListener('click', () => UI.toggleRealTime());
    });
  }

  window.BTHG = BTHG;
})();
