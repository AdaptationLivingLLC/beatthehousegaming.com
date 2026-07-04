// ============================================================
// intel-feed.js — Live intelligence feed (BTHG.IntelFeed)
// BTHG Roulette Breaker Web App
// Renders PatternEngine.analyze() alerts as newest-first cards into
// #intel-feed (container markup lives in js/roulette-table.js —
// render() sibling of #table-container; styling + tablet/desktop-only
// visibility is css/app.css's "Layout Shell" section from Task 7),
// plus a pinned BET/HOLD/STOP signal banner at the top of the feed and
// a compact mirror of that same signal as a chip in #status-strip
// (#ss-signal, see app.html) — the status strip stays visible in phone
// landscape, where #intel-feed itself is hidden, so the signal is the
// one piece of intel that always has somewhere to show.
//
// Public API — also the integration point for Task 9's Trinity wiring.
// Trinity isn't built yet, so this module only knows about
// PatternEngine-shaped alerts today, but push()/setSignal() take plain
// {kind, message, samples} / {state, reason} objects, not anything
// PatternEngine-specific, so a later caller pushing Trinity alerts
// through the same functions needs no changes here:
//   BTHG.IntelFeed.push({kind, message, samples})
//   BTHG.IntelFeed.setSignal({state, reason})
//   BTHG.IntelFeed.reset() — clears the feed and its dedup memory.
//     Not part of the original spec's two producer calls, but required
//     to make "Deduplicate alerts already shown ... within the current
//     series" (the brief's Step 2) actually mean something: without a
//     series-boundary hook, dedup would silently span every series for
//     the whole page lifetime instead of just the current one. Callers
//     wire this to the same series-boundary actions that already reset
//     the board (New Series / Discard) — see js/roulette-table.js.
//
// Kept deliberately independent of any real `document` (same guarded
// pattern as js/ui-shell.js) so the pure push/cap/dedup/setSignal/reset
// logic is testable headlessly via tests/_load.mjs.
// ============================================================

(function() {
  // Self-initializing (like js/utils.js), not "assume it already exists"
  // (like js/ui-shell.js/roulette-table.js) — this module has no real
  // dependencies on anything else in BTHG, so tests/test-intel-feed.mjs
  // loads it standalone via tests/_load.mjs without first loading
  // utils.js/storage.js.
  const BTHG = window.BTHG || (window.BTHG = {});

  const MAX_ENTRIES = 50;

  const KIND_ICONS = {
    follower: 'fa-link',
    gap: 'fa-hourglass-half',
    cycle: 'fa-sync-alt',
  };
  const DEFAULT_ICON = 'fa-circle-info';

  const SIGNAL_LABELS = { BET: 'BET', HOLD: 'HOLD', STOP: 'STOP' };

  let entries = [];      // newest-first, capped at MAX_ENTRIES
  let seen = new Set();  // dedup keys "kind|message", cleared by reset()
  let signal = null;     // { state, reason } — null until setSignal() first runs

  // Adds an alert card unless its (kind, message) pair has already been
  // shown since the last reset(). Silently ignores malformed input
  // (missing kind/message) rather than throwing — callers pass
  // PatternEngine alert objects straight through without validating them.
  function push(alert) {
    if (!alert || !alert.kind || !alert.message) return;
    const key = alert.kind + '|' + alert.message;
    if (seen.has(key)) return;
    seen.add(key);
    entries.unshift({
      kind: alert.kind,
      message: alert.message,
      samples: alert.samples,
      ts: Date.now(),
    });
    if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
    render();
  }

  // Replaces the pinned BET/HOLD/STOP signal. Defensive defaults (state
  // falls back to HOLD, reason to '') so a malformed entry object still
  // renders something sane instead of "undefined".
  function setSignal(next) {
    signal = { state: (next && next.state) || 'HOLD', reason: (next && next.reason) || '' };
    render();
  }

  function reset() {
    entries = [];
    seen = new Set();
    signal = null;
    render();
  }

  // ---- Render ------------------------------------------------------
  // No-ops headlessly (Node test sandbox, or any context with no real
  // `document`) — same guard style as js/ui-shell.js.
  function render() {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    bindCollapse();
    renderFeed();
    renderStatusChip();
  }

  function renderFeed() {
    const el = document.getElementById('intel-feed');
    if (!el) return;
    const banner = signal ? signalBannerHtml(signal) : '';
    const body = entries.length
      ? entries.map(cardHtml).join('')
      : '<div class="intel-feed-empty"><i class="fas fa-satellite-dish"></i><p>Live intelligence feed will appear here once a series is active.</p></div>';
    el.innerHTML = banner + body;
  }

  function renderStatusChip() {
    const chip = document.getElementById('ss-signal');
    if (!chip) return;
    chip.classList.remove('ss-signal-bet', 'ss-signal-hold', 'ss-signal-stop');
    if (!signal) {
      chip.innerHTML = '<span class="ss-chip-label">SIGNAL</span><span class="ss-chip-value">--</span>';
      return;
    }
    const label = SIGNAL_LABELS[signal.state] || signal.state;
    chip.innerHTML = `<span class="ss-chip-label">SIGNAL</span><span class="ss-chip-value">${escapeHtml(label)}</span>`;
    chip.classList.add('ss-signal-' + signal.state.toLowerCase());
    chip.title = signal.reason || '';
  }

  function signalBannerHtml(sig) {
    const label = SIGNAL_LABELS[sig.state] || sig.state;
    return `<div class="if-signal-banner if-signal-${sig.state.toLowerCase()}">` +
      `<span class="if-signal-state">${escapeHtml(label)}</span>` +
      `<span class="if-signal-reason">${escapeHtml(sig.reason)}</span>` +
      // Minimize control ON the banner itself (Brandon, from the floor:
      // the feed block was eating half his iPad screen and the status
      // strip button alone was not discoverable). Click is delegated in
      // render() so it survives every innerHTML re-render; #ss-signal
      // keeps mirroring the call while hidden; #btn-feed restores.
      `<button class="if-collapse" type="button" title="Hide insights">HIDE</button>` +
      `</div>`;
  }

  // One-time delegated handler for the banner's HIDE button, bound on
  // the container so innerHTML re-renders never orphan it.
  let collapseBound = false;
  function bindCollapse() {
    if (collapseBound || typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    const el = document.getElementById('intel-feed');
    if (!el || typeof el.addEventListener !== 'function') return;
    el.addEventListener('click', e => {
      const t = e.target;
      if (t && t.classList && t.classList.contains('if-collapse')) {
        if (BTHG.UI && BTHG.UI.toggleFeed) BTHG.UI.toggleFeed();
        else document.body.classList.add('feed-hidden');
      }
    });
    collapseBound = true;
  }

  function cardHtml(entry) {
    const icon = KIND_ICONS[entry.kind] || DEFAULT_ICON;
    const samples = entry.samples != null ? `<span class="if-card-samples">n=${escapeHtml(entry.samples)}</span>` : '';
    return `<div class="if-card" data-kind="${escapeHtml(entry.kind)}">` +
      `<i class="fas ${icon} if-card-icon"></i>` +
      `<span class="if-card-message">${escapeHtml(entry.message)}</span>` +
      samples +
      `<span class="if-card-time">${formatTime(entry.ts)}</span>` +
      `</div>`;
  }

  function formatTime(ts) {
    try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return ''; }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  BTHG.IntelFeed = { push, setSignal, reset };

  window.BTHG = BTHG;
})();
