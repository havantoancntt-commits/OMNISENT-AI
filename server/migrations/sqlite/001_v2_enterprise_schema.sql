-- SQLite Enterprise Schema Migration v2
-- Applied automatically by server/db.ts migration runner with pre-migration backup.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_state_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor TEXT NOT NULL,
  metadata_json TEXT,
  timestamp_utc TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_order_state_events_order_id ON order_state_events (order_id, timestamp_utc);

CREATE TABLE IF NOT EXISTS auto_execution_state (
  key TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auto_jobs (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL,
  lock_owner TEXT,
  locked_until_ms INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  dead_letter_reason TEXT,
  payload_json TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auto_jobs_status ON auto_jobs (status, locked_until_ms);

CREATE TABLE IF NOT EXISTS emergency_stop_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active INTEGER NOT NULL DEFAULT 0,
  locked_at_utc TEXT,
  reason TEXT,
  triggered_by TEXT,
  unlocked_at_utc TEXT,
  unlocked_by TEXT
);

CREATE TABLE IF NOT EXISTS auth_credentials (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  role TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at_utc TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at_utc DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (timestamp_utc DESC);
CREATE INDEX IF NOT EXISTS idx_signals_pair_created ON signals (symbol, exchange, created_at_utc DESC);
