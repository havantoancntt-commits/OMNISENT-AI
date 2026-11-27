-- Rollback script for PostgreSQL 001_initial.sql
BEGIN;

DROP TABLE IF EXISTS auth_credentials;
DROP TABLE IF EXISTS emergency_stop_state;
DROP TABLE IF EXISTS auto_jobs;
DROP TABLE IF EXISTS auto_execution_state;
DROP TABLE IF EXISTS auto_proposals;
DROP TABLE IF EXISTS pnl_snapshots;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS agent_logs;
DROP TABLE IF EXISTS agent_registry;
DROP TABLE IF EXISTS signals;
DROP TABLE IF EXISTS order_state_events;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS positions;
DROP TABLE IF EXISTS exchange_registry;
DROP TABLE IF EXISTS app_state;
DROP TABLE IF EXISTS schema_migrations;

COMMIT;
