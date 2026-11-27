-- PostgreSQL Production Initial Schema v1
-- Target: PostgreSQL 15+ (multi-instance production deployment via DATABASE_URL)

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at_utc TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exchange_registry (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  connection_status TEXT NOT NULL,
  api_status TEXT NOT NULL,
  supported_markets JSONB NOT NULL,
  ws_status TEXT NOT NULL,
  api_latency_ms INTEGER NOT NULL DEFAULT 0,
  last_sync_utc TIMESTAMPTZ NOT NULL,
  data_health TEXT NOT NULL,
  maker_fee_bps DOUBLE PRECISION NOT NULL,
  taker_fee_bps DOUBLE PRECISION NOT NULL,
  encrypted_credentials TEXT,
  masked_api_key TEXT,
  permissions_json JSONB NOT NULL,
  environment TEXT NOT NULL DEFAULT 'MAINNET',
  verification_status TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
  last_verified_utc TIMESTAMPTZ,
  verification_note TEXT,
  account_equity_summary_usd DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  exchange TEXT NOT NULL,
  market_type TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('LONG', 'SHORT')),
  quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
  entry_price DOUBLE PRECISION NOT NULL CHECK (entry_price > 0),
  mark_price DOUBLE PRECISION NOT NULL CHECK (mark_price > 0),
  stop_loss DOUBLE PRECISION NOT NULL CHECK (stop_loss > 0),
  initial_stop_loss DOUBLE PRECISION,
  take_price DOUBLE PRECISION NOT NULL CHECK (take_price > 0),
  leverage DOUBLE PRECISION NOT NULL CHECK (leverage >= 1),
  margin_usd DOUBLE PRECISION NOT NULL CHECK (margin_usd >= 0),
  unrealized_pnl_usd DOUBLE PRECISION NOT NULL,
  unrealized_pnl_pct DOUBLE PRECISION NOT NULL,
  liquidation_price DOUBLE PRECISION,
  funding_paid_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  strategy_name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('PAPER', 'LIVE')),
  opened_at_utc TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT UNIQUE NOT NULL,
  symbol TEXT NOT NULL,
  exchange TEXT NOT NULL,
  market_type TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('LONG', 'SHORT')),
  order_type TEXT NOT NULL,
  quantity DOUBLE PRECISION NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  stop_loss DOUBLE PRECISION NOT NULL,
  take_profit DOUBLE PRECISION NOT NULL,
  leverage DOUBLE PRECISION NOT NULL,
  fees_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  slippage_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('PAPER', 'LIVE')),
  strategy_name TEXT NOT NULL,
  risk_decision TEXT NOT NULL,
  created_at_utc TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_state_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_state TEXT,
  to_state TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor TEXT NOT NULL,
  metadata_json JSONB,
  timestamp_utc TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pg_order_state_events_order ON order_state_events (order_id, timestamp_utc);

CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  exchange TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  created_at_utc TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_registry (
  id TEXT PRIMARY KEY,
  payload_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_logs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  timestamp_utc TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT NOT NULL,
  timestamp_utc TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pg_audit_logs_ts ON audit_logs (timestamp_utc DESC);

CREATE TABLE IF NOT EXISTS pnl_snapshots (
  id BIGSERIAL PRIMARY KEY,
  timestamp_ms BIGINT NOT NULL,
  timestamp_utc TIMESTAMPTZ NOT NULL,
  realized_pnl_usd DOUBLE PRECISION NOT NULL,
  unrealized_pnl_usd DOUBLE PRECISION NOT NULL,
  net_pnl_usd DOUBLE PRECISION NOT NULL,
  total_equity_usd DOUBLE PRECISION NOT NULL,
  open_positions_count INTEGER NOT NULL,
  event_tag TEXT
);
CREATE INDEX IF NOT EXISTS idx_pg_pnl_snapshots_ts ON pnl_snapshots (timestamp_ms DESC);

CREATE TABLE IF NOT EXISTS auto_proposals (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at_utc TIMESTAMPTZ NOT NULL,
  expires_at_utc TIMESTAMPTZ NOT NULL,
  payload_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS auto_execution_state (
  key TEXT PRIMARY KEY,
  payload_json JSONB NOT NULL,
  updated_at_utc TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auto_jobs (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL,
  lock_owner TEXT,
  locked_until_ms BIGINT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  dead_letter_reason TEXT,
  payload_json JSONB,
  created_at_utc TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at_utc TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS emergency_stop_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active BOOLEAN NOT NULL DEFAULT FALSE,
  locked_at_utc TIMESTAMPTZ,
  reason TEXT,
  triggered_by TEXT,
  unlocked_at_utc TIMESTAMPTZ,
  unlocked_by TEXT
);

CREATE TABLE IF NOT EXISTS auth_credentials (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  role TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at_utc TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (version, name) VALUES (1, '001_initial')
ON CONFLICT (version) DO NOTHING;

COMMIT;
