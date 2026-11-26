import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import dotenv from 'dotenv';
import { WebSocketServer, WebSocket } from 'ws';
import {
  appendAgentLog,
  appendAuditLog,
  closePositionAtomically,
  deletePosition,
  disconnectExchange,
  expireStaleAutoProposals,
  getAgentLogs,
  getAgents,
  getAuditLogs,
  getAutoExecutionConfig,
  getAutoProposals,
  getDatabaseDiagnostics,
  getExchanges,
  getExchangeEncryptedCredentials,
  getLatestPnlSnapshot,
  getOpenPositions,
  getOrders,
  getPnlHistory,
  getPortfolioSummary,
  getRecentIdempotencyKeys,
  getRiskConfig,
  getSignals,
  getStateRevision,
  getTradingMode,
  bumpStateRevision,
  initDatabase,
  insertOrder,
  openPositionAtomically,
  recordPnlSnapshot,
  resetTradingSession,
  saveAutoExecutionConfig,
  saveExchangeCredentials,
  savePortfolioSummary,
  saveRiskConfig,
  saveSignal,
  setTradingMode,
  updateAgent,
  updateExchangeVerificationStatus,
  upsertAutoProposal,
  upsertPosition,
} from './server/db.ts';
import {
  decryptSecretPayload,
  encryptSecretPayload,
  isPersistentVaultKeyConfigured,
  isStrictProductionRuntime,
  maskApiKey,
} from './server/cryptoVault.ts';
import { verifyExchangeCredentials } from './server/exchangeAuth.ts';
import { marketFeed } from './server/marketFeed.ts';
import { streamQuantCopilot, synthesizeWithGemini } from './server/geminiService.ts';
import { computeAllIndicators, detectMarketRegime } from './src/engine/indicators.ts';
import { validateTickerIntegrity } from './src/engine/dataIntegrity.ts';
import {
  clampAutoExecutionConfig,
  evaluateAutoExecutionCandidate,
  resolveTradingModeAfterAutoConfig,
  syncAutoConfigWithRiskConfig,
  syncAutoConfigWithTradingMode,
} from './src/engine/autoExecutionEngine.ts';
import {
  computePortfolioCorrelationGuard,
  computeQuantIntelligenceSnapshot,
} from './src/engine/quantIntelligence.ts';
import { computeLiquidationRadar } from './src/engine/liquidationRadar.ts';
import {
  classifyFeedFreshness,
  computeCrossVenueBasisBps,
  computeFeedHealthMetrics,
  mergeLiveTickIntoCandles,
} from './src/engine/priceFeedGuard.ts';
import {
  estimateLiquidationPrice,
  evaluateOrderRisk,
} from './src/engine/riskEngine.ts';
import {
  benchmarkAllStrategies,
  optimizeStrategyWalkForward,
  runBacktest,
} from './src/engine/backtester.ts';
import { STRATEGY_CATALOG } from './src/engine/adaptiveConfluence.ts';
import {
  buildDeepVerifiedOpportunity,
  computeMarketBreadth,
  preScreenMarketDirectory,
  rankDeepOpportunities,
} from './src/engine/marketScreener.ts';
import { getExchangeSpec } from './src/engine/exchangeCatalog.ts';
import { runMultiAgentDecisionPipeline } from './src/engine/multiAgentPipeline.ts';
import {
  evaluateLivePositionLifecycle,
  validatePositionSlTpUpdate,
} from './src/engine/positionMetrics.ts';
import { findMatchingSignal } from './src/engine/pairSelection.ts';
import { getSmartPriceDecimals, type MarketDirectoryEntry } from './src/engine/symbolSearch.ts';
import type {
  AutoExecutionActivityEntry,
  AutoExecutionConfig,
  AutoExecutionEngineStatus,
  AutoExecutionProposal,
  BacktestConfig,
  BacktestStrategyId,
  Candle,
  ClosePositionReceipt,
  ExchangeEnvironment,
  FullMarketOpportunity,
  FullMarketScanResponse,
  MarketTicker,
  MarketType,
  OrderRequest,
  OrderSide,
  PnlHistoryPoint,
  Position,
  RiskCheckResult,
  RiskConfig,
  ScannerAssetUniverse,
  ScannerStrategyFocus,
  SmartOpportunityCandidate,
  TradingMode,
  TradingSignal,
} from './src/engine/types.ts';

dotenv.config();
initDatabase();

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '512kb' }));

// Security Headers (compatible with AI Studio preview iframe)
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  next();
});

function buildAllowedOrigins(): Set<string> {
  const origins = new Set<string>([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ]);
  for (const raw of [process.env.APP_URL, process.env.ALLOWED_ORIGIN]) {
    if (!raw) continue;
    for (const part of raw.split(',')) {
      const trimmed = part.trim().replace(/\/+$/, '');
      if (trimmed && trimmed !== 'MY_APP_URL') {
        origins.add(trimmed);
      }
    }
  }
  return origins;
}

// Strict Origin/CORS policy for /api routes
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    const allowed = buildAllowedOrigins();
    const hostHeader = req.headers.host;
    const isSameHost =
      Boolean(hostHeader) &&
      (origin === `https://${hostHeader}` || origin === `http://${hostHeader}`);
    const isCloudRunPreview = /^https:\/\/[a-z0-9.-]+\.run\.app$/i.test(origin);
    if (isSameHost || allowed.has(origin) || isCloudRunPreview) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Token');
    } else {
      if (req.method === 'OPTIONS') {
        res.status(403).end();
        return;
      }
    }
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

// Sliding-window per-IP rate limiter for sensitive / compute-heavy routes
export function createRateLimiter(options: { maxRequests: number; windowMs: number }) {
  const hits = new Map<string, number[]>();
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const now = Date.now();
    const clientIp = String(req.ip || req.socket?.remoteAddress || 'unknown');
    const cutoff = now - options.windowMs;
    const prev = (hits.get(clientIp) ?? []).filter((ts) => ts > cutoff);
    if (prev.length >= options.maxRequests) {
      const retryAfterSec = Math.max(1, Math.ceil((prev[0] + options.windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        error: `Quá nhiều yêu cầu trong thời gian ngắn. Vui lòng thử lại sau ${retryAfterSec}s.`,
      });
      return;
    }
    prev.push(now);
    hits.set(clientIp, prev);
    if (hits.size > 2000) {
      for (const [k, list] of hits.entries()) {
        const fresh = list.filter((ts) => ts > cutoff);
        if (fresh.length === 0) hits.delete(k);
        else hits.set(k, fresh);
      }
    }
    next();
  };
}

// Optional timing-safe bearer/header auth when OMNISENT_ADMIN_TOKEN is configured
export function requireAdminAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  const expected = process.env.OMNISENT_ADMIN_TOKEN?.trim();
  if (!expected) {
    next();
    return;
  }
  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const headerToken = typeof req.headers['x-admin-token'] === 'string' ? req.headers['x-admin-token'].trim() : '';
  const supplied = bearerToken || headerToken;
  const expectedBuf = Buffer.from(expected, 'utf8');
  const suppliedBuf = Buffer.from(supplied, 'utf8');
  if (
    supplied.length === 0 ||
    expectedBuf.length !== suppliedBuf.length ||
    !crypto.timingSafeEqual(expectedBuf, suppliedBuf)
  ) {
    res.status(401).json({
      error: 'Yêu cầu xác thực quản trị (Authorization: Bearer <OMNISENT_ADMIN_TOKEN> hoặc X-Admin-Token).',
    });
    return;
  }
  next();
}

const aiRateLimiter = createRateLimiter({ maxRequests: 24, windowMs: 60_000 });
const exchangeRateLimiter = createRateLimiter({ maxRequests: 30, windowMs: 60_000 });
const executionRateLimiter = createRateLimiter({ maxRequests: 45, windowMs: 60_000 });
const scanBacktestRateLimiter = createRateLimiter({ maxRequests: 36, windowMs: 60_000 });

app.use('/api/ai', aiRateLimiter);
app.use('/api/exchanges/test', exchangeRateLimiter, requireAdminAuth);
app.use('/api/exchanges/connect', exchangeRateLimiter, requireAdminAuth);
app.use('/api/exchanges/:id/verify', exchangeRateLimiter, requireAdminAuth);
app.use('/api/exchanges/verify-all', exchangeRateLimiter, requireAdminAuth);
app.use('/api/exchanges/:id/disconnect', requireAdminAuth);
app.use('/api/orders', executionRateLimiter, requireAdminAuth);
app.use('/api/positions', executionRateLimiter, requireAdminAuth);
app.use('/api/mode', requireAdminAuth);
app.use('/api/emergency-stop', requireAdminAuth);
app.use('/api/session/reset', requireAdminAuth);
app.use('/api/risk/config', requireAdminAuth);
app.use('/api/auto-trade/config', requireAdminAuth);
app.use('/api/auto-trade/cycle', requireAdminAuth);
app.use('/api/auto-trade/proposals', requireAdminAuth);
app.use('/api/agents/:id/action', requireAdminAuth);
app.use('/api/market/scan', scanBacktestRateLimiter);
app.use('/api/backtest', scanBacktestRateLimiter);

let coldWarmupPromise: Promise<void> | null = null;
async function ensureServerWarm(): Promise<void> {
  if (!process.env.VERCEL && !process.env.VERCEL_ENV) return;
  if (!coldWarmupPromise) {
    coldWarmupPromise = (async () => {
      try {
        await marketFeed.refreshFeed();
      } catch {
        // Non-fatal in cold-start serverless fallback
      }
    })();
  }
  await coldWarmupPromise;
}

app.use('/api', async (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  await ensureServerWarm();
  next();
});

// Helper to recompute portfolio equity, mark-to-market positions, and record real PnL snapshots
function syncPortfolioAndPositions(options?: {
  eventTag?: string;
  forceRecord?: boolean;
  skipSnapshotWriteIfUnchanged?: boolean;
}): {
  portfolio: ReturnType<typeof getPortfolioSummary>;
  positions: Position[];
  latestPnlPoint: PnlHistoryPoint | null;
} {
  const portfolio = getPortfolioSummary();
  const positions = getOpenPositions();
  const tickers = marketFeed.getTickers();
  const riskConfig = getRiskConfig();

  let unrealizedSum = 0;
  let usedMarginSum = 0;
  let autoClosed = false;
  const updatedPositions: Position[] = [];

  for (const pos of positions) {
    const ticker =
      tickers.find(
        (t) =>
          t.symbol === pos.symbol &&
          t.marketType === pos.marketType &&
          t.exchange.toUpperCase() === pos.exchange.toUpperCase(),
      ) ??
      tickers.find((t) => t.symbol === pos.symbol && t.marketType === pos.marketType) ??
      tickers.find((t) => t.symbol === pos.symbol);
    const hasLiveMark = Boolean(ticker && ticker.lastPrice > 0);
    const markPrice = hasLiveMark && ticker ? ticker.lastPrice : pos.markPrice;
    const canEvaluateTriggers = Boolean(
      ticker && ticker.dataStatus === 'LIVE_EXCHANGE' && ticker.lastPrice > 0,
    );

    const lifecycle = evaluateLivePositionLifecycle({
      position: pos,
      markPrice,
      canEvaluateTriggers,
    });

    if (lifecycle.closed && lifecycle.closePrice !== undefined) {
      const actionTag =
        lifecycle.closeReason === 'TAKE_PROFIT'
          ? 'AUTO_TAKE_PROFIT'
          : lifecycle.closeReason === 'TRAILING_PROFIT'
            ? 'AUTO_TRAILING_PROFIT_EXIT'
            : 'AUTO_STOP_LOSS';

      const closedRes = closePositionAtomically({
        positionId: pos.id,
        resolveClosePrice: () => lifecycle.closePrice!,
        closeReason: lifecycle.closeReason ?? 'STOP_LOSS',
        idempotencyPrefix: 'CLOSE',
        actor: 'EXIT_STRATEGY',
        auditAction: actionTag,
        auditSeverity: lifecycle.closeReason === 'STOP_LOSS' ? 'WARNING' : 'INFO',
      });
      if (closedRes.closed) {
        autoClosed = true;
        const freshPort = getPortfolioSummary();
        portfolio.realizedPnlUsd = freshPort.realizedPnlUsd;
        portfolio.totalFeesUsd = freshPort.totalFeesUsd;
        portfolio.winCount = freshPort.winCount;
        portfolio.lossCount = freshPort.lossCount;
        portfolio.totalClosedTrades = freshPort.totalClosedTrades;
        portfolio.winRatePct = freshPort.winRatePct;
      }
      continue;
    }

    if (lifecycle.trailingStage === 'BREAKEVEN_ARMED') {
      appendAuditLog({
        category: 'RISK',
        severity: 'INFO',
        actor: 'EXIT_STRATEGY',
        action: 'AUTO_BREAKEVEN_ARMED',
        details: `Tự động khóa hòa vốn (+0.65R) ${pos.symbol} ${pos.side}: SL -> $${lifecycle.nextStopLoss} (Mark $${markPrice}).`,
      });
    } else if (
      lifecycle.trailingStage === 'STEP_LOCK_055R' ||
      lifecycle.trailingStage === 'CHANDELIER_55PCT'
    ) {
      appendAuditLog({
        category: 'RISK',
        severity: 'INFO',
        actor: 'EXIT_STRATEGY',
        action: 'AUTO_TRAILING_SL_UPDATED',
        details: `Dời Trailing Stop (${lifecycle.trailingStage}) ${pos.symbol} ${pos.side}: SL -> $${lifecycle.nextStopLoss} (Mark $${markPrice}).`,
      });
    }

    const updated: Position = {
      ...pos,
      markPrice,
      stopLoss: lifecycle.nextStopLoss,
      unrealizedPnlUsd: lifecycle.unrealizedPnlUsd,
      unrealizedPnlPct: lifecycle.unrealizedPnlPct,
    };
    upsertPosition(updated);
    updatedPositions.push(updated);
    unrealizedSum += updated.unrealizedPnlUsd;
    usedMarginSum += updated.marginUsd;
  }

  const totalEquity = Number(
    (portfolio.initialEquityUsd + portfolio.realizedPnlUsd + unrealizedSum).toFixed(2),
  );
  portfolio.totalEquityUsd = totalEquity;
  portfolio.unrealizedPnlUsd = Number(unrealizedSum.toFixed(2));
  portfolio.usedMarginUsd = Number(usedMarginSum.toFixed(2));
  portfolio.availableBalanceUsd = Number(
    Math.max(0, totalEquity - usedMarginSum).toFixed(2),
  );
  if (totalEquity > portfolio.peakEquityUsd) {
    portfolio.peakEquityUsd = totalEquity;
  }
  const dd =
    portfolio.peakEquityUsd > 0
      ? ((portfolio.peakEquityUsd - totalEquity) / portfolio.peakEquityUsd) * 100
      : 0;
  portfolio.currentDrawdownPct = Number(Math.max(0, dd).toFixed(2));
  portfolio.dailyPnlPct = Number(
    (((totalEquity - portfolio.initialEquityUsd) / portfolio.initialEquityUsd) * 100).toFixed(2),
  );
  portfolio.weeklyPnlPct = portfolio.dailyPnlPct;

  // Automatic Drawdown Circuit Breaker
  let circuitBreakerTripped = false;
  if (
    portfolio.currentDrawdownPct >= riskConfig.maxDrawdownPct &&
    getTradingMode() !== 'EMERGENCY_STOP'
  ) {
    circuitBreakerTripped = true;
    setTradingMode('EMERGENCY_STOP');
    portfolio.mode = 'EMERGENCY_STOP';
    saveAutoExecutionConfig(
      syncAutoConfigWithTradingMode('EMERGENCY_STOP', getAutoExecutionConfig()),
    );
    autoExecRuntime.lastSummary = `Circuit Breaker kích hoạt tại Drawdown ${portfolio.currentDrawdownPct}% (>= ${riskConfig.maxDrawdownPct}%) — đã tự động khóa Auto-Execution.`;
    appendAuditLog({
      category: 'EMERGENCY',
      severity: 'CRITICAL',
      actor: 'RISK_MANAGEMENT',
      action: 'DRAWDOWN_CIRCUIT_BREAKER',
      details: `Drawdown ${portfolio.currentDrawdownPct}% đạt ngưỡng ${riskConfig.maxDrawdownPct}% — tự động kích hoạt EMERGENCY_STOP và tắt Auto-Execution.`,
    });
  }

  savePortfolioSummary(portfolio);

  const nowMs = Date.now();
  const prevSnap = getLatestPnlSnapshot();
  const netPnl = Number((portfolio.realizedPnlUsd + portfolio.unrealizedPnlUsd).toFixed(2));
  const changed =
    !prevSnap ||
    prevSnap.realizedPnlUsd !== portfolio.realizedPnlUsd ||
    prevSnap.unrealizedPnlUsd !== portfolio.unrealizedPnlUsd ||
    prevSnap.openPositionsCount !== updatedPositions.length;
  const elapsedMs = prevSnap ? nowMs - prevSnap.timestampMs : Infinity;

  let latestPnlPoint = prevSnap;
  const routineMinIntervalMs = options?.skipSnapshotWriteIfUnchanged ? 8000 : 1500;
  if (
    options?.forceRecord ||
    autoClosed ||
    circuitBreakerTripped ||
    (changed && elapsedMs >= routineMinIntervalMs) ||
    elapsedMs >= 16_000
  ) {
    const point: PnlHistoryPoint = {
      timestampMs: nowMs,
      timestampUtc: new Date(nowMs).toISOString(),
      realizedPnlUsd: portfolio.realizedPnlUsd,
      unrealizedPnlUsd: portfolio.unrealizedPnlUsd,
      netPnlUsd: netPnl,
      totalEquityUsd: portfolio.totalEquityUsd,
      openPositionsCount: updatedPositions.length,
      eventTag: circuitBreakerTripped ? 'EMERGENCY_STOP' : autoClosed ? 'AUTO_SL_TP' : options?.eventTag,
    };
    recordPnlSnapshot(point);
    latestPnlPoint = point;
  }

  if (circuitBreakerTripped && !isBroadcastingTick) {
    autoExecRuntime.broadcastAutoStatus?.();
  } else if (autoClosed && !circuitBreakerTripped) {
    const autoCfg = getAutoExecutionConfig();
    if (
      autoCfg.enabled &&
      autoCfg.maintainActivePositions &&
      getTradingMode() === 'FULL_AUTO' &&
      updatedPositions.length < autoCfg.targetActivePositions
    ) {
      scheduleAutonomousReplenishment(2200);
    }
  }

  return { portfolio, positions: updatedPositions, latestPnlPoint };
}

// --- API Routes ---

app.get('/api/health', (_req, res) => {
  const mode = getTradingMode();
  const tickers = marketFeed.getTickers();
  const integrityReports = tickers.slice(0, 6).map((t) => validateTickerIntegrity(t));
  const validCount = integrityReports.filter((r) => r.valid).length;
  res.json({
    status: 'OK',
    tradingMode: mode,
    liveExchangeFeed: marketFeed.isLiveFeedActive(),
    dataIntegrityHealthy: validCount === integrityReports.length,
    uptimeSec: Math.round(process.uptime()),
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    geminiConfigured:
      Boolean(process.env.GEMINI_API_KEY) &&
      process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY',
    vaultPersistentKeyConfigured: isPersistentVaultKeyConfigured(),
    strictVaultProduction: isStrictProductionRuntime(),
    adminAuthEnabled: Boolean(process.env.OMNISENT_ADMIN_TOKEN?.trim()),
    database: getDatabaseDiagnostics(),
    timestampUtc: new Date().toISOString(),
  });
});

app.get('/api/sync/bootstrap', (_req, res) => {
  const tickers = marketFeed.getTickers();
  const { portfolio, positions } = syncPortfolioAndPositions({
    skipSnapshotWriteIfUnchanged: true,
  });
  res.json({
    stateRevision: getStateRevision(),
    tradingMode: getTradingMode(),
    liveFeedActive: marketFeed.isLiveFeedActive(),
    feedHealth: computeFeedHealthMetrics(tickers),
    tickers,
    totalDirectoryCount: marketFeed.getDirectoryCount(),
    portfolio,
    positions,
    autoExecutionStatus: buildAutoExecutionStatus(),
    serverUtc: new Date().toISOString(),
  });
});

app.get('/api/market/tickers', (_req, res) => {
  const tickers = marketFeed.getTickers();
  const integrity = tickers.map((t) => validateTickerIntegrity(t));
  res.json({
    tickers,
    totalDirectoryCount: marketFeed.getDirectoryCount(),
    feedHealth: computeFeedHealthMetrics(tickers),
    integritySummary: {
      total: integrity.length,
      valid: integrity.filter((r) => r.valid).length,
      anomalies: integrity.filter((r) => !r.valid).slice(0, 10),
    },
    liveFeedActive: marketFeed.isLiveFeedActive(),
    serverUtc: new Date().toISOString(),
  });
});

app.get('/api/market/quote', async (req, res) => {
  const symbol = String(req.query.symbol || 'BTC/USDT').slice(0, 40);
  const marketType = (String(req.query.marketType || 'PERPETUAL') as MarketType);
  const exchange = req.query.exchange ? String(req.query.exchange).slice(0, 32) : undefined;
  let ticker = marketFeed.getTicker(symbol, marketType, exchange);
  const staleOrMissing = !ticker || ticker.lastPrice <= 0 || Date.now() - ticker.timestampUtc > 2000;
  if (staleOrMissing) {
    ticker = (await marketFeed.refreshPairQuote(symbol, marketType, exchange)) ?? ticker;
  }
  if (!ticker) {
    res.status(404).json({ error: `Không tìm thấy dữ liệu giá cho ${symbol}.` });
    return;
  }
  const allTickers = marketFeed.getTickers();
  res.json({
    ticker,
    freshness: classifyFeedFreshness(ticker.timestampUtc),
    basis: computeCrossVenueBasisBps(allTickers, ticker),
    serverUtc: new Date().toISOString(),
  });
});

app.get('/api/market/search', async (req, res) => {
  const q = String(req.query.q || '').slice(0, 80);
  const rawMarket = String(req.query.marketType || 'ALL').toUpperCase();
  const marketType =
    rawMarket === 'SPOT' || rawMarket === 'PERPETUAL' ? (rawMarket as MarketType) : 'ALL';
  const exchange = String(req.query.exchange || 'ALL').slice(0, 32);
  const rawSort = String(req.query.sort || 'relevance').toLowerCase();
  const sort =
    rawSort === 'volume' || rawSort === 'gainer' || rawSort === 'loser' ? rawSort : 'relevance';
  const limit = Math.min(60, Math.max(1, Number(req.query.limit || 32) || 32));

  const { results, totalIndexed } = await marketFeed.searchMarkets(q, {
    marketType,
    exchange,
    sort,
    limit,
  });

  res.json({
    results,
    totalIndexed,
    activeCount: marketFeed.getTickers().length,
    serverUtc: new Date().toISOString(),
  });
});

app.post('/api/market/select', async (req, res) => {
  const symbol = String(req.body?.symbol || '').trim();
  const rawMarket = req.body?.marketType ? String(req.body.marketType).toUpperCase() : undefined;
  const marketType =
    rawMarket === 'SPOT' || rawMarket === 'PERPETUAL' ? (rawMarket as MarketType) : undefined;
  const exchange = req.body?.exchange ? String(req.body.exchange) : undefined;

  if (!symbol) {
    res.status(400).json({ error: 'Vui lòng cung cấp mã coin hoặc cặp giao dịch.' });
    return;
  }

  const ticker = await marketFeed.activatePair(symbol, marketType, exchange);
  if (!ticker || ticker.lastPrice <= 0) {
    res.status(404).json({
      error: `Không tìm thấy dữ liệu giá thực tế đang giao dịch cho ${symbol} trên các sàn hỗ trợ.`,
    });
    return;
  }

  res.json({
    ticker,
    tickers: marketFeed.getTickers(),
    totalDirectoryCount: marketFeed.getDirectoryCount(),
    serverUtc: new Date().toISOString(),
  });
});

app.get('/api/market/candles', async (req, res) => {
  const symbol = String(req.query.symbol || 'BTC/USDT');
  const marketType = (String(req.query.marketType || 'PERPETUAL') as MarketType);
  const interval = String(req.query.interval || '1h');
  const exchange = req.query.exchange ? String(req.query.exchange) : undefined;
  const [{ candles, status, source }, book] = await Promise.all([
    marketFeed.getCandles(symbol, marketType, interval, exchange),
    marketFeed.getOrderBook(symbol, marketType, exchange).catch(() => null),
  ]);
  if (candles.length === 0) {
    res.status(503).json({
      error: `Không thể lấy nến OHLCV thực tế từ sàn cho ${symbol}.`,
      symbol,
      marketType,
      exchange: exchange ?? null,
      interval,
      status,
      source,
      candles: [],
      indicators: null,
      quantIntel: null,
    });
    return;
  }
  const ticker = marketFeed.getTicker(symbol, marketType, exchange);
  const liveCandles =
    ticker && ticker.dataStatus === 'LIVE_EXCHANGE' && ticker.lastPrice > 0
      ? mergeLiveTickIntoCandles(candles, ticker.lastPrice, ticker.timestampUtc, interval)
      : candles;
  const indicators = computeAllIndicators(liveCandles);
  const riskConfig = getRiskConfig();
  const portfolio = getPortfolioSummary();
  const quantIntel = computeQuantIntelligenceSnapshot({
    candles: liveCandles,
    orderBook: book,
    ticker,
    winProbability: 0.56,
    riskReward: Math.max(1.6, riskConfig.minRiskReward),
    riskConfig,
    accountEquityUsd: portfolio.totalEquityUsd,
  });
  res.json({
    symbol,
    marketType,
    exchange: exchange ?? null,
    interval,
    status,
    source,
    candles: liveCandles,
    indicators,
    quantIntel,
  });
});

app.get('/api/market/orderbook', async (req, res) => {
  const symbol = String(req.query.symbol || 'BTC/USDT');
  const marketType = (String(req.query.marketType || 'PERPETUAL') as MarketType);
  const exchange = req.query.exchange ? String(req.query.exchange) : undefined;
  const book = await marketFeed.getOrderBook(symbol, marketType, exchange);
  res.json(book);
});

app.get('/api/market/liquidation-radar', async (req, res) => {
  const symbol = String(req.query.symbol || 'BTC/USDT');
  const marketType = (String(req.query.marketType || 'PERPETUAL') as MarketType);
  const interval = String(req.query.interval || '1h');
  const exchange = req.query.exchange ? String(req.query.exchange) : undefined;
  const [{ candles, status, source }, book] = await Promise.all([
    marketFeed.getCandles(symbol, marketType, interval, exchange),
    marketFeed.getOrderBook(symbol, marketType, exchange).catch(() => null),
  ]);
  if (candles.length === 0) {
    res.status(503).json({
      error: `Không thể lấy dữ liệu nến để quét vùng thanh lý cho ${symbol}.`,
      symbol,
      marketType,
      exchange: exchange ?? null,
      status,
      source,
      liquidationRadar: null,
    });
    return;
  }
  const indicators = computeAllIndicators(candles);
  const ticker = marketFeed.getTicker(symbol, marketType, exchange);
  const riskConfig = getRiskConfig();
  const liquidationRadar = computeLiquidationRadar({
    candles,
    orderBook: book,
    ticker,
    atr14: indicators.atr14,
    riskConfig,
  });
  res.json({
    symbol,
    marketType,
    exchange: exchange ?? null,
    interval,
    status,
    source,
    ticker,
    indicators,
    liquidationRadar,
  });
});

function directoryEntryToSyntheticTicker(entry: MarketDirectoryEntry, spreadBps: number, volatilityPct: number, liquidityScore: number): MarketTicker {
  return {
    symbol: entry.symbol,
    baseAsset: entry.baseAsset,
    quoteAsset: entry.quoteAsset,
    exchange: entry.exchange,
    marketType: entry.marketType,
    lastPrice: entry.lastPrice,
    bidPrice: entry.bidPrice,
    askPrice: entry.askPrice,
    change24hPct: entry.change24hPct,
    high24h: entry.high24h ?? entry.lastPrice,
    low24h: entry.low24h ?? entry.lastPrice,
    volume24hUsd: entry.volume24hUsd,
    openInterestUsd: entry.openInterestUsd ?? null,
    fundingRatePct: entry.fundingRatePct ?? null,
    spreadBps,
    volatility24hPct: volatilityPct,
    rsi14: null,
    regime: 'SIDEWAYS',
    liquidityScore,
    dataStatus: 'LIVE_EXCHANGE',
    sourceLabel: `${entry.exchange} Full-Market Scanner`,
    timestampUtc: Date.now(),
    latencyMs: 90,
    tickSize: entry.lastPrice < 0.0001 ? 0.00000001 : entry.lastPrice < 0.01 ? 0.000001 : 0.001,
    lotSize: 0.001,
    minOrderUsd: 10,
    maxLeverage: entry.maxLeverage,
    tradingStatus: 'TRADING',
  };
}

async function runFullMarketAlphaScan(params: {
  scanMode: 'FAST' | 'DEEP';
  marketType?: MarketType | 'ALL';
  exchange?: string;
  minVolumeUsd?: number;
  strategyFocus?: ScannerStrategyFocus;
  direction?: OrderSide | 'ALL';
  assetUniverse?: ScannerAssetUniverse;
  limit?: number;
}): Promise<{
  response: FullMarketScanResponse;
  bestRaw?: { ticker: MarketTicker; signal: TradingSignal };
  rankedRaw?: Array<{ opp: FullMarketOpportunity; ticker: MarketTicker; signal: TradingSignal }>;
}> {
  const t0 = Date.now();
  let directory = marketFeed.getMarketDirectory();
  if (directory.length === 0) {
    await marketFeed.refreshFeed();
    directory = marketFeed.getMarketDirectory();
  }
  if (directory.length === 0) {
    directory = marketFeed
      .getTickers()
      .filter((t) => t.lastPrice > 0)
      .map((t) => ({
        symbol: t.symbol,
        baseAsset: t.baseAsset,
        quoteAsset: t.quoteAsset,
        exchange: (t.exchange === 'Bybit' || t.exchange === 'OKX' || t.exchange === 'Kraken' || t.exchange === 'Coinbase Advanced'
          ? t.exchange
          : 'Binance') as MarketDirectoryEntry['exchange'],
        exchangeId: (t.exchange.toLowerCase().includes('bybit')
          ? 'bybit'
          : t.exchange.toLowerCase().includes('okx')
            ? 'okx'
            : t.exchange.toLowerCase().includes('kraken')
              ? 'kraken'
              : t.exchange.toLowerCase().includes('coinbase')
                ? 'coinbase'
                : 'binance') as MarketDirectoryEntry['exchangeId'],
        marketType: t.marketType,
        nativeSymbol: t.symbol.replace('/', ''),
        lastPrice: t.lastPrice,
        bidPrice: t.bidPrice,
        askPrice: t.askPrice,
        change24hPct: t.change24hPct,
        volume24hUsd: t.volume24hUsd,
        maxLeverage: t.maxLeverage,
        high24h: t.high24h,
        low24h: t.low24h,
        fundingRatePct: t.fundingRatePct,
        openInterestUsd: t.openInterestUsd,
      }));
  }

  const marketType = params.marketType ?? 'ALL';
  const exchange = params.exchange ?? 'ALL';
  const minVolumeUsd = Number.isFinite(params.minVolumeUsd) ? Math.max(0, Number(params.minVolumeUsd)) : 1_000_000;
  const strategyFocus = params.strategyFocus ?? 'HIGH_PROFIT_ALPHA';
  const direction = params.direction ?? 'ALL';
  const assetUniverse: ScannerAssetUniverse = params.assetUniverse === 'ALL' ? 'ALL' : 'CRYPTO';
  const requestedLimit = Math.min(40, Math.max(6, params.limit ?? (params.scanMode === 'DEEP' ? 18 : 20)));

  const breadth = computeMarketBreadth(directory);
  const stage1 = preScreenMarketDirectory(directory, {
    marketType,
    exchange,
    minVolumeUsd,
    strategyFocus,
    assetUniverse,
    dedupeBySymbol: true,
    limit: requestedLimit,
  });

  if (params.scanMode === 'FAST') {
    const filteredFast =
      direction === 'ALL' ? stage1 : stage1.filter((s) => s.direction === direction);
    return {
      response: {
        scanMode: 'FAST',
        filters: { marketType, exchange, minVolumeUsd, strategyFocus, direction, assetUniverse },
        breadth,
        stage1CandidatesCount: stage1.length,
        deepEvaluatedCount: 0,
        approvedCount: 0,
        durationMs: Math.max(1, Date.now() - t0),
        scannedAtUtc: new Date().toISOString(),
        opportunities: filteredFast.map((o, idx) => ({ ...o, rank: idx + 1 })),
      },
    };
  }

  // Stage 2: Deep Multi-Timeframe (1H + 4H + L2 Book + Empirical 160-bar Backtest) in bounded batches of 6.
  // When global account is still in ANALYSIS_ONLY, evaluate setup risk rules against PAPER mode so valid
  // quantitative setups accurately report APPROVED vs REJECTED instead of blanket-rejecting the whole market.
  const riskConfig = getRiskConfig();
  const effectiveMode = getTradingMode();
  const screenerRiskMode: TradingMode =
    effectiveMode === 'ANALYSIS_ONLY' ? 'PAPER' : effectiveMode;
  const agents = getAgents();
  const { portfolio, positions } = syncPortfolioAndPositions();
  const recentIdempKeys = getRecentIdempotencyKeys();

  const evaluatedResults: Array<{
    opp: FullMarketOpportunity;
    ticker: MarketTicker;
    signal: TradingSignal;
  }> = [];

  const batchSize = 6;
  for (let i = 0; i < stage1.length; i += batchSize) {
    const batch = stage1.slice(i, i + batchSize);
    const batchSettled = await Promise.all(
      batch.map(async (cand) => {
        try {
          const dirMatch = directory.find(
            (d) =>
              d.symbol === cand.symbol &&
              d.marketType === cand.marketType &&
              d.exchange === cand.exchange,
          );
          const [{ candles }, htfRes, orderBook] = await Promise.all([
            marketFeed.getCandles(cand.symbol, cand.marketType, '1h', cand.exchange),
            marketFeed.getCandles(cand.symbol, cand.marketType, '4h', cand.exchange).catch(() => ({ candles: [] })),
            marketFeed.getOrderBook(cand.symbol, cand.marketType, cand.exchange),
          ]);
          if (candles.length < 24) return null;

          const baseTicker =
            marketFeed.getTicker(cand.symbol, cand.marketType, cand.exchange) ??
            directoryEntryToSyntheticTicker(
              dirMatch ?? {
                symbol: cand.symbol,
                baseAsset: cand.baseAsset,
                quoteAsset: cand.quoteAsset,
                exchange: cand.exchange as MarketDirectoryEntry['exchange'],
                exchangeId: cand.exchangeId as MarketDirectoryEntry['exchangeId'],
                marketType: cand.marketType,
                nativeSymbol: cand.symbol.replace('/', ''),
                lastPrice: cand.lastPrice,
                bidPrice: cand.bidPrice,
                askPrice: cand.askPrice,
                change24hPct: cand.change24hPct,
                volume24hUsd: cand.volume24hUsd,
                maxLeverage: cand.maxLeverage,
                high24h: cand.lastPrice,
                low24h: cand.lastPrice,
                fundingRatePct: cand.fundingRatePct,
                openInterestUsd: cand.openInterestUsd,
              },
              cand.spreadBps,
              cand.volatility24hPct,
              cand.liquidityScore,
            );

          const ind = computeAllIndicators(candles);
          const liveTicker: MarketTicker = {
            ...baseTicker,
            rsi14: Number(ind.rsi14.toFixed(1)),
            regime: detectMarketRegime(ind, baseTicker.lastPrice, cand.volatility24hPct),
          };

          const signal = runMultiAgentDecisionPipeline({
            ticker: liveTicker,
            candles,
            htfCandles: htfRes.candles,
            orderBook,
            riskConfig,
            riskContext: {
              tradingMode: screenerRiskMode,
              accountEquityUsd: portfolio.totalEquityUsd,
              availableBalanceUsd: portfolio.availableBalanceUsd,
              dailyPnlPct: portfolio.dailyPnlPct,
              weeklyPnlPct: portfolio.weeklyPnlPct,
              currentDrawdownPct: portfolio.currentDrawdownPct,
              openPositions: positions,
              recentIdempotencyKeys: recentIdempKeys,
            },
            agents,
          });

          let backtestRes = null;
          if (candles.length >= 45) {
            try {
              backtestRes = runBacktest(
                candles,
                {
                  symbol: cand.symbol,
                  timeframe: '1h',
                  strategyId: 'ADAPTIVE_CONFLUENCE_ALPHA',
                  marketType: cand.marketType,
                  initialCapitalUsd: 10_000,
                  riskPerTradePct: riskConfig.riskPerTradePct,
                  leverage: cand.marketType === 'SPOT' ? 1 : Math.min(riskConfig.defaultLeverage, cand.maxLeverage),
                  feeRateBps: 5,
                  slippageBps: 3,
                  fundingRatePer8hPct: cand.marketType === 'PERPETUAL' ? 0.01 : 0,
                  stopLossAtrMult: 1.65,
                  takeProfitAtrMult: 2.75,
                  monteCarloRuns: 20,
                  useTrailingProfitLock: true,
                },
                `${cand.exchange} 1h Live`,
              );
            } catch {
              backtestRes = null;
            }
          }

          const opp = buildDeepVerifiedOpportunity({
            stage1: cand,
            signal,
            backtest: backtestRes,
          });
          return { opp, ticker: liveTicker, signal };
        } catch {
          return null;
        }
      }),
    );

    for (const item of batchSettled) {
      if (item) evaluatedResults.push(item);
    }
  }

  const ranked = rankDeepOpportunities(
    evaluatedResults.map((r) => r.opp),
    direction,
  );
  const topOpp = ranked[0];
  const topRaw = topOpp
    ? evaluatedResults.find(
        (r) =>
          r.opp.symbol === topOpp.symbol &&
          r.opp.marketType === topOpp.marketType &&
          r.opp.exchange === topOpp.exchange,
      )
    : evaluatedResults[0];

  const approvedCount = ranked.filter(
    (o) => o.signalState === 'APPROVED' && o.direction !== 'NO_TRADE',
  ).length;

  const evaluatedByKey = new Map(
    evaluatedResults.map((r) => [`${r.opp.symbol}|${r.opp.marketType}|${r.opp.exchange}`, r]),
  );
  const rankedRaw = ranked
    .map((o) => evaluatedByKey.get(`${o.symbol}|${o.marketType}|${o.exchange}`))
    .filter((item): item is { opp: FullMarketOpportunity; ticker: MarketTicker; signal: TradingSignal } =>
      Boolean(item),
    );

  return {
    response: {
      scanMode: 'DEEP',
      filters: { marketType, exchange, minVolumeUsd, strategyFocus, direction, assetUniverse },
      breadth,
      stage1CandidatesCount: stage1.length,
      deepEvaluatedCount: evaluatedResults.length,
      approvedCount,
      durationMs: Math.max(1, Date.now() - t0),
      scannedAtUtc: new Date().toISOString(),
      opportunities: ranked,
    },
    bestRaw: topRaw ? { ticker: topRaw.ticker, signal: topRaw.signal } : undefined,
    rankedRaw,
  };
}

app.get('/api/market/scan', async (req, res) => {
  try {
    const rawMarket = String(req.query.marketType || 'ALL').toUpperCase();
    const marketType =
      rawMarket === 'SPOT' || rawMarket === 'PERPETUAL' ? (rawMarket as MarketType) : 'ALL';
    const exchange = String(req.query.exchange || 'ALL');
    const minVolumeUsd = Number(req.query.minVolumeUsd ?? 1_000_000);
    const strategyFocus = String(req.query.strategyFocus || 'HIGH_PROFIT_ALPHA') as ScannerStrategyFocus;
    const rawDir = String(req.query.direction || 'ALL').toUpperCase();
    const direction = rawDir === 'LONG' || rawDir === 'SHORT' ? (rawDir as OrderSide) : 'ALL';
    const assetUniverse: ScannerAssetUniverse =
      String(req.query.assetUniverse || 'CRYPTO').toUpperCase() === 'ALL' ? 'ALL' : 'CRYPTO';
    const limit = Number(req.query.limit ?? 20);

    const { response } = await runFullMarketAlphaScan({
      scanMode: 'FAST',
      marketType,
      exchange,
      minVolumeUsd,
      strategyFocus,
      direction,
      assetUniverse,
      limit,
    });
    res.json(response);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message || 'Lỗi khi quét thị trường.' });
  }
});

app.post('/api/market/scan', async (req, res) => {
  try {
    const scanMode = String(req.body?.mode || 'DEEP').toUpperCase() === 'FAST' ? 'FAST' : 'DEEP';
    const rawMarket = String(req.body?.marketType || 'ALL').toUpperCase();
    const marketType =
      rawMarket === 'SPOT' || rawMarket === 'PERPETUAL' ? (rawMarket as MarketType) : 'ALL';
    const exchange = String(req.body?.exchange || 'ALL');
    const minVolumeUsd = Number(req.body?.minVolumeUsd ?? 1_000_000);
    const strategyFocus = String(req.body?.strategyFocus || 'HIGH_PROFIT_ALPHA') as ScannerStrategyFocus;
    const rawDir = String(req.body?.direction || 'ALL').toUpperCase();
    const direction = rawDir === 'LONG' || rawDir === 'SHORT' ? (rawDir as OrderSide) : 'ALL';
    const assetUniverse: ScannerAssetUniverse =
      String(req.body?.assetUniverse || 'CRYPTO').toUpperCase() === 'ALL' ? 'ALL' : 'CRYPTO';
    const limit = Number(req.body?.limit ?? (scanMode === 'DEEP' ? 18 : 24));

    const { response } = await runFullMarketAlphaScan({
      scanMode,
      marketType,
      exchange,
      minVolumeUsd,
      strategyFocus,
      direction,
      assetUniverse,
      limit,
    });

    if (scanMode === 'DEEP') {
      appendAuditLog({
        category: 'AGENT',
        severity: 'INFO',
        actor: 'MARKET_SCANNER',
        action: 'FULL_MARKET_DEEP_SCAN',
        details: `Quét ${response.breadth.totalScannedPairs} cặp toàn thị trường -> kiểm định ${response.deepEvaluatedCount} cặp (1H+4H+Backtest), tìm thấy ${response.approvedCount} tín hiệu đạt chuẩn Risk Engine trong ${response.durationMs}ms.`,
      });
    }

    res.json(response);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message || 'Lỗi khi quét sâu toàn thị trường.' });
  }
});

app.get('/api/agents', (_req, res) => {
  res.json({
    agents: getAgents(),
    logs: getAgentLogs(undefined, 40),
  });
});

app.post('/api/agents/:id/action', (req, res) => {
  const { id } = req.params;
  const action = String(req.body?.action || '').toUpperCase();
  const agents = getAgents();
  const target = agents.find((a) => a.id === id);
  if (!target) {
    res.status(404).json({ error: 'Không tìm thấy Agent.' });
    return;
  }

  const nowIso = new Date().toISOString();
  if (action === 'DISABLE') {
    target.enabled = false;
    target.status = 'DISABLED';
  } else if (action === 'ENABLE' || action === 'START' || action === 'RESTART') {
    target.enabled = true;
    target.status = 'ONLINE';
    target.healthPct = 100;
  } else if (action === 'STOP') {
    target.status = 'OFFLINE';
  } else {
    res.status(400).json({ error: 'Hành động không hợp lệ.' });
    return;
  }
  target.lastActivityUtc = nowIso;
  updateAgent(target);

  appendAgentLog({
    agentId: target.id,
    level: 'INFO',
    message: `Thực thi lệnh ${action} bởi người dùng.`,
  });
  appendAuditLog({
    category: 'AGENT',
    severity: 'INFO',
    actor: 'USER',
    action: `AGENT_${action}`,
    details: `${target.name} (${target.id}) chuyển trạng thái sang ${target.status}.`,
  });
  autoExecRuntime.broadcastAutoStatus?.();

  res.json({ agent: target });
});

app.post('/api/pipeline/run', async (req, res) => {
  const symbol = String(req.body?.symbol || 'BTC/USDT');
  const marketType = (String(req.body?.marketType || 'PERPETUAL') as MarketType);
  const exchange = req.body?.exchange ? String(req.body.exchange) : undefined;
  const ticker =
    marketFeed.getTicker(symbol, marketType, exchange) ??
    (await marketFeed.activatePair(symbol, marketType, exchange));
  if (!ticker) {
    res.status(404).json({ error: `Không tìm thấy thị trường cho ${symbol}.` });
    return;
  }

  const t0 = Date.now();
  const [{ candles }, htfRes, orderBook] = await Promise.all([
    marketFeed.getCandles(ticker.symbol, ticker.marketType, '1h', ticker.exchange),
    marketFeed.getCandles(ticker.symbol, ticker.marketType, '4h', ticker.exchange).catch(() => ({ candles: [] })),
    marketFeed.getOrderBook(ticker.symbol, ticker.marketType, ticker.exchange),
  ]);
  if (candles.length === 0) {
    res.status(503).json({ error: `Chưa có dữ liệu OHLCV thực tế từ sàn cho ${symbol}.` });
    return;
  }

  const riskConfig = getRiskConfig();
  const { portfolio, positions } = syncPortfolioAndPositions();
  const agents = getAgents();

  const signal = runMultiAgentDecisionPipeline({
    ticker,
    candles,
    htfCandles: htfRes.candles,
    orderBook,
    riskConfig,
    riskContext: {
      tradingMode: getTradingMode(),
      accountEquityUsd: portfolio.totalEquityUsd,
      availableBalanceUsd: portfolio.availableBalanceUsd,
      dailyPnlPct: portfolio.dailyPnlPct,
      weeklyPnlPct: portfolio.weeklyPnlPct,
      currentDrawdownPct: portfolio.currentDrawdownPct,
      openPositions: positions,
      recentIdempotencyKeys: getRecentIdempotencyKeys(),
    },
    agents,
  });

  const elapsedMs = Math.max(1, Date.now() - t0);
  const nowIso = new Date().toISOString();
  for (const ag of agents) {
    if (!ag.enabled) continue;
    ag.latencyMs = ag.id === 'MARKET_DATA' ? ticker.latencyMs : elapsedMs;
    ag.evalCount = (ag.evalCount ?? 0) + 1;
    ag.lastActivityUtc = nowIso;
    const vote = signal.agentVotes.find((v) => v.agentId === ag.id);
    if (vote) {
      ag.lastOutput = `${ticker.symbol}: ${vote.stance} (${vote.score}/100) — ${vote.rationale}`;
    } else if (ag.id === 'MASTER_ORCHESTRATOR') {
      ag.lastOutput = `Pipeline ${ticker.symbol}: ${signal.direction} (${signal.confidenceScore}/100) · ${signal.state}`;
    }
    updateAgent(ag);
  }

  saveSignal(signal);
  appendAgentLog({
    agentId: 'MASTER_ORCHESTRATOR',
    level: signal.state === 'APPROVED' ? 'INFO' : 'WARN',
    message: `Pipeline ${ticker.symbol} (${ticker.marketType} · ${ticker.exchange}): ${signal.direction} · State=${signal.state} · Risk=${signal.riskCheck.decision}`,
  });
  appendAuditLog({
    category: 'AGENT',
    severity: 'INFO',
    actor: 'MASTER_ORCHESTRATOR',
    action: 'PIPELINE_EVALUATION',
    details: `Đánh giá ${ticker.symbol} (${ticker.exchange}): ${signal.direction}, R:R=${signal.riskReward}, Risk=${signal.riskCheck.decision}.`,
  });
  autoExecRuntime.broadcastAutoStatus?.();

  res.json({ signal });
});

app.post('/api/ai/synthesize', async (req, res) => {
  const symbol = String(req.body?.symbol || 'BTC/USDT');
  const marketType = (String(req.body?.marketType || 'PERPETUAL') as MarketType);
  const exchange = req.body?.exchange ? String(req.body.exchange) : undefined;
  const locale = req.body?.locale === 'en' ? 'en' : 'vi';
  const ticker =
    marketFeed.getTicker(symbol, marketType, exchange) ??
    (await marketFeed.activatePair(symbol, marketType, exchange));
  if (!ticker) {
    res.status(404).json({ error: `Không tìm thấy ${symbol}.` });
    return;
  }

  const [{ candles }, htfRes, orderBook] = await Promise.all([
    marketFeed.getCandles(ticker.symbol, ticker.marketType, '1h', ticker.exchange),
    marketFeed.getCandles(ticker.symbol, ticker.marketType, '4h', ticker.exchange).catch(() => ({ candles: [] })),
    marketFeed.getOrderBook(ticker.symbol, ticker.marketType, ticker.exchange),
  ]);
  if (candles.length === 0) {
    res.status(503).json({ error: `Chưa có dữ liệu OHLCV thực tế từ sàn cho ${symbol}.` });
    return;
  }
  const indicators = computeAllIndicators(candles);
  const { portfolio, positions } = syncPortfolioAndPositions();

  const signal = runMultiAgentDecisionPipeline({
    ticker,
    candles,
    htfCandles: htfRes.candles,
    orderBook,
    riskConfig: getRiskConfig(),
    riskContext: {
      tradingMode: getTradingMode(),
      accountEquityUsd: portfolio.totalEquityUsd,
      availableBalanceUsd: portfolio.availableBalanceUsd,
      dailyPnlPct: portfolio.dailyPnlPct,
      weeklyPnlPct: portfolio.weeklyPnlPct,
      currentDrawdownPct: portfolio.currentDrawdownPct,
      openPositions: positions,
      recentIdempotencyKeys: getRecentIdempotencyKeys(),
    },
    agents: getAgents(),
  });

  const synthesis = await synthesizeWithGemini({
    ticker,
    indicators,
    signal,
    quantIntel: signal.quantIntel,
    locale,
  });
  if (synthesis.status === 'OK') {
    appendAgentLog({
      agentId: 'MASTER_ORCHESTRATOR',
      level: 'INFO',
      message: `Gemini 4 Hydrogen (${synthesis.thinkingLevel ?? 'XHIGH'}) + Decisions API ${symbol}: ${synthesis.recommendedAction}`,
    });
  }
  res.json({ synthesis, signal });
});

app.post('/api/ai/copilot/stream', async (req, res) => {
  const question = String(req.body?.question || '').trim();
  const symbol = String(req.body?.symbol || 'BTC/USDT');
  const marketType = (String(req.body?.marketType || 'PERPETUAL') as MarketType);
  const exchange = req.body?.exchange ? String(req.body.exchange) : undefined;
  const locale = req.body?.locale === 'en' ? 'en' : 'vi';
  const history = Array.isArray(req.body?.history)
    ? (req.body.history as Array<{ role: 'user' | 'model'; text: string }>)
    : [];

  if (!question) {
    res.status(400).json({ error: locale === 'en' ? 'Question is required.' : 'Vui lòng nhập câu hỏi.' });
    return;
  }

  const ticker =
    marketFeed.getTicker(symbol, marketType, exchange) ??
    (await marketFeed.activatePair(symbol, marketType, exchange));
  if (!ticker) {
    res.status(404).json({ error: `Symbol ${symbol} unavailable.` });
    return;
  }

  const [{ candles }, orderBook] = await Promise.all([
    marketFeed.getCandles(ticker.symbol, ticker.marketType, '1h', ticker.exchange),
    marketFeed.getOrderBook(ticker.symbol, ticker.marketType, ticker.exchange),
  ]);
  const { portfolio, positions } = syncPortfolioAndPositions();
  const riskConfig = getRiskConfig();
  const signal = findMatchingSignal(getSignals(40), ticker) ?? undefined;
  const quantIntel =
    candles.length >= 15
      ? computeQuantIntelligenceSnapshot({
          candles,
          orderBook,
          ticker,
          winProbability: 0.56,
          riskReward: Math.max(1.6, riskConfig.minRiskReward),
          riskConfig,
          accountEquityUsd: portfolio.totalEquityUsd,
        })
      : null;

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendEvent = (payload: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  await streamQuantCopilot({
    question,
    symbol: ticker.symbol,
    marketType: ticker.marketType,
    exchange: ticker.exchange,
    locale,
    history,
    contextSnapshot: {
      ticker,
      portfolio,
      positions,
      signal,
      quantIntel,
    },
    tools: {
      getLiveMarketSnapshot: (reqSym) => {
        const target =
          (reqSym ? marketFeed.getTicker(reqSym, ticker.marketType) : null) ??
          (reqSym ? marketFeed.getTicker(reqSym) : null) ??
          ticker;
        return {
          symbol: target.symbol,
          exchange: target.exchange,
          marketType: target.marketType,
          lastPrice: target.lastPrice,
          change24hPct: target.change24hPct,
          volume24hUsd: target.volume24hUsd,
          spreadBps: target.spreadBps,
          fundingRatePct: target.fundingRatePct,
          liquidityScore: target.liquidityScore,
          regime: target.regime,
          rsi14: target.rsi14,
          orderBookImbalancePct: Number((orderBook.imbalanceRatio * 100).toFixed(2)),
          dataStatus: target.dataStatus,
        };
      },
      getQuantMicrostructure: () => ({
        symbol: ticker.symbol,
        quantIntel,
        signalSummary: signal
          ? {
              direction: signal.direction,
              state: signal.state,
              confidenceScore: signal.confidenceScore,
              expectedValueR: signal.expectedValueR,
              riskReward: signal.riskReward,
              htfAlignment: signal.htfAlignment,
            }
          : null,
      }),
      getPortfolioRiskState: () => ({
        tradingMode: getTradingMode(),
        portfolio,
        openPositionsCount: positions.length,
        openPositions: positions.map((p) => ({
          symbol: p.symbol,
          side: p.side,
          leverage: p.leverage,
          unrealizedPnlUsd: p.unrealizedPnlUsd,
          stopLoss: p.stopLoss,
          takeProfit: p.takeProfit,
        })),
        riskLimits: {
          maxRiskPerTradePct: riskConfig.maxRiskPerTradePct,
          maxLeverage: riskConfig.maxLeverage,
          maxDrawdownPct: riskConfig.maxDrawdownPct,
          allowMartingale: riskConfig.allowMartingale,
        },
      }),
    },
    handlers: {
      onMeta: (meta) => sendEvent({ type: 'meta', ...meta }),
      onToolCall: (tool) => sendEvent({ type: 'tool', ...tool }),
      onDelta: (text) => sendEvent({ type: 'delta', text }),
      onDone: (payload) => {
        sendEvent({ type: 'done', ...payload });
        res.end();
      },
      onError: (err) => {
        sendEvent({ type: 'error', ...err });
        res.end();
      },
    },
  });
});

// --- Autonomous 9-Gate Auto-Execution Engine ---

const autoExecRuntime: {
  cycleInProgress: boolean;
  lastCycleAtMs: number | null;
  lastScanDurationMs: number | null;
  lastSummary: string;
  recentExecutionTimestampsMs: number[];
  symbolCooldowns: Record<string, number>;
  recentActivity: AutoExecutionActivityEntry[];
  autoTradesTotalCount: number;
  broadcastAutoStatus: (() => void) | null;
  replenishTimer: ReturnType<typeof setTimeout> | null;
} = {
  cycleInProgress: false,
  lastCycleAtMs: null,
  lastScanDurationMs: null,
  lastSummary: 'Hệ thống Auto-Execution FULL_AUTO sẵn sàng duy trì vị thế thông minh.',
  recentExecutionTimestampsMs: [],
  symbolCooldowns: {},
  recentActivity: [],
  autoTradesTotalCount: 0,
  broadcastAutoStatus: null,
  replenishTimer: null,
};

let isBroadcastingTick = false;

function scheduleAutonomousReplenishment(delayMs = 1800): void {
  if (autoExecRuntime.replenishTimer) {
    clearTimeout(autoExecRuntime.replenishTimer);
  }
  autoExecRuntime.replenishTimer = setTimeout(() => {
    autoExecRuntime.replenishTimer = null;
    const cfg = getAutoExecutionConfig();
    const mode = getTradingMode();
    if (!cfg.enabled || (mode !== 'FULL_AUTO' && mode !== 'SEMI_AUTO')) return;
    void runAutonomousExecutionCycle('SCHEDULER');
  }, delayMs);
}

function pruneAndCountHourlyTrades(nowMs = Date.now()): number {
  const cutoff = nowMs - 3_600_000;
  autoExecRuntime.recentExecutionTimestampsMs = autoExecRuntime.recentExecutionTimestampsMs.filter(
    (ts) => ts >= cutoff,
  );
  return autoExecRuntime.recentExecutionTimestampsMs.length;
}

function recordAutoActivity(entry: Omit<AutoExecutionActivityEntry, 'id' | 'timestampUtc'>): void {
  const item: AutoExecutionActivityEntry = {
    id: `ACT-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    timestampUtc: new Date().toISOString(),
    ...entry,
  };
  autoExecRuntime.recentActivity = [item, ...autoExecRuntime.recentActivity].slice(0, 25);
}

function executeRiskVerifiedPaperOrder(params: {
  orderReq: OrderRequest;
  riskCheck: RiskCheckResult;
  markPrice: number;
  actor: string;
  auditAction: string;
}): { orderId: string; position: Position; execPrice: number; feeUsd: number } {
  const { orderReq, riskCheck, markPrice, actor, auditAction } = params;
  const nowIso = new Date().toISOString();
  const orderId = `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const slippageAdj = orderReq.orderType === 'MARKET' ? 0.0003 : 0;
  const pxDec = getSmartPriceDecimals(orderReq.entryPrice);
  const execPrice =
    orderReq.side === 'LONG'
      ? Number((orderReq.entryPrice * (1 + slippageAdj)).toFixed(pxDec))
      : Number((orderReq.entryPrice * (1 - slippageAdj)).toFixed(pxDec));

  const feeUsd = Number((riskCheck.recommendedQuantity * execPrice * 0.0005).toFixed(2));
  const slipUsd = Number((riskCheck.recommendedQuantity * orderReq.entryPrice * slippageAdj).toFixed(2));
  const effLev = orderReq.marketType === 'SPOT' ? 1 : orderReq.leverage;

  const newPos: Position = {
    id: `POS-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    symbol: orderReq.symbol,
    exchange: orderReq.exchange,
    marketType: orderReq.marketType,
    side: orderReq.side,
    quantity: riskCheck.recommendedQuantity,
    entryPrice: execPrice,
    markPrice: markPrice > 0 ? markPrice : execPrice,
    stopLoss: orderReq.stopLoss,
    initialStopLoss: orderReq.stopLoss,
    takeProfit: orderReq.takeProfit,
    leverage: effLev,
    marginUsd: riskCheck.requiredMarginUsd,
    unrealizedPnlUsd: 0,
    unrealizedPnlPct: 0,
    liquidationPrice: estimateLiquidationPrice(
      orderReq.side,
      execPrice,
      effLev,
      orderReq.marketType,
    ),
    fundingPaidUsd: 0,
    strategyName: orderReq.strategyName || 'Autonomous Alpha',
    mode: 'PAPER',
    openedAtUtc: nowIso,
  };

  openPositionAtomically({
    order: {
      id: orderId,
      idempotencyKey: orderReq.idempotencyKey,
      symbol: orderReq.symbol,
      exchange: orderReq.exchange,
      marketType: orderReq.marketType,
      side: orderReq.side,
      orderType: orderReq.orderType,
      quantity: riskCheck.recommendedQuantity,
      price: execPrice,
      stopLoss: orderReq.stopLoss,
      takeProfit: orderReq.takeProfit,
      leverage: effLev,
      feesUsd: feeUsd,
      slippageUsd: slipUsd,
      status: 'FILLED',
      mode: 'PAPER',
      strategyName: orderReq.strategyName || 'Autonomous Alpha',
      riskDecision: riskCheck.decision,
      createdAtUtc: nowIso,
    },
    position: newPos,
    feeUsd,
    auditActor: actor,
    auditAction,
    auditDetails: `Khớp lệnh tự động ${orderReq.side} ${riskCheck.recommendedQuantity} ${orderReq.symbol} @ $${execPrice} (R:R ${riskCheck.riskRewardRatio}, Fee $${feeUsd}).`,
  });

  return { orderId, position: newPos, execPrice, feeUsd };
}

function buildAutoExecutionStatus(): AutoExecutionEngineStatus {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  expireStaleAutoProposals(nowIso);
  const config = getAutoExecutionConfig();
  const tradingMode = getTradingMode();
  const tradesExecutedLastHour = pruneAndCountHourlyTrades(nowMs);

  const activeCooldowns: Record<string, string> = {};
  for (const [sym, untilMs] of Object.entries(autoExecRuntime.symbolCooldowns)) {
    if (untilMs > nowMs) {
      activeCooldowns[sym] = new Date(untilMs).toISOString();
    } else {
      delete autoExecRuntime.symbolCooldowns[sym];
    }
  }

  const engineRunning =
    config.enabled && (tradingMode === 'FULL_AUTO' || tradingMode === 'SEMI_AUTO');
  const nextCycleMs =
    engineRunning && autoExecRuntime.lastCycleAtMs
      ? autoExecRuntime.lastCycleAtMs + config.scanIntervalSeconds * 1000
      : engineRunning
        ? nowMs + config.scanIntervalSeconds * 1000
        : null;

  return {
    config,
    tradingMode,
    engineRunning,
    cycleInProgress: autoExecRuntime.cycleInProgress,
    lastCycleAtUtc: autoExecRuntime.lastCycleAtMs
      ? new Date(autoExecRuntime.lastCycleAtMs).toISOString()
      : null,
    nextCycleAtUtc: nextCycleMs ? new Date(nextCycleMs).toISOString() : null,
    lastScanDurationMs: autoExecRuntime.lastScanDurationMs,
    lastSummary: autoExecRuntime.lastSummary,
    tradesExecutedLastHour,
    autoTradesTotalCount: autoExecRuntime.autoTradesTotalCount,
    symbolCooldowns: activeCooldowns,
    recentActivity: autoExecRuntime.recentActivity,
    pendingProposals: getAutoProposals('PENDING', 15),
  };
}

async function runAutonomousExecutionCycle(
  trigger: 'SCHEDULER' | 'MANUAL_TRIGGER',
): Promise<AutoExecutionEngineStatus> {
  if (autoExecRuntime.cycleInProgress) {
    return buildAutoExecutionStatus();
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  expireStaleAutoProposals(nowIso);

  const config = getAutoExecutionConfig();
  const tradingMode = getTradingMode();

  if (tradingMode === 'EMERGENCY_STOP') {
    autoExecRuntime.lastSummary =
      'EMERGENCY_STOP đang kích hoạt — động cơ Auto-Execution tạm khóa toàn bộ lệnh mới.';
    if (trigger === 'MANUAL_TRIGGER') {
      recordAutoActivity({
        symbol: 'SYSTEM',
        exchange: 'ALL',
        side: 'NO_TRADE',
        action: 'BLOCKED',
        reason: autoExecRuntime.lastSummary,
      });
    }
    return buildAutoExecutionStatus();
  }

  if (trigger === 'SCHEDULER' && (!config.enabled || (tradingMode !== 'FULL_AUTO' && tradingMode !== 'SEMI_AUTO'))) {
    return buildAutoExecutionStatus();
  }

  autoExecRuntime.cycleInProgress = true;
  const t0 = Date.now();

  try {
    const effectiveEvalMode: TradingMode =
      tradingMode === 'ANALYSIS_ONLY' ? config.executionMode : tradingMode;

    const fullScan = await runFullMarketAlphaScan({
      scanMode: 'DEEP',
      marketType: 'ALL',
      minVolumeUsd: config.minVolume24hUsd,
      strategyFocus: 'HIGH_PROFIT_ALPHA',
      assetUniverse: 'CRYPTO',
      limit: 28,
    });

    const { portfolio, positions } = syncPortfolioAndPositions();
    const riskConfig = getRiskConfig();
    const recentIdempKeys = getRecentIdempotencyKeys(200);
    const candlesBySymbol: Record<string, Candle[]> = {};

    const candidateRaw = (fullScan.rankedRaw ?? []).slice(0, 16);
    await Promise.all([
      ...positions.map(async (p) => {
        if (candlesBySymbol[p.symbol]) return;
        const c = await marketFeed.getCandles(p.symbol, p.marketType, '1h', p.exchange).catch(() => null);
        if (c && c.candles.length > 0) candlesBySymbol[p.symbol] = c.candles;
      }),
      ...candidateRaw.map(async (item) => {
        if (candlesBySymbol[item.ticker.symbol]) return;
        const c = await marketFeed
          .getCandles(item.ticker.symbol, item.ticker.marketType, '1h', item.ticker.exchange)
          .catch(() => null);
        if (c && c.candles.length > 0) candlesBySymbol[item.ticker.symbol] = c.candles;
      }),
    ]);

    let actionable = candidateRaw.filter(
      (item) => item.signal.direction !== 'NO_TRADE' && item.signal.state === 'APPROVED',
    );

    // Multi-Timeframe Tactical 15m + 1H Rescue Scout when 1H bar has 0 approved setups
    if (actionable.length === 0 && candidateRaw.length > 0) {
      const agents = getAgents();
      const tacticalPool = candidateRaw.slice(0, 10);
      const tacticalResults = await Promise.all(
        tacticalPool.map(async (item) => {
          try {
            const [res15m, orderBook] = await Promise.all([
              marketFeed.getCandles(item.ticker.symbol, item.ticker.marketType, '15m', item.ticker.exchange),
              marketFeed.getOrderBook(item.ticker.symbol, item.ticker.marketType, item.ticker.exchange),
            ]);
            if (res15m.candles.length < 30) return null;
            const candles1h = candlesBySymbol[item.ticker.symbol] ?? [];
            const sig15m = runMultiAgentDecisionPipeline({
              ticker: item.ticker,
              candles: res15m.candles,
              htfCandles: candles1h,
              orderBook,
              riskConfig,
              riskContext: {
                tradingMode: effectiveEvalMode,
                accountEquityUsd: portfolio.totalEquityUsd,
                availableBalanceUsd: portfolio.availableBalanceUsd,
                dailyPnlPct: portfolio.dailyPnlPct,
                weeklyPnlPct: portfolio.weeklyPnlPct,
                currentDrawdownPct: portfolio.currentDrawdownPct,
                openPositions: getOpenPositions(),
                recentIdempotencyKeys: recentIdempKeys,
              },
              agents,
            });
            if (sig15m.direction === 'NO_TRADE' || sig15m.state !== 'APPROVED') return null;
            const tacticalSignal: TradingSignal = {
              ...sig15m,
              timeHorizon: '15m Tactical · 1H HTF',
            };
            const tacticalOpp = buildDeepVerifiedOpportunity({
              stage1: {
                ...item.opp,
                deepVerified: false,
              },
              signal: tacticalSignal,
              backtest: null,
            });
            return {
              ...item,
              signal: tacticalSignal,
              opp: {
                ...tacticalOpp,
                reasoningSummary: `[15m+1H] ${sig15m.reasoningSummary}`,
              },
            };
          } catch {
            return null;
          }
        }),
      );
      actionable = tacticalResults.filter((r): r is NonNullable<typeof r> => Boolean(r));
    }

    let executedCount = 0;
    let proposedCount = 0;
    const slotCap = Math.min(config.maxSimultaneousAutoPositions, riskConfig.maxOpenPositions);
    const desiredActiveSlots = config.maintainActivePositions
      ? Math.min(slotCap, Math.max(1, config.targetActivePositions))
      : 1;

    const executeOrStageCandidate = async (
      item: (typeof actionable)[number],
      allowTacticalFallback: boolean,
    ): Promise<'EXECUTED' | 'PROPOSED' | 'SKIPPED'> => {
      const currentOpen = getOpenPositions();
      const hourlyCount = pruneAndCountHourlyTrades(Date.now());
      const latestPortfolio = syncPortfolioAndPositions().portfolio;
      const evalResult = evaluateAutoExecutionCandidate({
        config,
        tradingMode: effectiveEvalMode,
        opportunity: item.opp,
        ticker: item.ticker,
        signal: item.signal,
        riskConfig,
        portfolio: latestPortfolio,
        openPositions: currentOpen,
        candlesBySymbol,
        tradesExecutedLastHour: hourlyCount,
        cooldownUntilMs: autoExecRuntime.symbolCooldowns[item.ticker.symbol] ?? 0,
        recentIdempotencyKeys: getRecentIdempotencyKeys(200),
        allowTacticalFallback,
        nowMs: Date.now(),
      });

      if (!evalResult.passed) {
        if (!allowTacticalFallback) {
          recordAutoActivity({
            symbol: item.ticker.symbol,
            exchange: item.ticker.exchange,
            side: item.signal.direction,
            action: 'SKIPPED',
            reason: evalResult.gateFailures[0] || 'Không đạt đủ 9 màng lọc định lượng.',
            alphaScore: item.opp.compositeAlphaScore,
            expectedValueR: item.opp.expectedValueR,
            tier: 'CORE_9_GATE',
          });
        }
        return 'SKIPPED';
      }

      saveSignal(item.signal);

      if (config.executionMode === 'FULL_AUTO' && effectiveEvalMode === 'FULL_AUTO') {
        if (tradingMode === 'ANALYSIS_ONLY') {
          autoExecRuntime.lastSummary = `Tìm thấy ${item.ticker.symbol} đạt chuẩn — đang ở ANALYSIS_ONLY nên giữ nguyên tắc không khớp lệnh.`;
          return 'SKIPPED';
        }

        await marketFeed
          .activatePair(item.ticker.symbol, item.ticker.marketType, item.ticker.exchange)
          .catch(() => null);

        const filled = executeRiskVerifiedPaperOrder({
          orderReq: evalResult.orderRequest,
          riskCheck: evalResult.riskCheck,
          markPrice: item.ticker.lastPrice,
          actor: 'AUTO_EXECUTION_ENGINE',
          auditAction:
            evalResult.executionTier === 'CORE_9_GATE'
              ? 'AUTO_EXEC_ORDER_FILLED'
              : 'AUTO_TACTICAL_ORDER_FILLED',
        });

        const execNowMs = Date.now();
        autoExecRuntime.recentExecutionTimestampsMs.push(execNowMs);
        autoExecRuntime.autoTradesTotalCount += 1;
        autoExecRuntime.symbolCooldowns[item.ticker.symbol] =
          execNowMs + config.cooldownMinutesPerSymbol * 60_000;
        executedCount += 1;

        const tierLabel = evalResult.executionTier === 'CORE_9_GATE' ? '9-Gate Core' : 'Tactical Continuity';
        const msg = `Auto FULL_AUTO [${tierLabel}] khớp ${evalResult.orderRequest.side} ${evalResult.riskCheck.recommendedQuantity} ${item.ticker.symbol} @ $${filled.execPrice} (Alpha ${item.opp.compositeAlphaScore.toFixed(1)}, EV +${item.opp.expectedValueR.toFixed(2)}R, Risk ${evalResult.effectiveRiskPct}%).`;
        autoExecRuntime.lastSummary = msg;

        recordAutoActivity({
          symbol: item.ticker.symbol,
          exchange: item.ticker.exchange,
          side: evalResult.orderRequest.side,
          action: 'EXECUTED',
          reason: msg,
          alphaScore: item.opp.compositeAlphaScore,
          expectedValueR: item.opp.expectedValueR,
          tier: evalResult.executionTier,
        });
        appendAgentLog({
          agentId: 'EXECUTION_AGENT',
          level: 'INFO',
          message: msg,
        });
        syncPortfolioAndPositions({ eventTag: 'ORDER_FILLED', forceRecord: true });
        return 'EXECUTED';
      }

      // SEMI_AUTO mode: stage verified proposal for trader 1-click confirmation
      const existingPending = getAutoProposals('PENDING', 20).find(
        (p) =>
          p.symbol === item.ticker.symbol &&
          p.exchange === item.ticker.exchange &&
          p.side === evalResult.orderRequest.side,
      );
      if (!existingPending) {
        const propNow = Date.now();
        const proposal: AutoExecutionProposal = {
          id: `PROP-${propNow}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
          symbol: item.ticker.symbol,
          exchange: item.ticker.exchange,
          marketType: item.ticker.marketType,
          side: evalResult.orderRequest.side,
          entryPrice: item.ticker.lastPrice,
          stopLoss: evalResult.orderRequest.stopLoss,
          takeProfit: evalResult.orderRequest.takeProfit,
          leverage: evalResult.orderRequest.leverage,
          recommendedQuantity: evalResult.riskCheck.recommendedQuantity,
          recommendedRiskPct: evalResult.effectiveRiskPct,
          requiredMarginUsd: evalResult.riskCheck.requiredMarginUsd,
          confluenceScore: item.opp.confluenceScore,
          expectedValueR: item.opp.expectedValueR,
          riskReward: item.signal.riskReward,
          winProbabilityPct: Number((evalResult.winProbabilityEstimate * 100).toFixed(1)),
          compositeAlphaScore: item.opp.compositeAlphaScore,
          hurstRegime: item.signal.quantIntel?.hurst.regimeClass ?? 'TRENDING_PERSISTENT',
          orderFlowBias: item.signal.quantIntel?.microstructure.orderFlowBias ?? 'NEUTRAL',
          htfAlignment: item.opp.htfAlignment,
          maxSameSideCorrelation: evalResult.maxSameSideCorrelation,
          strategyName: evalResult.orderRequest.strategyName || 'Autonomous Alpha',
          reasoningSummary: item.opp.reasoningSummary,
          status: 'PENDING',
          createdAtUtc: new Date(propNow).toISOString(),
          expiresAtUtc: new Date(propNow + 30 * 60_000).toISOString(),
        };
        upsertAutoProposal(proposal);
        proposedCount += 1;

        recordAutoActivity({
          symbol: item.ticker.symbol,
          exchange: item.ticker.exchange,
          side: evalResult.orderRequest.side,
          action: 'PROPOSED',
          reason: `Đề xuất SEMI_AUTO: Alpha ${item.opp.compositeAlphaScore.toFixed(1)} · EV +${item.opp.expectedValueR.toFixed(2)}R · Win ${(evalResult.winProbabilityEstimate * 100).toFixed(0)}%.`,
          alphaScore: item.opp.compositeAlphaScore,
          expectedValueR: item.opp.expectedValueR,
          tier: evalResult.executionTier,
        });
        appendAuditLog({
          category: 'AGENT',
          severity: 'INFO',
          actor: 'AUTO_EXECUTION_ENGINE',
          action: 'SEMI_AUTO_PROPOSAL_STAGED',
          details: `Đề xuất SEMI_AUTO ${proposal.symbol} ${proposal.side} @ $${proposal.entryPrice} (Alpha ${proposal.compositeAlphaScore}).`,
        });
        return 'PROPOSED';
      }
      return 'SKIPPED';
    };

    if (actionable.length === 0) {
      autoExecRuntime.lastSummary = `Đã quét ${fullScan.response.deepEvaluatedCount} cặp 1H+4H+15m (${fullScan.response.breadth.totalScannedPairs} cặp toàn sàn): Chưa có setup đạt chuẩn Risk & Alpha.`;
      recordAutoActivity({
        symbol: fullScan.rankedRaw?.[0]?.ticker.symbol ?? 'MARKET',
        exchange: fullScan.rankedRaw?.[0]?.ticker.exchange ?? 'MULTI',
        side: 'NO_TRADE',
        action: 'SKIPPED',
        reason: 'Chưa có cặp nào đồng thời đạt Signal APPROVED trên khung 1H hoặc 15m.',
      });
    } else {
      const executedPairKeys = new Set<string>(
        getOpenPositions().map((p) => `${p.symbol.toUpperCase()}|${p.marketType}`),
      );
      // Pass 1: Strict 9-Gate Core Alpha across uncorrelated open slots
      for (const item of actionable) {
        if (config.executionMode === 'FULL_AUTO' && getOpenPositions().length >= desiredActiveSlots) break;
        if (config.executionMode === 'SEMI_AUTO' && proposedCount >= 2) break;
        const pairKey = `${item.ticker.symbol.toUpperCase()}|${item.ticker.marketType}`;
        if (executedPairKeys.has(pairKey)) continue;
        const outcome = await executeOrStageCandidate(item, false);
        if (outcome === 'EXECUTED') executedPairKeys.add(pairKey);
      }

      // Pass 2: Tactical Continuity Tier (only if maintainActivePositions is enabled & slots still below target)
      if (
        config.maintainActivePositions &&
        config.executionMode === 'FULL_AUTO' &&
        effectiveEvalMode === 'FULL_AUTO' &&
        tradingMode !== 'ANALYSIS_ONLY' &&
        getOpenPositions().length < desiredActiveSlots
      ) {
        for (const item of actionable) {
          if (getOpenPositions().length >= desiredActiveSlots) break;
          const pairKey = `${item.ticker.symbol.toUpperCase()}|${item.ticker.marketType}`;
          if (executedPairKeys.has(pairKey)) continue;
          const outcome = await executeOrStageCandidate(item, true);
          if (outcome === 'EXECUTED') executedPairKeys.add(pairKey);
        }
      }

      if (executedCount === 0 && proposedCount > 0) {
        autoExecRuntime.lastSummary = `Đã sàng lọc ${actionable.length} cơ hội và đưa ${proposedCount} đề xuất vào hàng đợi SEMI_AUTO chờ xác nhận.`;
      } else if (executedCount === 0 && proposedCount === 0) {
        const openCnt = getOpenPositions().length;
        autoExecRuntime.lastSummary =
          openCnt >= desiredActiveSlots
            ? `Đang duy trì ${openCnt}/${desiredActiveSlots} vị thế tối ưu — giám sát Trailing Stop & Take Profit.`
            : `Đã kiểm tra ${actionable.length} tín hiệu APPROVED nhưng chưa có setup vượt qua màng lọc định lượng.`;
      }
    }
  } catch (err) {
    autoExecRuntime.lastSummary = `Chu kỳ Auto-Execution tạm hoãn: ${err instanceof Error ? err.message : 'Lỗi kết nối sàn'}`;
  } finally {
    autoExecRuntime.cycleInProgress = false;
    autoExecRuntime.lastCycleAtMs = Date.now();
    autoExecRuntime.lastScanDurationMs = Math.max(1, Date.now() - t0);
    autoExecRuntime.broadcastAutoStatus?.();
  }

  return buildAutoExecutionStatus();
}

app.get('/api/auto-trade/status', (_req, res) => {
  res.json(buildAutoExecutionStatus());
});

app.post('/api/auto-trade/config', (req, res) => {
  const currentCfg = getAutoExecutionConfig();
  const clampedCfg = clampAutoExecutionConfig(req.body as Partial<AutoExecutionConfig>, currentCfg);
  const nextCfg = syncAutoConfigWithRiskConfig(clampedCfg, getRiskConfig());
  const currentMode = getTradingMode();

  if (nextCfg.enabled && currentMode === 'EMERGENCY_STOP') {
    res.status(400).json({
      error: 'Không thể bật Auto-Execution khi hệ thống đang ở EMERGENCY_STOP. Hãy khôi phục chế độ trước.',
    });
    return;
  }

  if (nextCfg.enabled && nextCfg.executionMode === 'FULL_AUTO') {
    const tickers = marketFeed.getTickers();
    const healthy = tickers.slice(0, 4).every((t) => validateTickerIntegrity(t).valid);
    if (!healthy) {
      res.status(400).json({
        error: 'Không thể kích hoạt FULL_AUTO khi dữ liệu thị trường Live Exchange chưa ổn định.',
      });
      return;
    }
  }

  saveAutoExecutionConfig(nextCfg);

  const resolvedMode = resolveTradingModeAfterAutoConfig(currentMode, nextCfg);
  if (resolvedMode !== currentMode) {
    setTradingMode(resolvedMode);
  }

  autoExecRuntime.lastSummary = nextCfg.enabled
    ? `Auto-Execution (${nextCfg.executionMode}) đã kích hoạt · Confluence ≥ ${nextCfg.minConfluenceScore} · EV ≥ +${nextCfg.minExpectedValueR}R.`
    : 'Đã tạm tắt động cơ Auto-Execution (Standby).';

  appendAuditLog({
    category: 'SYSTEM',
    severity: 'INFO',
    actor: 'USER',
    action: 'UPDATE_AUTO_EXEC_CONFIG',
    details: `Cập nhật Auto-Execution: enabled=${nextCfg.enabled}, mode=${nextCfg.executionMode}, minConf=${nextCfg.minConfluenceScore}, minEV=${nextCfg.minExpectedValueR}R, maxHr=${nextCfg.maxTradesPerHour}.`,
  });

  autoExecRuntime.broadcastAutoStatus?.();
  if (nextCfg.enabled) {
    scheduleAutonomousReplenishment(600);
  }
  res.json({
    ...buildAutoExecutionStatus(),
    tradingMode: getTradingMode(),
  });
});

app.post('/api/auto-trade/cycle', async (_req, res) => {
  const status = await runAutonomousExecutionCycle('MANUAL_TRIGGER');
  const { portfolio, positions } = syncPortfolioAndPositions();
  autoExecRuntime.broadcastAutoStatus?.();
  res.json({
    status,
    portfolio,
    positions,
    signals: getSignals(20),
    orders: getOrders(50),
  });
});

app.post('/api/auto-trade/proposals/:id/approve', async (req, res) => {
  const { id } = req.params;
  const proposal = getAutoProposals(undefined, 50).find((p) => p.id === id);
  if (!proposal || proposal.status !== 'PENDING') {
    res.status(404).json({ error: 'Đề xuất không tồn tại hoặc đã được xử lý/hết hạn.' });
    return;
  }

  const mode = getTradingMode();
  if (mode === 'EMERGENCY_STOP') {
    res.status(400).json({ error: 'EMERGENCY_STOP đang bật — không thể duyệt lệnh.' });
    return;
  }
  const cfgSnapshot = getAutoExecutionConfig();
  if (mode === 'ANALYSIS_ONLY') {
    setTradingMode(cfgSnapshot.enabled ? 'SEMI_AUTO' : 'PAPER');
  }

  const ticker =
    marketFeed.getTicker(proposal.symbol, proposal.marketType, proposal.exchange) ??
    (await marketFeed.activatePair(proposal.symbol, proposal.marketType, proposal.exchange));
  if (!ticker || ticker.lastPrice <= 0) {
    res.status(503).json({ error: 'Không lấy được giá LIVE_EXCHANGE hiện tại cho đề xuất này.' });
    return;
  }

  const { portfolio, positions } = syncPortfolioAndPositions();
  const existingPair = positions.find(
    (p) =>
      p.symbol.toUpperCase() === proposal.symbol.toUpperCase() &&
      p.marketType === proposal.marketType,
  );
  if (existingPair) {
    res.status(400).json({
      error: `Đã có vị thế ${existingPair.side} đang mở cho ${proposal.symbol} (${proposal.marketType}) — hủy trùng lặp.`,
    });
    return;
  }
  const riskConfig = getRiskConfig();
  const orderReq: OrderRequest = {
    symbol: proposal.symbol,
    exchange: proposal.exchange,
    marketType: proposal.marketType,
    side: proposal.side,
    orderType: 'MARKET',
    entryPrice: ticker.lastPrice,
    stopLoss: proposal.stopLoss,
    takeProfit: proposal.takeProfit,
    leverage: proposal.leverage,
    riskPctOverride: proposal.recommendedRiskPct,
    strategyName: proposal.strategyName,
    idempotencyKey: `PROP-EXEC-${proposal.id}`,
    dataStatus: ticker.dataStatus,
    tradingStatus: ticker.tradingStatus,
    tickerTimestampUtc: ticker.timestampUtc,
  };

  const riskCheck = evaluateOrderRisk(orderReq, riskConfig, {
    tradingMode: getTradingMode(),
    accountEquityUsd: portfolio.totalEquityUsd,
    availableBalanceUsd: portfolio.availableBalanceUsd,
    dailyPnlPct: portfolio.dailyPnlPct,
    weeklyPnlPct: portfolio.weeklyPnlPct,
    currentDrawdownPct: portfolio.currentDrawdownPct,
    openPositions: positions,
    recentIdempotencyKeys: getRecentIdempotencyKeys(200),
  });

  if (!riskCheck.approved) {
    res.status(400).json({ error: riskCheck.reasons[0] || 'Risk Engine từ chối khớp đề xuất.' });
    return;
  }

  const filled = executeRiskVerifiedPaperOrder({
    orderReq,
    riskCheck,
    markPrice: ticker.lastPrice,
    actor: 'SEMI_AUTO_APPROVAL',
    auditAction: 'SEMI_AUTO_PROPOSAL_EXECUTED',
  });

  const cfg = getAutoExecutionConfig();
  const nowMs = Date.now();
  autoExecRuntime.recentExecutionTimestampsMs.push(nowMs);
  autoExecRuntime.autoTradesTotalCount += 1;
  autoExecRuntime.symbolCooldowns[proposal.symbol] =
    nowMs + cfg.cooldownMinutesPerSymbol * 60_000;

  upsertAutoProposal({
    ...proposal,
    status: 'EXECUTED',
    executedOrderId: filled.orderId,
  });

  const msg = `Đã duyệt SEMI_AUTO & khớp ${proposal.side} ${riskCheck.recommendedQuantity} ${proposal.symbol} @ $${filled.execPrice}.`;
  autoExecRuntime.lastSummary = msg;
  recordAutoActivity({
    symbol: proposal.symbol,
    exchange: proposal.exchange,
    side: proposal.side,
    action: 'EXECUTED',
    reason: msg,
    alphaScore: proposal.compositeAlphaScore,
    expectedValueR: proposal.expectedValueR,
  });

  const synced = syncPortfolioAndPositions({ eventTag: 'ORDER_FILLED', forceRecord: true });
  autoExecRuntime.broadcastAutoStatus?.();
  res.json({
    orderId: filled.orderId,
    status: buildAutoExecutionStatus(),
    portfolio: synced.portfolio,
    positions: synced.positions,
    pnlPoint: synced.latestPnlPoint,
    orders: getOrders(50),
  });
});

app.post('/api/auto-trade/proposals/:id/reject', (req, res) => {
  const { id } = req.params;
  const proposal = getAutoProposals(undefined, 50).find((p) => p.id === id);
  if (!proposal || proposal.status !== 'PENDING') {
    res.status(404).json({ error: 'Đề xuất không tồn tại hoặc đã xử lý.' });
    return;
  }
  upsertAutoProposal({ ...proposal, status: 'REJECTED' });
  recordAutoActivity({
    symbol: proposal.symbol,
    exchange: proposal.exchange,
    side: proposal.side,
    action: 'SKIPPED',
    reason: 'Trader từ chối đề xuất SEMI_AUTO.',
    alphaScore: proposal.compositeAlphaScore,
  });
  appendAuditLog({
    category: 'ORDER',
    severity: 'INFO',
    actor: 'USER',
    action: 'SEMI_AUTO_PROPOSAL_REJECTED',
    details: `Từ chối đề xuất SEMI_AUTO ${proposal.symbol} ${proposal.side}.`,
  });
  res.json({ status: buildAutoExecutionStatus() });
});

app.post('/api/session/reset', (req, res) => {
  const requestedMode = req.body?.mode as TradingMode | undefined;
  const targetMode: TradingMode =
    requestedMode === 'ANALYSIS_ONLY' ||
    requestedMode === 'PAPER' ||
    requestedMode === 'SEMI_AUTO' ||
    requestedMode === 'FULL_AUTO'
      ? requestedMode
      : 'FULL_AUTO';

  resetTradingSession(targetMode);
  autoExecRuntime.recentExecutionTimestampsMs = [];
  autoExecRuntime.symbolCooldowns = {};
  autoExecRuntime.recentActivity = [];
  autoExecRuntime.autoTradesTotalCount = 0;
  autoExecRuntime.lastCycleAtMs = null;
  autoExecRuntime.lastScanDurationMs = null;
  autoExecRuntime.lastSummary =
    targetMode === 'FULL_AUTO'
      ? 'Đã reset phiên làm việc ($100,000) — FULL_AUTO đang quét thị trường để mở lệnh tối ưu.'
      : `Đã reset phiên làm việc sạch ($100,000 · ${targetMode}).`;

  const { portfolio, positions } = syncPortfolioAndPositions();
  autoExecRuntime.broadcastAutoStatus?.();
  if (targetMode === 'FULL_AUTO' || targetMode === 'SEMI_AUTO') {
    scheduleAutonomousReplenishment(500);
  }
  res.json({
    ok: true,
    tradingMode: getTradingMode(),
    portfolio,
    positions,
    pnlHistory: getPnlHistory(360),
    orders: getOrders(50),
    signals: getSignals(20),
    agents: getAgents(),
    autoExecutionStatus: buildAutoExecutionStatus(),
  });
});

app.post('/api/run/smart', async (req, res) => {
  const runMode = String(req.body?.mode || 'ANALYZE_SINGLE') as
    | 'ANALYZE_SINGLE'
    | 'SMART_SCAN_BEST'
    | 'ANALYZE_AND_PAPER_EXECUTE';
  const requestedSymbol = String(req.body?.symbol || '');
  const requestedMarket = req.body?.marketType as MarketType | undefined;
  const includeGemini = Boolean(req.body?.includeGemini);

  const currentMode = getTradingMode();
  const riskConfig = getRiskConfig();
  const agents = getAgents();
  const { portfolio, positions } = syncPortfolioAndPositions();

  let allTickers = marketFeed.getTickers();
  if (allTickers.every((t) => t.lastPrice <= 0)) {
    await marketFeed.refreshFeed().catch(() => {});
    allTickers = marketFeed.getTickers();
  }
  let effectiveMode = currentMode;
  if (runMode === 'ANALYZE_AND_PAPER_EXECUTE' && currentMode === 'ANALYSIS_ONLY') {
    setTradingMode('PAPER');
    saveAutoExecutionConfig(syncAutoConfigWithTradingMode('PAPER', getAutoExecutionConfig()));
    effectiveMode = 'PAPER';
  }

  const recentIdempKeys = getRecentIdempotencyKeys();
  const smartRunT0 = Date.now();
  let evaluated: Array<{
    ticker: MarketTicker;
    signal: TradingSignal;
    opportunityScore: number;
  }> = [];
  let opportunities: SmartOpportunityCandidate[] = [];
  let scanCandidatesCount = 1;
  let totalUniverseScanned = marketFeed.getDirectoryCount();

  if (runMode === 'SMART_SCAN_BEST') {
    // True Two-Stage Full-Market Scan across ALL multi-exchange indexed coins
    const fullScan = await runFullMarketAlphaScan({
      scanMode: 'DEEP',
      marketType: requestedMarket ?? 'ALL',
      minVolumeUsd: 2_000_000,
      strategyFocus: 'HIGH_PROFIT_ALPHA',
      assetUniverse: 'CRYPTO',
      limit: 18,
    });
    scanCandidatesCount = fullScan.response.deepEvaluatedCount || fullScan.response.stage1CandidatesCount;
    totalUniverseScanned = fullScan.response.breadth.totalScannedPairs;

    if (fullScan.bestRaw) {
      await marketFeed
        .activatePair(
          fullScan.bestRaw.ticker.symbol,
          fullScan.bestRaw.ticker.marketType,
          fullScan.bestRaw.ticker.exchange,
        )
        .catch(() => null);
    }

    opportunities = fullScan.response.opportunities.slice(0, 10).map((opp) => ({
      rank: opp.rank,
      symbol: opp.symbol,
      exchange: opp.exchange,
      marketType: opp.marketType,
      lastPrice: opp.lastPrice,
      change24hPct: opp.change24hPct,
      direction: opp.direction,
      state: opp.signalState === 'PRE_SCREEN' ? 'DETECTED' : opp.signalState,
      confidenceScore: opp.confluenceScore,
      confluenceScore: opp.confluenceScore,
      htfAlignment: opp.htfAlignment,
      riskReward: opp.riskReward,
      expectedValueR: opp.expectedValueR,
      opportunityScore: opp.compositeAlphaScore,
      reasoningSummary: opp.reasoningSummary,
    }));

    if (fullScan.bestRaw) {
      evaluated = [
        {
          ticker: fullScan.bestRaw.ticker,
          signal: fullScan.bestRaw.signal,
          opportunityScore: fullScan.response.opportunities[0]?.compositeAlphaScore ?? 0,
        },
      ];
    }
  } else {
    const requestedExchange = req.body?.exchange ? String(req.body.exchange) : undefined;
    const liveTickers = allTickers.filter((t) => t.lastPrice > 0 && t.dataStatus === 'LIVE_EXCHANGE');
    const primaryMatch = requestedSymbol
      ? (marketFeed.getTicker(requestedSymbol, requestedMarket, requestedExchange) ??
        (await marketFeed.activatePair(requestedSymbol, requestedMarket, requestedExchange)))
      : undefined;

    const candidateList: MarketTicker[] = [];
    const seenKeys = new Set<string>();
    const pushCandidate = (t?: MarketTicker | null) => {
      if (!t || t.lastPrice <= 0) return;
      const k = `${t.symbol}|${t.marketType}|${t.exchange}`;
      if (seenKeys.has(k)) return;
      seenKeys.add(k);
      candidateList.push(t);
    };

    pushCandidate(primaryMatch);
    if (requestedSymbol) {
      for (const alt of liveTickers.filter(
        (t) => t.symbol.toUpperCase() === requestedSymbol.toUpperCase(),
      )) {
        pushCandidate(alt);
      }
    }
    for (const live of [...liveTickers].sort((a, b) => b.volume24hUsd - a.volume24hUsd).slice(0, 6)) {
      pushCandidate(live);
    }

    if (candidateList.length === 0 && !primaryMatch && allTickers.length === 0) {
      res.status(404).json({ error: 'Không tìm thấy thị trường khả dụng để chạy.' });
      return;
    }

    for (const candidate of candidateList) {
      const [{ candles }, htfRes, orderBook] = await Promise.all([
        marketFeed.getCandles(candidate.symbol, candidate.marketType, '1h', candidate.exchange),
        marketFeed
          .getCandles(candidate.symbol, candidate.marketType, '4h', candidate.exchange)
          .catch(() => ({ candles: [] })),
        marketFeed.getOrderBook(candidate.symbol, candidate.marketType, candidate.exchange),
      ]);
      if (candles.length === 0) continue;

      const sig = runMultiAgentDecisionPipeline({
        ticker: candidate,
        candles,
        htfCandles: htfRes.candles,
        orderBook,
        riskConfig,
        riskContext: {
          tradingMode: effectiveMode,
          accountEquityUsd: portfolio.totalEquityUsd,
          availableBalanceUsd: portfolio.availableBalanceUsd,
          dailyPnlPct: portfolio.dailyPnlPct,
          weeklyPnlPct: portfolio.weeklyPnlPct,
          currentDrawdownPct: portfolio.currentDrawdownPct,
          openPositions: positions,
          recentIdempotencyKeys: recentIdempKeys,
        },
        agents,
      });
      const score = Number((sig.confidenceScore * 2 + (sig.expectedValueR ?? 0) * 40).toFixed(1));
      evaluated = [
        {
          ticker: candidate,
          signal: sig,
          opportunityScore: score,
        },
      ];
      opportunities = [
        {
          rank: 1,
          symbol: candidate.symbol,
          exchange: candidate.exchange,
          marketType: candidate.marketType,
          lastPrice: candidate.lastPrice,
          change24hPct: candidate.change24hPct,
          direction: sig.direction,
          state: sig.state,
          confidenceScore: sig.confidenceScore,
          confluenceScore: sig.quantAlpha?.confluenceScore ?? sig.quantScore,
          htfAlignment: sig.htfAlignment ?? 'NEUTRAL',
          riskReward: sig.riskReward,
          expectedValueR: sig.expectedValueR ?? 0,
          opportunityScore: score,
          reasoningSummary: sig.reasoningSummary,
        },
      ];
      break;
    }
  }

  const best = evaluated[0];
  if (!best) {
    res.status(503).json({ error: 'Chưa nhận được dữ liệu thực tế từ sàn để hoàn tất Smart Run.' });
    return;
  }

  const { ticker: chosenTicker, signal } = best;
  saveSignal(signal);

  const smartElapsedMs = Math.max(1, Date.now() - smartRunT0);
  const nowIso = new Date().toISOString();
  for (const ag of agents) {
    if (!ag.enabled) continue;
    const vote = signal.agentVotes.find((v) => v.agentId === ag.id);
    ag.lastActivityUtc = nowIso;
    ag.latencyMs = ag.id === 'MARKET_DATA' ? chosenTicker.latencyMs : smartElapsedMs;
    ag.evalCount = (ag.evalCount ?? 0) + 1;
    if (vote) {
      ag.lastOutput = `${chosenTicker.symbol}: ${vote.stance} (${vote.score}/100) — ${vote.rationale}`;
    } else if (ag.id === 'MASTER_ORCHESTRATOR') {
      ag.lastOutput = `Smart Run ${chosenTicker.symbol}: ${signal.direction} (${signal.confidenceScore}/100) · ${signal.state}`;
    }
    updateAgent(ag);
  }

  let autoExecuted = false;
  let executionMessage = 'Chỉ phân tích tín hiệu (không tự vào lệnh).';
  let executedOrderId: string | null = null;

  if (runMode === 'ANALYZE_AND_PAPER_EXECUTE') {
    if (effectiveMode === 'EMERGENCY_STOP') {
      executionMessage = 'EMERGENCY_STOP đang bật — Risk Engine khóa toàn bộ lệnh mới.';
    } else if (
      signal.state === 'APPROVED' &&
      signal.riskCheck.approved &&
      signal.direction !== 'NO_TRADE'
    ) {
      const idempotencyKey = `SMARTRUN-${signal.id}`;
      const orderReq: OrderRequest = {
        symbol: chosenTicker.symbol,
        exchange: chosenTicker.exchange,
        marketType: chosenTicker.marketType,
        side: signal.direction,
        orderType: 'MARKET',
        entryPrice: chosenTicker.lastPrice,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfitLevels[1] ?? signal.takeProfitLevels[0],
        leverage: signal.leverage,
        riskPctOverride: signal.recommendedRiskPct,
        strategyName: `Smart Run · ${signal.strategyName}`,
        idempotencyKey,
        dataStatus: chosenTicker.dataStatus,
        tradingStatus: chosenTicker.tradingStatus,
      };
      const freshPortfolioState = syncPortfolioAndPositions();
      const riskCheck = evaluateOrderRisk(orderReq, riskConfig, {
        tradingMode: effectiveMode,
        accountEquityUsd: freshPortfolioState.portfolio.totalEquityUsd,
        availableBalanceUsd: freshPortfolioState.portfolio.availableBalanceUsd,
        dailyPnlPct: freshPortfolioState.portfolio.dailyPnlPct,
        weeklyPnlPct: freshPortfolioState.portfolio.weeklyPnlPct,
        currentDrawdownPct: freshPortfolioState.portfolio.currentDrawdownPct,
        openPositions: freshPortfolioState.positions,
        recentIdempotencyKeys: getRecentIdempotencyKeys(200),
      });

      if (riskCheck.approved) {
        const filled = executeRiskVerifiedPaperOrder({
          orderReq,
          riskCheck,
          markPrice: chosenTicker.lastPrice,
          actor: 'SMART_RUN',
          auditAction: 'SMART_RUN_PAPER_ORDER_FILLED',
        });

        const smartExecNow = Date.now();
        const autoCfg = getAutoExecutionConfig();
        autoExecRuntime.recentExecutionTimestampsMs.push(smartExecNow);
        autoExecRuntime.symbolCooldowns[chosenTicker.symbol] =
          smartExecNow + autoCfg.cooldownMinutesPerSymbol * 60_000;

        autoExecuted = true;
        executedOrderId = filled.orderId;
        executionMessage = `Đã khớp lệnh PAPER ${orderReq.side} ${riskCheck.recommendedQuantity} ${orderReq.symbol} @ $${filled.execPrice} qua Risk Engine.`;
      } else {
        executionMessage = riskCheck.reasons[0] || 'Risk Engine từ chối mở lệnh.';
      }
    } else {
      executionMessage = `Tín hiệu ở trạng thái ${signal.state} (${signal.direction}) — Risk Engine giữ vốn, không vào lệnh.`;
    }
  }

  let synthesis = null;
  if (includeGemini) {
    const smartLocale = req.body?.locale === 'en' ? 'en' : 'vi';
    const { candles } = await marketFeed.getCandles(chosenTicker.symbol, chosenTicker.marketType, '1h', chosenTicker.exchange);
    const indicators = computeAllIndicators(candles);
    synthesis = await synthesizeWithGemini({
      ticker: chosenTicker,
      indicators,
      signal,
      quantIntel: signal.quantIntel,
      locale: smartLocale,
    });
  }

  appendAgentLog({
    agentId: 'MASTER_ORCHESTRATOR',
    level: signal.state === 'APPROVED' ? 'INFO' : 'WARN',
    message: `Smart Run (${runMode}, ${scanCandidatesCount}/${totalUniverseScanned} cặp): Chọn ${chosenTicker.symbol} · ${signal.direction} (${signal.confidenceScore}/100) · ${executionMessage}`,
  });
  appendAuditLog({
    category: 'AGENT',
    severity: 'INFO',
    actor: 'SMART_RUN',
    action: runMode,
    details: `${chosenTicker.symbol}: ${signal.direction} (${signal.state}). ${executionMessage}`,
  });

  const synced = syncPortfolioAndPositions(
    autoExecuted ? { eventTag: 'ORDER_FILLED', forceRecord: true } : undefined,
  );
  if (autoExecuted || effectiveMode !== currentMode) {
    autoExecRuntime.broadcastAutoStatus?.();
  }
  res.json({
    signal,
    chosenSymbol: chosenTicker.symbol,
    chosenMarketType: chosenTicker.marketType,
    chosenExchange: chosenTicker.exchange,
    scanCandidatesCount,
    totalUniverseScanned,
    opportunities,
    autoExecuted,
    executedOrderId,
    executionMessage,
    synthesis,
    tradingMode: getTradingMode(),
    portfolio: synced.portfolio,
    positions: synced.positions,
    pnlPoint: synced.latestPnlPoint,
  });
});

app.get('/api/signals', (_req, res) => {
  res.json({ signals: getSignals(20) });
});

app.get('/api/portfolio', async (_req, res) => {
  const { portfolio, positions } = syncPortfolioAndPositions();
  const targetSymbols = Array.from(
    new Set([
      ...positions.map((p) => p.symbol),
      'BTC/USDT',
      'ETH/USDT',
      'SOL/USDT',
    ]),
  ).slice(0, 5);
  const candlesBySymbol: Record<string, Candle[]> = {};
  await Promise.all(
    targetSymbols.map(async (sym) => {
      const pos = positions.find((p) => p.symbol === sym);
      const tkr = marketFeed.getTicker(sym, pos?.marketType ?? 'PERPETUAL', pos?.exchange);
      const resCandles = await marketFeed
        .getCandles(sym, pos?.marketType ?? tkr?.marketType ?? 'PERPETUAL', '1h', pos?.exchange ?? tkr?.exchange)
        .catch(() => ({ candles: [] as Candle[] }));
      if (resCandles.candles.length > 0) {
        candlesBySymbol[sym] = resCandles.candles;
      }
    }),
  );
  const correlationGuard = computePortfolioCorrelationGuard({
    positions,
    candlesBySymbol,
  });

  res.json({
    portfolio,
    positions,
    pnlHistory: getPnlHistory(360),
    orders: getOrders(50),
    riskConfig: getRiskConfig(),
    correlationGuard,
  });
});

app.post('/api/orders/preview', async (req, res) => {
  const body = req.body as Partial<OrderRequest>;
  const sym = String(body.symbol || 'BTC/USDT');
  const ticker =
    marketFeed.getTicker(sym, body.marketType, body.exchange) ??
    (await marketFeed.activatePair(sym, body.marketType, body.exchange));
  if (!ticker) {
    res.status(404).json({ error: 'Không tìm thấy cặp giao dịch.' });
    return;
  }

  const { portfolio, positions } = syncPortfolioAndPositions();
  const riskConfig = getRiskConfig();
  const orderType = body.orderType === 'LIMIT' || body.orderType === 'STOP' ? body.orderType : 'MARKET';
  const rawEntry = Number(body.entryPrice);
  const entryPrice =
    orderType === 'MARKET'
      ? ticker.lastPrice
      : Number.isFinite(rawEntry) && rawEntry > 0
        ? rawEntry
        : ticker.lastPrice;
  const rawSl = Number(body.stopLoss);
  const rawTp = Number(body.takeProfit);
  const rawLev = Number(body.leverage);
  const rawQty = Number(body.quantity);
  const orderReq: OrderRequest = {
    symbol: ticker.symbol,
    exchange: ticker.exchange,
    marketType: ticker.marketType,
    side: body.side === 'SHORT' ? 'SHORT' : 'LONG',
    orderType,
    entryPrice,
    stopLoss: Number.isFinite(rawSl) ? rawSl : 0,
    takeProfit: Number.isFinite(rawTp) ? rawTp : 0,
    leverage: Number.isFinite(rawLev) && rawLev > 0 ? rawLev : riskConfig.defaultLeverage,
    quantity: Number.isFinite(rawQty) && rawQty > 0 ? rawQty : undefined,
    strategyName: body.strategyName || 'Manual Discretionary',
    idempotencyKey: String(body.idempotencyKey || `PREVIEW-${Date.now()}`),
    dataStatus: ticker.dataStatus,
    tradingStatus: ticker.tradingStatus,
  };

  const check = evaluateOrderRisk(orderReq, riskConfig, {
    tradingMode: getTradingMode(),
    accountEquityUsd: portfolio.totalEquityUsd,
    availableBalanceUsd: portfolio.availableBalanceUsd,
    dailyPnlPct: portfolio.dailyPnlPct,
    weeklyPnlPct: portfolio.weeklyPnlPct,
    currentDrawdownPct: portfolio.currentDrawdownPct,
    openPositions: positions,
    recentIdempotencyKeys: [], // preview ignores idempotency uniqueness
  });

  res.json({ riskCheck: check, order: orderReq });
});

app.post('/api/orders', async (req, res) => {
  const body = req.body as Partial<OrderRequest>;
  const sym = String(body.symbol || '');
  const ticker =
    marketFeed.getTicker(sym, body.marketType, body.exchange) ??
    (await marketFeed.activatePair(sym, body.marketType, body.exchange));
  if (!ticker) {
    res.status(404).json({ error: 'Không tìm thấy cặp giao dịch hợp lệ.' });
    return;
  }

  const mode = getTradingMode();
  const { portfolio, positions } = syncPortfolioAndPositions();
  const riskConfig = getRiskConfig();

  const idempotencyKey = String(
    body.idempotencyKey || `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  );

  const orderType = body.orderType === 'LIMIT' || body.orderType === 'STOP' ? body.orderType : 'MARKET';
  const rawEntry = Number(body.entryPrice);
  const entryPrice =
    orderType === 'MARKET'
      ? ticker.lastPrice
      : Number.isFinite(rawEntry) && rawEntry > 0
        ? rawEntry
        : ticker.lastPrice;
  const rawSl = Number(body.stopLoss);
  const rawTp = Number(body.takeProfit);
  const rawLev = Number(body.leverage);
  const rawQty = Number(body.quantity);

  const orderReq: OrderRequest = {
    symbol: ticker.symbol,
    exchange: ticker.exchange,
    marketType: ticker.marketType,
    side: body.side === 'SHORT' ? 'SHORT' : 'LONG',
    orderType,
    entryPrice,
    stopLoss: Number.isFinite(rawSl) ? rawSl : 0,
    takeProfit: Number.isFinite(rawTp) ? rawTp : 0,
    leverage: Number.isFinite(rawLev) && rawLev > 0 ? rawLev : riskConfig.defaultLeverage,
    quantity: Number.isFinite(rawQty) && rawQty > 0 ? rawQty : undefined,
    strategyName: body.strategyName || 'Manual / Semi-Auto Setup',
    idempotencyKey,
    dataStatus: ticker.dataStatus,
    tradingStatus: ticker.tradingStatus,
    tickerTimestampUtc: ticker.timestampUtc,
  };

  const riskCheck = evaluateOrderRisk(orderReq, riskConfig, {
    tradingMode: mode,
    accountEquityUsd: portfolio.totalEquityUsd,
    availableBalanceUsd: portfolio.availableBalanceUsd,
    dailyPnlPct: portfolio.dailyPnlPct,
    weeklyPnlPct: portfolio.weeklyPnlPct,
    currentDrawdownPct: portfolio.currentDrawdownPct,
    openPositions: positions,
    recentIdempotencyKeys: getRecentIdempotencyKeys(200),
  });

  const nowIso = new Date().toISOString();
  const orderId = `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  if (!riskCheck.approved) {
    insertOrder({
      id: orderId,
      idempotencyKey,
      symbol: orderReq.symbol,
      exchange: orderReq.exchange,
      marketType: orderReq.marketType,
      side: orderReq.side,
      orderType: orderReq.orderType,
      quantity: riskCheck.recommendedQuantity,
      price: orderReq.entryPrice,
      stopLoss: orderReq.stopLoss,
      takeProfit: orderReq.takeProfit,
      leverage: orderReq.leverage,
      feesUsd: 0,
      slippageUsd: 0,
      status: 'REJECTED',
      mode: 'PAPER',
      strategyName: orderReq.strategyName || 'Manual',
      riskDecision: riskCheck.decision,
      createdAtUtc: nowIso,
    });
    appendAuditLog({
      category: 'RISK',
      severity: 'WARNING',
      actor: 'RISK_MANAGEMENT',
      action: 'ORDER_REJECTED',
      details: `Từ chối lệnh ${orderReq.symbol} ${orderReq.side}: ${riskCheck.reasons.join(' ')}`,
    });
    res.status(400).json({ error: riskCheck.reasons[0] || 'Risk Engine từ chối lệnh.', riskCheck });
    return;
  }

  // Execute in Paper Ledger via unified risk-verified executor
  const filled = executeRiskVerifiedPaperOrder({
    orderReq,
    riskCheck,
    markPrice: ticker.lastPrice,
    actor: 'EXECUTION_AGENT',
    auditAction: 'PAPER_ORDER_FILLED',
  });

  const synced = syncPortfolioAndPositions({ eventTag: 'ORDER_FILLED', forceRecord: true });
  autoExecRuntime.broadcastAutoStatus?.();
  res.json({
    orderId: filled.orderId,
    position: filled.position,
    riskCheck,
    portfolio: synced.portfolio,
    positions: synced.positions,
    pnlPoint: synced.latestPnlPoint,
  });
});

app.patch('/api/positions/:id', (req, res) => {
  const { id } = req.params;
  const positions = getOpenPositions();
  const pos = positions.find((p) => p.id === id);
  if (!pos) {
    res.status(404).json({ error: 'Không tìm thấy vị thế đang mở.' });
    return;
  }

  const ticker = marketFeed.getTicker(pos.symbol, pos.marketType, pos.exchange);
  const currentPos: Position =
    ticker && ticker.lastPrice > 0 ? { ...pos, markPrice: ticker.lastPrice } : pos;

  const nextSl = Number(req.body?.stopLoss ?? currentPos.stopLoss);
  const nextTp = Number(req.body?.takeProfit ?? currentPos.takeProfit);
  const check = validatePositionSlTpUpdate(currentPos, nextSl, nextTp);
  if (!check.valid) {
    res.status(400).json({ error: check.reason || 'Thông số SL/TP không hợp lệ.' });
    return;
  }

  const updated: Position = {
    ...currentPos,
    stopLoss: check.stopLoss,
    takeProfit: check.takeProfit,
  };
  upsertPosition(updated);
  bumpStateRevision();

  appendAuditLog({
    category: 'RISK',
    severity: 'INFO',
    actor: 'USER',
    action: 'UPDATE_SL_TP',
    details: `Cập nhật ${updated.symbol} ${updated.side}: SL=$${updated.stopLoss}, TP=$${updated.takeProfit}.`,
  });

  const synced = syncPortfolioAndPositions();
  autoExecRuntime.broadcastAutoStatus?.();
  res.json({ position: updated, portfolio: synced.portfolio, positions: synced.positions });
});

app.post('/api/positions/:id/close', (req, res) => {
  const { id } = req.params;
  const closeResult = closePositionAtomically({
    positionId: id,
    resolveClosePrice: (pos) => {
      const ticker = marketFeed.getTicker(pos.symbol, pos.marketType, pos.exchange);
      return ticker && ticker.lastPrice > 0 ? ticker.lastPrice : pos.markPrice;
    },
    closeReason: 'MANUAL_CLOSE',
    idempotencyPrefix: 'CLOSE-MANUAL',
    actor: 'USER',
    auditAction: 'CLOSE_POSITION',
  });

  if (!closeResult.closed) {
    res.status(404).json({ ok: false, error: 'Không tìm thấy vị thế đang mở hoặc vị thế vừa được đóng.' });
    return;
  }

  const pos = closeResult.position;
  const receipt: ClosePositionReceipt = {
    positionId: pos.id,
    symbol: pos.symbol,
    exchange: pos.exchange,
    marketType: pos.marketType,
    side: pos.side,
    leverage: pos.leverage,
    quantity: pos.quantity,
    entryPrice: pos.entryPrice,
    closePrice: closeResult.closePrice,
    grossPnlUsd: closeResult.grossPnlUsd,
    closeFeeUsd: closeResult.closeFeeUsd,
    realizedNetUsd: closeResult.realizedNetUsd,
    rMultiple: closeResult.rMultiple,
    closeReason: 'MANUAL_CLOSE',
    closedAtUtc: closeResult.closedAtUtc,
  };

  const autoCfg = getAutoExecutionConfig();
  autoExecRuntime.symbolCooldowns[pos.symbol] =
    Date.now() + Math.min(10, autoCfg.cooldownMinutesPerSymbol) * 60_000;

  const synced = syncPortfolioAndPositions({ eventTag: 'POSITION_CLOSED', forceRecord: true });
  autoExecRuntime.broadcastAutoStatus?.();
  if (
    autoCfg.enabled &&
    autoCfg.maintainActivePositions &&
    getTradingMode() === 'FULL_AUTO' &&
    synced.positions.length < autoCfg.targetActivePositions
  ) {
    scheduleAutonomousReplenishment(1200);
  }
  res.json({
    ok: true,
    closedNetPnlUsd: closeResult.realizedNetUsd,
    receipt,
    portfolio: synced.portfolio,
    positions: synced.positions,
    pnlPoint: synced.latestPnlPoint,
  });
});

function clampFinite(value: unknown, min: number, max: number, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

app.post('/api/risk/config', (req, res) => {
  const current = getRiskConfig();
  const body = req.body as Partial<RiskConfig>;
  const maxRiskPerTradePct = clampFinite(
    body.maxRiskPerTradePct,
    0.1,
    3,
    current.maxRiskPerTradePct,
  );
  const riskPerTradePct = Math.min(
    maxRiskPerTradePct,
    clampFinite(body.riskPerTradePct, 0.05, 2, current.riskPerTradePct),
  );
  const maxLeverage = Math.round(clampFinite(body.maxLeverage, 1, 10, current.maxLeverage));
  const defaultLeverage = Math.min(
    maxLeverage,
    Math.round(clampFinite(body.defaultLeverage, 1, 10, current.defaultLeverage)),
  );
  const weeklyLossLimitPct = clampFinite(
    body.weeklyLossLimitPct,
    1,
    20,
    current.weeklyLossLimitPct,
  );
  const dailyLossLimitPct = Math.min(
    weeklyLossLimitPct,
    clampFinite(body.dailyLossLimitPct, 0.5, 10, current.dailyLossLimitPct),
  );
  const next: RiskConfig = {
    riskPerTradePct,
    maxRiskPerTradePct,
    dailyLossLimitPct,
    weeklyLossLimitPct,
    maxDrawdownPct: clampFinite(body.maxDrawdownPct, 2, 25, current.maxDrawdownPct),
    defaultLeverage,
    maxLeverage,
    maxOpenPositions: Math.round(
      clampFinite(body.maxOpenPositions, 1, 10, current.maxOpenPositions),
    ),
    minRiskReward: clampFinite(body.minRiskReward, 1.0, 5, current.minRiskReward),
    allowMartingale: false,
    requireStopLoss: true,
    maxSingleAssetExposurePct: clampFinite(
      body.maxSingleAssetExposurePct,
      10,
      50,
      current.maxSingleAssetExposurePct,
    ),
  };
  saveRiskConfig(next);
  const syncedAutoCfg = syncAutoConfigWithRiskConfig(getAutoExecutionConfig(), next);
  saveAutoExecutionConfig(syncedAutoCfg);
  appendAuditLog({
    category: 'RISK',
    severity: 'INFO',
    actor: 'USER',
    action: 'UPDATE_RISK_CONFIG',
    details: `Cập nhật cấu hình rủi ro: Risk/trade=${next.riskPerTradePct}%, MaxLev=${next.maxLeverage}x, DailyLimit=${next.dailyLossLimitPct}%, MaxDD=${next.maxDrawdownPct}%, MaxAssetExp=${next.maxSingleAssetExposurePct}%.`,
  });
  autoExecRuntime.broadcastAutoStatus?.();
  res.json({ riskConfig: next, autoExecutionStatus: buildAutoExecutionStatus() });
});

app.post('/api/mode', (req, res) => {
  const requested = String(req.body?.mode || '') as TradingMode;
  const allowed: TradingMode[] = ['ANALYSIS_ONLY', 'PAPER', 'SEMI_AUTO', 'FULL_AUTO', 'EMERGENCY_STOP'];
  if (!allowed.includes(requested)) {
    res.status(400).json({ error: 'Chế độ giao dịch không hợp lệ.' });
    return;
  }

  if (requested === 'FULL_AUTO') {
    const tickers = marketFeed.getTickers();
    const healthy =
      tickers.length > 0 && tickers.slice(0, 4).every((t) => validateTickerIntegrity(t).valid);
    if (!healthy) {
      res.status(400).json({ error: 'Không thể bật FULL_AUTO khi dữ liệu thị trường chưa hợp lệ.' });
      return;
    }
  }

  setTradingMode(requested);
  const syncedAuto = syncAutoConfigWithTradingMode(requested, getAutoExecutionConfig());
  saveAutoExecutionConfig(syncedAuto);
  if (requested === 'FULL_AUTO' || requested === 'SEMI_AUTO') {
    autoExecRuntime.lastSummary = `Auto-Execution (${requested}) đã kích hoạt · Confluence ≥ ${syncedAuto.minConfluenceScore} · EV ≥ +${syncedAuto.minExpectedValueR}R.`;
  } else if (requested === 'EMERGENCY_STOP') {
    autoExecRuntime.lastSummary = 'EMERGENCY STOP đã kích hoạt — khóa toàn bộ Auto-Execution.';
  } else {
    autoExecRuntime.lastSummary = `Đã chuyển chế độ sang ${requested} — Auto-Execution tạm dừng ở Standby.`;
  }

  appendAuditLog({
    category: requested === 'EMERGENCY_STOP' ? 'EMERGENCY' : 'SYSTEM',
    severity: requested === 'EMERGENCY_STOP' ? 'CRITICAL' : 'INFO',
    actor: 'USER',
    action: 'SET_TRADING_MODE',
    details: `Chuyển chế độ hệ thống sang ${requested}.`,
  });
  autoExecRuntime.broadcastAutoStatus?.();
  if (requested === 'FULL_AUTO' || requested === 'SEMI_AUTO') {
    scheduleAutonomousReplenishment(600);
  }
  res.json({ tradingMode: requested, autoExecutionStatus: buildAutoExecutionStatus() });
});

app.post('/api/emergency-stop', (_req, res) => {
  setTradingMode('EMERGENCY_STOP');
  const currentAuto = getAutoExecutionConfig();
  saveAutoExecutionConfig({ ...currentAuto, enabled: false });
  autoExecRuntime.lastSummary = 'EMERGENCY STOP đã kích hoạt — khóa toàn bộ Auto-Execution.';
  appendAuditLog({
    category: 'EMERGENCY',
    severity: 'CRITICAL',
    actor: 'USER',
    action: 'EMERGENCY_STOP_TRIGGERED',
    details: 'Người dùng kích hoạt EMERGENCY STOP — khóa toàn bộ lệnh mới, giữ giám sát các vị thế hiện hữu.',
  });
  autoExecRuntime.broadcastAutoStatus?.();
  res.json({
    tradingMode: 'EMERGENCY_STOP',
    portfolio: getPortfolioSummary(),
    autoExecutionStatus: buildAutoExecutionStatus(),
  });
});

app.post('/api/backtest', async (req, res) => {
  try {
    const body = req.body as Partial<BacktestConfig> & { exchange?: string };
    const symbol = String(body.symbol || 'BTC/USDT');
    const timeframe = String(body.timeframe || '1h');
    const marketType = (body.marketType || 'PERPETUAL') as MarketType;
    const exchange = body.exchange ? String(body.exchange) : undefined;

    const { candles, source } = await marketFeed.getCandles(symbol, marketType, timeframe, exchange);
    if (candles.length === 0) {
      res.status(503).json({
        error: `Không lấy được dữ liệu OHLCV lịch sử thực tế từ sàn cho ${symbol} (${timeframe}).`,
      });
      return;
    }
    const ticker = marketFeed.getTicker(symbol, marketType, exchange);
    const defaultFunding =
      marketType === 'SPOT' ? 0 : (ticker?.fundingRatePct ?? 0);
    const stopLossAtrMult = clampFinite(body.stopLossAtrMult, 0.5, 5, 1.5);
    const takeProfitAtrMult = Math.max(
      stopLossAtrMult,
      clampFinite(body.takeProfitAtrMult, 1, 10, 2.5),
    );
    const validStrategyIds = new Set<BacktestStrategyId>(
      STRATEGY_CATALOG.map((s) => s.id),
    );
    const requestedStrategy = String(body.strategyId || 'ADAPTIVE_CONFLUENCE_ALPHA') as BacktestStrategyId;
    const strategyId: BacktestStrategyId = validStrategyIds.has(requestedStrategy)
      ? requestedStrategy
      : 'ADAPTIVE_CONFLUENCE_ALPHA';
    const config: BacktestConfig = {
      symbol,
      timeframe,
      strategyId,
      marketType,
      initialCapitalUsd: clampFinite(body.initialCapitalUsd, 100, 100_000_000, 10_000),
      riskPerTradePct: clampFinite(body.riskPerTradePct, 0.1, 5, 0.5),
      leverage: Math.round(clampFinite(body.leverage, 1, 10, 2)),
      feeRateBps: clampFinite(body.feeRateBps, 0, 50, 5),
      slippageBps: clampFinite(body.slippageBps, 0, 50, 3),
      fundingRatePer8hPct: clampFinite(body.fundingRatePer8hPct, -0.5, 0.5, defaultFunding),
      stopLossAtrMult,
      takeProfitAtrMult,
      monteCarloRuns: Math.round(clampFinite(body.monteCarloRuns, 10, 500, 100)),
      useTrailingProfitLock:
        typeof body.useTrailingProfitLock === 'boolean' ? body.useTrailingProfitLock : undefined,
    };

    const result = runBacktest(candles, config, source);
    appendAuditLog({
      category: 'AGENT',
      severity: 'INFO',
      actor: 'STRATEGY_VALIDATION',
      action: 'RUN_BACKTEST',
      details: `Backtest ${config.strategyId} trên ${symbol} (${timeframe}): ${result.totalTrades} lệnh, WinRate=${result.winRatePct}%, PF=${result.profitFactor}, MaxDD=${result.maxDrawdownPct}%.`,
    });
    res.json({ result });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Backtest thất bại.' });
  }
});

app.post('/api/backtest/benchmark', async (req, res) => {
  try {
    const body = req.body as Partial<BacktestConfig> & { exchange?: string };
    const symbol = String(body.symbol || 'BTC/USDT');
    const timeframe = String(body.timeframe || '1h');
    const marketType = (body.marketType || 'PERPETUAL') as MarketType;
    const exchange = body.exchange ? String(body.exchange) : undefined;

    const { candles, source } = await marketFeed.getCandles(symbol, marketType, timeframe, exchange);
    if (candles.length === 0) {
      res.status(503).json({
        error: `Không lấy được dữ liệu OHLCV lịch sử thực tế từ sàn cho ${symbol} (${timeframe}).`,
      });
      return;
    }
    const ticker = marketFeed.getTicker(symbol, marketType, exchange);
    const defaultFunding =
      marketType === 'SPOT' ? 0 : (ticker?.fundingRatePct ?? 0);
    const stopLossAtrMult = clampFinite(body.stopLossAtrMult, 0.5, 5, 1.5);
    const takeProfitAtrMult = Math.max(
      stopLossAtrMult,
      clampFinite(body.takeProfitAtrMult, 1, 10, 2.5),
    );
    const benchmark = benchmarkAllStrategies(
      candles,
      {
        symbol,
        timeframe,
        marketType,
        initialCapitalUsd: clampFinite(body.initialCapitalUsd, 100, 100_000_000, 10_000),
        riskPerTradePct: clampFinite(body.riskPerTradePct, 0.1, 5, 0.5),
        leverage: Math.round(clampFinite(body.leverage, 1, 10, 2)),
        feeRateBps: clampFinite(body.feeRateBps, 0, 50, 5),
        slippageBps: clampFinite(body.slippageBps, 0, 50, 3),
        fundingRatePer8hPct: clampFinite(body.fundingRatePer8hPct, -0.5, 0.5, defaultFunding),
        stopLossAtrMult,
        takeProfitAtrMult,
        monteCarloRuns: Math.round(clampFinite(body.monteCarloRuns, 10, 500, 100)),
        useTrailingProfitLock:
          typeof body.useTrailingProfitLock === 'boolean' ? body.useTrailingProfitLock : undefined,
      },
      source,
    );
    appendAuditLog({
      category: 'AGENT',
      severity: 'INFO',
      actor: 'STRATEGY_VALIDATION',
      action: 'BENCHMARK_ALL_STRATEGIES',
      details: `Benchmark 5 chiến lược trên ${symbol} (${timeframe}): Top WinRate=${benchmark.bestWinRateStrategyId}, Top Composite=${benchmark.bestCompositeStrategyId}.`,
    });
    res.json({ benchmark });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Benchmark chiến lược thất bại.' });
  }
});

app.post('/api/backtest/optimize', async (req, res) => {
  try {
    const body = req.body as Partial<BacktestConfig> & { exchange?: string };
    const symbol = String(body.symbol || 'BTC/USDT');
    const timeframe = String(body.timeframe || '1h');
    const marketType = (body.marketType || 'PERPETUAL') as MarketType;
    const exchange = body.exchange ? String(body.exchange) : undefined;

    const { candles, source } = await marketFeed.getCandles(symbol, marketType, timeframe, exchange);
    if (candles.length < 40) {
      res.status(503).json({
        error: `Không đủ dữ liệu OHLCV lịch sử thực tế (>=40 nến) từ sàn cho ${symbol} (${timeframe}).`,
      });
      return;
    }
    const ticker = marketFeed.getTicker(symbol, marketType, exchange);
    const defaultFunding =
      marketType === 'SPOT' ? 0 : (ticker?.fundingRatePct ?? 0);

    const optimization = optimizeStrategyWalkForward(
      candles,
      {
        symbol,
        timeframe,
        marketType,
        initialCapitalUsd: clampFinite(body.initialCapitalUsd, 100, 100_000_000, 10_000),
        riskPerTradePct: clampFinite(body.riskPerTradePct, 0.1, 5, 0.5),
        leverage: Math.round(clampFinite(body.leverage, 1, 10, 2)),
        feeRateBps: clampFinite(body.feeRateBps, 0, 50, 5),
        slippageBps: clampFinite(body.slippageBps, 0, 50, 3),
        fundingRatePer8hPct: clampFinite(body.fundingRatePer8hPct, -0.5, 0.5, defaultFunding),
        monteCarloRuns: Math.round(clampFinite(body.monteCarloRuns, 10, 500, 80)),
      },
      source,
    );

    appendAuditLog({
      category: 'AGENT',
      severity: 'INFO',
      actor: 'STRATEGY_VALIDATION',
      action: 'WALK_FORWARD_OPTIMIZE',
      details: `Tối ưu Walk-Forward ${symbol} (${timeframe}): Đã thử ${optimization.candidatesEvaluated} cấu hình -> Top=${optimization.bestStrategyId} (SL ${optimization.bestStopLossAtrMult}x / TP ${optimization.bestTakeProfitAtrMult}x, OOS WinRate=${optimization.outOfSampleResult.winRatePct}%, PF=${optimization.outOfSampleResult.profitFactor}).`,
    });

    res.json({ optimization });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Walk-Forward Optimization thất bại.' });
  }
});

function buildMergedExchanges() {
  const telemetryById = new Map(
    marketFeed.getExchangeTelemetry().map((t) => [t.exchangeId, t]),
  );
  return getExchanges().map((ex) => {
    const live = telemetryById.get(ex.id);
    if (!live) {
      return {
        ...ex,
        apiLatencyMs: ex.hasApiKeyConfigured ? ex.apiLatencyMs : 0,
        wsStatus: ex.hasApiKeyConfigured ? ex.wsStatus : 'OFFLINE',
        dataHealth: ex.hasApiKeyConfigured ? ex.dataHealth : 'UNKNOWN',
      };
    }
    return {
      ...ex,
      apiStatus: live.apiStatus,
      wsStatus: ex.hasApiKeyConfigured ? ex.wsStatus : live.wsStatus,
      apiLatencyMs: ex.hasApiKeyConfigured && ex.apiLatencyMs > 0 ? ex.apiLatencyMs : live.apiLatencyMs,
      lastSyncUtc: live.lastSyncUtc,
      dataHealth: ex.hasApiKeyConfigured ? ex.dataHealth : live.dataHealth,
    };
  });
}

app.get('/api/exchanges', (_req, res) => {
  res.json({ exchanges: buildMergedExchanges() });
});

app.post('/api/exchanges/test', async (req, res) => {
  try {
    const { exchangeId, apiKey, apiSecret, passphrase, environment, allowWithdrawal } =
      req.body as {
        exchangeId?: string;
        apiKey?: string;
        apiSecret?: string;
        passphrase?: string;
        environment?: ExchangeEnvironment;
        allowWithdrawal?: boolean;
      };

    if (
      !exchangeId ||
      !apiKey ||
      !apiSecret ||
      apiKey.trim().length < 8 ||
      apiSecret.trim().length < 8
    ) {
      res.status(400).json({
        error: 'Vui lòng nhập Exchange ID, API Key và API Secret hợp lệ (>= 8 ký tự).',
      });
      return;
    }

    const cleanId = exchangeId.trim().toLowerCase();
    const spec = getExchangeSpec(cleanId);
    const exchangeExists = getExchanges().some((ex) => ex.id === cleanId);
    if (!exchangeExists) {
      res.status(404).json({ error: `Sàn "${exchangeId}" không nằm trong danh sách hỗ trợ.` });
      return;
    }

    if (allowWithdrawal === true) {
      appendAuditLog({
        category: 'SECURITY',
        severity: 'CRITICAL',
        actor: 'CYBERSECURITY',
        action: 'BLOCK_WITHDRAWAL_KEY',
        details: `Chặn kiểm tra API Key cho ${spec.name} vì cờ withdrawal đang bật.`,
      });
      res.status(403).json({
        error: 'Chính sách bảo mật: Hệ thống không chấp nhận API Key có quyền rút tiền.',
      });
      return;
    }

    if (spec.requiresPassphrase && (!passphrase || passphrase.trim().length === 0)) {
      res.status(400).json({
        error: `${spec.name} bắt buộc phải có API Passphrase để ký xác thực.`,
      });
      return;
    }

    const reqEnv: ExchangeEnvironment =
      environment === 'TESTNET' && spec.supportsTestnet ? 'TESTNET' : 'MAINNET';

    const verification = await verifyExchangeCredentials({
      exchangeId: cleanId,
      apiKey: apiKey.trim(),
      apiSecret: apiSecret.trim(),
      passphrase: passphrase?.trim(),
      environment: reqEnv,
    });

    if (verification.outcome === 'WITHDRAWAL_DETECTED') {
      appendAuditLog({
        category: 'SECURITY',
        severity: 'CRITICAL',
        actor: 'CYBERSECURITY',
        action: 'BLOCK_WITHDRAWAL_KEY',
        details: `Phát hiện quyền rút tiền trực tiếp từ API ${spec.name} (${maskApiKey(apiKey)}). Đã từ chối.`,
      });
      res.status(403).json({ error: verification.message, verification });
      return;
    }

    appendAuditLog({
      category: 'SECURITY',
      severity: verification.ok ? 'INFO' : 'WARNING',
      actor: 'CYBERSECURITY',
      action: 'EXCHANGE_AUTH_PROBE',
      details: `Kiểm tra xác thực ${spec.name} [${reqEnv}] (${maskApiKey(apiKey)}): ${verification.outcome} (${verification.latencyMs}ms).`,
    });

    res.json({ verification });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Lỗi kiểm tra xác thực sàn giao dịch.',
    });
  }
});

app.post('/api/exchanges/connect', async (req, res) => {
  try {
    const {
      exchangeId,
      apiKey,
      apiSecret,
      passphrase,
      spotTrade,
      futuresTrade,
      allowWithdrawal,
      environment,
      allowUnverifiedVaultStage,
    } = req.body as {
      exchangeId?: string;
      apiKey?: string;
      apiSecret?: string;
      passphrase?: string;
      spotTrade?: boolean;
      futuresTrade?: boolean;
      allowWithdrawal?: boolean;
      environment?: ExchangeEnvironment;
      allowUnverifiedVaultStage?: boolean;
    };

    if (
      !exchangeId ||
      !apiKey ||
      !apiSecret ||
      apiKey.trim().length < 8 ||
      apiSecret.trim().length < 8
    ) {
      res.status(400).json({
        error: 'Vui lòng nhập đầy đủ Exchange ID, API Key và API Secret hợp lệ (>= 8 ký tự).',
      });
      return;
    }

    const cleanId = exchangeId.trim().toLowerCase();
    const spec = getExchangeSpec(cleanId);
    const exchangeExists = getExchanges().some((ex) => ex.id === cleanId);
    if (!exchangeExists) {
      res.status(404).json({ error: `Sàn giao dịch "${exchangeId}" không nằm trong danh sách hỗ trợ.` });
      return;
    }

    if (allowWithdrawal === true) {
      appendAuditLog({
        category: 'SECURITY',
        severity: 'CRITICAL',
        actor: 'CYBERSECURITY',
        action: 'BLOCK_WITHDRAWAL_KEY',
        details: `Chặn lưu API Key cho ${spec.name} vì phát hiện cờ cấp quyền rút tiền.`,
      });
      res.status(403).json({
        error: 'Chính sách bảo mật: Hệ thống nghiêm cấm API Key có quyền rút tiền.',
      });
      return;
    }

    if (spec.requiresPassphrase && (!passphrase || passphrase.trim().length === 0)) {
      res.status(400).json({
        error: `${spec.name} bắt buộc phải nhập Passphrase khi kết nối API Key.`,
      });
      return;
    }

    const reqEnv: ExchangeEnvironment =
      environment === 'TESTNET' && spec.supportsTestnet ? 'TESTNET' : 'MAINNET';

    const verification = await verifyExchangeCredentials({
      exchangeId: cleanId,
      apiKey: apiKey.trim(),
      apiSecret: apiSecret.trim(),
      passphrase: passphrase?.trim(),
      environment: reqEnv,
    });

    if (verification.outcome === 'WITHDRAWAL_DETECTED') {
      appendAuditLog({
        category: 'SECURITY',
        severity: 'CRITICAL',
        actor: 'CYBERSECURITY',
        action: 'BLOCK_WITHDRAWAL_KEY',
        details: `Chặn lưu API Key ${spec.name} (${maskApiKey(apiKey)}) vì sàn xác nhận đang bật quyền rút tiền.`,
      });
      res.status(403).json({ error: verification.message, verification });
      return;
    }

    if (verification.outcome === 'AUTH_FAILED') {
      appendAuditLog({
        category: 'SECURITY',
        severity: 'WARNING',
        actor: 'CYBERSECURITY',
        action: 'VAULT_CONNECT_REJECTED',
        details: `Từ chối lưu API Key ${spec.name} [${reqEnv}] (${maskApiKey(apiKey)}): ${verification.message}`,
      });
      res.status(401).json({ error: verification.message, verification });
      return;
    }

    if (verification.outcome === 'REGION_OR_NETWORK_RESTRICTED' && !allowUnverifiedVaultStage) {
      res.status(422).json({
        error: `${verification.message} Bạn có thể chọn "Lưu tạm ở trạng thái chưa xác thực từ xa" để mã hóa Vault hoặc đổi sang Testnet/Sàn khác.`,
        canStageUnverified: true,
        verification,
      });
      return;
    }

    const encrypted = encryptSecretPayload({
      apiKey: apiKey.trim(),
      apiSecret: apiSecret.trim(),
      passphrase: passphrase?.trim(),
    });
    const masked = maskApiKey(apiKey);
    const nowIso = new Date().toISOString();

    const finalSpot = verification.detectedPermissions
      ? Boolean(spotTrade) && verification.detectedPermissions.spotTrade
      : Boolean(spotTrade);
    const finalFutures = verification.detectedPermissions
      ? Boolean(futuresTrade) && verification.detectedPermissions.futuresTrade
      : Boolean(futuresTrade);

    saveExchangeCredentials({
      exchangeId: cleanId,
      encryptedCredentials: encrypted,
      maskedApiKey: masked,
      spotTrade: finalSpot,
      futuresTrade: finalFutures,
      environment: reqEnv,
      verificationStatus: verification.verificationStatus,
      lastVerifiedUtc: verification.ok ? nowIso : null,
      verificationNote: verification.message,
      latencyMs: verification.latencyMs,
      accountEquitySummaryUsd: verification.detectedEquityUsd ?? null,
    });

    appendAuditLog({
      category: 'SECURITY',
      severity: verification.ok ? 'INFO' : 'WARNING',
      actor: 'CYBERSECURITY',
      action: verification.ok ? 'VAULT_KEY_VERIFIED_AND_STORED' : 'VAULT_KEY_STAGED_UNVERIFIED',
      details: `Mã hóa AES-256-GCM và lưu API Key (${masked}) cho ${spec.name} [${reqEnv}] -> ${verification.verificationStatus}. Quyền rút tiền đã khóa.`,
    });

    res.json({ exchanges: buildMergedExchanges(), verification });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Lỗi mã hóa và lưu khóa vào Security Vault.',
    });
  }
});

app.post('/api/exchanges/:id/verify', async (req, res) => {
  try {
    const cleanId = req.params.id.trim().toLowerCase();
    const record = getExchangeEncryptedCredentials(cleanId);
    if (!record) {
      res.status(404).json({ error: `Không tìm thấy sàn "${cleanId}".` });
      return;
    }
    if (!record.encryptedCredentials) {
      res.status(400).json({ error: `Sàn ${cleanId} chưa có API Key trong Security Vault.` });
      return;
    }

    const creds = decryptSecretPayload(record.encryptedCredentials);
    const verification = await verifyExchangeCredentials({
      exchangeId: cleanId,
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
      passphrase: creds.passphrase,
      environment: record.environment,
    });

    if (verification.outcome === 'WITHDRAWAL_DETECTED') {
      disconnectExchange(cleanId);
      appendAuditLog({
        category: 'SECURITY',
        severity: 'CRITICAL',
        actor: 'CYBERSECURITY',
        action: 'AUTO_REVOKE_WITHDRAWAL_KEY',
        details: `Tự động thu hồi khóa ${cleanId} (${record.maskedApiKey}) vì phát hiện quyền rút tiền vừa được bật.`,
      });
      res.status(403).json({
        error: verification.message,
        verification,
        exchanges: buildMergedExchanges(),
      });
      return;
    }

    const nowIso = new Date().toISOString();
    updateExchangeVerificationStatus({
      exchangeId: cleanId,
      verificationStatus: verification.verificationStatus,
      lastVerifiedUtc: verification.ok ? nowIso : null,
      verificationNote: verification.message,
      latencyMs: verification.latencyMs,
      accountEquitySummaryUsd: verification.detectedEquityUsd ?? null,
    });

    appendAuditLog({
      category: 'SECURITY',
      severity: verification.ok ? 'INFO' : 'WARNING',
      actor: 'CYBERSECURITY',
      action: 'VAULT_KEY_REVERIFIED',
      details: `Kiểm tra lại khóa ${cleanId} [${record.environment}] (${record.maskedApiKey}): ${verification.verificationStatus} (${verification.latencyMs}ms).`,
    });

    res.json({ verification, exchanges: buildMergedExchanges() });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Lỗi kiểm tra lại API Key.',
    });
  }
});

app.post('/api/exchanges/verify-all', async (_req, res) => {
  try {
    const configured = getExchanges().filter((ex) => ex.hasApiKeyConfigured);
    const results: Array<{ exchangeId: string; verificationStatus: string; message: string }> = [];

    for (const ex of configured) {
      const record = getExchangeEncryptedCredentials(ex.id);
      if (!record?.encryptedCredentials) continue;
      const creds = decryptSecretPayload(record.encryptedCredentials);
      const verification = await verifyExchangeCredentials({
        exchangeId: ex.id,
        apiKey: creds.apiKey,
        apiSecret: creds.apiSecret,
        passphrase: creds.passphrase,
        environment: record.environment,
      });

      if (verification.outcome === 'WITHDRAWAL_DETECTED') {
        disconnectExchange(ex.id);
        appendAuditLog({
          category: 'SECURITY',
          severity: 'CRITICAL',
          actor: 'CYBERSECURITY',
          action: 'AUTO_REVOKE_WITHDRAWAL_KEY',
          details: `Batch Verify tự động thu hồi khóa ${ex.name} vì phát hiện quyền rút tiền.`,
        });
        results.push({
          exchangeId: ex.id,
          verificationStatus: 'REVOKED_WITHDRAWAL',
          message: verification.message,
        });
        continue;
      }

      updateExchangeVerificationStatus({
        exchangeId: ex.id,
        verificationStatus: verification.verificationStatus,
        lastVerifiedUtc: verification.ok ? new Date().toISOString() : null,
        verificationNote: verification.message,
        latencyMs: verification.latencyMs,
        accountEquitySummaryUsd: verification.detectedEquityUsd ?? null,
      });

      results.push({
        exchangeId: ex.id,
        verificationStatus: verification.verificationStatus,
        message: verification.message,
      });
    }

    appendAuditLog({
      category: 'SECURITY',
      severity: 'INFO',
      actor: 'CYBERSECURITY',
      action: 'VAULT_BATCH_REVERIFY',
      details: `Kiểm tra đồng loạt ${results.length} kết nối API Key trong Security Vault.`,
    });

    res.json({ results, exchanges: buildMergedExchanges() });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Lỗi kiểm tra đồng loạt Security Vault.',
    });
  }
});

app.post('/api/exchanges/:id/disconnect', (req, res) => {
  const { id } = req.params;
  disconnectExchange(id);
  appendAuditLog({
    category: 'SECURITY',
    severity: 'INFO',
    actor: 'CYBERSECURITY',
    action: 'VAULT_KEY_REVOKED',
    details: `Thu hồi và xóa API Key cho sàn ${id}.`,
  });
  res.json({ exchanges: buildMergedExchanges() });
});

app.get('/api/audit-logs', (_req, res) => {
  res.json({ logs: getAuditLogs(80) });
});

// --- Server & Vite Middleware Setup ---

async function startServer() {
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

  wss.on('error', () => {
    // non-fatal WebSocketServer error
  });

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {
      // ignore aborted upgrade sockets
    });
    try {
      const reqUrl = new URL(req.url || '/', 'http://localhost');
      if (reqUrl.pathname === '/ws') {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req);
        });
      } else if (req.headers['sec-websocket-protocol'] !== 'vite-hmr') {
        socket.destroy();
      }
    } catch {
      socket.destroy();
    }
  });

  const broadcastTick = () => {
    if (wss.clients.size === 0 || isBroadcastingTick) return;
    isBroadcastingTick = true;
    try {
      const { portfolio, positions, latestPnlPoint } = syncPortfolioAndPositions();
      const payload = JSON.stringify({
        type: 'TELEMETRY_UPDATE',
        tickers: marketFeed.getTickers(),
        portfolio,
        positions,
        pnlPoint: latestPnlPoint,
        tradingMode: getTradingMode(),
        liveFeedActive: marketFeed.isLiveFeedActive(),
        autoExecutionStatus: buildAutoExecutionStatus(),
        stateRevision: getStateRevision(),
        serverUtc: new Date().toISOString(),
      });
      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      }
    } finally {
      isBroadcastingTick = false;
    }
  };

  autoExecRuntime.broadcastAutoStatus = broadcastTick;

  wss.on('connection', (ws) => {
    ws.on('error', () => {
      // ignore abrupt client socket disconnect errors
    });
    const { portfolio, positions, latestPnlPoint } = syncPortfolioAndPositions();
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(
          JSON.stringify({
            type: 'TELEMETRY_UPDATE',
            tickers: marketFeed.getTickers(),
            portfolio,
            positions,
            pnlPoint: latestPnlPoint,
            tradingMode: getTradingMode(),
            liveFeedActive: marketFeed.isLiveFeedActive(),
            autoExecutionStatus: buildAutoExecutionStatus(),
            stateRevision: getStateRevision(),
            serverUtc: new Date().toISOString(),
          }),
        );
      } catch {
        // ignore closed client socket
      }
    }
  });

  // Fast 1s sub-second WebSocket price & SL/TP lifecycle tick fanout when real-time exchange frames arrive
  const broadcastFastPriceTick = () => {
    if (wss.clients.size === 0 || isBroadcastingTick) return;
    const hasPriceUpdates = marketFeed.consumePriceDirty();
    const hasOpenPositions = getOpenPositions().length > 0;
    if (!hasPriceUpdates && !hasOpenPositions) return;

    isBroadcastingTick = true;
    try {
      const { portfolio, positions, latestPnlPoint } = syncPortfolioAndPositions({
        skipSnapshotWriteIfUnchanged: true,
      });
      const payload = JSON.stringify({
        type: 'PRICE_TICK_UPDATE',
        tickers: marketFeed.getTickers(),
        portfolio,
        positions,
        pnlPoint: latestPnlPoint,
        liveFeedActive: marketFeed.isLiveFeedActive(),
        stateRevision: getStateRevision(),
        serverUtc: new Date().toISOString(),
      });
      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      }
    } finally {
      isBroadcastingTick = false;
    }
  };

  setInterval(broadcastFastPriceTick, 1000);

  // Periodic feed refresh every 8s (matches 7s probe floor without hitting rate limits)
  setInterval(async () => {
    await marketFeed.refreshFeed();
    broadcastTick();
  }, 8000);

  // Autonomous 9-Gate Auto-Execution Scheduler (evaluates when FULL_AUTO / SEMI_AUTO is armed)
  setInterval(async () => {
    const cfg = getAutoExecutionConfig();
    const mode = getTradingMode();
    if (!cfg.enabled || (mode !== 'FULL_AUTO' && mode !== 'SEMI_AUTO')) return;
    const elapsed = autoExecRuntime.lastCycleAtMs
      ? Date.now() - autoExecRuntime.lastCycleAtMs
      : cfg.scanIntervalSeconds * 1000;
    if (elapsed >= cfg.scanIntervalSeconds * 1000) {
      await runAutonomousExecutionCycle('SCHEDULER');
    }
  }, 10_000);

  if (process.env.NODE_ENV !== 'production') {
    const disableHmr = process.env.DISABLE_HMR === 'true';
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: disableHmr ? false : { server },
        ws: disableHmr ? false : { server },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(
      express.static(distDir, {
        setHeaders(res, filePath) {
          const base = path.basename(filePath);
          if (base === 'sw.js') {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Service-Worker-Allowed', '/');
          } else if (base === 'manifest.webmanifest') {
            res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
            res.setHeader('Cache-Control', 'public, max-age=3600');
          }
        },
      }),
    );
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  server.listen(port, '0.0.0.0', () => {
    console.log(`OMNISENT AI Command Center listening on http://0.0.0.0:${port}`);
  });

  // Run initial exchange feed probe, real-time Exchange WS streams, and 1h OHLCV warmup immediately
  // without blocking HTTP port binding so preview & health checks never stall during cold start.
  void (async () => {
    try {
      await marketFeed.refreshFeed();
      marketFeed.startRealtimeStreams();
      broadcastTick();
      await marketFeed.warmTopCandles();
    } catch {
      // Periodic 8s refresh and WS reconnect loops continue automatically
    }

    const bootCfg = getAutoExecutionConfig();
    const bootMode = getTradingMode();
    if (bootCfg.enabled && (bootMode === 'FULL_AUTO' || bootMode === 'SEMI_AUTO')) {
      autoExecRuntime.lastSummary = `Auto-Execution (${bootMode}) đang khởi chạy chu kỳ quét thị trường...`;
      scheduleAutonomousReplenishment(1200);
    }
  })();
}

const isVercelRuntime = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
if (!isVercelRuntime && !process.env.OMNISENT_SKIP_LISTEN) {
  startServer().catch((err) => {
    console.error('Failed to start OMNISENT AI server:', err);
    process.exit(1);
  });
}

export default app;
