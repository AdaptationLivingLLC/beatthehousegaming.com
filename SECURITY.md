# BTHG Security Model

## Threat model

Beat The House Gaming sells lifetime access to a professional roulette
analytics app for $24.99. The primary threats are:

1. **Access key forgery** — someone generates valid keys without paying
2. **Account sharing / leak** — a paid key gets distributed to non-payers
3. **Admin account takeover** — unauthorized access to key generation
4. **Lead data exfiltration** — contact form submissions leaked
5. **Webhook replay** — Stripe webhook forged to trigger false key issuance

## Security architecture (v2, 2026-04-08)

### Before (v1 — INSECURE, burned)

The v1 paywall put `HMAC_SECRET` and `ADMIN_HASH` directly in
`js/paywall.js`. Because that file is delivered to every browser,
anyone who viewed page source could:

- Read the HMAC secret
- Generate valid lifetime keys on their own machine
- Brute-force the admin password hash

Once the legacy repo was public the v1 secrets were burned forever.

### After (v2 — server-side)

**All cryptographic secrets live server-side only**, loaded from
Vercel environment variables. The client never sees them:

| Secret | Purpose | Location |
|---|---|---|
| `BTHG_HMAC_SECRET` | Sign/verify access keys | Vercel env only |
| `BTHG_JWT_SECRET` | Sign/verify session JWTs | Vercel env only |
| `BTHG_ADMIN_PASSWORD_HASH` | scrypt hash of admin password | Vercel env only |
| `STRIPE_SECRET_KEY` | Server-side Stripe API | Vercel env only |
| `STRIPE_WEBHOOK_SECRET` | Verify incoming webhook signatures | Vercel env only |
| `DATABASE_URL` | Neon connection string | Vercel env only |
| `RESEND_API_KEY` | Transactional email | Vercel env only |

### Access key lifecycle

```
 Customer                   Stripe                 BTHG backend              Neon DB
     |                        |                         |                      |
     |--Click Buy------------>|                         |                      |
     |                        |--checkout.session.------>                      |
     |                        |  completed (webhook)    |                      |
     |                        |                         |--verify signature--->|
     |                        |                         |--generateKey()       |
     |                        |                         |--INSERT access_keys->|
     |                        |                         |--sendAccessKeyEmail-+
     |<-----------------email: key + launch link------------------------------|
     |                        |                         |                      |
     |--Enter key on site---->|                         |                      |
     |                        |                POST /api/verify-key            |
     |                        |                         |--verify HMAC         |
     |                        |                         |--SELECT access_keys->|
     |                        |                         |--mark used_at        |
     |                        |                         |<--issue session JWT--|
     |<---session JWT---------|                         |                      |
     |                        |                         |                      |
     |--Launch app.html------>|                         |                      |
     |                        |              POST /api/verify-session          |
     |                        |                         |--verify JWT sig      |
     |                        |                         |--check revoked_sessions
     |                        |                         |--check access_keys.revoked
     |                        |                         |<--valid              |
     |<--app renders----------|                         |                      |
```

### Admin key generation

```
 Admin                     BTHG backend              Neon DB
    |                          |                        |
    |--POST /api/admin/login------------>               |
    |                          |--verifyPassword(scrypt)|
    |                          |--log attempt---------->|
    |<--admin JWT---------------|                        |
    |                          |                        |
    |--POST /api/admin/generate-key                     |
    |    Authorization: Bearer <admin-jwt>             |
    |                          |--jwtVerify (role=admin)|
    |                          |--generateKey(days)     |
    |                          |--INSERT access_keys--->|
    |<--key + metadata--------|                         |
```

## Required environment variables

All of these must be set in Vercel **before deploying**. The backend
fails fast on missing env vars rather than silently running insecure.

```
DATABASE_URL                  # Neon pooled connection string
RESEND_API_KEY                # Transactional email API key
RESEND_FROM_EMAIL             # Sender email (with verified domain)
RESEND_REPLY_TO               # Reply-to for customer support
STRIPE_SECRET_KEY             # Restricted key with minimum scopes
STRIPE_WEBHOOK_SECRET         # From Stripe Dashboard webhook endpoint
BTHG_HMAC_SECRET              # 32-byte hex, generated fresh
BTHG_JWT_SECRET               # 32-byte hex, generated fresh
BTHG_ADMIN_PASSWORD_HASH      # scrypt hash from scripts/hash-password.mjs
PUBLIC_SITE_URL               # https://beatthehousegaming.com
PUBLIC_STRIPE_BUY_URL         # Stripe Buy Button URL
SLACK_LEAD_WEBHOOK_URL        # (optional) Slack webhook for lead alerts
```

Generate secrets:
```
node scripts/generate-secrets.mjs      # HMAC + JWT
node scripts/hash-password.mjs         # admin password hash
```

Apply DB schema:
```
DATABASE_URL="..." node scripts/migrate.mjs
```

## Security headers (vercel.json)

- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `Content-Security-Policy` — restricts scripts to self, GTM, GA, Stripe, fonts
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN` (DENY on `/app.html`)
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`

## Rate limits

All public endpoints are rate-limited per IP:

| Endpoint | Limit |
|---|---|
| `/api/capture` | 10 / minute |
| `/api/verify-key` | 5 / minute |
| `/api/verify-session` | 30 / minute |
| `/api/admin/login` | 5 / 15 minutes |
| `/api/admin/generate-key` | 20 / minute |

Note: the in-memory rate limiter is per-serverless-instance. For global
rate limiting across all instances, migrate to Upstash Redis.

## Rotation procedure

If a secret is suspected compromised:

1. Generate new values (`node scripts/generate-secrets.mjs`)
2. Update Vercel env vars
3. Trigger redeploy (any push or manual redeploy)
4. All existing session JWTs immediately invalidate
5. All existing access keys also invalidate (since their HMAC was
   signed with the old secret). Revoked keys still in the DB can be
   individually re-issued by admins via the key generation endpoint,
   then emailed to affected customers.

## Audit

- Every admin login attempt (success OR failure) logged to
  `login_attempts` with IP, timestamp, endpoint
- Every key verification attempt logged to `login_attempts`
- All errors logged to Vercel console (without leaking secrets)
- Suspicious patterns (rate-limit hits, repeated failures) visible
  in Vercel logs under the Functions tab

## Never commit

The `.gitignore` blocks:
- `.env` and `.env.*` (except `.env.example`)
- `*.pem`, `*.key`, `*.p12`, `*.crt`
- `secrets/`, `private/`
- Vercel deployment tokens

If you accidentally commit a secret, **rotate it immediately** — do not
rely on git history rewrites to remove it. Assume it has been scraped.
