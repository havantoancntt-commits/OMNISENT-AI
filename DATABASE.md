# Database Persistence & Migration Guide

## 1. Local Persistent Engine (SQLite WAL)

By default (`.data/omnisent.db` or `$OMNISENT_DATA_DIR/omnisent.db`), OMNISENT AI runs **better-sqlite3 / Node SQLite (`node:sqlite` DatabaseSync)** with:
- `PRAGMA journal_mode = WAL;`
- `PRAGMA synchronous = NORMAL;`
- `PRAGMA foreign_keys = ON;`
- `PRAGMA busy_timeout = 5000;`
- Automatic corruption detection & quarantine (`openDatabaseWithRecovery()`)
- Atomic transaction wrapper (`runInTransaction()` using `BEGIN IMMEDIATE ... COMMIT / ROLLBACK`)

## 2. Versioned Schema Migrations

- **SQLite Migration**: `server/migrations/sqlite/001_v2_enterprise_schema.sql` tracked in the `schema_migrations` table, with automatic pre-migration `.bak.<timestamp>` backup creation on legacy databases.
- **PostgreSQL Migration & Rollback**: `server/migrations/postgres/001_initial.sql` and `server/migrations/postgres/001_rollback.sql` define the full relational DDL (`portfolio_state`, `positions`, `orders`, `order_state_events`, `risk_config`, `auto_execution_config`, `auto_execution_state`, `auto_jobs`, `emergency_stop_state`, `auth_credentials`, `exchanges`, `audit_logs`, etc.).

### Honest Multi-Instance PostgreSQL Status
- `server/dbAdapter.ts` (`resolveStorageBackendStatus()`) checks `DATABASE_URL`.
- Note: A live PostgreSQL server and Redis server are **not** bundled or running inside the local development sandbox; when `DATABASE_URL` is absent or external instances are unprovisioned, SQLite WAL remains the active runtime persistence engine and external database connectivity must be verified in the target cloud environment after provisioning.
