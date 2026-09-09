-- API key store for the India Air Quality API gateway (Cloudflare D1 / SQLite).

CREATE TABLE IF NOT EXISTS users (
  email          TEXT PRIMARY KEY,
  name           TEXT,
  affiliation    TEXT,
  purpose        TEXT,
  wants_upgrade  INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  verified_at    TEXT
);

CREATE TABLE IF NOT EXISTS verify_tokens (
  token_hash  TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  ip          TEXT
);
CREATE INDEX IF NOT EXISTS idx_verify_tokens_email ON verify_tokens(email);

CREATE TABLE IF NOT EXISTS api_keys (
  id           TEXT PRIMARY KEY,          -- first 8 chars of the key body; safe to log
  key_hash     TEXT NOT NULL UNIQUE,      -- sha256(full key); the key itself is never stored
  owner_email  TEXT NOT NULL,
  tier         TEXT NOT NULL DEFAULT 'free',  -- free | research | dashboard | admin
  note         TEXT,
  created_at   TEXT NOT NULL,
  expires_at   TEXT,
  revoked_at   TEXT,
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_keys_owner ON api_keys(owner_email);

CREATE TABLE IF NOT EXISTS usage_daily (
  key_id    TEXT NOT NULL,
  day       TEXT NOT NULL,                -- YYYY-MM-DD (UTC)
  requests  INTEGER NOT NULL DEFAULT 0,
  bytes     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, day)
);
