// ============================================================
// paywall.js — BTHG Roulette Breaker client-side paywall
// SECURITY MODEL (v2 — 2026-04-08):
// All cryptographic operations happen server-side. This file no
// longer contains any secrets. It calls the BTHG backend to:
//   - POST /api/verify-key       → redeem an access key, get a JWT
//   - POST /api/verify-session   → confirm the stored JWT is still valid
//   - POST /api/admin/login      → exchange password for admin JWT
// The user's session JWT is stored in localStorage and sent with
// every protected API call. Signature verification happens server-side.
// ============================================================

(function() {
  const BTHG = window.BTHG;
  const Access = BTHG.Storage.Access;
  const STRIPE_LINK = 'https://buy.stripe.com/28E14n41m1e9eCxeia9MY0d';
  const LANDING_PAGE = 'index.html';
  const APP_PAGE = 'app.html';
  const SESSION_KEY = 'bthg_session_v2';
  const ADMIN_TOKEN_KEY = 'bthg_admin_token_v2';
  const DAY_MS = 24 * 60 * 60 * 1000;

  // ---- Session token storage ----------------------------------
  function getSessionToken() {
    try { return localStorage.getItem(SESSION_KEY); } catch { return null; }
  }
  function setSessionToken(token, expiresAt) {
    try {
      localStorage.setItem(SESSION_KEY, token);
      if (expiresAt) localStorage.setItem(SESSION_KEY + '_exp', String(expiresAt));
    } catch {}
  }
  function clearSessionToken() {
    try {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(SESSION_KEY + '_exp');
    } catch {}
  }
  function getAdminToken() {
    try { return localStorage.getItem(ADMIN_TOKEN_KEY); } catch { return null; }
  }
  function setAdminToken(token) {
    try { localStorage.setItem(ADMIN_TOKEN_KEY, token); } catch {}
  }
  function clearAdminToken() {
    try { localStorage.removeItem(ADMIN_TOKEN_KEY); } catch {}
  }

  // ---- Server-verified access check ---------------------------
  async function verifySessionWithServer() {
    const token = getSessionToken();
    if (!token) return { valid: false };
    try {
      const res = await fetch('/api/verify-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        clearSessionToken();
        return { valid: false };
      }
      const data = await res.json();
      return data;
    } catch {
      return { valid: false, offline: true };
    }
  }

  // ---- Redeem a key (server-side HMAC verification) -----------
  async function redeemKey(keyStr) {
    if (!keyStr || typeof keyStr !== 'string') {
      return { success: false, message: 'Invalid key format' };
    }
    try {
      const res = await fetch('/api/verify-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: keyStr.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, message: data.error || 'Key verification failed' };
      }
      setSessionToken(data.session, new Date(data.expiresAt).getTime());
      return { success: true, days: data.durationDays, expiresAt: data.expiresAt };
    } catch (err) {
      return { success: false, message: 'Network error — try again' };
    }
  }

  // ---- Admin login (server-side scrypt verification) ----------
  async function adminLogin(password) {
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) return { success: false, message: data.error || 'Login failed' };
      setAdminToken(data.token);
      return { success: true };
    } catch {
      return { success: false, message: 'Network error' };
    }
  }

  // ---- Legacy compatibility shim ------------------------------
  // Existing code calls BTHG.Paywall.verifyAdminPassword(pass) and
  // checks the return value synchronously in some places. New code
  // must use the async adminLogin() function. This shim keeps the old
  // API working during the transition.
  async function verifyAdminPassword(input) {
    const result = await adminLogin(input);
    return result.success;
  }

  // ---- Payment success flow -----------------------------------
  // After Stripe checkout completes, the webhook server-side creates
  // the access key and emails it to the customer. The success URL
  // from Stripe lands on the site with ?payment=success, which we
  // use to show a "check your email" message, not to grant access
  // directly (the email delivery is authoritative).
  function handlePaymentSuccess() {
    showMessage(
      'Payment confirmed! Check your email for your access key. It will arrive within 60 seconds.',
      'success'
    );
  }

  // ---- Sync-friendly access check ------------------------------
  // For pages that need an immediate yes/no before an async call
  // finishes (like the app render bootstrap), we do a best-effort
  // check based on whether a session token is present. The real
  // check happens server-side asynchronously.
  function hasSessionToken() {
    return getSessionToken() !== null;
  }

  // ---- Check access (server-verified) -------------------------
  async function checkAccess() {
    const result = await verifySessionWithServer();
    return result.valid === true;
  }

  function markAsAdmin() {
    // Admin session is already stored via setAdminToken. For UI state,
    // also grant local access so the app renders without a second call.
    // Server-side admin role is verified by the admin token, not by this flag.
    BTHG.Storage.LS.set('is_admin_ui', true);
  }

  // ---- Timer widget -------------------------------------------
  function startTimer(el) {
    const isAdmin = BTHG.Storage.LS.get('is_admin_ui', false);
    if (isAdmin) {
      el.textContent = 'ADMIN';
      el.style.color = '#d4af37';
      return;
    }
    const expStr = localStorage.getItem(SESSION_KEY + '_exp');
    if (!expStr) { el.textContent = '—'; return; }
    const exp = parseInt(expStr, 10);
    function update() {
      const remainingMs = exp - Date.now();
      if (remainingMs <= 0) {
        el.textContent = 'EXPIRED';
        el.style.color = '#ff3333';
        clearSessionToken();
        setTimeout(() => { window.location.href = LANDING_PAGE + '?expired=1'; }, 2000);
        return;
      }
      const remainingSec = Math.floor(remainingMs / 1000);
      el.textContent = BTHG.formatTimer(remainingSec);
      if (remainingSec < 3600) el.style.color = '#ff3333';
      else if (remainingSec < 7200) el.style.color = '#FFCC1A';
      else el.style.color = '#5EFF00';
      requestAnimationFrame(update);
    }
    update();
  }

  // ---- Init on page load --------------------------------------
  // Returns true when access is granted (or not required on this page),
  // false when the gate screen has been painted. Callers on app.html
  // MUST await this and bail when it returns false.
  async function initPaywall() {
    const params = new URLSearchParams(window.location.search);
    const isAppPage = window.location.pathname.includes('app.html');

    // Fail closed: blank #app-root before any verification so that if
    // JS is slow or throws, nothing protected gets painted.
    if (isAppPage) {
      const root = document.getElementById('app-root');
      if (root) root.innerHTML = '';
    }

    if (params.get('payment') === 'success') {
      handlePaymentSuccess();
      window.history.replaceState({}, '', window.location.pathname);
    }

    const urlKey = params.get('key');
    if (urlKey) {
      const result = await redeemKey(urlKey);
      if (result.success) {
        window.history.replaceState({}, '', window.location.pathname);
        if (!isAppPage) { window.location.href = APP_PAGE; return true; }
      } else {
        showMessage(result.message, 'error');
      }
    }

    if (params.get('expired') === '1' && !isAppPage) {
      showMessage('Your access has expired. Purchase again or enter a new key.', 'warning');
    }

    if (!isAppPage) return true;

    const adminToken = getAdminToken();
    if (adminToken) {
      try {
        const adminRes = await fetch('/api/admin/verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + adminToken,
          },
          body: JSON.stringify({}),
        });
        if (adminRes.ok) {
          markAsAdmin();
          return true;
        }
      } catch {}
      clearAdminToken();
    }

    const result = await verifySessionWithServer();
    if (result.valid) return true;

    showGateScreen();
    return false;
  }

  // ---- In-app gate screen -------------------------------------
  function showGateScreen() {
    const root = document.getElementById('app-root');
    if (!root) return;
    root.innerHTML = `
      <div class="session-setup">
        <div class="setup-logo">
          <div class="css-logo">ROULETTE<br>BREAKER</div>
          <p class="setup-subtitle">Professional Roulette Analytics</p>
        </div>
        <div class="setup-form">
          <p style="color:#FFCC1A;font-weight:700;margin-bottom:1rem;text-align:center;">Access Required</p>
          <div class="setup-field">
            <label>Enter Access Key</label>
            <input type="text" id="gate-key" placeholder="BTHG-XXXX-XXXX..." autocomplete="off">
          </div>
          <button id="gate-redeem" class="btn-gold">Redeem Key</button>
          <div style="text-align:center;margin:1.5rem 0 0.75rem;">
            <span style="color:#444;font-size:0.8rem;">— or —</span>
          </div>
          <button id="gate-admin-toggle" class="btn-outline" style="width:100%;font-size:0.85rem;color:#888;border-color:#333;">
            <i class="fas fa-lock"></i> Admin Login
          </button>
          <div id="gate-admin-section" style="display:none;margin-top:1rem;">
            <div class="setup-field">
              <label>Admin Password</label>
              <input type="password" id="gate-admin-pass" placeholder="Enter admin password" autocomplete="off">
            </div>
            <button id="gate-admin-submit" class="btn-gold">Unlock</button>
          </div>
          <p id="gate-error" style="color:#ff3333;font-size:0.85rem;text-align:center;margin-top:1rem;display:none;"></p>
          <div style="text-align:center;margin-top:1.5rem;">
            <a href="${LANDING_PAGE}" style="color:#666;font-size:0.8rem;text-decoration:underline;">Back to Home</a>
          </div>
        </div>
      </div>
    `;

    const redeemBtn = document.getElementById('gate-redeem');
    redeemBtn.addEventListener('click', async () => {
      const key = document.getElementById('gate-key').value.trim();
      if (!key) return;
      redeemBtn.disabled = true;
      redeemBtn.textContent = 'Verifying...';
      const result = await redeemKey(key);
      redeemBtn.disabled = false;
      redeemBtn.textContent = 'Redeem Key';
      if (result.success) {
        location.reload();
      } else {
        const err = document.getElementById('gate-error');
        err.textContent = result.message;
        err.style.display = 'block';
      }
    });

    document.getElementById('gate-admin-toggle').addEventListener('click', () => {
      const section = document.getElementById('gate-admin-section');
      section.style.display = section.style.display === 'none' ? 'block' : 'none';
    });

    const adminBtn = document.getElementById('gate-admin-submit');
    adminBtn.addEventListener('click', async () => {
      const pass = document.getElementById('gate-admin-pass').value;
      adminBtn.disabled = true;
      adminBtn.textContent = 'Verifying...';
      const result = await adminLogin(pass);
      adminBtn.disabled = false;
      adminBtn.textContent = 'Unlock';
      if (result.success) {
        markAsAdmin();
        location.reload();
      } else {
        const err = document.getElementById('gate-error');
        err.textContent = result.message || 'Wrong password.';
        err.style.display = 'block';
      }
    });

    document.getElementById('gate-key').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('gate-redeem').click();
    });
    document.getElementById('gate-admin-pass').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('gate-admin-submit').click();
    });
  }

  function showMessage(msg, type) {
    let banner = document.getElementById('bthg-message');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'bthg-message';
      banner.style.cssText = 'position:fixed;top:90px;left:50%;transform:translateX(-50%);z-index:9999;padding:1rem 2rem;border-radius:8px;font-family:Inter,sans-serif;font-weight:600;text-align:center;max-width:90%;animation:slideDown 0.3s ease;';
      document.body.appendChild(banner);
    }
    banner.textContent = msg;
    if (type === 'error') {
      banner.style.background = 'rgba(255,50,50,0.9)';
      banner.style.color = '#fff';
    } else if (type === 'warning') {
      banner.style.background = 'rgba(255,180,0,0.9)';
      banner.style.color = '#000';
    } else {
      banner.style.background = 'rgba(0,179,77,0.9)';
      banner.style.color = '#fff';
    }
    banner.style.display = 'block';
    setTimeout(() => { banner.style.display = 'none'; }, 5000);
  }

  function signOut() {
    clearSessionToken();
    clearAdminToken();
    BTHG.Storage.LS.set('is_admin_ui', false);
    window.location.href = LANDING_PAGE;
  }

  // ---- Public API ---------------------------------------------
  // The legacy surface is preserved where possible. `generateKey`
  // is now admin-only and must go through the API; calling it
  // client-side with a duration will throw since there's no secret.
  BTHG.Paywall = {
    checkAccess,              // async, server-verified
    hasSessionToken,          // sync, best-effort
    redeemKey,                // async, server-verified
    startTimer,
    initPaywall,              // async, returns true if access granted
    showGateScreen,           // exposed for fail-closed use from app bootstrap
    showMessage,
    markAsAdmin,
    verifyAdminPassword,      // async
    adminLogin,               // returns { success, message? }
    getAdminToken,
    getSessionToken,
    signOut,
    STRIPE_LINK,
  };

  window.BTHG = BTHG;
})();
