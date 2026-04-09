// ============================================================
// admin-keygen.js — Password-protected admin key generator
// BTHG Roulette Breaker Web App
// Last modified: 2026-03-07
// ============================================================

(function() {
  const BTHG = window.BTHG;

  async function initAdminPanel() {
    const params = new URLSearchParams(window.location.search);
    const adminPass = params.get('admin');
    if (!adminPass) return false;

    const isValid = await BTHG.Paywall.verifyAdminPassword(adminPass);
    if (!isValid) {
      document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#0a0a0a;color:#ff3333;font-family:Inter,sans-serif;font-size:1.5rem;">Access Denied</div>';
      return true;
    }

    // Mark this device as admin — permanent app access from now on
    BTHG.Paywall.markAsAdmin();

    // Clean password from URL immediately
    window.history.replaceState({}, '', 'app.html');

    // Build admin UI
    renderAdminPanel();
    return true;
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
          <p style="color:#888;font-size:0.9rem;">Generate access keys for in-person distribution</p>
        </div>

        <div style="background:rgba(20,20,20,0.8);border:1px solid rgba(212,175,55,0.3);border-radius:12px;padding:2rem;margin-bottom:2rem;">
          <h3 style="color:#fff;margin-bottom:1rem;">Generate New Key</h3>
          <div style="display:flex;gap:1rem;flex-wrap:wrap;align-items:end;">
            <div style="flex:1;min-width:150px;">
              <label style="color:#aaa;font-size:0.85rem;display:block;margin-bottom:0.5rem;">Duration</label>
              <select id="key-duration" style="width:100%;padding:0.75rem;background:#1a1a1a;color:#fff;border:1px solid rgba(255,255,255,0.2);border-radius:6px;font-size:1rem;">
                <option value="36500">Lifetime — $24.99 (paid)</option>
                <option value="1">1 Day — Demo (admin issue)</option>
                <option value="3">3 Days — Trial (admin issue)</option>
                <option value="7">7 Days — Extended Trial (admin issue)</option>
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
        </div>

        <div style="background:rgba(20,20,20,0.8);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:2rem;">
          <h3 style="color:#fff;margin-bottom:1rem;">Generated Keys</h3>
          <div id="keys-list" style="max-height:400px;overflow-y:auto;"></div>
        </div>

        <div style="text-align:center;margin-top:2rem;">
          <a href="app.html" style="color:#d4af37;text-decoration:underline;font-size:0.9rem;">Back to App</a>
        </div>
      </div>
    `;

    app.appendChild(panel);

    // Event listeners
    document.getElementById('btn-generate').addEventListener('click', handleGenerate);
    document.getElementById('btn-copy-key').addEventListener('click', handleCopy);
    refreshKeyList();
  }

  async function handleGenerate() {
    const days = parseInt(document.getElementById('key-duration').value);
    const btn = document.getElementById('btn-generate');
    btn.textContent = 'Generating...';
    btn.disabled = true;

    try {
      const key = await BTHG.Paywall.generateKey(days);
      // Save to admin storage
      BTHG.Storage.AdminKeys.add({
        key: key,
        days: days,
        created: Date.now(),
        used: false,
      });

      // Display
      const display = document.getElementById('generated-key-display');
      display.style.display = 'block';
      document.getElementById('new-key-text').textContent = key;

      refreshKeyList();
    } catch(e) {
      alert('Error generating key: ' + e.message);
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

  function refreshKeyList() {
    const container = document.getElementById('keys-list');
    if (!container) return;
    const keys = BTHG.Storage.AdminKeys.getAll();
    if (keys.length === 0) {
      container.innerHTML = '<p style="color:#666;font-style:italic;">No keys generated yet.</p>';
      return;
    }
    container.innerHTML = keys.slice().reverse().map(k => {
      const created = new Date(k.created).toLocaleString();
      const expiresAt = new Date(k.created + k.days * 86400000).toLocaleString();
      const isExpired = Date.now() > (k.created + k.days * 86400000);
      let status, statusColor;
      if (k.used) { status = 'USED'; statusColor = '#888'; }
      else if (isExpired) { status = 'EXPIRED'; statusColor = '#ff3333'; }
      else { status = 'ACTIVE'; statusColor = '#5EFF00'; }

      return `
        <div style="padding:1rem;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;">
          <div style="flex:1;min-width:200px;">
            <div style="font-family:monospace;font-size:0.85rem;color:#ccc;word-break:break-all;">${k.key}</div>
            <div style="font-size:0.75rem;color:#666;margin-top:0.25rem;">${k.days} day${k.days>1?'s':''} — Created: ${created}</div>
          </div>
          <span style="color:${statusColor};font-weight:700;font-size:0.8rem;padding:0.25rem 0.75rem;border:1px solid ${statusColor};border-radius:4px;">${status}</span>
        </div>
      `;
    }).join('');
  }

  // ---- Public API ---------------------------------------------
  BTHG.AdminKeygen = { initAdminPanel };
  window.BTHG = BTHG;
})();
