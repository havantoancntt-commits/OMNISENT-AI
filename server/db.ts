import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  clampAutoExecutionConfig,
  DEFAULT_AUTO_EXECUTION_CONFIG,
  syncAutoConfigWithTradingMode,
} from '../src/engine/autoExecutionEngine.ts';
import { createInitialAgentRegistry } from '../src/engine/multiAgentPipeline.ts';
import { dedupeSignalsByPair } from '../src/engine/pairSelection.ts';
import { DEFAULT_RISK_CONFIG } from '../src/engine/riskEngine.ts';
import type {
  AgentLogEntry,
  AgentState,
  AuditLogEntry,
  AutoExecutionConfig,
  AutoExecutionProposal,
  AutoProposalStatus,
  ExchangeEnvironment,
  ExchangeInfo,
  ExchangeVerificationStatus,
  OrderRecord,
  PnlHistoryPoint,
  PortfolioSummary,
  Position,
  RiskConfig,
  TradingMode,
  TradingSignal,
} from '../src/engine/types.ts';

function resolveWritableDataDir(): string {
  if (process.env.OMNISENT_DATA_DIR) {
    const customDir = path.resolve(process.env.OMNISENT_DATA_DIR);
    fs.mkdirSync(customDir, { recursive: true });
    return customDir;
  }
  const preferredDir = path.resolve(process.cwd(), '.data');
  if (!process.env.VERCEL && !process.env.VERCEL_ENV) {
    try {
      if (!fs.existsSync(preferredDir)) {
        fs.mkdirSync(preferredDir, { recursive: true });
      }
      fs.accessSync(preferredDir, fs.constants.W_OK);
      return preferredDir;
    } catch {
      // Fall through to OS temp dir if workspace cwd is read-only
    }
  }
  const tmpDir = path.join(os.tmpdir(), 'omnisent-data');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  return tmpDir;
}

const DATA_DIR = resolveWritableDataDir();
const DB_PATH = path.join(DATA_DIR, 'omnisent.db');

export function openDatabaseWithRecovery(dbPath: string): DatabaseSync {
  const attempt = new DatabaseSync(dbPath);
  try {
    const check = attempt.prepare('PRAGMA quick_check;').get() as { quick_check?: string } | undefined;
    if (check?.quick_check !== 'ok') {
      throw new Error(`SQLite quick_check failed: ${check?.quick_check ?? 'unknown'}`);
    }
    attempt.prepare('SELECT COUNT(*) as c FROM sqlite_master;').get();
    return attempt;
  } catch (err) {
    try {
      attempt.close();
    } catch {
      // ignore close failure on corrupt handle
    }
    const quarantineSuffix = `.corrupt.${Date.now()}`;
    for (const suffix of ['', '-wal', '-shm']) {
      const src = `${dbPath}${suffix}`;
      if (fs.existsSync(src)) {
        try {
          fs.renameSync(src, `${src}${quarantineSuffix}`);
        } catch {
          try {
            fs.unlinkSync(src);
          } catch {
            // ignore
          }
        }
      }
    }
    console.warn(
      `[DB] Detected malformed SQLite image (${err instanceof Error ? err.message : String(err)}); quarantined and created fresh database.`,
    );
    return new DatabaseSync(dbPath);
  }
}

export const db = openDatabaseWithRecovery(DB_PATH);

export function checkpointDatabase(mode: 'PASSIVE' | 'TRUNCATE' = 'PASSIVE'): void {
  try {
    db.exec(`PRAGMA wal_checkpoint(${mode});`);
  } catch {
    // ignore checkpoint errors during teardown
  }
}

let stateRevision = 1;
export function getStateRevision(): number {
  return stateRevision;
}
export function bumpStateRevision(): number {
  stateRevision += 1;
  return stateRevision;
}

export function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

let transactionDepth = 0;
export function runInTransaction<T>(fn: () => T): T {
  if (transactionDepth > 0) {
    transactionDepth += 1;
    try {
      return fn();
    } finally {
      transactionDepth -= 1;
    }
  }
  db.exec('BEGIN IMMEDIATE;');
  transactionDepth = 1;
  try {
    const result = fn();
    db.exec('COMMIT;');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // ignore rollback error
    }
    throw err;
  } finally {
    transactionDepth = 0;
  }
}

export function getDatabaseDiagnostics(): {
  healthy: boolean;
  journalMode: string;
  isEphemeralStorage: boolean;
  dataDir: string;
  openPositions: number;
  totalOrders: number;
} {
  const check = db.prepare('PRAGMA quick_check;').get() as { quick_check?: string } | undefined;
  const journal = db.prepare('PRAGMA journal_mode;').get() as { journal_mode?: string } | undefined;
  const posCount = (db.prepare('SELECT COUNT(*) as c FROM positions').get() as { c: number }).c;
  const ordCount = (db.prepare('SELECT COUNT(*) as c FROM orders').get() as { c: number }).c;
  const normalizedTmp = path.resolve(os.tmpdir());
  const isEphemeralStorage =
    Boolean(process.env.VERCEL || process.env.VERCEL_ENV) ||
    path.resolve(DATA_DIR).startsWith(normalizedTmp);
  return {
    healthy: check?.quick_check === 'ok',
    journalMode: journal?.journal_mode ?? 'unknown',
    isEphemeralStorage,
    dataDir: DATA_DIR,
    openPositions: posCount,
    totalOrders: ordCount,
  };
}

export function initDatabase(): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS exchange_registry (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      connection_status TEXT NOT NULL,
      api_status TEXT NOT NULL,
      supported_markets TEXT NOT NULL,
      ws_status TEXT NOT NULL,
      api_latency_ms INTEGER NOT NULL,
      last_sync_utc TEXT NOT NULL,
      data_health TEXT NOT NULL,
      maker_fee_bps REAL NOT NULL,
      taker_fee_bps REAL NOT NULL,
      encrypted_credentials TEXT,
      masked_api_key TEXT,
      permissions_json TEXT NOT NULL,
      environment TEXT NOT NULL DEFAULT 'MAINNET',
      verification_status TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
      last_verified_utc TEXT,
      verification_note TEXT,
      account_equity_summary_usd REAL
    );

    CREATE TABLE IF NOT EXISTS positions (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      exchange TEXT NOT NULL,
      market_type TEXT NOT NULL,
      side TEXT NOT NULL,
      quantity REAL NOT NULL,
      entry_price REAL NOT NULL,
      mark_price REAL NOT NULL,
      stop_loss REAL NOT NULL,
      take_price REAL NOT NULL,
      leverage REAL NOT NULL,
      margin_usd REAL NOT NULL,
      unrealized_pnl_usd REAL NOT NULL,
      unrealized_pnl_pct REAL NOT NULL,
      liquidation_price REAL,
      funding_paid_usd REAL NOT NULL,
      strategy_name TEXT NOT NULL,
      mode TEXT NOT NULL,
      opened_at_utc TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT UNIQUE NOT NULL,
      symbol TEXT NOT NULL,
      exchange TEXT NOT NULL,
      market_type TEXT NOT NULL,
      side TEXT NOT NULL,
      order_type TEXT NOT NULL,
      quantity REAL NOT NULL,
      price REAL NOT NULL,
      stop_loss REAL NOT NULL,
      take_profit REAL NOT NULL,
      leverage REAL NOT NULL,
      fees_usd REAL NOT NULL,
      slippage_usd REAL NOT NULL,
      status TEXT NOT NULL,
      mode TEXT NOT NULL,
      strategy_name TEXT NOT NULL,
      risk_decision TEXT NOT NULL,
      created_at_utc TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS signals (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      exchange TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at_utc TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_registry (
      id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_logs (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      timestamp_utc TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      severity TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT NOT NULL,
      timestamp_utc TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pnl_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp_ms INTEGER NOT NULL,
      timestamp_utc TEXT NOT NULL,
      realized_pnl_usd REAL NOT NULL,
      unrealized_pnl_usd REAL NOT NULL,
      net_pnl_usd REAL NOT NULL,
      total_equity_usd REAL NOT NULL,
      open_positions_count INTEGER NOT NULL,
      event_tag TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_pnl_snapshots_ts ON pnl_snapshots (timestamp_ms);

    CREATE TABLE IF NOT EXISTS auto_proposals (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at_utc TEXT NOT NULL,
      expires_at_utc TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
  `);

  try {
    const integrity = db.prepare('PRAGMA quick_check;').all() as Array<{ quick_check?: string }>;
    if (integrity.length !== 1 || integrity[0]?.quick_check !== 'ok') {
      db.exec('REINDEX;');
      db.exec('VACUUM;');
    }
  } catch (err) {
    console.warn(
      '[DB] Startup integrity check/repair warning:',
      err instanceof Error ? err.message : String(err),
    );
  }

  const nowIso = new Date().toISOString();

  const existingMode = db.prepare('SELECT value FROM app_state WHERE key = ?').get('trading_mode');
  if (!existingMode) {
    db.prepare('INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?)').run(
      'trading_mode',
      JSON.stringify('FULL_AUTO'),
      nowIso,
    );
  }

  const existingRisk = db.prepare('SELECT value FROM app_state WHERE key = ?').get('risk_config');
  if (!existingRisk) {
    db.prepare('INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?)').run(
      'risk_config',
      JSON.stringify(DEFAULT_RISK_CONFIG),
      nowIso,
    );
  }

  const existingAutoCfg = db.prepare('SELECT value FROM app_state WHERE key = ?').get('auto_exec_config');
  if (!existingAutoCfg) {
    db.prepare('INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?)').run(
      'auto_exec_config',
      JSON.stringify(DEFAULT_AUTO_EXECUTION_CONFIG),
      nowIso,
    );
  }

  const existingPortfolio = db
    .prepare('SELECT value FROM app_state WHERE key = ?')
    .get('portfolio_summary');
  if (!existingPortfolio) {
    const initialPortfolio: PortfolioSummary = {
      mode: 'FULL_AUTO',
      initialEquityUsd: 100_000,
      totalEquityUsd: 100_000,
      availableBalanceUsd: 100_000,
      usedMarginUsd: 0,
      realizedPnlUsd: 0,
      unrealizedPnlUsd: 0,
      totalFeesUsd: 0,
      dailyPnlPct: 0,
      weeklyPnlPct: 0,
      peakEquityUsd: 100_000,
      currentDrawdownPct: 0,
      winCount: 0,
      lossCount: 0,
      totalClosedTrades: 0,
      winRatePct: null,
    };
    db.prepare('INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?)').run(
      'portfolio_summary',
      JSON.stringify(initialPortfolio),
      nowIso,
    );
  }

  const snapCount = db.prepare('SELECT COUNT(*) as c FROM pnl_snapshots').get() as { c: number };
  if (snapCount.c === 0) {
    const portRow = getPortfolioSummary();
    const openCnt = (db.prepare('SELECT COUNT(*) as c FROM positions').get() as { c: number }).c;
    const nowMs = Date.now();
    recordPnlSnapshot({
      timestampMs: nowMs,
      timestampUtc: new Date(nowMs).toISOString(),
      realizedPnlUsd: portRow.realizedPnlUsd,
      unrealizedPnlUsd: portRow.unrealizedPnlUsd,
      netPnlUsd: Number((portRow.realizedPnlUsd + portRow.unrealizedPnlUsd).toFixed(2)),
      totalEquityUsd: portRow.totalEquityUsd,
      openPositionsCount: openCnt,
      eventTag: 'SESSION_BOOT',
    });
  }

  // Safe SQLite migration for exchange_registry columns on existing databases
  const exchangeColumns = db
    .prepare('PRAGMA table_info(exchange_registry)')
    .all() as Array<{ name: string }>;
  const existingCols = new Set(exchangeColumns.map((c) => c.name));
  const migrations: Array<{ col: string; sql: string }> = [
    {
      col: 'environment',
      sql: "ALTER TABLE exchange_registry ADD COLUMN environment TEXT NOT NULL DEFAULT 'MAINNET'",
    },
    {
      col: 'verification_status',
      sql: "ALTER TABLE exchange_registry ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'NOT_CONFIGURED'",
    },
    {
      col: 'last_verified_utc',
      sql: 'ALTER TABLE exchange_registry ADD COLUMN last_verified_utc TEXT',
    },
    {
      col: 'verification_note',
      sql: 'ALTER TABLE exchange_registry ADD COLUMN verification_note TEXT',
    },
    {
      col: 'account_equity_summary_usd',
      sql: 'ALTER TABLE exchange_registry ADD COLUMN account_equity_summary_usd REAL',
    },
  ];
  for (const mig of migrations) {
    if (!existingCols.has(mig.col)) {
      db.exec(mig.sql);
    }
  }

  // Safe SQLite migration for positions.initial_stop_loss
  const posColumns = db
    .prepare('PRAGMA table_info(positions)')
    .all() as Array<{ name: string }>;
  if (!posColumns.some((c) => c.name === 'initial_stop_loss')) {
    db.exec('ALTER TABLE positions ADD COLUMN initial_stop_loss REAL');
  }

  // Seed Exchange Registry
  const exCount = db.prepare('SELECT COUNT(*) as c FROM exchange_registry').get() as { c: number };
  if (exCount.c === 0) {
    type SeedExchange = Omit<
      ExchangeInfo,
      | 'hasApiKeyConfigured'
      | 'maskedApiKey'
      | 'environment'
      | 'verificationStatus'
      | 'lastVerifiedUtc'
      | 'verificationNote'
      | 'accountEquitySummaryUsd'
    >;
    const exchanges: SeedExchange[] = [
      {
        id: 'binance',
        name: 'Binance',
        connectionStatus: 'PUBLIC_ONLY',
        apiStatus: 'OPERATIONAL',
        supportedMarkets: ['SPOT', 'FUTURES', 'PERPETUAL', 'MARGIN'],
        wsStatus: 'OFFLINE',
        apiLatencyMs: 0,
        lastSyncUtc: nowIso,
        dataHealth: 'UNKNOWN',
        permissions: { read: true, spotTrade: false, futuresTrade: false, withdrawalBlocked: true },
        makerFeeBps: 2,
        takerFeeBps: 5,
      },
      {
        id: 'bybit',
        name: 'Bybit',
        connectionStatus: 'PUBLIC_ONLY',
        apiStatus: 'OPERATIONAL',
        supportedMarkets: ['SPOT', 'FUTURES', 'PERPETUAL'],
        wsStatus: 'OFFLINE',
        apiLatencyMs: 0,
        lastSyncUtc: nowIso,
        dataHealth: 'UNKNOWN',
        permissions: { read: true, spotTrade: false, futuresTrade: false, withdrawalBlocked: true },
        makerFeeBps: 2,
        takerFeeBps: 5.5,
      },
      {
        id: 'okx',
        name: 'OKX',
        connectionStatus: 'PUBLIC_ONLY',
        apiStatus: 'OPERATIONAL',
        supportedMarkets: ['SPOT', 'FUTURES', 'PERPETUAL', 'MARGIN'],
        wsStatus: 'OFFLINE',
        apiLatencyMs: 0,
        lastSyncUtc: nowIso,
        dataHealth: 'UNKNOWN',
        permissions: { read: true, spotTrade: false, futuresTrade: false, withdrawalBlocked: true },
        makerFeeBps: 2,
        takerFeeBps: 5,
      },
      {
        id: 'kraken',
        name: 'Kraken',
        connectionStatus: 'PUBLIC_ONLY',
        apiStatus: 'OPERATIONAL',
        supportedMarkets: ['SPOT', 'FUTURES', 'MARGIN'],
        wsStatus: 'OFFLINE',
        apiLatencyMs: 0,
        lastSyncUtc: nowIso,
        dataHealth: 'UNKNOWN',
        permissions: { read: true, spotTrade: false, futuresTrade: false, withdrawalBlocked: true },
        makerFeeBps: 16,
        takerFeeBps: 26,
      },
      {
        id: 'coinbase',
        name: 'Coinbase Advanced',
        connectionStatus: 'PUBLIC_ONLY',
        apiStatus: 'OPERATIONAL',
        supportedMarkets: ['SPOT', 'FUTURES'],
        wsStatus: 'OFFLINE',
        apiLatencyMs: 0,
        lastSyncUtc: nowIso,
        dataHealth: 'UNKNOWN',
        permissions: { read: true, spotTrade: false, futuresTrade: false, withdrawalBlocked: true },
        makerFeeBps: 10,
        takerFeeBps: 20,
      },
      {
        id: 'bitget',
        name: 'Bitget',
        connectionStatus: 'DISCONNECTED',
        apiStatus: 'OPERATIONAL',
        supportedMarkets: ['SPOT', 'FUTURES', 'PERPETUAL'],
        wsStatus: 'OFFLINE',
        apiLatencyMs: 0,
        lastSyncUtc: nowIso,
        dataHealth: 'UNKNOWN',
        permissions: { read: false, spotTrade: false, futuresTrade: false, withdrawalBlocked: true },
        makerFeeBps: 2,
        takerFeeBps: 6,
      },
      {
        id: 'kucoin',
        name: 'KuCoin',
        connectionStatus: 'DISCONNECTED',
        apiStatus: 'OPERATIONAL',
        supportedMarkets: ['SPOT', 'FUTURES', 'MARGIN'],
        wsStatus: 'OFFLINE',
        apiLatencyMs: 0,
        lastSyncUtc: nowIso,
        dataHealth: 'UNKNOWN',
        permissions: { read: false, spotTrade: false, futuresTrade: false, withdrawalBlocked: true },
        makerFeeBps: 2,
        takerFeeBps: 6,
      },
      {
        id: 'gateio',
        name: 'Gate.io',
        connectionStatus: 'DISCONNECTED',
        apiStatus: 'OPERATIONAL',
        supportedMarkets: ['SPOT', 'FUTURES', 'PERPETUAL'],
        wsStatus: 'OFFLINE',
        apiLatencyMs: 0,
        lastSyncUtc: nowIso,
        dataHealth: 'UNKNOWN',
        permissions: { read: false, spotTrade: false, futuresTrade: false, withdrawalBlocked: true },
        makerFeeBps: 2,
        takerFeeBps: 5,
      },
      {
        id: 'mexc',
        name: 'MEXC',
        connectionStatus: 'DISCONNECTED',
        apiStatus: 'OPERATIONAL',
        supportedMarkets: ['SPOT', 'FUTURES', 'PERPETUAL'],
        wsStatus: 'OFFLINE',
        apiLatencyMs: 0,
        lastSyncUtc: nowIso,
        dataHealth: 'UNKNOWN',
        permissions: { read: false, spotTrade: false, futuresTrade: false, withdrawalBlocked: true },
        makerFeeBps: 0,
        takerFeeBps: 2,
      },
      {
        id: 'htx',
        name: 'HTX',
        connectionStatus: 'DISCONNECTED',
        apiStatus: 'OPERATIONAL',
        supportedMarkets: ['SPOT', 'FUTURES'],
        wsStatus: 'OFFLINE',
        apiLatencyMs: 0,
        lastSyncUtc: nowIso,
        dataHealth: 'UNKNOWN',
        permissions: { read: false, spotTrade: false, futuresTrade: false, withdrawalBlocked: true },
        makerFeeBps: 2,
        takerFeeBps: 5,
      },
      {
        id: 'deribit',
        name: 'Deribit',
        connectionStatus: 'DISCONNECTED',
        apiStatus: 'OPERATIONAL',
        supportedMarkets: ['FUTURES', 'PERPETUAL'],
        wsStatus: 'OFFLINE',
        apiLatencyMs: 0,
        lastSyncUtc: nowIso,
        dataHealth: 'UNKNOWN',
        permissions: { read: false, spotTrade: false, futuresTrade: false, withdrawalBlocked: true },
        makerFeeBps: 0,
        takerFeeBps: 5,
      },
    ];

    const insertEx = db.prepare(`
      INSERT INTO exchange_registry (
        id, name, connection_status, api_status, supported_markets, ws_status,
        api_latency_ms, last_sync_utc, data_health, maker_fee_bps, taker_fee_bps,
        encrypted_credentials, masked_api_key, permissions_json,
        environment, verification_status, last_verified_utc, verification_note, account_equity_summary_usd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 'MAINNET', 'NOT_CONFIGURED', NULL, NULL, NULL)
    `);

    for (const ex of exchanges) {
      insertEx.run(
        ex.id,
        ex.name,
        ex.connectionStatus,
        ex.apiStatus,
        JSON.stringify(ex.supportedMarkets),
        ex.wsStatus,
        ex.apiLatencyMs,
        ex.lastSyncUtc,
        ex.dataHealth,
        ex.makerFeeBps,
        ex.takerFeeBps,
        JSON.stringify(ex.permissions),
      );
    }
  }

  // Seed Agent Registry
  const agCount = db.prepare('SELECT COUNT(*) as c FROM agent_registry').get() as { c: number };
  if (agCount.c === 0) {
    const initialAgents = createInitialAgentRegistry(nowIso);
    const insertAg = db.prepare('INSERT INTO agent_registry (id, payload_json) VALUES (?, ?)');
    for (const ag of initialAgents) {
      insertAg.run(ag.id, JSON.stringify(ag));
    }
    appendAuditLog({
      category: 'SYSTEM',
      severity: 'INFO',
      actor: 'MASTER_ORCHESTRATOR',
      action: 'SYSTEM_BOOT',
      details: 'Khởi tạo OMNISENT AI Multi-Agent Command Center với 19 tác nhân chuyên biệt và Risk Engine độc lập.',
    });
  } else {
    // Normalize any legacy seeded agent rows so no placeholder reliability/latency remains
    const existingRows = db.prepare('SELECT id, payload_json FROM agent_registry').all() as Array<{
      id: string;
      payload_json: string;
    }>;
    const updAg = db.prepare('UPDATE agent_registry SET payload_json = ? WHERE id = ?');
    for (const row of existingRows) {
      const parsed = JSON.parse(row.payload_json) as Record<string, unknown>;
      if ('reliabilityPct' in parsed || typeof parsed.evalCount !== 'number') {
        delete parsed.reliabilityPct;
        parsed.evalCount = typeof parsed.evalCount === 'number' ? parsed.evalCount : 0;
        if (parsed.evalCount === 0) parsed.latencyMs = 0;
        updAg.run(JSON.stringify(parsed), row.id);
      }
    }
  }
}

export function getTradingMode(): TradingMode {
  const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get('trading_mode') as
    | { value: string }
    | undefined;
  return row ? safeJsonParse<TradingMode>(row.value, 'FULL_AUTO') : 'FULL_AUTO';
}

export function setTradingMode(mode: TradingMode): void {
  db.prepare('INSERT OR REPLACE INTO app_state (key, value, updated_at) VALUES (?, ?, ?)').run(
    'trading_mode',
    JSON.stringify(mode),
    new Date().toISOString(),
  );
  bumpStateRevision();
}

export function resetTradingSession(initialMode: TradingMode = 'FULL_AUTO'): void {
  runInTransaction(() => {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    db.exec(`
      DELETE FROM positions;
      DELETE FROM orders;
      DELETE FROM signals;
      DELETE FROM agent_logs;
      DELETE FROM pnl_snapshots;
      DELETE FROM auto_proposals;
    `);

    setTradingMode(initialMode);
    saveAutoExecutionConfig(syncAutoConfigWithTradingMode(initialMode, DEFAULT_AUTO_EXECUTION_CONFIG));

    const cleanPortfolio: PortfolioSummary = {
      mode: initialMode,
      initialEquityUsd: 100_000,
      totalEquityUsd: 100_000,
      availableBalanceUsd: 100_000,
      usedMarginUsd: 0,
      realizedPnlUsd: 0,
      unrealizedPnlUsd: 0,
      totalFeesUsd: 0,
      dailyPnlPct: 0,
      weeklyPnlPct: 0,
      peakEquityUsd: 100_000,
      currentDrawdownPct: 0,
      winCount: 0,
      lossCount: 0,
      totalClosedTrades: 0,
      winRatePct: null,
    };
    savePortfolioSummary(cleanPortfolio);

    recordPnlSnapshot({
      timestampMs: nowMs,
      timestampUtc: nowIso,
      realizedPnlUsd: 0,
      unrealizedPnlUsd: 0,
      netPnlUsd: 0,
      totalEquityUsd: 100_000,
      openPositionsCount: 0,
      eventTag: 'SESSION_RESET',
    });

    const freshAgents = createInitialAgentRegistry(nowIso);
    const insertAg = db.prepare('INSERT OR REPLACE INTO agent_registry (id, payload_json) VALUES (?, ?)');
    for (const ag of freshAgents) {
      insertAg.run(ag.id, JSON.stringify(ag));
    }

    appendAuditLog({
      category: 'SYSTEM',
      severity: 'INFO',
      actor: 'USER',
      action: 'SESSION_RESET',
      details: `Đưa hệ thống về trạng thái khởi đầu sạch ($100,000, chế độ ${initialMode}).`,
    });
    bumpStateRevision();
  });
}

export function getRiskConfig(): RiskConfig {
  const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get('risk_config') as
    | { value: string }
    | undefined;
  return row ? { ...DEFAULT_RISK_CONFIG, ...safeJsonParse<Partial<RiskConfig>>(row.value, {}), allowMartingale: false } : DEFAULT_RISK_CONFIG;
}

export function saveRiskConfig(cfg: RiskConfig): void {
  const safeCfg: RiskConfig = { ...cfg, allowMartingale: false };
  db.prepare('INSERT OR REPLACE INTO app_state (key, value, updated_at) VALUES (?, ?, ?)').run(
    'risk_config',
    JSON.stringify(safeCfg),
    new Date().toISOString(),
  );
  bumpStateRevision();
}

export function getPortfolioSummary(): PortfolioSummary {
  const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get('portfolio_summary') as
    | { value: string }
    | undefined;
  const fallbackPortfolio: PortfolioSummary = {
    mode: getTradingMode(),
    initialEquityUsd: 100_000,
    totalEquityUsd: 100_000,
    availableBalanceUsd: 100_000,
    usedMarginUsd: 0,
    realizedPnlUsd: 0,
    unrealizedPnlUsd: 0,
    totalFeesUsd: 0,
    dailyPnlPct: 0,
    weeklyPnlPct: 0,
    peakEquityUsd: 100_000,
    currentDrawdownPct: 0,
    winCount: 0,
    lossCount: 0,
    totalClosedTrades: 0,
    winRatePct: null,
  };
  const base = row
    ? { ...fallbackPortfolio, ...safeJsonParse<Partial<PortfolioSummary>>(row.value, {}) }
    : fallbackPortfolio;
  base.mode = getTradingMode();
  return base;
}

export function savePortfolioSummary(summary: PortfolioSummary): void {
  db.prepare('INSERT OR REPLACE INTO app_state (key, value, updated_at) VALUES (?, ?, ?)').run(
    'portfolio_summary',
    JSON.stringify(summary),
    new Date().toISOString(),
  );
}

export function getOpenPositions(): Position[] {
  const rows = db.prepare('SELECT * FROM positions ORDER BY opened_at_utc DESC').all() as Array<{
    id: string;
    symbol: string;
    exchange: string;
    market_type: string;
    side: string;
    quantity: number;
    entry_price: number;
    mark_price: number;
    stop_loss: number;
    initial_stop_loss: number | null;
    take_price: number;
    leverage: number;
    margin_usd: number;
    unrealized_pnl_usd: number;
    unrealized_pnl_pct: number;
    liquidation_price: number | null;
    funding_paid_usd: number;
    strategy_name: string;
    mode: string;
    opened_at_utc: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    symbol: r.symbol,
    exchange: r.exchange,
    marketType: r.market_type as Position['marketType'],
    side: r.side as Position['side'],
    quantity: r.quantity,
    entryPrice: r.entry_price,
    markPrice: r.mark_price,
    stopLoss: r.stop_loss,
    initialStopLoss: r.initial_stop_loss ?? undefined,
    takeProfit: r.take_price,
    leverage: r.leverage,
    marginUsd: r.margin_usd,
    unrealizedPnlUsd: r.unrealized_pnl_usd,
    unrealizedPnlPct: r.unrealized_pnl_pct,
    liquidationPrice: r.liquidation_price,
    fundingPaidUsd: r.funding_paid_usd,
    strategyName: r.strategy_name,
    mode: r.mode as Position['mode'],
    openedAtUtc: r.opened_at_utc,
  }));
}

export function upsertPosition(pos: Position): void {
  db.prepare(`
    INSERT OR REPLACE INTO positions (
      id, symbol, exchange, market_type, side, quantity, entry_price, mark_price,
      stop_loss, initial_stop_loss, take_price, leverage, margin_usd, unrealized_pnl_usd, unrealized_pnl_pct,
      liquidation_price, funding_paid_usd, strategy_name, mode, opened_at_utc
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    pos.id,
    pos.symbol,
    pos.exchange,
    pos.marketType,
    pos.side,
    pos.quantity,
    pos.entryPrice,
    pos.markPrice,
    pos.stopLoss,
    pos.initialStopLoss ?? pos.stopLoss,
    pos.takeProfit,
    pos.leverage,
    pos.marginUsd,
    pos.unrealizedPnlUsd,
    pos.unrealizedPnlPct,
    pos.liquidationPrice,
    pos.fundingPaidUsd,
    pos.strategyName,
    pos.mode,
    pos.openedAtUtc,
  );
}

export function deletePosition(id: string): number {
  const info = db.prepare('DELETE FROM positions WHERE id = ?').run(id);
  if (info.changes > 0) {
    bumpStateRevision();
  }
  return Number(info.changes ?? 0);
}

export function openPositionAtomically(params: {
  order: OrderRecord;
  position: Position;
  feeUsd: number;
  auditActor: string;
  auditAction: string;
  auditDetails: string;
}): void {
  runInTransaction(() => {
    insertOrder(params.order);
    upsertPosition(params.position);
    const portfolio = getPortfolioSummary();
    portfolio.realizedPnlUsd = Number((portfolio.realizedPnlUsd - params.feeUsd).toFixed(2));
    portfolio.totalFeesUsd = Number((portfolio.totalFeesUsd + params.feeUsd).toFixed(2));
    savePortfolioSummary(portfolio);
    appendAuditLog({
      category: 'ORDER',
      severity: 'INFO',
      actor: params.auditActor,
      action: params.auditAction,
      details: params.auditDetails,
    });
    bumpStateRevision();
  });
}

export function closePositionAtomically(params: {
  positionId: string;
  resolveClosePrice: (pos: Position) => number;
  closeReason: 'MANUAL_CLOSE' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'TRAILING_PROFIT';
  idempotencyPrefix: string;
  actor: string;
  auditAction: string;
  auditSeverity?: AuditLogEntry['severity'];
}):
  | {
      closed: true;
      position: Position;
      closePrice: number;
      grossPnlUsd: number;
      closeFeeUsd: number;
      realizedNetUsd: number;
      rMultiple: number;
      closedAtUtc: string;
    }
  | { closed: false } {
  return runInTransaction(() => {
    const pos = getOpenPositions().find((p) => p.id === params.positionId);
    if (!pos) return { closed: false };

    const deletedCount = deletePosition(pos.id);
    if (deletedCount !== 1) return { closed: false };

    const closePrice = params.resolveClosePrice(pos);
    const grossPnlUsd = Number(
      (pos.side === 'LONG'
        ? (closePrice - pos.entryPrice) * pos.quantity
        : (pos.entryPrice - closePrice) * pos.quantity
      ).toFixed(2),
    );
    const closeFeeUsd = Number((pos.quantity * closePrice * 0.0005).toFixed(2));
    const realizedNetUsd = Number((grossPnlUsd - closeFeeUsd).toFixed(2));
    const initialRiskPerUnit = Math.abs(pos.entryPrice - (pos.initialStopLoss ?? pos.stopLoss));
    const initialRiskUsd = initialRiskPerUnit * pos.quantity;
    const rMultiple =
      initialRiskUsd > 0 ? Number((realizedNetUsd / initialRiskUsd).toFixed(2)) : 0;
    const closedAtUtc = new Date().toISOString();

    const portfolio = getPortfolioSummary();
    portfolio.realizedPnlUsd = Number((portfolio.realizedPnlUsd + realizedNetUsd).toFixed(2));
    portfolio.totalFeesUsd = Number((portfolio.totalFeesUsd + closeFeeUsd).toFixed(2));
    if (realizedNetUsd >= 0) portfolio.winCount += 1;
    else portfolio.lossCount += 1;
    portfolio.totalClosedTrades += 1;
    portfolio.winRatePct =
      portfolio.totalClosedTrades > 0
        ? Number(((portfolio.winCount / portfolio.totalClosedTrades) * 100).toFixed(1))
        : null;
    savePortfolioSummary(portfolio);

    try {
      insertOrder({
        id: `ORD-CLS-${Date.now()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`,
        idempotencyKey: `${params.idempotencyPrefix}-${pos.id}`,
        symbol: pos.symbol,
        exchange: pos.exchange,
        marketType: pos.marketType,
        side: pos.side === 'LONG' ? 'SHORT' : 'LONG',
        orderType: 'MARKET',
        quantity: pos.quantity,
        price: closePrice,
        stopLoss: pos.stopLoss,
        takeProfit: pos.takeProfit,
        leverage: pos.leverage,
        feesUsd: closeFeeUsd,
        slippageUsd: 0,
        status: 'FILLED',
        mode: pos.mode,
        strategyName: `${pos.strategyName} [${params.closeReason}]`,
        riskDecision: 'APPROVE',
        createdAtUtc: closedAtUtc,
      });
    } catch {
      // Ignore duplicate close idempotency key inside same transaction boundary
    }

    appendAuditLog({
      category: 'ORDER',
      severity: params.auditSeverity ?? 'INFO',
      actor: params.actor,
      action: params.auditAction,
      details: `Đóng vị thế ${pos.symbol} ${pos.side} @ $${closePrice} (${params.closeReason}), PnL ròng $${realizedNetUsd.toFixed(2)} (${rMultiple >= 0 ? '+' : ''}${rMultiple}R).`,
    });

    return {
      closed: true,
      position: pos,
      closePrice,
      grossPnlUsd,
      closeFeeUsd,
      realizedNetUsd,
      rMultiple,
      closedAtUtc,
    };
  });
}

export function insertOrder(order: OrderRecord): void {
  db.prepare(`
    INSERT INTO orders (
      id, idempotency_key, symbol, exchange, market_type, side, order_type,
      quantity, price, stop_loss, take_profit, leverage, fees_usd, slippage_usd,
      status, mode, strategy_name, risk_decision, created_at_utc
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    order.id,
    order.idempotencyKey,
    order.symbol,
    order.exchange,
    order.marketType,
    order.side,
    order.orderType,
    order.quantity,
    order.price,
    order.stopLoss,
    order.takeProfit,
    order.leverage,
    order.feesUsd,
    order.slippageUsd,
    order.status,
    order.mode,
    order.strategyName,
    order.riskDecision,
    order.createdAtUtc,
  );
  bumpStateRevision();
}

export function getOrders(limit = 50): OrderRecord[] {
  const rows = db
    .prepare('SELECT * FROM orders ORDER BY created_at_utc DESC LIMIT ?')
    .all(limit) as Array<{
    id: string;
    idempotency_key: string;
    symbol: string;
    exchange: string;
    market_type: string;
    side: string;
    order_type: string;
    quantity: number;
    price: number;
    stop_loss: number;
    take_profit: number;
    leverage: number;
    fees_usd: number;
    slippage_usd: number;
    status: string;
    mode: string;
    strategy_name: string;
    risk_decision: string;
    created_at_utc: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    idempotencyKey: r.idempotency_key,
    symbol: r.symbol,
    exchange: r.exchange,
    marketType: r.market_type as OrderRecord['marketType'],
    side: r.side as OrderRecord['side'],
    orderType: r.order_type as OrderRecord['orderType'],
    quantity: r.quantity,
    price: r.price,
    stopLoss: r.stop_loss,
    takeProfit: r.take_profit,
    leverage: r.leverage,
    feesUsd: r.fees_usd,
    slippageUsd: r.slippage_usd,
    status: r.status as OrderRecord['status'],
    mode: r.mode as OrderRecord['mode'],
    strategyName: r.strategy_name,
    riskDecision: r.risk_decision as OrderRecord['riskDecision'],
    createdAtUtc: r.created_at_utc,
  }));
}

export function getRecentIdempotencyKeys(limit = 100): string[] {
  const rows = db
    .prepare('SELECT idempotency_key FROM orders ORDER BY created_at_utc DESC LIMIT ?')
    .all(limit) as Array<{ idempotency_key: string }>;
  return rows.map((r) => r.idempotency_key);
}

export function saveSignal(signal: TradingSignal): void {
  db.prepare(
    'INSERT OR REPLACE INTO signals (id, symbol, exchange, payload_json, created_at_utc) VALUES (?, ?, ?, ?, ?)',
  ).run(signal.id, signal.symbol, signal.exchange, JSON.stringify(signal), signal.timestampUtc);
  bumpStateRevision();
}

export function getSignals(limit = 20): TradingSignal[] {
  const fetchLimit = Math.max(limit * 4, 80);
  const rows = db
    .prepare('SELECT payload_json FROM signals ORDER BY created_at_utc DESC LIMIT ?')
    .all(fetchLimit) as Array<{ payload_json: string }>;
  const parsed = rows
    .map((r) => safeJsonParse<TradingSignal | null>(r.payload_json, null))
    .filter((s): s is TradingSignal => Boolean(s && s.id && s.symbol));
  return dedupeSignalsByPair(parsed).slice(0, limit);
}

export function getAgents(): AgentState[] {
  const rows = db.prepare('SELECT payload_json FROM agent_registry').all() as Array<{
    payload_json: string;
  }>;
  return rows
    .map((r) => safeJsonParse<AgentState | null>(r.payload_json, null))
    .filter((a): a is AgentState => Boolean(a && a.id));
}

export function updateAgent(agent: AgentState): void {
  db.prepare('INSERT OR REPLACE INTO agent_registry (id, payload_json) VALUES (?, ?)').run(
    agent.id,
    JSON.stringify(agent),
  );
  bumpStateRevision();
}

export function appendAgentLog(entry: Omit<AgentLogEntry, 'id' | 'timestampUtc'>): void {
  const id = `AGL-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const ts = new Date().toISOString();
  db.prepare(
    'INSERT INTO agent_logs (id, agent_id, level, message, timestamp_utc) VALUES (?, ?, ?, ?, ?)',
  ).run(id, entry.agentId, entry.level, entry.message, ts);
}

export function getAgentLogs(agentId?: string, limit = 50): AgentLogEntry[] {
  const rows = agentId
    ? (db
        .prepare('SELECT * FROM agent_logs WHERE agent_id = ? ORDER BY timestamp_utc DESC LIMIT ?')
        .all(agentId, limit) as Array<{
        id: string;
        agent_id: string;
        level: string;
        message: string;
        timestamp_utc: string;
      }>)
    : (db
        .prepare('SELECT * FROM agent_logs ORDER BY timestamp_utc DESC LIMIT ?')
        .all(limit) as Array<{
        id: string;
        agent_id: string;
        level: string;
        message: string;
        timestamp_utc: string;
      }>);

  return rows.map((r) => ({
    id: r.id,
    agentId: r.agent_id as AgentLogEntry['agentId'],
    level: r.level as AgentLogEntry['level'],
    message: r.message,
    timestampUtc: r.timestamp_utc,
  }));
}

export function appendAuditLog(entry: Omit<AuditLogEntry, 'id' | 'timestampUtc'>): void {
  const id = `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const ts = new Date().toISOString();
  db.prepare(
    'INSERT INTO audit_logs (id, category, severity, actor, action, details, timestamp_utc) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, entry.category, entry.severity, entry.actor, entry.action, entry.details, ts);
}

export function getAuditLogs(limit = 60): AuditLogEntry[] {
  const rows = db
    .prepare('SELECT * FROM audit_logs ORDER BY timestamp_utc DESC LIMIT ?')
    .all(limit) as Array<{
    id: string;
    category: string;
    severity: string;
    actor: string;
    action: string;
    details: string;
    timestamp_utc: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    category: r.category as AuditLogEntry['category'],
    severity: r.severity as AuditLogEntry['severity'],
    actor: r.actor,
    action: r.action,
    details: r.details,
    timestampUtc: r.timestamp_utc,
  }));
}

export function getExchanges(): ExchangeInfo[] {
  const rows = db.prepare('SELECT * FROM exchange_registry').all() as Array<{
    id: string;
    name: string;
    connection_status: string;
    api_status: string;
    supported_markets: string;
    ws_status: string;
    api_latency_ms: number;
    last_sync_utc: string;
    data_health: string;
    maker_fee_bps: number;
    taker_fee_bps: number;
    encrypted_credentials: string | null;
    masked_api_key: string | null;
    permissions_json: string;
    environment: string | null;
    verification_status: string | null;
    last_verified_utc: string | null;
    verification_note: string | null;
    account_equity_summary_usd: number | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    connectionStatus: r.connection_status as ExchangeInfo['connectionStatus'],
    apiStatus: r.api_status as ExchangeInfo['apiStatus'],
    supportedMarkets: safeJsonParse<ExchangeInfo['supportedMarkets']>(r.supported_markets, ['SPOT']),
    wsStatus: r.ws_status as ExchangeInfo['wsStatus'],
    apiLatencyMs: r.api_latency_ms,
    lastSyncUtc: r.last_sync_utc,
    dataHealth: r.data_health as ExchangeInfo['dataHealth'],
    hasApiKeyConfigured: Boolean(r.encrypted_credentials),
    maskedApiKey: r.masked_api_key,
    environment: (r.environment === 'TESTNET' ? 'TESTNET' : 'MAINNET') as ExchangeEnvironment,
    verificationStatus: (r.verification_status ??
      (r.encrypted_credentials
        ? 'VAULT_STORED_UNVERIFIED'
        : 'NOT_CONFIGURED')) as ExchangeVerificationStatus,
    lastVerifiedUtc: r.last_verified_utc ?? null,
    verificationNote: r.verification_note ?? null,
    accountEquitySummaryUsd:
      typeof r.account_equity_summary_usd === 'number' ? r.account_equity_summary_usd : null,
    permissions: safeJsonParse<ExchangeInfo['permissions']>(r.permissions_json, {
      read: false,
      spotTrade: false,
      futuresTrade: false,
      withdrawalBlocked: true,
    }),
    makerFeeBps: r.maker_fee_bps,
    takerFeeBps: r.taker_fee_bps,
  }));
}

export function getExchangeEncryptedCredentials(exchangeId: string): {
  id: string;
  encryptedCredentials: string | null;
  maskedApiKey: string | null;
  environment: ExchangeEnvironment;
  permissions: ExchangeInfo['permissions'];
} | null {
  const row = db
    .prepare(
      'SELECT id, encrypted_credentials, masked_api_key, environment, permissions_json FROM exchange_registry WHERE id = ?',
    )
    .get(exchangeId) as
    | {
        id: string;
        encrypted_credentials: string | null;
        masked_api_key: string | null;
        environment: string | null;
        permissions_json: string;
      }
    | undefined;

  if (!row) return null;
  return {
    id: row.id,
    encryptedCredentials: row.encrypted_credentials,
    maskedApiKey: row.masked_api_key,
    environment: row.environment === 'TESTNET' ? 'TESTNET' : 'MAINNET',
    permissions: safeJsonParse<ExchangeInfo['permissions']>(row.permissions_json, {
      read: false,
      spotTrade: false,
      futuresTrade: false,
      withdrawalBlocked: true,
    }),
  };
}

export function saveExchangeCredentials(params: {
  exchangeId: string;
  encryptedCredentials: string;
  maskedApiKey: string;
  spotTrade: boolean;
  futuresTrade: boolean;
  environment: ExchangeEnvironment;
  verificationStatus: ExchangeVerificationStatus;
  lastVerifiedUtc: string | null;
  verificationNote: string | null;
  latencyMs?: number;
  accountEquitySummaryUsd?: number | null;
}): void {
  const nowIso = new Date().toISOString();
  const isVerified =
    params.verificationStatus === 'VERIFIED_LIVE' ||
    params.verificationStatus === 'VERIFIED_TESTNET';
  const connectionStatus =
    params.verificationStatus === 'AUTH_FAILED'
      ? 'ERROR'
      : 'CONNECTED';
  const dataHealth = isVerified ? 'HEALTHY' : 'DEGRADED';

  db.prepare(`
    UPDATE exchange_registry
    SET connection_status = ?,
        ws_status = 'CONNECTED',
        data_health = ?,
        api_latency_ms = ?,
        last_sync_utc = ?,
        encrypted_credentials = ?,
        masked_api_key = ?,
        permissions_json = ?,
        environment = ?,
        verification_status = ?,
        last_verified_utc = ?,
        verification_note = ?,
        account_equity_summary_usd = ?
    WHERE id = ?
  `).run(
    connectionStatus,
    dataHealth,
    typeof params.latencyMs === 'number' ? params.latencyMs : 0,
    nowIso,
    params.encryptedCredentials,
    params.maskedApiKey,
    JSON.stringify({
      read: true,
      spotTrade: params.spotTrade,
      futuresTrade: params.futuresTrade,
      withdrawalBlocked: true,
    }),
    params.environment,
    params.verificationStatus,
    params.lastVerifiedUtc,
    params.verificationNote,
    params.accountEquitySummaryUsd ?? null,
    params.exchangeId,
  );
}

export function updateExchangeVerificationStatus(params: {
  exchangeId: string;
  verificationStatus: ExchangeVerificationStatus;
  lastVerifiedUtc: string | null;
  verificationNote: string | null;
  latencyMs?: number;
  accountEquitySummaryUsd?: number | null;
  spotTrade?: boolean;
  futuresTrade?: boolean;
}): void {
  const nowIso = new Date().toISOString();
  const isVerified =
    params.verificationStatus === 'VERIFIED_LIVE' ||
    params.verificationStatus === 'VERIFIED_TESTNET';
  const connectionStatus =
    params.verificationStatus === 'AUTH_FAILED' ? 'ERROR' : 'CONNECTED';
  const dataHealth = isVerified ? 'HEALTHY' : 'DEGRADED';

  const existing = getExchangeEncryptedCredentials(params.exchangeId);
  const nextPerms = existing
    ? {
        read: true,
        spotTrade: params.spotTrade ?? existing.permissions.spotTrade,
        futuresTrade: params.futuresTrade ?? existing.permissions.futuresTrade,
        withdrawalBlocked: true,
      }
    : {
        read: true,
        spotTrade: Boolean(params.spotTrade),
        futuresTrade: Boolean(params.futuresTrade),
        withdrawalBlocked: true,
      };

  db.prepare(`
    UPDATE exchange_registry
    SET connection_status = ?,
        data_health = ?,
        api_latency_ms = CASE WHEN ? > 0 THEN ? ELSE api_latency_ms END,
        last_sync_utc = ?,
        verification_status = ?,
        last_verified_utc = ?,
        verification_note = ?,
        account_equity_summary_usd = ?,
        permissions_json = ?
    WHERE id = ?
  `).run(
    connectionStatus,
    dataHealth,
    params.latencyMs ?? 0,
    params.latencyMs ?? 0,
    nowIso,
    params.verificationStatus,
    params.lastVerifiedUtc,
    params.verificationNote,
    params.accountEquitySummaryUsd ?? null,
    JSON.stringify(nextPerms),
    params.exchangeId,
  );
}

const PUBLIC_FEED_EXCHANGES = new Set(['binance', 'bybit', 'okx', 'kraken', 'coinbase']);

export function disconnectExchange(exchangeId: string): void {
  const nowIso = new Date().toISOString();
  const isPublicFeed = PUBLIC_FEED_EXCHANGES.has(exchangeId.toLowerCase());
  db.prepare(`
    UPDATE exchange_registry
    SET connection_status = ?,
        ws_status = 'OFFLINE',
        data_health = 'UNKNOWN',
        api_latency_ms = 0,
        encrypted_credentials = NULL,
        masked_api_key = NULL,
        environment = 'MAINNET',
        verification_status = 'NOT_CONFIGURED',
        last_verified_utc = NULL,
        verification_note = NULL,
        account_equity_summary_usd = NULL,
        last_sync_utc = ?,
        permissions_json = ?
    WHERE id = ?
  `).run(
    isPublicFeed ? 'PUBLIC_ONLY' : 'DISCONNECTED',
    nowIso,
    JSON.stringify({
      read: isPublicFeed,
      spotTrade: false,
      futuresTrade: false,
      withdrawalBlocked: true,
    }),
    exchangeId,
  );
}

export function recordPnlSnapshot(point: PnlHistoryPoint): void {
  db.prepare(`
    INSERT INTO pnl_snapshots (
      timestamp_ms, timestamp_utc, realized_pnl_usd, unrealized_pnl_usd,
      net_pnl_usd, total_equity_usd, open_positions_count, event_tag
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    point.timestampMs,
    point.timestampUtc,
    point.realizedPnlUsd,
    point.unrealizedPnlUsd,
    point.netPnlUsd,
    point.totalEquityUsd,
    point.openPositionsCount,
    point.eventTag ?? null,
  );

  // Retain at most 720 recent points in SQLite to keep DB compact
  db.exec(`
    DELETE FROM pnl_snapshots
    WHERE id NOT IN (
      SELECT id FROM pnl_snapshots ORDER BY timestamp_ms DESC LIMIT 720
    );
  `);
}

export function getLatestPnlSnapshot(): PnlHistoryPoint | null {
  const row = db
    .prepare('SELECT * FROM pnl_snapshots ORDER BY timestamp_ms DESC LIMIT 1')
    .get() as
    | {
        timestamp_ms: number;
        timestamp_utc: string;
        realized_pnl_usd: number;
        unrealized_pnl_usd: number;
        net_pnl_usd: number;
        total_equity_usd: number;
        open_positions_count: number;
        event_tag: string | null;
      }
    | undefined;

  if (!row) return null;
  return {
    timestampMs: row.timestamp_ms,
    timestampUtc: row.timestamp_utc,
    realizedPnlUsd: row.realized_pnl_usd,
    unrealizedPnlUsd: row.unrealized_pnl_usd,
    netPnlUsd: row.net_pnl_usd,
    totalEquityUsd: row.total_equity_usd,
    openPositionsCount: row.open_positions_count,
    eventTag: row.event_tag ?? undefined,
  };
}

export function getPnlHistory(limit = 360): PnlHistoryPoint[] {
  const rows = db
    .prepare('SELECT * FROM pnl_snapshots ORDER BY timestamp_ms DESC LIMIT ?')
    .all(limit) as Array<{
    timestamp_ms: number;
    timestamp_utc: string;
    realized_pnl_usd: number;
    unrealized_pnl_usd: number;
    net_pnl_usd: number;
    total_equity_usd: number;
    open_positions_count: number;
    event_tag: string | null;
  }>;

  return rows.reverse().map((r) => ({
    timestampMs: r.timestamp_ms,
    timestampUtc: r.timestamp_utc,
    realizedPnlUsd: r.realized_pnl_usd,
    unrealizedPnlUsd: r.unrealized_pnl_usd,
    netPnlUsd: r.net_pnl_usd,
    totalEquityUsd: r.total_equity_usd,
    openPositionsCount: r.open_positions_count,
    eventTag: r.event_tag ?? undefined,
  }));
}

export function getAutoExecutionConfig(): AutoExecutionConfig {
  const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get('auto_exec_config') as
    | { value: string }
    | undefined;
  return row
    ? clampAutoExecutionConfig(
        safeJsonParse<Partial<AutoExecutionConfig>>(row.value, {}),
        DEFAULT_AUTO_EXECUTION_CONFIG,
      )
    : DEFAULT_AUTO_EXECUTION_CONFIG;
}

export function saveAutoExecutionConfig(cfg: AutoExecutionConfig): void {
  db.prepare('INSERT OR REPLACE INTO app_state (key, value, updated_at) VALUES (?, ?, ?)').run(
    'auto_exec_config',
    JSON.stringify(cfg),
    new Date().toISOString(),
  );
  bumpStateRevision();
}

export function upsertAutoProposal(proposal: AutoExecutionProposal): void {
  db.prepare(`
    INSERT OR REPLACE INTO auto_proposals (
      id, symbol, status, created_at_utc, expires_at_utc, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    proposal.id,
    proposal.symbol,
    proposal.status,
    proposal.createdAtUtc,
    proposal.expiresAtUtc,
    JSON.stringify(proposal),
  );
  bumpStateRevision();
}

export function getAutoProposals(statusFilter?: AutoProposalStatus, limit = 25): AutoExecutionProposal[] {
  const rows = statusFilter
    ? (db
        .prepare('SELECT payload_json FROM auto_proposals WHERE status = ? ORDER BY created_at_utc DESC LIMIT ?')
        .all(statusFilter, limit) as Array<{ payload_json: string }>)
    : (db
        .prepare('SELECT payload_json FROM auto_proposals ORDER BY created_at_utc DESC LIMIT ?')
        .all(limit) as Array<{ payload_json: string }>);

  return rows
    .map((r) => safeJsonParse<AutoExecutionProposal | null>(r.payload_json, null))
    .filter((p): p is AutoExecutionProposal => Boolean(p && p.id));
}

export function expireStaleAutoProposals(nowIso: string): void {
  const pending = getAutoProposals('PENDING', 50);
  for (const prop of pending) {
    if (prop.expiresAtUtc <= nowIso) {
      upsertAutoProposal({ ...prop, status: 'EXPIRED' });
    }
  }
}


