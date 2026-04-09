-- ============================================================
-- BTHG database schema — run against Neon Postgres
-- Execute with: psql $DATABASE_URL -f migrations/001_init.sql
-- Or use: pnpm migrate
-- ============================================================

-- Access keys issued to paying customers and admin-generated trials
CREATE TABLE IF NOT EXISTS access_keys (
  id            BIGSERIAL PRIMARY KEY,
  jti           TEXT NOT NULL UNIQUE,           -- unique key identifier (from HMAC payload)
  key_hash      TEXT NOT NULL UNIQUE,           -- SHA-256 hash of the full key string
  email         TEXT,                           -- paying customer email (null for admin-issued)
  duration_days INTEGER NOT NULL,
  issued_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,                    -- first time the key was redeemed
  revoked_at    TIMESTAMPTZ,                    -- null = active, timestamp = manually revoked
  source        TEXT NOT NULL,                  -- 'stripe' | 'admin' | 'import'
  stripe_session_id TEXT UNIQUE,                -- for dedup on webhook retries
  metadata      JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_access_keys_email      ON access_keys(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_access_keys_expires_at ON access_keys(expires_at) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_access_keys_source     ON access_keys(source);

-- Lead capture from marketing forms
CREATE TABLE IF NOT EXISTS leads (
  id         BIGSERIAL PRIMARY KEY,
  source     TEXT NOT NULL,                    -- which form submitted
  email      TEXT,
  name       TEXT,
  phone      TEXT,
  message    TEXT,
  payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_email      ON leads(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_source     ON leads(source);

-- Login attempts for rate limiting and audit
CREATE TABLE IF NOT EXISTS login_attempts (
  id         BIGSERIAL PRIMARY KEY,
  ip_address INET NOT NULL,
  endpoint   TEXT NOT NULL,                    -- 'admin' | 'key'
  success    BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time ON login_attempts(ip_address, created_at DESC);

-- Revoked session JWT IDs (for emergency logout across devices)
CREATE TABLE IF NOT EXISTS revoked_sessions (
  jti        TEXT PRIMARY KEY,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason     TEXT
);
