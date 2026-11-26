import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnisent-audit-test-'));
process.env.OMNISENT_DATA_DIR = tempDataDir;
process.env.OMNISENT_SKIP_LISTEN = '1';

let serverModule: typeof import('../server.ts');
let dbModule: typeof import('../server/db.ts');
let httpServer: import('node:http').Server;
let baseUrl = '';

before(async () => {
  dbModule = await import('../server/db.ts');
  serverModule = await import('../server.ts');
  httpServer = serverModule.app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => {
    httpServer.once('listening', resolve);
  });
  const addr = httpServer.address();
  assert.ok(addr && typeof addr === 'object');
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  delete process.env.OMNISENT_ADMIN_TOKEN;
  await new Promise<void>((resolve) => {
    httpServer.close(() => resolve());
  });
  try {
    dbModule.db.close();
  } catch {
    // ignore
  }
  fs.rmSync(tempDataDir, { recursive: true, force: true });
});

test('SQLite atomic closePositionAtomically prevents double-close race and computes exact settlement receipt', () => {
  dbModule.resetTradingSession('PAPER');
  const posId = 'POS-ATOMIC-RACE-1';
  dbModule.upsertPosition({
    id: posId,
    symbol: 'BTC/USDT',
    exchange: 'Binance',
    marketType: 'PERPETUAL',
    side: 'LONG',
    quantity: 0.1,
    entryPrice: 90_000,
    markPrice: 92_000,
    stopLoss: 89_000,
    initialStopLoss: 89_000,
    takeProfit: 94_000,
    leverage: 2,
    marginUsd: 4_500,
    unrealizedPnlUsd: 200,
    unrealizedPnlPct: 4.44,
    liquidationPrice: 45_450,
    fundingPaidUsd: 0,
    strategyName: 'Atomic Close Test',
    mode: 'PAPER',
    openedAtUtc: new Date().toISOString(),
  });

  const firstClose = dbModule.closePositionAtomically({
    positionId: posId,
    resolveClosePrice: () => 92_000,
    closeReason: 'MANUAL_CLOSE',
    idempotencyPrefix: 'CLOSE-TEST',
    actor: 'USER',
    auditAction: 'CLOSE_POSITION',
  });
  assert.equal(firstClose.closed, true);
  if (firstClose.closed) {
    assert.equal(firstClose.grossPnlUsd, 200);
    assert.equal(firstClose.closeFeeUsd, 4.6); // 0.1 * 92000 * 0.0005
    assert.equal(firstClose.realizedNetUsd, 195.4);
    assert.ok(firstClose.rMultiple > 1.8);
  }

  // Concurrent/duplicate close attempt on the same position ID must fail cleanly without double crediting PnL
  const secondClose = dbModule.closePositionAtomically({
    positionId: posId,
    resolveClosePrice: () => 92_000,
    closeReason: 'MANUAL_CLOSE',
    idempotencyPrefix: 'CLOSE-TEST',
    actor: 'USER',
    auditAction: 'CLOSE_POSITION',
  });
  assert.equal(secondClose.closed, false);

  const portfolio = dbModule.getPortfolioSummary();
  assert.equal(portfolio.realizedPnlUsd, 195.4);
  assert.equal(portfolio.totalClosedTrades, 1);
  assert.equal(portfolio.winCount, 1);
  assert.equal(portfolio.winRatePct, 100);
  assert.equal(dbModule.getOpenPositions().length, 0);
});

test('HTTP security headers, diagnostics, atomic POST /api/positions/:id/close receipt, and optional OMNISENT_ADMIN_TOKEN guard', async () => {
  dbModule.resetTradingSession('PAPER');

  // 1. Verify /api/health & security headers
  const healthRes = await fetch(`${baseUrl}/api/health`);
  assert.equal(healthRes.status, 200);
  assert.equal(healthRes.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(healthRes.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(healthRes.headers.get('x-powered-by'), null);
  const healthJson = (await healthRes.json()) as {
    status: string;
    database: { healthy: boolean; journalMode: string };
  };
  assert.equal(healthJson.status, 'OK');
  assert.equal(healthJson.database.healthy, true);
  assert.equal(healthJson.database.journalMode, 'wal');

  // 2. Seed open position and verify HTTP close endpoint returns receipt and rejects second close with 404
  dbModule.upsertPosition({
    id: 'POS-HTTP-CLOSE-1',
    symbol: 'ETH/USDT',
    exchange: 'Binance',
    marketType: 'PERPETUAL',
    side: 'SHORT',
    quantity: 2,
    entryPrice: 3_000,
    markPrice: 2_900,
    stopLoss: 3_100,
    initialStopLoss: 3_100,
    takeProfit: 2_800,
    leverage: 2,
    marginUsd: 3_000,
    unrealizedPnlUsd: 200,
    unrealizedPnlPct: 6.67,
    liquidationPrice: 4_485,
    fundingPaidUsd: 0,
    strategyName: 'HTTP Receipt Test',
    mode: 'PAPER',
    openedAtUtc: new Date().toISOString(),
  });

  const closeRes1 = await fetch(`${baseUrl}/api/positions/POS-HTTP-CLOSE-1/close`, {
    method: 'POST',
  });
  assert.equal(closeRes1.status, 200);
  const closeBody1 = (await closeRes1.json()) as {
    ok: boolean;
    closedNetPnlUsd: number;
    receipt: { symbol: string; closeFeeUsd: number; realizedNetUsd: number; rMultiple: number };
    positions: unknown[];
  };
  assert.equal(closeBody1.ok, true);
  assert.equal(closeBody1.receipt.symbol, 'ETH/USDT');
  assert.ok(closeBody1.receipt.closeFeeUsd > 0);
  assert.equal(closeBody1.closedNetPnlUsd, closeBody1.receipt.realizedNetUsd);
  assert.equal(closeBody1.positions.length, 0);

  const closeRes2 = await fetch(`${baseUrl}/api/positions/POS-HTTP-CLOSE-1/close`, {
    method: 'POST',
  });
  assert.equal(closeRes2.status, 404);

  // 3. Verify optional OMNISENT_ADMIN_TOKEN bearer guard blocks unauthorized mutations and allows authorized ones
  process.env.OMNISENT_ADMIN_TOKEN = 'audit-secret-token-xyz';
  const unauthRes = await fetch(`${baseUrl}/api/session/reset`, { method: 'POST' });
  assert.equal(unauthRes.status, 401);

  const wrongTokenRes = await fetch(`${baseUrl}/api/session/reset`, {
    method: 'POST',
    headers: { Authorization: 'Bearer wrong-token' },
  });
  assert.equal(wrongTokenRes.status, 401);

  const validTokenRes = await fetch(`${baseUrl}/api/session/reset`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer audit-secret-token-xyz',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mode: 'PAPER' }),
  });
  assert.equal(validTokenRes.status, 200);
  delete process.env.OMNISENT_ADMIN_TOKEN;

  // 4. Verify single-trip PWA bootstrap sync endpoint & strict no-store cache-control header
  const bootstrapRes = await fetch(`${baseUrl}/api/sync/bootstrap`);
  assert.equal(bootstrapRes.status, 200);
  const cacheControl = bootstrapRes.headers.get('cache-control') || '';
  assert.ok(cacheControl.includes('no-store'));
  assert.ok(cacheControl.includes('no-cache'));
  const bootstrapJson = (await bootstrapRes.json()) as {
    stateRevision: number;
    wsSupported: boolean;
    feedAgeMs: number | null;
    tradingMode: string;
    portfolio: { totalEquityUsd: number };
    positions: unknown[];
    tickers: unknown[];
    serverUtc: string;
  };
  assert.equal(typeof bootstrapJson.stateRevision, 'number');
  assert.equal(typeof bootstrapJson.wsSupported, 'boolean');
  assert.ok(bootstrapJson.feedAgeMs === null || typeof bootstrapJson.feedAgeMs === 'number');
  assert.equal(bootstrapJson.tradingMode, 'PAPER');
  assert.ok(Array.isArray(bootstrapJson.positions));
  assert.ok(Array.isArray(bootstrapJson.tickers));
  assert.ok(typeof bootstrapJson.serverUtc === 'string' && bootstrapJson.serverUtc.length > 0);
});

test('openDatabaseWithRecovery quarantines corrupted SQLite files and recovers a clean writable DB', () => {
  const corruptPath = path.join(tempDataDir, 'corrupt-probe.db');
  fs.writeFileSync(corruptPath, Buffer.from('not-a-valid-sqlite-database-image-corrupted-bytes'));
  const recovered = dbModule.openDatabaseWithRecovery(corruptPath);
  try {
    recovered.exec('CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY);');
    recovered.exec('INSERT INTO probe (id) VALUES (1);');
    const row = recovered.prepare('SELECT id FROM probe WHERE id = 1').get() as { id?: number };
    assert.equal(row?.id, 1);
    const quarantined = fs
      .readdirSync(tempDataDir)
      .filter((name) => name.startsWith('corrupt-probe.db.corrupt.'));
    assert.equal(quarantined.length, 1);
  } finally {
    recovered.close();
  }
});
