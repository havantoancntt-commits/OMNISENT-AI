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
  try {
    serverModule?.clearAutonomousReplenishmentTimer?.();
  } catch {
    // ignore
  }
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
  assert.equal(closeRes2.status, 409);
  const closeBody2 = (await closeRes2.json()) as { ok: boolean; alreadyClosed?: boolean };
  assert.equal(closeBody2.ok, false);
  assert.equal(closeBody2.alreadyClosed, true);

  const closeResMissing = await fetch(`${baseUrl}/api/positions/POS-NON-EXISTENT-999/close`, {
    method: 'POST',
  });
  assert.equal(closeResMissing.status, 404);

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

  // 5. Verify /api/portfolio and mode/config mutations emit monotonic stateRevision
  const portRes = await fetch(`${baseUrl}/api/portfolio`);
  assert.equal(portRes.status, 200);
  const portJson = (await portRes.json()) as { stateRevision: number };
  assert.equal(typeof portJson.stateRevision, 'number');
  assert.ok(portJson.stateRevision >= bootstrapJson.stateRevision);

  const modeRes = await fetch(`${baseUrl}/api/mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'SEMI_AUTO' }),
  });
  assert.equal(modeRes.status, 200);
  const modeJson = (await modeRes.json()) as { tradingMode: string; stateRevision: number };
  assert.equal(modeJson.tradingMode, 'SEMI_AUTO');
  assert.ok(modeJson.stateRevision > portJson.stateRevision);
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

test('SQLite ledgerEpoch rotates on session reset, rejected orders do not poison idempotency keys, and close returns authoritative state beyond 20 orders', async () => {
  dbModule.resetTradingSession('PAPER');
  const epochBefore = dbModule.getLedgerEpoch();
  const revBefore = dbModule.getStateRevision();
  assert.ok(typeof epochBefore === 'string' && epochBefore.length >= 16);
  assert.ok(revBefore >= 1);

  // 1. openPositionAtomically enforces maxOpenPositions concurrency invariant inside SQLite transaction
  const riskCfg = { ...dbModule.getRiskConfig(), maxOpenPositions: 1 };
  dbModule.saveRiskConfig(riskCfg);

  dbModule.openPositionAtomically({
    order: {
      id: 'ORD-CONC-1',
      idempotencyKey: 'CONC-KEY-1',
      symbol: 'BTC/USDT',
      exchange: 'Binance',
      marketType: 'PERPETUAL',
      side: 'LONG',
      orderType: 'MARKET',
      quantity: 0.05,
      price: 90_000,
      stopLoss: 88_000,
      takeProfit: 94_000,
      leverage: 2,
      feesUsd: 2.25,
      slippageUsd: 1,
      status: 'FILLED',
      lifecycleState: 'FILLED',
      mode: 'PAPER',
      strategyName: 'AutoAlpha Test',
      riskDecision: 'APPROVE',
      createdAtUtc: new Date().toISOString(),
    },
    position: {
      id: 'POS-CONC-1',
      symbol: 'BTC/USDT',
      exchange: 'Binance',
      marketType: 'PERPETUAL',
      side: 'LONG',
      quantity: 0.05,
      entryPrice: 90_000,
      markPrice: 90_000,
      stopLoss: 88_000,
      initialStopLoss: 88_000,
      takeProfit: 94_000,
      leverage: 2,
      marginUsd: 2_250,
      unrealizedPnlUsd: 0,
      unrealizedPnlPct: 0,
      liquidationPrice: 45_450,
      fundingPaidUsd: 0,
      strategyName: 'AutoAlpha Test',
      mode: 'PAPER',
      openedAtUtc: new Date().toISOString(),
    },
    feeUsd: 2.25,
    auditActor: 'AUTO_EXECUTION_ENGINE',
    auditAction: 'AUTO_EXEC_ORDER_FILLED',
    auditDetails: 'Slot 1 filled',
  });

  // 2nd concurrent autonomous open must be rejected atomically by SQLite transaction at cap=1
  assert.throws(() =>
    dbModule.openPositionAtomically({
      order: {
        id: 'ORD-CONC-2',
        idempotencyKey: 'CONC-KEY-2',
        symbol: 'ETH/USDT',
        exchange: 'Binance',
        marketType: 'PERPETUAL',
        side: 'LONG',
        orderType: 'MARKET',
        quantity: 0.5,
        price: 3_000,
        stopLoss: 2_900,
        takeProfit: 3_300,
        leverage: 2,
        feesUsd: 0.75,
        slippageUsd: 0.3,
        status: 'FILLED',
        lifecycleState: 'FILLED',
        mode: 'PAPER',
        strategyName: 'AutoAlpha Test',
        riskDecision: 'APPROVE',
        createdAtUtc: new Date().toISOString(),
      },
      position: {
        id: 'POS-CONC-2',
        symbol: 'ETH/USDT',
        exchange: 'Binance',
        marketType: 'PERPETUAL',
        side: 'LONG',
        quantity: 0.5,
        entryPrice: 3_000,
        markPrice: 3_000,
        stopLoss: 2_900,
        initialStopLoss: 2_900,
        takeProfit: 3_300,
        leverage: 2,
        marginUsd: 750,
        unrealizedPnlUsd: 0,
        unrealizedPnlPct: 0,
        liquidationPrice: 1_515,
        fundingPaidUsd: 0,
        strategyName: 'AutoAlpha Test',
        mode: 'PAPER',
        openedAtUtc: new Date().toISOString(),
      },
      feeUsd: 0.75,
      auditActor: 'AUTO_EXECUTION_ENGINE',
      auditAction: 'AUTO_EXEC_ORDER_FILLED',
      auditDetails: 'Should exceed slot cap',
    }),
  );

  // 2. Rejected orders must NOT poison getRecentIdempotencyKeys
  dbModule.insertOrder({
    id: 'ORD-REJ-POISON',
    idempotencyKey: 'KEY-NOT-POISONED',
    symbol: 'SOL/USDT',
    exchange: 'Binance',
    marketType: 'PERPETUAL',
    side: 'LONG',
    orderType: 'MARKET',
    quantity: 1,
    price: 150,
    stopLoss: 145,
    takeProfit: 165,
    leverage: 2,
    feesUsd: 0,
    slippageUsd: 0,
    status: 'REJECTED',
    lifecycleState: 'RISK_REJECTED',
    mode: 'PAPER',
    strategyName: 'Test',
    riskDecision: 'REJECT',
    createdAtUtc: new Date().toISOString(),
  });
  const activeKeys = dbModule.getRecentIdempotencyKeys(50);
  assert.equal(activeKeys.includes('CONC-KEY-1'), true);
  assert.equal(activeKeys.includes('KEY-NOT-POISONED'), false);

  // 3. Close POS-CONC-1, push 25 filler orders, and confirm POST /close returns 409 alreadyClosed with authoritative portfolio & ledgerEpoch
  const closed = dbModule.closePositionAtomically({
    positionId: 'POS-CONC-1',
    resolveClosePrice: () => 91_000,
    closeReason: 'STOP_LOSS',
    idempotencyPrefix: 'CLOSE',
    actor: 'EXIT_STRATEGY',
    auditAction: 'AUTO_STOP_LOSS',
  });
  assert.equal(closed.closed, true);

  for (let i = 0; i < 25; i++) {
    dbModule.insertOrder({
      id: `ORD-FILLER-${i}`,
      idempotencyKey: `FILLER-${i}`,
      symbol: 'XRP/USDT',
      exchange: 'Binance',
      marketType: 'PERPETUAL',
      side: 'LONG',
      orderType: 'MARKET',
      quantity: 10,
      price: 1.5,
      stopLoss: 1.4,
      takeProfit: 1.8,
      leverage: 2,
      feesUsd: 0,
      slippageUsd: 0,
      status: 'CANCELLED',
      lifecycleState: 'CANCELLED',
      mode: 'PAPER',
      strategyName: 'Filler',
      riskDecision: 'APPROVE',
      createdAtUtc: new Date(Date.now() + i + 10).toISOString(),
    });
  }

  const closeAgainRes = await fetch(`${baseUrl}/api/positions/POS-CONC-1/close`, {
    method: 'POST',
  });
  assert.equal(closeAgainRes.status, 409);
  const closeAgainBody = (await closeAgainRes.json()) as {
    alreadyClosed: boolean;
    positions: unknown[];
    portfolio: { totalEquityUsd: number };
    ledgerEpoch: string;
    stateRevision: number;
  };
  assert.equal(closeAgainBody.alreadyClosed, true);
  assert.equal(closeAgainBody.positions.length, 0);
  assert.equal(closeAgainBody.ledgerEpoch, epochBefore);

  // Unknown ghost ID returns 404 with alreadyClosed: true & authoritative empty positions
  const ghostCloseRes = await fetch(`${baseUrl}/api/positions/POS-NON-EXISTENT-999/close`, {
    method: 'POST',
  });
  assert.equal(ghostCloseRes.status, 404);
  const ghostCloseBody = (await ghostCloseRes.json()) as {
    alreadyClosed: boolean;
    positions: unknown[];
    ledgerEpoch: string;
  };
  assert.equal(ghostCloseBody.alreadyClosed, true);
  assert.equal(ghostCloseBody.positions.length, 0);

  // 4. Resetting trading session rotates ledgerEpoch and sync bootstrap exposes it
  const resetRes = await fetch(`${baseUrl}/api/session/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'PAPER' }),
  });
  assert.equal(resetRes.status, 200);
  const resetJson = (await resetRes.json()) as { ledgerEpoch: string; stateRevision: number };
  assert.notEqual(resetJson.ledgerEpoch, epochBefore);

  const bootRes = await fetch(`${baseUrl}/api/sync/bootstrap`);
  assert.equal(bootRes.status, 200);
  const bootJson = (await bootRes.json()) as { ledgerEpoch: string; stateRevision: number };
  assert.equal(bootJson.ledgerEpoch, resetJson.ledgerEpoch);
});

