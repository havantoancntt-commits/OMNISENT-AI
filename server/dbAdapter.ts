/**
 * Storage & Multi-Instance Adapter Diagnostics.
 * Evaluates DATABASE_URL (PostgreSQL production readiness) vs local SQLite WAL persistence.
 */

export interface StorageBackendStatus {
  activeDriver: 'SQLITE_WAL' | 'POSTGRES_PENDING_DRIVER';
  databaseUrlConfigured: boolean;
  postgresPoolReady: boolean;
  multiInstanceSafe: boolean;
  migrationsDirPostgres: string;
  migrationsDirSqlite: string;
  notes: string;
}

export function resolveStorageBackendStatus(): StorageBackendStatus {
  const dbUrl = process.env.DATABASE_URL?.trim() ?? '';
  const databaseUrlConfigured =
    dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://');

  if (databaseUrlConfigured) {
    return {
      activeDriver: 'SQLITE_WAL',
      databaseUrlConfigured: true,
      postgresPoolReady: false,
      multiInstanceSafe: false,
      migrationsDirPostgres: 'server/migrations/postgres',
      migrationsDirSqlite: 'server/migrations/sqlite',
      notes:
        'DATABASE_URL detected. SQLite WAL remains active locally; apply server/migrations/postgres/001_initial.sql to provision PostgreSQL.',
    };
  }

  return {
    activeDriver: 'SQLITE_WAL',
    databaseUrlConfigured: false,
    postgresPoolReady: false,
    multiInstanceSafe: false,
    migrationsDirPostgres: 'server/migrations/postgres',
    migrationsDirSqlite: 'server/migrations/sqlite',
    notes: 'Local persistent SQLite WAL mode active.',
  };
}
