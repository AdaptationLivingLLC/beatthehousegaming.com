// ============================================================
// paywall.js — Access check, Stripe redirect, key validation, timer
// BTHG Roulette Breaker Web App
// Last modified: 2026-03-07
// ============================================================

(function() {
  const BTHG = window.BTHG;
  const Access = BTHG.Storage.Access;
  const STRIPE_LINK = 'https://buy.stripe.com/8x28wP69u1e97a5de69MY08';
  const LANDING_PAGE = 'bthg.html';
  const APP_PAGE = 'app.html';
  // SHA-256 hash of admin password — plaintext is NEVER stored client-side
  const ADMIN_HASH = 'e9a472f0095b83634eb1dd01a4ce06825087502f65f39684eacef8a16e8ca5ee';
  // Separate HMAC secret for key signing (not the password)
  const HMAC_SECRET = '8050f1fa516710d92fd58865d10627568e30efdeb2920de02cffe3fdeb486c5b';
  const DAY_MS = 24 * 60 * 60 * 1000;

  // ---- Hash a password string to SHA-256 hex --------------------
  async function hashPassword(password) {
    const enc = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', enc.encode(password));
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ---- Verify admin password against stored hash ----------------
  async function verifyAdminPassword(input) {
    const inputHash = await hashPassword(input);
    return inputHash === ADMIN_HASH;
  }

  // ---- HMAC Key Derivation (Web Crypto) -----------------------
  async function getHmacKey() {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw', enc.encode(HMAC_SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
    );
    return keyMaterial;
  }

  function buf2hex(buffer) {
    return Array.from(new Uint8Array(buffer))
      .map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function hex2buf(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2)
      bytes[i/2] = parseInt(hex.substring(i, i+2), 16);
    return bytes.buffer;
  }

  // ---- Key Format: BTHG-<payload>-<sig> -----------------------
  // Payload = base64url( JSON{ created, durationDays } )
  // Sig = first 8 hex chars of HMAC-SHA256(payload, adminPassword)

  function base64urlEncode(str) {
    return btoa(str).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  function base64urlDecode(str) {
    str = str.replace(/-/g,'+').replace(/_/g,'/');
    while (str.length % 4) str += '=';
    return atob(str);
  }

  async function generateKey(durationDays) {
    const payload = base64urlEncode(JSON.stringify({
      created: Date.now(),
      durationDays: durationDays
    }));
    const hmacKey = await getHmacKey();
    const sig = await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(payload));
    const sigHex = buf2hex(sig).substring(0, 16);
    // Format into readable chunks
    const raw = payload + '.' + sigHex;
    // Make it look like BTHG-XXXX-XXXX-...
    const chunks = [];
    for (let i = 0; i < raw.length; i += 6) {
      chunks.push(raw.substring(i, i + 6));
    }
    return 'BTHG-' + chunks.join('-');
  }

  async function validateKey(keyStr) {
    if (!keyStr || !keyStr.startsWith('BTHG-')) return null;
    // Check if already used
    if (Access.isKeyUsed(keyStr)) return { error: 'Key already used' };
    // Parse
    const raw = keyStr.replace('BTHG-','').replace(/-/g,'');
    const dotIdx = raw.lastIndexOf('.');
    // Find the dot separator — it's encoded in the raw string
    // Actually the raw is payload.sigHex joined, we need to find the split
    const parts = keyStr.replace('BTHG-','').replace(/-/g,'');
    const sigLen = 16; // 16 hex chars
    const payloadPart = parts.substring(0, parts.length - 1 - sigLen); // before the dot
    const dotAndSig = parts.substring(parts.length - 1 - sigLen);

    // Better approach: reconstruct from the formatted key
    const stripped = keyStr.substring(5).replace(/-/g, ''); // remove "BTHG-" and dashes
    const lastDot = stripped.lastIndexOf('.');
    if (lastDot === -1) return null;
    const payload = stripped.substring(0, lastDot);
    const sigHex = stripped.substring(lastDot + 1);

    try {
      const dataStr = base64urlDecode(payload);
      const data = JSON.parse(dataStr);
      if (!data.created || !data.durationDays) return null;
      // Verify HMAC
      const hmacKey = await getHmacKey();
      const sig = await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(payload));
      const expectedSig = buf2hex(sig).substring(0, 16);
      if (sigHex !== expectedSig) return { error: 'Invalid key signature' };
      // Check if expired (key creation + duration)
      const expiresAt = data.created + (data.durationDays * DAY_MS);
      if (Date.now() > expiresAt) return { error: 'Key has expired' };
      return { valid: true, durationDays: data.durationDays, created: data.created, expiresAt };
    } catch(e) {
      return null;
    }
  }

  // ---- Access Check -------------------------------------------
  function checkAccess() {
    // Admin bypass: once you've accessed the admin panel, you're always in
    if (BTHG.Storage.LS.get('is_admin', false)) {
      // Auto-renew 30 days of access silently
      if (!Access.isValid()) {
        Access.grantAccess(30 * DAY_MS);
      }
      return true;
    }
    return Access.isValid();
  }

  function markAsAdmin() {
    BTHG.Storage.LS.set('is_admin', true);
    Access.grantAccess(30 * DAY_MS);
  }

  function grantPaymentAccess() {
    // $24.99 = permanent access. Use a 100-year duration as the "forever" key
    // until the new BTHG site lands with real user accounts + Stripe webhook gating.
    Access.grantAccess(36500 * DAY_MS);
  }

  async function redeemKey(keyStr) {
    const result = await validateKey(keyStr);
    if (!result) return { success: false, message: 'Invalid key format' };
    if (result.error) return { success: false, message: result.error };
    // Grant access
    Access.grantAccess(result.durationDays * DAY_MS);
    Access.markKeyUsed(keyStr);
    return { success: true, days: result.durationDays };
  }

  // ---- Timer Widget -------------------------------------------
  function startTimer(el) {
    const isAdmin = BTHG.Storage.LS.get('is_admin', false);
    if (isAdmin) {
      el.textContent = 'ADMIN';
      el.style.color = '#d4af37';
      return;
    }
    function update() {
      const remaining = Access.remainingSeconds();
      if (remaining <= 0) {
        el.textContent = 'EXPIRED';
        el.style.color = '#ff3333';
        setTimeout(() => {
          window.location.href = LANDING_PAGE + '?expired=1';
        }, 2000);
        return;
      }
      el.textContent = BTHG.formatTimer(remaining);
      if (remaining < 3600) el.style.color = '#ff3333';
      else if (remaining < 7200) el.style.color = '#FFCC1A';
      else el.style.color = '#5EFF00';
      requestAnimationFrame(update);
    }
    update();
  }

  // ---- Page Init Logic ----------------------------------------
  function initPaywall() {
    const params = new URLSearchParams(window.location.search);
    const isAppPage = window.location.pathname.includes('app.html');

    // Handle Stripe payment success
    if (params.get('payment') === 'success' && isAppPage) {
      grantPaymentAccess();
      // Clean URL
      window.history.replaceState({}, '', 'app.html');
    }

    // Handle key in URL
    const urlKey = params.get('key');
    if (urlKey) {
      redeemKey(urlKey).then(result => {
        if (result.success) {
          if (!isAppPage) window.location.href = APP_PAGE;
          else window.history.replaceState({}, '', 'app.html');
        } else {
          showMessage(result.message, 'error');
        }
      });
      return;
    }

    // Check expired redirect
    if (params.get('expired') === '1' && !isAppPage) {
      showMessage('Your access has expired. Purchase again or enter a new key.', 'warning');
    }

    // Gate app page
    if (isAppPage && !checkAccess()) {
      // Check if admin mode via URL param
      if (params.get('admin')) return; // admin-keygen handles its own auth
      // Show in-app gate screen instead of redirecting
      showGateScreen();
      return;
    }
  }

  // ---- In-App Gate Screen (replaces redirect) -------------------
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

    // Redeem key
    document.getElementById('gate-redeem').addEventListener('click', async () => {
      const key = document.getElementById('gate-key').value.trim();
      if (!key) return;
      const result = await redeemKey(key);
      if (result.success) {
        location.reload();
      } else {
        const err = document.getElementById('gate-error');
        err.textContent = result.message;
        err.style.display = 'block';
      }
    });

    // Admin toggle
    document.getElementById('gate-admin-toggle').addEventListener('click', () => {
      const section = document.getElementById('gate-admin-section');
      section.style.display = section.style.display === 'none' ? 'block' : 'none';
    });

    // Admin submit
    document.getElementById('gate-admin-submit').addEventListener('click', async () => {
      const pass = document.getElementById('gate-admin-pass').value;
      if (await verifyAdminPassword(pass)) {
        markAsAdmin();
        location.reload();
      } else {
        const err = document.getElementById('gate-error');
        err.textContent = 'Wrong password.';
        err.style.display = 'block';
      }
    });

    // Enter key support
    document.getElementById('gate-key').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('gate-redeem').click();
    });
    document.getElementById('gate-admin-pass').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('gate-admin-submit').click();
    });
  }

  function showMessage(msg, type) {
    // Find or create message banner
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

  // ---- Public API ---------------------------------------------
  BTHG.Paywall = {
    checkAccess,
    grantPaymentAccess,
    redeemKey,
    validateKey,
    generateKey,
    startTimer,
    initPaywall,
    showMessage,
    markAsAdmin,
    verifyAdminPassword,
    STRIPE_LINK,
  };

  window.BTHG = BTHG;
})();
