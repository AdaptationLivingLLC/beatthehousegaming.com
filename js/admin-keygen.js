// ============================================================
// admin-keygen.js — Admin key generator UI
// All key generation happens server-side via /api/admin/generate-key.
// This file only renders the UI and shuttles requests/responses.
// ============================================================

(function() {
  const BTHG = window.BTHG;

  async function initAdminPanel() {
    // Legacy support: if the URL has ?admin=PASSWORD, exchange it for
    // an admin JWT server-side and clean the URL immediately.
    const params = new URLSearchParams(window.location.search);
    const adminPass = params.get('admin');
    if (adminPass) {
      const result = await BTHG.Paywall.adminLogin(adminPass);
      if (!result.success) {
        document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#0a0a0a;color:#ff3333;font-family:Inter,sans-serif;font-size:1.5rem;">Access Denied</div>';
        return true;
      }
      BTHG.Paywall.markAsAdmin();
      window.history.replaceState({}, '', 'app.html');
      renderAdminPanel();
      return true;
    }

    // Non-legacy path: already logged in as admin?
    if (BTHG.Paywall.getAdminToken()) {
      renderAdminPanel();
      return true;
    }
    return false;
  }

  function renderAdminPanel() {
    const app = document.getElementById('app-root');
    if (!app) return;
    app.innerHTML = '';

    const panel = document.createElement('div');
    panel.className = 'admin-panel';
    panel.innerHTML = `
      <div style="max-width:700px;margin:0 auto;padding:2rem;">
        <div style="text-align:center;margin-bottom:2rem;">
          <h1 style="color:#d4af37;font-family:'Cinzel',serif;font-size:2rem;margin-bottom:0.5rem;">ADMIN KEY GENERATOR</h1>
          <p style="color:#888;font-size:0.9rem;">Generate server-signed access keys for in-person distribution</p>
        </div>

        <div style="background:rgba(20,20,20,0.8);border:1px solid rgba(212,175,55,0.3);border-radius:12px;padding:2rem;margin-bottom:2rem;">
          <h3 style="color:#fff;margin-bottom:1rem;">Generate New Key</h3>
          <div style="display:flex;gap:1rem;flex-wrap:wrap;align-items:end;">
            <div style="flex:1;min-width:150px;">
              <label style="color:#aaa;font-size:0.85rem;display:block;margin-bottom:0.5rem;">Duration</label>
              <select id="key-duration" style="width:100%;padding:0.75rem;background:#1a1a1a;color:#fff;border:1px solid rgba(255,255,255,0.2);border-radius:6px;font-size:1rem;">
                <option value="36500">Lifetime — $24.99 (paid equivalent)</option>
                <option value="1">1 Day — Demo</option>
                <option value="3">3 Days — Trial</option>
                <option value="7">7 Days — Extended Trial</option>
                <option value="14">14 Days</option>
                <option value="30">30 Days</option>
                <option value="90">90 Days</option>
                <option value="365">1 Year</option>
              </select>
            </div>
            <button id="btn-generate" style="padding:0.75rem 2rem;background:#d4af37;color:#000;border:none;border-radius:6px;font-weight:700;font-size:1rem;cursor:pointer;white-space:nowrap;">
              GENERATE KEY
            </button>
          </div>

          <div id="generated-key-display" style="display:none;margin-top:1.5rem;padding:1.5rem;background:rgba(0,179,77,0.1);border:1px solid rgba(0,179,77,0.3);border-radius:8px;">
            <p style="color:#5EFF00;font-size:0.85rem;margin-bottom:0.5rem;">NEW KEY GENERATED:</p>
            <div id="new-key-text" style="font-family:monospace;font-size:1.1rem;color:#fff;word-break:break-all;padding:0.75rem;background:rgba(0,0,0,0.5);border-radius:4px;margin-bottom:0.75rem;"></div>
            <button id="btn-copy-key" style="padding:0.5rem 1.5rem;background:rgba(255,255,255,0.15);color:#fff;border:1px solid rgba(255,255,255,0.3);border-radius:4px;cursor:pointer;font-size:0.9rem;">
              Copy to Clipboard
            </button>
          </div>

          <p id="gen-error" style="color:#ff3333;font-size:0.85rem;margin-top:1rem;display:none;"></p>
        </div>

        <div style="text-align:center;margin-top:2rem;">
          <a href="app.html" style="color:#d4af37;text-decoration:underline;font-size:0.9rem;">Back to App</a>
          &nbsp;&nbsp;·&nbsp;&nbsp;
          <a href="#" id="admin-signout" style="color:#888;text-decoration:underline;font-size:0.9rem;">Sign Out</a>
        </div>
      </div>
    `;

    app.appendChild(panel);

    document.getElementById('btn-generate').addEventListener('click', handleGenerate);
    document.getElementById('btn-copy-key').addEventListener('click', handleCopy);
    document.getElementById('admin-signout').addEventListener('click', (e) => {
      e.preventDefault();
      BTHG.Paywall.signOut();
    });
  }

  async function handleGenerate() {
    const days = parseInt(document.getElementById('key-duration').value, 10);
    const btn = document.getElementById('btn-generate');
    const errEl = document.getElementById('gen-error');
    errEl.style.display = 'none';
    btn.textContent = 'Generating...';
    btn.disabled = true;

    try {
      const token = BTHG.Paywall.getAdminToken();
      if (!token) {
        throw new Error('Admin session expired. Please log in again.');
      }

      const res = await fetch('/api/admin/generate-key', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
        },
        body: JSON.stringify({ durationDays: days }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Key generation failed');
      }

      const display = document.getElementById('generated-key-display');
      display.style.display = 'block';
      document.getElementById('new-key-text').textContent = data.key;
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }

    btn.textContent = 'GENERATE KEY';
    btn.disabled = false;
  }

  function handleCopy() {
    const keyText = document.getElementById('new-key-text').textContent;
    navigator.clipboard.writeText(keyText).then(() => {
      const btn = document.getElementById('btn-copy-key');
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy to Clipboard'; }, 2000);
    });
  }

  BTHG.AdminKeygen = { initAdminPanel };
  window.BTHG = BTHG;
})();
