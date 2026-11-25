import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateEMA,
  calculateRSI,
  computeAllIndicators,
} from './indicators.ts';
import { validateOhlcvConsistency, validateTickerIntegrity } from './dataIntegrity.ts';
import {
  calculatePositionSize,
  DEFAULT_RISK_CONFIG,
  evaluateOrderRisk,
} from './riskEngine.ts';
import { getTimeframeHours, runBacktest } from './backtester.ts';
import {
  computeLiquidationRadar,
  optimizeSlTpWithLiquidationRadar,
} from './liquidationRadar.ts';
import {
  createInitialAgentRegistry,
  runMultiAgentDecisionPipeline,
} from './multiAgentPipeline.ts';
import {
  COMPANY_CHARTER_RULES,
  COMPANY_PROFILE,
  getCompanyCharterRules,
  getCompanyDivisions,
  getCompanyPlaqueLines,
  getCompanyProfile,
  getTotalDivisionAgents,
} from '../data/companyProfile.ts';
import { getLocalizedExchangeSpec } from './exchangeCatalog.ts';
import { getStrategyCatalog } from './adaptiveConfluence.ts';
import { TRANSLATIONS, resolveLocale, translate } from '../i18n/translations.ts';
import {
  PWA_MANIFEST_META,
  computePWAUiState,
  detectPWAPlatform,
  getRecommendedGuideTab,
  isRunningStandalone,
} from '../pwa/pwaHelpers.ts';
import {
  DEFAULT_AUTO_EXECUTION_CONFIG,
  clampAutoExecutionConfig,
  evaluateAutoExecutionCandidate,
  resolveTradingModeAfterAutoConfig,
  syncAutoConfigWithRiskConfig,
  syncAutoConfigWithTradingMode,
} from './autoExecutionEngine.ts';
import {
  computePositionTelemetry,
  evaluateLivePositionLifecycle,
  validatePositionSlTpUpdate,
} from './positionMetrics.ts';
import {
  formatAssetPrice,
  parseMarketSearchQuery,
  searchMarketDirectory,
  type MarketDirectoryEntry,
} from './symbolSearch.ts';
import {
  appendPnlPoint,
  computePnlDomain,
  filterPnlHistoryByWindow,
  formatSignedUsd,
  summarizePnlSeries,
} from './pnlHistory.ts';
import {
  dedupeSignalsByPair,
  dedupeTickersByPair,
  findMatchingSignal,
  findMatchingTicker,
  isSignalFresh,
  parsePairSelection,
  serializePairSelection,
} from './pairSelection.ts';
import {
  computeHurstRegime,
  computeKellyAllocation,
  computeMicrostructureIntel,
  computePearsonReturnCorrelation,
  computePortfolioCorrelationGuard,
  computeQuantIntelligenceSnapshot,
} from './quantIntelligence.ts';
import type {
  Candle,
  MarketTicker,
  OrderBookSnapshot,
  PnlHistoryPoint,
  Position,
  RiskContext,
  TradingSignal,
} from './types.ts';

function makeTestCandles(
  symbol: string,
  basePrice: number,
  count = 160,
  intervalMs = 3600_000,
  nowMs = Date.now(),
): Candle[] {
  let seed = 0;
  for (let i = 0; i < symbol.length; i++) {
    seed = (seed * 31 + symbol.charCodeAt(i)) >>> 0;
  }
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const candles: Candle[] = [];
  const alignedEnd = Math.floor(nowMs / intervalMs) * intervalMs;
  let price = basePrice * 0.92;

  for (let i = count - 1; i >= 0; i--) {
    const ts = alignedEnd - i * intervalMs;
    const drift = (nextRand() - 0.485) * 0.022;
    const open = price;
    const close = Math.max(basePrice * 0.25, open * (1 + drift));
    const wickUp = Math.abs(nextRand()) * 0.012 * Math.max(open, close);
    const wickDown = Math.abs(nextRand()) * 0.012 * Math.max(open, close);
    candles.push({
      timestamp: ts,
      open: Number(open.toFixed(6)),
      high: Number((Math.max(open, close) + wickUp).toFixed(6)),
      low: Number((Math.min(open, close) - wickDown).toFixed(6)),
      close: Number(close.toFixed(6)),
      volume: Number(((500 + nextRand() * 2500) * (basePrice > 1000 ? 12 : 400)).toFixed(2)),
    });
    price = close;
  }
  return candles;
}

function makeValidTicker(overrides: Partial<MarketTicker> = {}): MarketTicker {
  return {
    symbol: 'BTC/USDT',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    exchange: 'Binance',
    marketType: 'PERPETUAL',
    lastPrice: 59800,
    bidPrice: 59799,
    askPrice: 59801,
    change24hPct: 2.1,
    high24h: 60400,
    low24h: 58900,
    volume24hUsd: 1_500_000_000,
    openInterestUsd: 800_000_000,
    fundingRatePct: 0.0085,
    spreadBps: 0.33,
    volatility24hPct: 2.5,
    rsi14: 58,
    regime: 'BULL',
    liquidityScore: 95,
    dataStatus: 'LIVE_EXCHANGE',
    sourceLabel: 'Binance Futures FAPI',
    timestampUtc: Date.now(),
    latencyMs: 22,
    tickSize: 0.1,
    lotSize: 0.001,
    minOrderUsd: 10,
    maxLeverage: 20,
    tradingStatus: 'TRADING',
    ...overrides,
  };
}

function makeBaseContext(overrides: Partial<RiskContext> = {}): RiskContext {
  return {
    tradingMode: 'PAPER',
    accountEquityUsd: 100_000,
    availableBalanceUsd: 95_000,
    dailyPnlPct: 0.2,
    weeklyPnlPct: 1.1,
    currentDrawdownPct: 0.5,
    openPositions: [],
    recentIdempotencyKeys: [],
    ...overrides,
  };
}

test('Indicators compute valid EMA, RSI, and OHLCV stats', () => {
  const candles = makeTestCandles('BTC/USDT', 59800, 120);
  const closes = candles.map((c) => c.close);
  const ema9 = calculateEMA(closes, 9);
  const rsi14 = calculateRSI(closes, 14);
  const all = computeAllIndicators(candles);

  assert.equal(ema9.length, 120);
  assert.ok(Number.isFinite(ema9[119]));
  assert.ok(rsi14[119] >= 0 && rsi14[119] <= 100);
  assert.ok(all.atr14 > 0);
  assert.ok(all.resistance >= all.support);
});

test('Data Integrity Agent rejects unavailable, stale, crossed-book, and invalid OHLCV data', () => {
  const now = Date.now();
  const unavailableTicker = makeValidTicker({ dataStatus: 'UNAVAILABLE' });
  const unavailableReport = validateTickerIntegrity(unavailableTicker, now);
  assert.equal(unavailableReport.valid, false);
  assert.ok(unavailableReport.anomalies.includes('NON_LIVE_FEED_UNAVAILABLE'));

  const staleTicker = makeValidTicker({
    dataStatus: 'LIVE_EXCHANGE',
    timestampUtc: now - 60_000,
  });
  const staleReport = validateTickerIntegrity(staleTicker, now);
  assert.equal(staleReport.valid, false);
  assert.equal(staleReport.status, 'STALE');

  const crossedTicker = makeValidTicker({ bidPrice: 60100, askPrice: 59800 });
  const crossedReport = validateTickerIntegrity(crossedTicker, now);
  assert.equal(crossedReport.valid, false);
  assert.equal(crossedReport.status, 'UNKNOWN');

  const badCandles = [
    { timestamp: 1000, open: 100, high: 95, low: 90, close: 94, volume: 10 },
  ];
  const ohlcvCheck = validateOhlcvConsistency(badCandles);
  assert.equal(ohlcvCheck.valid, false);
});

test('Risk Engine requires LIVE_EXCHANGE data and rejects unsafe orders deterministically', () => {
  const sized = calculatePositionSize({
    accountEquityUsd: 100_000,
    riskPct: 0.25,
    entryPrice: 60000,
    stopLossPrice: 58500,
    leverage: 2,
  });
  assert.ok(sized.quantity > 0);
  assert.ok(sized.estimatedRiskUsd <= 260);

  // Reject non-LIVE_EXCHANGE feed
  const nonLiveRejected = evaluateOrderRisk(
    {
      symbol: 'BTC/USDT',
      exchange: 'Binance',
      marketType: 'PERPETUAL',
      side: 'LONG',
      orderType: 'LIMIT',
      entryPrice: 60000,
      stopLoss: 58500,
      takeProfit: 63000,
      leverage: 2,
      idempotencyKey: 'order-nonlive',
      dataStatus: 'UNAVAILABLE',
    },
    DEFAULT_RISK_CONFIG,
    makeBaseContext(),
  );
  assert.equal(nonLiveRejected.approved, false);

  // Valid LONG trade with LIVE_EXCHANGE data
  const approved = evaluateOrderRisk(
    {
      symbol: 'BTC/USDT',
      exchange: 'Binance',
      marketType: 'PERPETUAL',
      side: 'LONG',
      orderType: 'LIMIT',
      entryPrice: 60000,
      stopLoss: 58500,
      takeProfit: 63000,
      leverage: 2,
      idempotencyKey: 'order-1',
      dataStatus: 'LIVE_EXCHANGE',
    },
    DEFAULT_RISK_CONFIG,
    makeBaseContext(),
  );
  assert.equal(approved.approved, true);
  assert.equal(approved.decision, 'APPROVE');

  // Reject EMERGENCY_STOP
  const stopped = evaluateOrderRisk(
    {
      symbol: 'BTC/USDT',
      exchange: 'Binance',
      marketType: 'PERPETUAL',
      side: 'LONG',
      orderType: 'MARKET',
      entryPrice: 60000,
      stopLoss: 58500,
      takeProfit: 63000,
      leverage: 2,
      idempotencyKey: 'order-2',
      dataStatus: 'LIVE_EXCHANGE',
    },
    DEFAULT_RISK_CONFIG,
    makeBaseContext({ tradingMode: 'EMERGENCY_STOP' }),
  );
  assert.equal(stopped.approved, false);
  assert.equal(stopped.decision, 'LOCK_SYSTEM');

  // Reject duplicate idempotency key
  const dup = evaluateOrderRisk(
    {
      symbol: 'BTC/USDT',
      exchange: 'Binance',
      marketType: 'PERPETUAL',
      side: 'LONG',
      orderType: 'MARKET',
      entryPrice: 60000,
      stopLoss: 58500,
      takeProfit: 63000,
      leverage: 2,
      idempotencyKey: 'dup-key',
      dataStatus: 'LIVE_EXCHANGE',
    },
    DEFAULT_RISK_CONFIG,
    makeBaseContext({ recentIdempotencyKeys: ['dup-key'] }),
  );
  assert.equal(dup.approved, false);

  // Reject excessive leverage
  const highLev = evaluateOrderRisk(
    {
      symbol: 'BTC/USDT',
      exchange: 'Binance',
      marketType: 'PERPETUAL',
      side: 'LONG',
      orderType: 'MARKET',
      entryPrice: 60000,
      stopLoss: 58500,
      takeProfit: 63000,
      leverage: 10,
      idempotencyKey: 'order-3',
      dataStatus: 'LIVE_EXCHANGE',
    },
    DEFAULT_RISK_CONFIG,
    makeBaseContext(),
  );
  assert.equal(highLev.approved, false);

  // Reject SPOT SHORT
  const spotShort = evaluateOrderRisk(
    {
      symbol: 'BTC/USDT',
      exchange: 'Binance',
      marketType: 'SPOT',
      side: 'SHORT',
      orderType: 'MARKET',
      entryPrice: 60000,
      stopLoss: 61500,
      takeProfit: 57000,
      leverage: 1,
      idempotencyKey: 'order-4',
      dataStatus: 'LIVE_EXCHANGE',
    },
    DEFAULT_RISK_CONFIG,
    makeBaseContext(),
  );
  assert.equal(spotShort.approved, false);
});

test('Backtester executes sequentially with fees, slippage, and Monte Carlo bounds', () => {
  const candles = makeTestCandles('ETH/USDT', 1680, 180);
  const result = runBacktest(
    candles,
    {
      symbol: 'ETH/USDT',
      timeframe: '1h',
      strategyId: 'EMA_CROSSOVER',
      marketType: 'PERPETUAL',
      initialCapitalUsd: 10_000,
      riskPerTradePct: 0.5,
      leverage: 2,
      feeRateBps: 5,
      slippageBps: 3,
      fundingRatePer8hPct: 0.01,
      stopLossAtrMult: 1.5,
      takeProfitAtrMult: 2.5,
      monteCarloRuns: 50,
    },
    'Unit Test OHLCV Fixture',
  );

  assert.equal(result.candleCount, 180);
  assert.ok(result.equityCurve.length > 100);
  assert.ok(result.monteCarlo.p5FinalEquityUsd <= result.monteCarlo.p95FinalEquityUsd);
  assert.ok(result.disclaimer.includes('Backtest'));
});

test('Multi-Agent Pipeline respects Data Integrity veto and Risk Engine gate', () => {
  const agents = createInitialAgentRegistry();
  assert.equal(agents.length, 19);
  assert.equal(agents[0].latencyMs, 0);
  assert.equal(agents[0].evalCount, 0);

  const candles = makeTestCandles('SOL/USDT', 70, 120);
  const badTicker = makeValidTicker({
    symbol: 'SOL/USDT',
    lastPrice: 70,
    bidPrice: 72,
    askPrice: 70, // crossed book!
  });
  const orderBook: OrderBookSnapshot = {
    symbol: 'SOL/USDT',
    exchange: 'Binance',
    timestampUtc: Date.now(),
    bids: [{ price: 69.95, quantity: 100, totalUsd: 6995 }],
    asks: [{ price: 70.05, quantity: 100, totalUsd: 7005 }],
    spreadBps: 14.2,
    imbalanceRatio: 0,
    dataStatus: 'LIVE_EXCHANGE',
  };

  const signal = runMultiAgentDecisionPipeline({
    ticker: badTicker,
    candles,
    orderBook,
    riskConfig: DEFAULT_RISK_CONFIG,
    riskContext: makeBaseContext(),
    agents,
  });

  assert.equal(signal.direction, 'NO_TRADE');
  assert.equal(signal.state, 'REJECTED');
  assert.ok(signal.conflictsDetected.length > 0);
  assert.ok(Array.isArray(signal.debateRounds) && signal.debateRounds.length === 7);
  assert.equal(signal.debateRounds[0].phase, 'PROPOSE');
  assert.ok(signal.debateRounds.some((d) => d.phase === 'CHALLENGE'));
  assert.equal(signal.debateRounds[6].phase, 'VERDICT');
  assert.equal(signal.precisionTier, 'REJECTED_PRESERVE_CAPITAL');
});

test('Adversarial Robot Debate enforces Risk Enforcer VETO during EMERGENCY_STOP', () => {
  const agents = createInitialAgentRegistry();
  const candles = makeTestCandles('BTC/USDT', 59800, 120);
  const lastClose = candles[candles.length - 1].close;
  const validTicker = makeValidTicker({
    symbol: 'BTC/USDT',
    lastPrice: lastClose,
    bidPrice: lastClose * 0.9999,
    askPrice: lastClose * 1.0001,
  });
  const orderBook: OrderBookSnapshot = {
    symbol: 'BTC/USDT',
    exchange: 'Binance',
    timestampUtc: Date.now(),
    bids: [{ price: lastClose * 0.9999, quantity: 5, totalUsd: lastClose * 5 }],
    asks: [{ price: lastClose * 1.0001, quantity: 5, totalUsd: lastClose * 5 }],
    spreadBps: 2,
    imbalanceRatio: 0.25,
    dataStatus: 'LIVE_EXCHANGE',
  };

  const signal = runMultiAgentDecisionPipeline({
    ticker: validTicker,
    candles,
    orderBook,
    riskConfig: DEFAULT_RISK_CONFIG,
    riskContext: makeBaseContext({ tradingMode: 'EMERGENCY_STOP' }),
    agents,
  });

  assert.equal(signal.state, 'REJECTED');
  assert.equal(signal.riskCheck.approved, false);
  const riskTurn = signal.debateRounds?.find((d) => d.speakerId === 'RISK_MANAGEMENT');
  assert.ok(riskTurn);
  assert.equal(riskTurn.phase, 'VETO');
  assert.equal(riskTurn.stance, 'VETO');
});

test('Company Profile for Giáo Sư - Prof.TOAN matches 19-agent division count and risk charter', () => {
  assert.equal(COMPANY_PROFILE.companyName, 'Giáo Sư - Prof.TOAN');
  assert.equal(COMPANY_PROFILE.contactEmail, 'prof.toan@gmail.com');
  assert.equal(getTotalDivisionAgents(), 19);
  assert.ok(COMPANY_CHARTER_RULES.every((r) => r.enforced === true));

  const plaque = getCompanyPlaqueLines();
  assert.ok(plaque.title.includes('PROF.TOAN'));
  assert.ok(plaque.badgeLine.includes('19 ROBOT'));
});

test('Position telemetry computes R-multiple, trajectory track, breakeven, and SL/TP validation', () => {
  const openedMs = Date.UTC(2026, 10, 22, 0, 0, 0);
  const pos: Position = {
    id: 'POS-1',
    symbol: 'BTC/USDT',
    exchange: 'Binance',
    marketType: 'PERPETUAL',
    side: 'LONG',
    quantity: 0.2,
    entryPrice: 60_000,
    markPrice: 60_900,
    stopLoss: 59_100,
    takeProfit: 61_800,
    leverage: 2,
    marginUsd: 6_000,
    unrealizedPnlUsd: 180,
    unrealizedPnlPct: 3.0,
    liquidationPrice: 30_600,
    fundingPaidUsd: 0,
    strategyName: 'Smart Run · EMA',
    mode: 'PAPER',
    openedAtUtc: new Date(openedMs).toISOString(),
  };

  const tel = computePositionTelemetry(pos, openedMs + 15 * 60_000);
  assert.equal(tel.notionalUsd, 12_180);
  assert.equal(tel.riskUsd, 180);
  assert.equal(tel.rewardUsd, 360);
  assert.equal(tel.plannedRR, 2);
  assert.equal(tel.rMultiple, 1);
  assert.equal(tel.canMoveBreakeven, true);
  assert.equal(tel.heldDurationLabel, '15m');
  assert.ok(tel.markTrackPct > tel.entryTrackPct);

  const validUpdate = validatePositionSlTpUpdate(pos, 60_000, 62_000);
  assert.equal(validUpdate.valid, true);

  const invalidSlCross = validatePositionSlTpUpdate(pos, 61_000, 62_000);
  assert.equal(invalidSlCross.valid, false);
});

test('Smart symbol search parses aliases, market hints, ranks by relevance+volume, and formats micro-cap prices', () => {
  const parsed = parseMarketSearchQuery('bitcoin perp');
  assert.equal(parsed.normalizedBaseQuery, 'BITCOIN');
  assert.ok(parsed.aliasBases.includes('BTC'));
  assert.equal(parsed.marketTypeHint, 'PERPETUAL');

  const directory: MarketDirectoryEntry[] = [
    {
      symbol: 'BTC/USDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      exchange: 'Binance',
      exchangeId: 'binance',
      marketType: 'PERPETUAL',
      nativeSymbol: 'BTCUSDT',
      lastPrice: 59600,
      bidPrice: 59599,
      askPrice: 59601,
      change24hPct: 1.5,
      volume24hUsd: 8_000_000_000,
      maxLeverage: 20,
    },
    {
      symbol: 'PEPE/USDT',
      baseAsset: 'PEPE',
      quoteAsset: 'USDT',
      exchange: 'Binance',
      exchangeId: 'binance',
      marketType: 'PERPETUAL',
      nativeSymbol: '1000PEPEUSDT',
      lastPrice: 0.008512,
      bidPrice: 0.00851,
      askPrice: 0.008514,
      change24hPct: 6.2,
      volume24hUsd: 520_000_000,
      maxLeverage: 10,
    },
    {
      symbol: 'PEPE/USDT',
      baseAsset: 'PEPE',
      quoteAsset: 'USDT',
      exchange: 'OKX',
      exchangeId: 'okx',
      marketType: 'SPOT',
      nativeSymbol: 'PEPE-USDT',
      lastPrice: 0.00000851,
      bidPrice: 0.0000085,
      askPrice: 0.00000852,
      change24hPct: 6.1,
      volume24hUsd: 110_000_000,
      maxLeverage: 1,
    },
  ];

  const btcHits = searchMarketDirectory(directory, 'bitcoin perp');
  assert.equal(btcHits.length, 1);
  assert.equal(btcHits[0].symbol, 'BTC/USDT');

  const pepeHits = searchMarketDirectory(directory, 'pepe');
  assert.equal(pepeHits.length, 2);
  assert.equal(pepeHits[0].exchange, 'Binance');

  assert.equal(formatAssetPrice(0.00000851), '$0.00000851');
  assert.equal(formatAssetPrice(59612.45), '$59,612.45');
});

test('Multi-Agent Pipeline preserves sub-cent precision for micro-cap coins like PEPE/USDT', () => {
  const agents = createInitialAgentRegistry();
  const now = Date.now();
  const intervalMs = 3600_000;
  const alignedEnd = Math.floor(now / intervalMs) * intervalMs;
  const candles: Candle[] = [];
  let price = 0.00000285;
  for (let i = 119; i >= 0; i--) {
    const open = price;
    const close = open * 1.0014;
    candles.push({
      timestamp: alignedEnd - i * intervalMs,
      open: Number(open.toFixed(10)),
      high: Number((close * 1.004).toFixed(10)),
      low: Number((open * 0.996).toFixed(10)),
      close: Number(close.toFixed(10)),
      volume: 120_000_000_000,
    });
    price = close;
  }

  const lastPrice = candles[candles.length - 1].close;
  const ticker = makeValidTicker({
    symbol: 'PEPE/USDT',
    baseAsset: 'PEPE',
    exchange: 'OKX',
    marketType: 'SPOT',
    lastPrice,
    bidPrice: Number((lastPrice * 0.9994).toFixed(10)),
    askPrice: Number((lastPrice * 1.0006).toFixed(10)),
    high24h: Number((lastPrice * 1.04).toFixed(10)),
    low24h: Number((lastPrice * 0.94).toFixed(10)),
    volume24hUsd: 85_000_000,
    openInterestUsd: 0,
    fundingRatePct: 0,
    tickSize: 1e-8,
    maxLeverage: 1,
  });

  const orderBook: OrderBookSnapshot = {
    symbol: 'PEPE/USDT',
    exchange: 'OKX',
    timestampUtc: now,
    bids: [{ price: Number((lastPrice * 0.9994).toFixed(10)), quantity: 500_000_000, totalUsd: 1600 }],
    asks: [{ price: Number((lastPrice * 1.0006).toFixed(10)), quantity: 400_000_000, totalUsd: 1300 }],
    spreadBps: 12,
    imbalanceRatio: 0.25,
    dataStatus: 'LIVE_EXCHANGE',
  };

  const signal = runMultiAgentDecisionPipeline({
    ticker,
    candles,
    orderBook,
    riskConfig: DEFAULT_RISK_CONFIG,
    riskContext: makeBaseContext({ tradingMode: 'PAPER' }),
    agents,
  });

  assert.notEqual(signal.stopLoss, signal.entryRange[0]);
  assert.ok(signal.takeProfitLevels.length >= 2);
  assert.notEqual(signal.takeProfitLevels[1], signal.entryRange[1]);
  assert.ok(signal.riskReward >= 1.8, `Expected R:R >= 1.8 for PEPE micro-cap, got ${signal.riskReward}`);
  assert.ok(
    signal.agentVotes.some((v) => v.rationale.includes('$0.00000')) ||
      (signal.debateRounds ?? []).some((d) => d.argument.includes('$0.00000')),
  );
});

test('PnL History helpers filter windows, compute symmetric domain with zero baseline, and summarize series', () => {
  const baseMs = Date.UTC(2026, 10, 22, 8, 0, 0);
  const rawPoints: PnlHistoryPoint[] = [
    {
      timestampMs: baseMs - 90 * 60_000,
      timestampUtc: new Date(baseMs - 90 * 60_000).toISOString(),
      realizedPnlUsd: 0,
      unrealizedPnlUsd: 0,
      netPnlUsd: 0,
      totalEquityUsd: 100_000,
      openPositionsCount: 0,
    },
    {
      timestampMs: baseMs - 10 * 60_000,
      timestampUtc: new Date(baseMs - 10 * 60_000).toISOString(),
      realizedPnlUsd: -12,
      unrealizedPnlUsd: 85,
      netPnlUsd: 73,
      totalEquityUsd: 100_073,
      openPositionsCount: 1,
    },
    {
      timestampMs: baseMs - 2 * 60_000,
      timestampUtc: new Date(baseMs - 2 * 60_000).toISOString(),
      realizedPnlUsd: 140,
      unrealizedPnlUsd: -30,
      netPnlUsd: 110,
      totalEquityUsd: 100_110,
      openPositionsCount: 1,
    },
  ];

  const win15m = filterPnlHistoryByWindow(rawPoints, '15m', baseMs);
  assert.equal(win15m.length, 2);
  assert.equal(win15m[1].realizedPnlUsd, 140);

  const winAll = filterPnlHistoryByWindow(rawPoints, 'ALL', baseMs);
  assert.equal(winAll.length, 3);

  const appendedSameSec = appendPnlPoint(winAll, {
    ...rawPoints[2],
    timestampMs: rawPoints[2].timestampMs + 500,
    unrealizedPnlUsd: 45,
    netPnlUsd: 185,
  });
  assert.equal(appendedSameSec.length, 3);
  assert.equal(appendedSameSec[2].netPnlUsd, 185);

  const domain = computePnlDomain(appendedSameSec, { realized: true, unrealized: true, net: true });
  assert.ok(domain[0] < 0 && domain[1] > 185);

  const zeroDomain = computePnlDomain([rawPoints[0]], { realized: true, unrealized: true, net: true });
  assert.deepEqual(zeroDomain, [-25, 25]);

  const appendedNext = appendPnlPoint(appendedSameSec, {
    ...rawPoints[2],
    timestampMs: rawPoints[2].timestampMs + 5000,
    unrealizedPnlUsd: -30,
    netPnlUsd: 110,
  });
  assert.equal(appendedNext.length, 4);

  const summary = summarizePnlSeries(appendedNext);
  assert.equal(summary.currentRealizedUsd, 140);
  assert.equal(summary.currentUnrealizedUsd, -30);
  assert.equal(summary.highNetUsd, 185);
  assert.equal(summary.minUnrealizedUsd, -30);

  assert.equal(formatSignedUsd(125.5), '+$125.50');
  assert.equal(formatSignedUsd(-42.1), '-$42.10');
});

test('Pair selection helpers enforce exact exchange+marketType sync and strict signal matching', () => {
  const btcPerpBinance = makeValidTicker({
    symbol: 'BTC/USDT',
    exchange: 'Binance',
    marketType: 'PERPETUAL',
  });
  const btcSpotBinance = makeValidTicker({
    symbol: 'BTC/USDT',
    exchange: 'Binance',
    marketType: 'SPOT',
  });
  const pepeSpotOkx = makeValidTicker({
    symbol: 'PEPE/USDT',
    baseAsset: 'PEPE',
    exchange: 'OKX',
    marketType: 'SPOT',
    lastPrice: 0.0000085,
  });
  const pepeSpotCoinbase = makeValidTicker({
    symbol: 'PEPE/USDT',
    baseAsset: 'PEPE',
    exchange: 'Coinbase Advanced',
    marketType: 'SPOT',
    lastPrice: 0.00000851,
  });

  const tickers = dedupeTickersByPair([
    btcPerpBinance,
    btcSpotBinance,
    pepeSpotOkx,
    btcPerpBinance,
    pepeSpotCoinbase,
  ]);
  assert.equal(tickers.length, 4);

  const exactCoinbase = findMatchingTicker(tickers, {
    symbol: 'PEPE/USDT',
    marketType: 'SPOT',
    exchange: 'Coinbase Advanced',
  });
  assert.equal(exactCoinbase?.exchange, 'Coinbase Advanced');

  const serialized = serializePairSelection({
    symbol: 'PEPE/USDT',
    marketType: 'SPOT',
    exchange: 'Coinbase Advanced',
  });
  assert.equal(serialized, 'PEPE/USDT|SPOT|Coinbase Advanced');
  assert.deepEqual(parsePairSelection(serialized), {
    symbol: 'PEPE/USDT',
    marketType: 'SPOT',
    exchange: 'Coinbase Advanced',
  });

  const btcSignal: TradingSignal = {
    id: 'SIG-BTC',
    symbol: 'BTC/USDT',
    exchange: 'Binance',
    marketType: 'PERPETUAL',
    direction: 'LONG',
    entryRange: [60000, 60100],
    stopLoss: 59000,
    takeProfitLevels: [62000, 63500],
    positionSizeQty: 0.1,
    leverage: 2,
    riskUsd: 100,
    rewardUsd: 350,
    riskReward: 3.5,
    timeHorizon: '1h',
    marketRegime: 'BULL',
    technicalScore: 80,
    quantScore: 78,
    liquidityScore: 95,
    fundamentalScore: 72,
    sentimentScore: 70,
    dataQualityScore: 98,
    riskScore: 90,
    confidenceScore: 82,
    calibratedProbabilityNote: 'Uncalibrated',
    strategyName: 'EMA',
    reasoningSummary: 'Bullish BTC',
    conflictsDetected: [],
    agentVotes: [],
    dataSource: 'LIVE_EXCHANGE',
    timestampUtc: new Date().toISOString(),
    expiresAtUtc: new Date().toISOString(),
    state: 'APPROVED',
    riskCheck: evaluateOrderRisk(
      {
        symbol: 'BTC/USDT',
        exchange: 'Binance',
        marketType: 'PERPETUAL',
        side: 'LONG',
        orderType: 'LIMIT',
        entryPrice: 60000,
        stopLoss: 59000,
        takeProfit: 63500,
        leverage: 2,
        idempotencyKey: 'sig-btc',
        dataStatus: 'LIVE_EXCHANGE',
      },
      DEFAULT_RISK_CONFIG,
      makeBaseContext(),
    ),
  };

  // Strictly match BTC/USDT signal, never leak BTC signal when PEPE is selected
  assert.equal(findMatchingSignal([btcSignal], btcPerpBinance)?.id, 'SIG-BTC');
  assert.equal(findMatchingSignal([btcSignal], btcSpotBinance), null);
  assert.equal(findMatchingSignal([btcSignal], pepeSpotOkx), null);
});

test('Risk Engine enforces maxSingleAssetExposurePct and rejects NaN inputs', () => {
  const existingBtcPos: Position = {
    id: 'POS-EXISTING',
    symbol: 'BTC/USDT',
    exchange: 'Binance',
    marketType: 'PERPETUAL',
    side: 'LONG',
    quantity: 0.55,
    entryPrice: 60_000,
    markPrice: 60_000,
    stopLoss: 58_000,
    takeProfit: 65_000,
    leverage: 3,
    marginUsd: 11_000,
    unrealizedPnlUsd: 0,
    unrealizedPnlPct: 0,
    liquidationPrice: 40_300,
    fundingPaidUsd: 0,
    strategyName: 'Test',
    mode: 'PAPER',
    openedAtUtc: new Date().toISOString(),
  };

  // Existing BTC notional = $33,000; 35% of $100,000 = $35,000 -> remaining $2,000
  // Auto-sized order gets safely capped to <= $2,000 remaining room
  const capped = evaluateOrderRisk(
    {
      symbol: 'BTC/USDT',
      exchange: 'Binance',
      marketType: 'PERPETUAL',
      side: 'LONG',
      orderType: 'LIMIT',
      entryPrice: 60_000,
      stopLoss: 58_500,
      takeProfit: 63_000,
      leverage: 2,
      idempotencyKey: 'cap-1',
      dataStatus: 'LIVE_EXCHANGE',
    },
    DEFAULT_RISK_CONFIG,
    makeBaseContext({ openPositions: [existingBtcPos] }),
  );
  assert.equal(capped.approved, true);
  assert.equal(capped.decision, 'REDUCE_POSITION');
  assert.ok(capped.notionalValueUsd <= 2005);

  // Explicit oversized quantity violating maxSingleAssetExposurePct is rejected
  const rejectedCap = evaluateOrderRisk(
    {
      symbol: 'BTC/USDT',
      exchange: 'Binance',
      marketType: 'PERPETUAL',
      side: 'LONG',
      orderType: 'LIMIT',
      entryPrice: 60_000,
      stopLoss: 58_500,
      takeProfit: 63_000,
      leverage: 2,
      quantity: 0.1, // $6,000 + $33,000 = $39,000 > $35,000
      idempotencyKey: 'cap-2',
      dataStatus: 'LIVE_EXCHANGE',
    },
    DEFAULT_RISK_CONFIG,
    makeBaseContext({ openPositions: [existingBtcPos] }),
  );
  assert.equal(rejectedCap.approved, false);

  // NaN input is rejected deterministically
  const nanRes = evaluateOrderRisk(
    {
      symbol: 'BTC/USDT',
      exchange: 'Binance',
      marketType: 'PERPETUAL',
      side: 'LONG',
      orderType: 'LIMIT',
      entryPrice: Number.NaN,
      stopLoss: 58_500,
      takeProfit: 63_000,
      leverage: 2,
      idempotencyKey: 'nan-1',
      dataStatus: 'LIVE_EXCHANGE',
    },
    DEFAULT_RISK_CONFIG,
    makeBaseContext(),
  );
  assert.equal(nanRes.approved, false);
});

test('Backtester scales funding & Sharpe by timeframe, credits SHORT positive funding, and preserves micro-cap precision', () => {
  assert.equal(getTimeframeHours('15m'), 0.25);
  assert.equal(getTimeframeHours('1h'), 1);
  assert.equal(getTimeframeHours('4h'), 4);
  assert.equal(getTimeframeHours('1d'), 24);

  // Build candles that trigger a SHORT EMA crossover and hold for >= 1 bar on 1d timeframe
  const now = Date.now();
  const dayMs = 24 * 3600_000;
  const aligned = Math.floor(now / dayMs) * dayMs;
  const dailyCandles: Candle[] = [];
  for (let i = 0; i < 60; i++) {
    const px = i < 35 ? 100 + i * 0.6 : 121 - (i - 35) * 1.4;
    dailyCandles.push({
      timestamp: aligned - (60 - i) * dayMs,
      open: px + 0.1,
      high: px + 0.8,
      low: px - 0.8,
      close: px,
      volume: 10_000,
    });
  }

  const btDaily = runBacktest(
    dailyCandles,
    {
      symbol: 'ETH/USDT',
      timeframe: '1d',
      strategyId: 'EMA_CROSSOVER',
      marketType: 'PERPETUAL',
      initialCapitalUsd: 10_000,
      riskPerTradePct: 0.5,
      leverage: 2,
      feeRateBps: 5,
      slippageBps: 3,
      fundingRatePer8hPct: 0.1, // positive funding -> SHORT receives negative cost (income)
      stopLossAtrMult: 2,
      takeProfitAtrMult: 3,
      monteCarloRuns: 20,
    },
    'Daily Funding Fixture',
  );
  const shortTrades = btDaily.trades.filter((t) => t.side === 'SHORT');
  assert.ok(shortTrades.length >= 1, 'Expected at least 1 SHORT trade on downtrend');
  assert.ok(shortTrades[0].fundingUsd < 0, 'SHORT should receive positive funding (negative funding cost)');

  // Micro-cap PEPE series (~0.0000033) preserves 8+ decimals in backtest trades
  const pepeCandles = makeTestCandles('PEPE/USDT', 0.0000033, 140, 3600_000, now).map((c, idx) => {
    const scale = 0.0000033 / 0.0000033;
    const base = idx < 50 ? 0.0000031 + idx * 0.00000001 : 0.0000036 - (idx - 50) * 0.000000008;
    return {
      ...c,
      open: Number((base * scale).toFixed(10)),
      high: Number((base * 1.01).toFixed(10)),
      low: Number((base * 0.99).toFixed(10)),
      close: Number((base * 1.002).toFixed(10)),
    };
  });
  const pepeBt = runBacktest(
    pepeCandles,
    {
      symbol: 'PEPE/USDT',
      timeframe: '1h',
      strategyId: 'EMA_CROSSOVER',
      marketType: 'SPOT',
      initialCapitalUsd: 10_000,
      riskPerTradePct: 0.5,
      leverage: 1,
      feeRateBps: 5,
      slippageBps: 3,
      fundingRatePer8hPct: 0,
      stopLossAtrMult: 1.5,
      takeProfitAtrMult: 2.5,
      monteCarloRuns: 20,
    },
    'PEPE Micro-cap Fixture',
  );
  if (pepeBt.trades.length > 0) {
    assert.ok(pepeBt.trades[0].entryPrice > 0.000003 && pepeBt.trades[0].entryPrice < 0.000005);
    assert.notEqual(pepeBt.trades[0].entryPrice, 0.000003);
  }
});

test('Position telemetry handles micro-cap (< 1e-8) SL/TP spans and pipeline respects disabled agents & NO_TRADE Step 6', () => {
  const microPos: Position = {
    id: 'POS-MICRO',
    symbol: 'SHIB/USDT',
    exchange: 'OKX',
    marketType: 'SPOT',
    side: 'LONG',
    quantity: 1_000_000_000,
    entryPrice: 0.000000005,
    markPrice: 0.000000006,
    stopLoss: 0.0000000045,
    takeProfit: 0.0000000065,
    leverage: 1,
    marginUsd: 5,
    unrealizedPnlUsd: 1,
    unrealizedPnlPct: 20,
    liquidationPrice: null,
    fundingPaidUsd: 0,
    strategyName: 'Micro',
    mode: 'PAPER',
    openedAtUtc: new Date().toISOString(),
  };
  const tel = computePositionTelemetry(microPos);
  assert.equal(tel.rMultiple, 2);
  assert.ok(tel.markTrackPct > tel.entryTrackPct);

  // Disabling TECHNICAL_ANALYSIS, QUANT_AI & ORDER_BOOK_LIQUIDITY leaves <2 directional votes -> NO_TRADE + Step 6 STANDBY
  const agents = createInitialAgentRegistry().map((a) =>
    a.id === 'TECHNICAL_ANALYSIS' ||
    a.id === 'QUANT_AI' ||
    a.id === 'ORDER_BOOK_LIQUIDITY'
      ? { ...a, enabled: false }
      : a,
  );
  const candles = makeTestCandles('BTC/USDT', 59800, 120);
  const lastClose = candles[candles.length - 1].close;
  const obSnapshot: OrderBookSnapshot = {
    symbol: 'BTC/USDT',
    exchange: 'Binance',
    timestampUtc: Date.now(),
    bids: [{ price: lastClose * 0.9999, quantity: 5, totalUsd: lastClose * 5 }],
    asks: [{ price: lastClose * 1.0001, quantity: 5, totalUsd: lastClose * 5 }],
    spreadBps: 2,
    imbalanceRatio: 0.25,
    dataStatus: 'LIVE_EXCHANGE',
  };
  const validTk = makeValidTicker({
    lastPrice: lastClose,
    bidPrice: lastClose * 0.9999,
    askPrice: lastClose * 1.0001,
  });

  const sig = runMultiAgentDecisionPipeline({
    ticker: validTk,
    candles,
    orderBook: obSnapshot,
    riskConfig: DEFAULT_RISK_CONFIG,
    riskContext: makeBaseContext(),
    agents,
  });

  assert.equal(sig.direction, 'NO_TRADE');
  assert.equal(sig.state, 'REJECTED');
  const techVote = sig.agentVotes.find((v) => v.agentId === 'TECHNICAL_ANALYSIS');
  assert.equal(techVote?.stance, 'NEUTRAL');
  const riskTurn = sig.debateRounds?.find((d) => d.speakerId === 'RISK_MANAGEMENT');
  assert.ok(riskTurn?.argument.includes('STANDBY'));

  // Disabling DATA_INTEGRITY prevents trading even if analysis agents are online
  const noIntegrityAgents = createInitialAgentRegistry().map((a) =>
    a.id === 'DATA_INTEGRITY' ? { ...a, enabled: false } : a,
  );
  const noIntegritySig = runMultiAgentDecisionPipeline({
    ticker: validTk,
    candles,
    orderBook: obSnapshot,
    riskConfig: DEFAULT_RISK_CONFIG,
    riskContext: makeBaseContext(),
    agents: noIntegrityAgents,
  });
  assert.equal(noIntegritySig.direction, 'NO_TRADE');
  assert.equal(noIntegritySig.state, 'REJECTED');
  assert.ok(noIntegritySig.conflictsDetected.some((c) => c.includes('Data Integrity')));
});

test('Adaptive Confluence Alpha v3 scores 5 orthogonal factors, vetoes shocks, and executes causal +1.0R breakeven backtest', async () => {
  const {
    buildConfluenceSeries,
    computeAdaptiveConfluenceLiveSnapshot,
    evaluateAdaptiveConfluenceAtBar,
    STRATEGY_CATALOG,
  } = await import('./adaptiveConfluence.ts');
  const { benchmarkAllStrategies } = await import('./backtester.ts');

  assert.equal(STRATEGY_CATALOG.length, 5);
  assert.equal(STRATEGY_CATALOG[0].id, 'ADAPTIVE_CONFLUENCE_ALPHA');

  // Construct an uptrend with structured healthy pullbacks to EMA21 followed by green bounces (RSI ~48-64)
  const now = Date.UTC(2026, 10, 22, 0, 0, 0);
  const trendPullbackCandles: Candle[] = [];
  let px = 100;
  for (let i = 0; i < 160; i++) {
    const phase = i % 12;
    let delta = 0.0035;
    let vol = 1200;
    if (phase >= 5 && phase <= 8) {
      delta = -0.0045; // 4-bar controlled pullback into EMA21 value zone
      vol = 950;
    } else if (phase === 9 || phase === 10) {
      delta = 0.0095; // institutional reclaim candle with volume spike
      vol = 2200;
    }
    const open = px;
    const close = open * (1 + delta);
    const high = Math.max(open, close) * 1.003;
    const low = Math.min(open, close) * (phase === 9 ? 0.992 : 0.997);
    trendPullbackCandles.push({
      timestamp: now - (160 - i) * 3600_000,
      open: Number(open.toFixed(4)),
      high: Number(high.toFixed(4)),
      low: Number(low.toFixed(4)),
      close: Number(close.toFixed(4)),
      volume: vol,
    });
    px = close;
  }

  const bt = runBacktest(
    trendPullbackCandles,
    {
      symbol: 'ETH/USDT',
      timeframe: '1h',
      strategyId: 'ADAPTIVE_CONFLUENCE_ALPHA',
      marketType: 'PERPETUAL',
      initialCapitalUsd: 10_000,
      riskPerTradePct: 0.5,
      leverage: 2,
      feeRateBps: 5,
      slippageBps: 2,
      fundingRatePer8hPct: 0.005,
      stopLossAtrMult: 1.5,
      takeProfitAtrMult: 2.5,
      monteCarloRuns: 40,
    },
    'Structured Trend Pullback Fixture',
  );
  assert.ok(bt.totalTrades >= 2, `Expected >=2 confluence trades, got ${bt.totalTrades}`);
  assert.ok(bt.winRatePct >= 50, `Expected high win rate on structured trend, got ${bt.winRatePct}%`);

  // Verify shock veto triggers on extreme 5x ATR spike bar
  const shocked = [...trendPullbackCandles];
  const last = shocked[shocked.length - 1];
  shocked[shocked.length - 1] = {
    ...last,
    high: last.close * 1.18,
    low: last.close * 0.82,
    close: last.close * 1.02,
  };
  const shockSeries = buildConfluenceSeries(shocked);
  const shockSnap = evaluateAdaptiveConfluenceAtBar({
    candles: shocked,
    series: shockSeries,
    index: shocked.length - 1,
    marketType: 'PERPETUAL',
  });
  assert.equal(shockSnap.shockVeto, true);
  assert.equal(shockSnap.direction, 'NO_TRADE');

  // Verify benchmarkAllStrategies compares all 5 strategies and identifies highest win rate
  const bm = benchmarkAllStrategies(
    trendPullbackCandles,
    {
      symbol: 'ETH/USDT',
      timeframe: '1h',
      marketType: 'PERPETUAL',
      initialCapitalUsd: 10_000,
      riskPerTradePct: 0.5,
      leverage: 2,
      feeRateBps: 5,
      slippageBps: 2,
      fundingRatePer8hPct: 0.005,
      stopLossAtrMult: 1.5,
      takeProfitAtrMult: 2.5,
      monteCarloRuns: 40,
    },
    'Structured Trend Pullback Fixture',
  );
  assert.equal(bm.entries.length, 5);
  assert.equal(bm.entries[0].rank, 1);
  assert.equal(bm.entries[4].rank, 5);
  assert.ok(bm.entries.some((e) => e.strategyId === bm.bestWinRateStrategyId && e.isHighestWinRate));

  // Verify Multi-Agent Pipeline attaches quantAlpha telemetry
  const liveSnap = computeAdaptiveConfluenceLiveSnapshot({
    candles: trendPullbackCandles,
    indicators: computeAllIndicators(trendPullbackCandles),
    regime: 'BULL',
    marketType: 'PERPETUAL',
  });
  assert.equal(liveSnap.factors.length, 5);

  const lastClose = trendPullbackCandles[trendPullbackCandles.length - 1].close;
  const sig = runMultiAgentDecisionPipeline({
    ticker: makeValidTicker({
      symbol: 'ETH/USDT',
      lastPrice: lastClose,
      bidPrice: lastClose * 0.9998,
      askPrice: lastClose * 1.0002,
    }),
    candles: trendPullbackCandles,
    orderBook: {
      symbol: 'ETH/USDT',
      exchange: 'Binance',
      timestampUtc: Date.now(),
      bids: [{ price: lastClose * 0.9998, quantity: 50, totalUsd: lastClose * 50 }],
      asks: [{ price: lastClose * 1.0002, quantity: 40, totalUsd: lastClose * 40 }],
      spreadBps: 4,
      imbalanceRatio: 0.22,
      dataStatus: 'LIVE_EXCHANGE',
    },
    riskConfig: DEFAULT_RISK_CONFIG,
    riskContext: makeBaseContext(),
    agents: createInitialAgentRegistry(),
  });
  assert.ok(sig.quantAlpha);
  assert.equal(sig.quantAlpha?.strategyId, 'ADAPTIVE_CONFLUENCE_ALPHA');
  assert.equal(sig.quantAlpha?.factors.length, 5);
});

test('Exchange catalog covers 11 top exchanges and AES-256-GCM Vault encrypts, decrypts, and rejects tampered payloads', async () => {
  const { EXCHANGE_SPECS, getExchangeSpec } = await import('./exchangeCatalog.ts');
  const {
    decryptSecretPayload,
    encryptSecretPayload,
    maskApiKey,
  } = await import('../../server/cryptoVault.ts');

  const ids = Object.keys(EXCHANGE_SPECS);
  assert.equal(ids.length, 11);
  for (const id of ['binance', 'bybit', 'okx', 'coinbase', 'kraken', 'bitget', 'kucoin', 'gateio', 'mexc', 'htx', 'deribit']) {
    assert.ok(EXCHANGE_SPECS[id], `Missing spec for ${id}`);
  }
  assert.equal(getExchangeSpec('okx').requiresPassphrase, true);
  assert.equal(getExchangeSpec('kucoin').requiresPassphrase, true);
  assert.equal(getExchangeSpec('bitget').requiresPassphrase, true);
  assert.equal(getExchangeSpec('binance').supportsTestnet, true);
  assert.equal(getExchangeSpec('bybit').supportsTestnet, true);
  assert.equal(getExchangeSpec('deribit').supportsTestnet, true);

  const encrypted = encryptSecretPayload({
    apiKey: 'vmP8kLmN9xQrT2zAbCdE',
    apiSecret: 's3cr3tK3yValueForTesting9988',
    passphrase: 'vault-passphrase-2026',
  });
  assert.ok(!encrypted.includes('s3cr3tK3yValueForTesting9988'));
  assert.ok(!encrypted.includes('vault-passphrase-2026'));

  const decrypted = decryptSecretPayload(encrypted);
  assert.equal(decrypted.apiKey, 'vmP8kLmN9xQrT2zAbCdE');
  assert.equal(decrypted.apiSecret, 's3cr3tK3yValueForTesting9988');
  assert.equal(decrypted.passphrase, 'vault-passphrase-2026');

  // Tamper auth tag / ciphertext must throw
  const parsed = JSON.parse(encrypted) as { v: number; iv: string; tag: string; data: string };
  const flippedTag = (parsed.tag[0] === 'a' ? 'b' : 'a') + parsed.tag.slice(1);
  assert.throws(() => decryptSecretPayload(JSON.stringify({ ...parsed, tag: flippedTag })));

  assert.equal(maskApiKey('vmP8kLmN9xQrT2zAbCdE'), 'vmP8••••bCdE');
  assert.equal(maskApiKey('short'), '••••••••');
});

test('Exchange Auth computes deterministic signatures across exchanges and enforces Zero-Withdrawal policy', async () => {
  const {
    buildCoinbaseAuthHeaders,
    detectWithdrawalPermission,
    signBinanceQuery,
    signBitgetV2,
    signBybitV5,
    signGateIoV4,
    signHtx,
    signKraken,
    signKuCoin,
    signOkxV5,
  } = await import('../../server/exchangeAuth.ts');

  const binanceSig = signBinanceQuery('symbol=LTCBTC&side=BUY&timestamp=1499827319559', 'NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j');
  assert.equal(binanceSig.length, 64);

  const bybitSig = signBybitV5({
    timestampMs: '1658384314791',
    apiKey: 'XXXXXXXXXX',
    recvWindow: '5000',
    queryOrBody: 'category=option',
    apiSecret: 'secret-key',
  });
  assert.equal(bybitSig.length, 64);

  const okxSig = signOkxV5({
    timestampIso: '2026-11-23T00:00:00.000Z',
    method: 'GET',
    requestPath: '/api/v5/account/config',
    body: '',
    apiSecret: 'okx-secret',
  });
  assert.ok(okxSig.endsWith('=') || okxSig.length >= 43);

  const bitgetSig = signBitgetV2({
    timestampMs: '1700000000000',
    method: 'GET',
    requestPath: '/api/v2/spot/account/info',
    queryString: '',
    body: '',
    apiSecret: 'bitget-secret',
  });
  assert.ok(bitgetSig.length >= 43);

  const kucoinAuth = signKuCoin({
    timestampMs: '1700000000000',
    method: 'GET',
    endpoint: '/api/v1/accounts',
    body: '',
    apiSecret: 'kucoin-secret',
    passphrase: 'my-passphrase',
  });
  assert.ok(kucoinAuth.signature.length >= 43);
  assert.ok(kucoinAuth.signedPassphrase.length >= 43);

  const gateSig = signGateIoV4({
    method: 'GET',
    urlPath: '/api/v4/spot/accounts',
    queryString: '',
    body: '',
    timestampSec: '1700000000',
    apiSecret: 'gate-secret',
  });
  assert.equal(gateSig.length, 128); // SHA-512 hex

  const krakenSig = signKraken({
    urlPath: '/0/private/Balance',
    nonce: '1616492376594',
    postData: 'nonce=1616492376594',
    base64Secret: Buffer.from('kraken-secret-key-test').toString('base64'),
  });
  assert.ok(krakenSig.length > 40);

  const htxSig = signHtx({
    method: 'GET',
    host: 'api.huobi.pro',
    path: '/v1/account/accounts',
    sortedQueryString: 'AccessKeyId=test&SignatureMethod=HmacSHA256&SignatureVersion=2&Timestamp=2026-11-23T00%3A00%3A00',
    apiSecret: 'htx-secret',
  });
  assert.ok(htxSig.length >= 43);

  const cbHeaders = buildCoinbaseAuthHeaders({
    apiKey: 'cb-key-1234',
    apiSecret: 'cb-hmac-secret',
    method: 'GET',
    host: 'api.coinbase.com',
    requestPath: '/api/v3/brokerage/accounts',
  });
  assert.equal(cbHeaders['CB-ACCESS-KEY'], 'cb-key-1234');
  assert.equal(cbHeaders['CB-ACCESS-SIGN']?.length, 64);

  // Zero-Withdrawal detection checks across exchanges
  assert.equal(
    detectWithdrawalPermission('binance', { canWithdraw: true, canTrade: true }).hasWithdrawal,
    true,
  );
  assert.equal(
    detectWithdrawalPermission('binance', { canWithdraw: false, canTrade: true, permissions: ['SPOT', 'FUTURES'] }).hasWithdrawal,
    false,
  );
  assert.equal(
    detectWithdrawalPermission('bybit', { result: { readOnly: 0, permissions: { Wallet: ['Withdraw'], Spot: ['SpotTrade'] } } }).hasWithdrawal,
    true,
  );
  assert.equal(
    detectWithdrawalPermission('okx', { data: [{ perm: 'read_only,trade,withdraw' }] }).hasWithdrawal,
    true,
  );
  assert.equal(
    detectWithdrawalPermission('okx', { data: [{ perm: 'read_only,trade' }] }).hasWithdrawal,
    false,
  );
  assert.equal(
    detectWithdrawalPermission('bitget', { data: { authorities: ['spot_trade', 'withdraw'] } }).hasWithdrawal,
    true,
  );
  assert.equal(
    detectWithdrawalPermission('deribit', { result: { scope: 'account:read wallet:read_write' } }).hasWithdrawal,
    true,
  );
  assert.equal(
    detectWithdrawalPermission('deribit', { result: { scope: 'account:read trade:read_write' } }).hasWithdrawal,
    false,
  );
});

test('Adaptive Alpha v4 enforces 4H HTF alignment, Expectancy (EV), and bounded conviction sizing', async () => {
  const { computeAdaptiveConfluenceLiveSnapshot } = await import('./adaptiveConfluence.ts');
  const now = Date.now();

  // Construct strong bullish 1H pullback + recovery and contrasting bullish/bearish 4H candles
  const bull1h: Candle[] = [];
  let px1h = 100;
  for (let i = 0; i < 120; i++) {
    const phase = i % 10;
    const delta = phase >= 5 && phase <= 7 ? -0.004 : phase === 8 ? 0.011 : 0.003;
    const open = px1h;
    const close = open * (1 + delta);
    bull1h.push({
      timestamp: now - (120 - i) * 3600_000,
      open: Number(open.toFixed(4)),
      high: Number((Math.max(open, close) * 1.003).toFixed(4)),
      low: Number((Math.min(open, close) * 0.996).toFixed(4)),
      close: Number(close.toFixed(4)),
      volume: phase === 8 ? 3000 : 1200,
    });
    px1h = close;
  }

  const bull4h: Candle[] = [];
  let px4h = 85;
  for (let i = 0; i < 65; i++) {
    const open = px4h;
    const close = open * 1.006;
    bull4h.push({
      timestamp: now - (65 - i) * 4 * 3600_000,
      open: Number(open.toFixed(4)),
      high: Number((close * 1.003).toFixed(4)),
      low: Number((open * 0.998).toFixed(4)),
      close: Number(close.toFixed(4)),
      volume: 5000,
    });
    px4h = close;
  }

  const bear4h: Candle[] = [];
  let pxBear = 160;
  for (let i = 0; i < 65; i++) {
    const open = pxBear;
    const close = open * 0.992;
    bear4h.push({
      timestamp: now - (65 - i) * 4 * 3600_000,
      open: Number(open.toFixed(4)),
      high: Number((open * 1.002).toFixed(4)),
      low: Number((close * 0.997).toFixed(4)),
      close: Number(close.toFixed(4)),
      volume: 5000,
    });
    pxBear = close;
  }

  const alignedSnap = computeAdaptiveConfluenceLiveSnapshot({
    candles: bull1h,
    htfCandles: bull4h,
    indicators: computeAllIndicators(bull1h),
    regime: 'BULL',
    marketType: 'PERPETUAL',
  });
  assert.equal(alignedSnap.htfAlignment, 'ALIGNED_BULL');
  assert.ok(typeof alignedSnap.expectedValueR === 'number');

  const counterSnap = computeAdaptiveConfluenceLiveSnapshot({
    candles: bull1h,
    htfCandles: bear4h,
    indicators: computeAllIndicators(bull1h),
    regime: 'BULL',
    marketType: 'PERPETUAL',
  });
  assert.equal(counterSnap.htfAlignment, 'COUNTER_TREND');
  assert.ok(counterSnap.bullScore < alignedSnap.bullScore);

  const lastClose = bull1h[bull1h.length - 1].close;
  const sig = runMultiAgentDecisionPipeline({
    ticker: makeValidTicker({
      symbol: 'ETH/USDT',
      lastPrice: lastClose,
      bidPrice: lastClose * 0.9999,
      askPrice: lastClose * 1.0001,
    }),
    candles: bull1h,
    htfCandles: bull4h,
    orderBook: {
      symbol: 'ETH/USDT',
      exchange: 'Binance',
      timestampUtc: now,
      bids: [{ price: lastClose * 0.9999, quantity: 30, totalUsd: lastClose * 30 }],
      asks: [{ price: lastClose * 1.0001, quantity: 20, totalUsd: lastClose * 20 }],
      spreadBps: 2,
      imbalanceRatio: 0.2,
      dataStatus: 'LIVE_EXCHANGE',
    },
    riskConfig: DEFAULT_RISK_CONFIG,
    riskContext: makeBaseContext({ tradingMode: 'PAPER' }),
    agents: createInitialAgentRegistry(),
  });
  assert.ok(sig.recommendedRiskPct !== undefined);
  assert.ok(sig.recommendedRiskPct <= DEFAULT_RISK_CONFIG.maxRiskPerTradePct);
  assert.ok(typeof sig.expectedValueR === 'number');
});

test('Walk-Forward Optimizer chronologically splits In-Sample / Out-of-Sample and returns valid optimal config', async () => {
  const { optimizeStrategyWalkForward } = await import('./backtester.ts');
  const candles = makeTestCandles('BTC/USDT', 59800, 160);

  const opt = optimizeStrategyWalkForward(
    candles,
    {
      symbol: 'BTC/USDT',
      timeframe: '1h',
      marketType: 'PERPETUAL',
      initialCapitalUsd: 10_000,
      riskPerTradePct: 0.5,
      leverage: 2,
      feeRateBps: 5,
      slippageBps: 3,
      fundingRatePer8hPct: 0.01,
      monteCarloRuns: 40,
    },
    'Walk-Forward Unit Fixture',
  );

  assert.equal(opt.candleCount, 160);
  assert.equal(opt.inSampleBars + opt.outOfSampleBars, 160);
  assert.ok(opt.inSampleBars >= 48);
  assert.ok(opt.outOfSampleBars >= 40);
  assert.equal(opt.candidatesEvaluated, 20);
  assert.equal(opt.topCandidates.length, 6);
  assert.ok(opt.bestStopLossAtrMult > 0);
  assert.ok(opt.bestTakeProfitAtrMult >= opt.bestStopLossAtrMult);
  assert.equal(opt.fullHistoryResult.candleCount, 160);

  const hasHighWinProfitableOos = opt.topCandidates.some(
    (c) => c.outOfSampleTrades > 0 && c.outOfSampleNetProfitUsd > 0 && c.outOfSampleWinRatePct >= 50,
  );
  if (hasHighWinProfitableOos) {
    assert.ok(opt.topCandidates[0].outOfSampleNetProfitUsd > 0);
    assert.ok(opt.topCandidates[0].outOfSampleWinRatePct >= 50);
  }
  const hasAnyProfitableOos = opt.topCandidates.some(
    (c) => c.outOfSampleTrades > 0 && c.outOfSampleNetProfitUsd > 0,
  );
  if (hasAnyProfitableOos) {
    assert.ok(opt.topCandidates[0].outOfSampleNetProfitUsd > 0);
  }
});

test('Full-Market Screener filters stablecoins/toxic spreads, computes Market Breadth, classifies archetypes, and deduplicates by liquidity', async () => {
  const { computeMarketBreadth, preScreenMarketDirectory } = await import('./marketScreener.ts');

  const directory = [
    // Stablecoin pair that MUST be excluded
    {
      symbol: 'USDC/USDT',
      baseAsset: 'USDC',
      quoteAsset: 'USDT',
      exchange: 'Binance' as const,
      exchangeId: 'binance' as const,
      marketType: 'SPOT' as const,
      nativeSymbol: 'USDCUSDT',
      lastPrice: 1.0001,
      bidPrice: 1.0,
      askPrice: 1.0001,
      change24hPct: 0.01,
      volume24hUsd: 850_000_000,
      maxLeverage: 1,
    },
    // Toxic spread > 45 bps that MUST be excluded
    {
      symbol: 'ILLIQ/USDT',
      baseAsset: 'ILLIQ',
      quoteAsset: 'USDT',
      exchange: 'OKX' as const,
      exchangeId: 'okx' as const,
      marketType: 'SPOT' as const,
      nativeSymbol: 'ILLIQ-USDT',
      lastPrice: 1.0,
      bidPrice: 0.99,
      askPrice: 1.0,
      change24hPct: 12.0,
      volume24hUsd: 5_000_000,
      maxLeverage: 1,
    },
    // Low volume below $1M threshold
    {
      symbol: 'MICRO/USDT',
      baseAsset: 'MICRO',
      quoteAsset: 'USDT',
      exchange: 'Bybit' as const,
      exchangeId: 'bybit' as const,
      marketType: 'PERPETUAL' as const,
      nativeSymbol: 'MICROUSDT',
      lastPrice: 0.25,
      bidPrice: 0.2499,
      askPrice: 0.2501,
      change24hPct: 8.5,
      volume24hUsd: 250_000,
      maxLeverage: 10,
    },
    // Strong Momentum Breakout on Binance PERP
    {
      symbol: 'SUI/USDT',
      baseAsset: 'SUI',
      quoteAsset: 'USDT',
      exchange: 'Binance' as const,
      exchangeId: 'binance' as const,
      marketType: 'PERPETUAL' as const,
      nativeSymbol: 'SUIUSDT',
      lastPrice: 3.45,
      bidPrice: 3.4495,
      askPrice: 3.4502,
      change24hPct: 7.4,
      volume24hUsd: 420_000_000,
      maxLeverage: 20,
      high24h: 3.49,
      low24h: 3.15,
      fundingRatePct: 0.008,
    },
    // Duplicate SUI/USDT on Bybit with lower volume (should dedupe keeping Binance)
    {
      symbol: 'SUI/USDT',
      baseAsset: 'SUI',
      quoteAsset: 'USDT',
      exchange: 'Bybit' as const,
      exchangeId: 'bybit' as const,
      marketType: 'PERPETUAL' as const,
      nativeSymbol: 'SUIUSDT',
      lastPrice: 3.45,
      bidPrice: 3.449,
      askPrice: 3.451,
      change24hPct: 7.3,
      volume24hUsd: 90_000_000,
      maxLeverage: 15,
      high24h: 3.49,
      low24h: 3.15,
      fundingRatePct: 0.009,
    },
    // Short Squeeze candidate (deep negative funding while holding steady)
    {
      symbol: 'TAO/USDT',
      baseAsset: 'TAO',
      quoteAsset: 'USDT',
      exchange: 'Bybit' as const,
      exchangeId: 'bybit' as const,
      marketType: 'PERPETUAL' as const,
      nativeSymbol: 'TAOUSDT',
      lastPrice: 412.5,
      bidPrice: 412.4,
      askPrice: 412.6,
      change24hPct: 3.1,
      volume24hUsd: 165_000_000,
      maxLeverage: 15,
      high24h: 420.0,
      low24h: 388.0,
      fundingRatePct: -0.032,
    },
    // Oversold Rebound candidate
    {
      symbol: 'ARB/USDT',
      baseAsset: 'ARB',
      quoteAsset: 'USDT',
      exchange: 'OKX' as const,
      exchangeId: 'okx' as const,
      marketType: 'PERPETUAL' as const,
      nativeSymbol: 'ARB-USDT-SWAP',
      lastPrice: 0.82,
      bidPrice: 0.8198,
      askPrice: 0.8202,
      change24hPct: -6.4,
      volume24hUsd: 110_000_000,
      maxLeverage: 15,
      high24h: 0.90,
      low24h: 0.81,
      fundingRatePct: -0.005,
    },
  ];

  const breadth = computeMarketBreadth(directory);
  assert.equal(breadth.totalScannedPairs, 6); // USDC/USDT excluded from breadth
  assert.equal(breadth.uniqueSymbolsCount, 5);
  assert.equal(breadth.exchangesCovered.length, 3);
  assert.ok(breadth.advancersCount >= 4);
  assert.equal(breadth.declinersCount, 1);

  const screened = preScreenMarketDirectory(directory, {
    minVolumeUsd: 1_000_000,
    strategyFocus: 'HIGH_PROFIT_ALPHA',
    dedupeBySymbol: true,
    limit: 10,
  });

  const symbols = screened.map((s) => s.symbol);
  assert.ok(!symbols.includes('USDC/USDT'));
  assert.ok(!symbols.includes('ILLIQ/USDT'));
  assert.ok(!symbols.includes('MICRO/USDT'));
  assert.equal(screened.filter((s) => s.symbol === 'SUI/USDT').length, 1);
  assert.equal(screened.find((s) => s.symbol === 'SUI/USDT')?.exchange, 'Binance');
  assert.equal(screened.find((s) => s.symbol === 'TAO/USDT')?.archetype, 'SHORT_SQUEEZE');
  assert.equal(screened.find((s) => s.symbol === 'ARB/USDT')?.archetype, 'OVERSOLD_REBOUND');
  const directoryWithTradFi = [
    ...directory,
    {
      symbol: 'TSLA/USDT',
      baseAsset: 'TSLA',
      quoteAsset: 'USDT',
      exchange: 'Binance' as const,
      exchangeId: 'binance' as const,
      marketType: 'PERPETUAL' as const,
      nativeSymbol: 'TSLAUSDT',
      lastPrice: 285,
      bidPrice: 284.95,
      askPrice: 285.05,
      change24hPct: 4.5,
      volume24hUsd: 650_000_000,
      maxLeverage: 20,
      high24h: 292,
      low24h: 274,
      fundingRatePct: 0.005,
    },
  ];

  const cryptoOnly = preScreenMarketDirectory(directoryWithTradFi, {
    minVolumeUsd: 1_000_000,
    assetUniverse: 'CRYPTO',
    dedupeBySymbol: true,
    limit: 10,
  });
  assert.ok(!cryptoOnly.some((s) => s.symbol === 'TSLA/USDT'));

  const withTradFi = preScreenMarketDirectory(directoryWithTradFi, {
    minVolumeUsd: 1_000_000,
    assetUniverse: 'ALL',
    dedupeBySymbol: true,
    limit: 10,
  });
  assert.ok(withTradFi.some((s) => s.symbol === 'TSLA/USDT'));
});

test('Full-Market Deep Ranker prioritizes Risk-Approved + positive EV + 4H aligned setups and dampens 1-trade PF=99 spikes', async () => {
  const { buildDeepVerifiedOpportunity, rankDeepOpportunities } = await import('./marketScreener.ts');

  const baseStage1 = {
    rank: 1,
    symbol: 'SOL/USDT',
    baseAsset: 'SOL',
    quoteAsset: 'USDT',
    exchange: 'Binance',
    exchangeId: 'binance',
    marketType: 'PERPETUAL' as const,
    lastPrice: 150,
    bidPrice: 149.98,
    askPrice: 150.02,
    change24hPct: 5.2,
    volume24hUsd: 500_000_000,
    spreadBps: 2.6,
    volatility24hPct: 6.4,
    rangePositionPct: 78,
    fundingRatePct: 0.008,
    openInterestUsd: 350_000_000,
    maxLeverage: 20,
    archetype: 'MOMENTUM_BREAKOUT' as const,
    preScreenScore: 86,
    liquidityScore: 95,
    deepVerified: false,
    direction: 'LONG' as const,
    signalState: 'PRE_SCREEN' as const,
    confluenceScore: 68,
    htfAlignment: 'NEUTRAL' as const,
    expectedValueR: 0,
    riskReward: 0,
    recommendedRiskPct: 0.5,
    entryPrice: 150,
    stopLoss: 0,
    takeProfit: 0,
    backtestWinRatePct: null,
    backtestProfitFactor: null,
    backtestReturnPct: null,
    backtestTradesCount: 0,
    compositeAlphaScore: 86,
    reasoningSummary: 'Stage 1',
  };

  const mkSig = (overrides: Record<string, unknown>) =>
    ({
      id: 'SIG-1',
      symbol: 'SOL/USDT',
      exchange: 'Binance',
      marketType: 'PERPETUAL',
      direction: 'LONG',
      entryRange: [150, 150.2],
      stopLoss: 145,
      takeProfitLevels: [156, 160],
      positionSizeQty: 10,
      leverage: 2,
      riskUsd: 500,
      rewardUsd: 1000,
      riskReward: 2.0,
      timeHorizon: '4h - 24h',
      marketRegime: 'BULL',
      technicalScore: 84,
      quantScore: 86,
      liquidityScore: 95,
      fundamentalScore: 75,
      sentimentScore: 78,
      dataQualityScore: 98,
      riskScore: 90,
      confidenceScore: 85,
      calibratedProbabilityNote: 'Uncalibrated',
      strategyName: 'Adaptive Confluence Alpha v4',
      reasoningSummary: '4H aligned breakout',
      conflictsDetected: [],
      agentVotes: [],
      dataSource: 'LIVE_EXCHANGE',
      timestampUtc: new Date().toISOString(),
      expiresAtUtc: new Date(Date.now() + 3600_000).toISOString(),
      state: 'APPROVED',
      htfAlignment: 'ALIGNED_BULL',
      expectedValueR: 0.65,
      recommendedRiskPct: 0.75,
      quantAlpha: {
        strategyId: 'ADAPTIVE_CONFLUENCE_ALPHA',
        strategyName: 'Adaptive Confluence Alpha v4',
        regimeMode: 'TREND_PULLBACK',
        direction: 'LONG',
        confluenceScore: 86,
        bullScore: 86,
        bearScore: 18,
        passedFactors: 5,
        totalFactors: 5,
        shockVeto: false,
        stopAtrMult: 1.65,
        tpAtrMult: 2.85,
        breakevenTriggerR: 0.65,
        htfAlignment: 'ALIGNED_BULL',
        expectedValueR: 0.65,
        recommendedRiskPct: 0.75,
        factors: [],
      },
      riskCheck: {
        decision: 'APPROVE',
        approved: true,
        reasons: [],
        warnings: [],
        recommendedQuantity: 10,
        notionalValueUsd: 1500,
        requiredMarginUsd: 750,
        estimatedRiskUsd: 50,
        estimatedRiskPct: 0.5,
        riskRewardRatio: 2.0,
        estimatedFeesUsd: 1.5,
        estimatedSlippageUsd: 0.45,
        liquidationPriceEst: 75,
        checkedAtUtc: new Date().toISOString(),
      },
      ...overrides,
    }) as any;

  const approvedWinner = buildDeepVerifiedOpportunity({
    stage1: baseStage1,
    signal: mkSig({}),
    backtest: {
      totalTrades: 6,
      winRatePct: 66.7,
      profitFactor: 2.15,
      totalReturnPct: 2.4,
    } as any,
  });

  const tinySampleSpike = buildDeepVerifiedOpportunity({
    stage1: { ...baseStage1, symbol: 'AVAX/USDT', preScreenScore: 86 },
    signal: mkSig({ symbol: 'AVAX/USDT', expectedValueR: 0.55 }),
    backtest: {
      totalTrades: 1,
      winRatePct: 100,
      profitFactor: 99,
      totalReturnPct: 0.4,
    } as any,
  });

  const rejectedCounter = buildDeepVerifiedOpportunity({
    stage1: { ...baseStage1, symbol: 'DOGE/USDT', preScreenScore: 92 },
    signal: mkSig({
      symbol: 'DOGE/USDT',
      direction: 'SHORT',
      state: 'REJECTED',
      htfAlignment: 'COUNTER_TREND',
      expectedValueR: -0.15,
      confidenceScore: 55,
      quantAlpha: undefined,
      quantScore: 54,
    }),
    backtest: null,
  });

  assert.ok(approvedWinner.compositeAlphaScore > tinySampleSpike.compositeAlphaScore);

  const rankedAll = rankDeepOpportunities([rejectedCounter, tinySampleSpike, approvedWinner], 'ALL');
  assert.equal(rankedAll.length, 3);
  assert.equal(rankedAll[0].symbol, 'SOL/USDT');
  assert.equal(rankedAll[0].rank, 1);
  assert.equal(rankedAll[0].backtestWinRatePct, 66.7);

  const rankedShortOnly = rankDeepOpportunities([rejectedCounter, approvedWinner], 'SHORT');
  assert.equal(rankedShortOnly.length, 1);
  assert.equal(rankedShortOnly[0].symbol, 'DOGE/USDT');
});

test('23. Internationalization (i18n): key parity, locale resolution, localized catalogs & validation', () => {
  assert.equal(resolveLocale('en'), 'en');
  assert.equal(resolveLocale('en-US'), 'en');
  assert.equal(resolveLocale('EN-GB'), 'en');
  assert.equal(resolveLocale('vi'), 'vi');
  assert.equal(resolveLocale('vi-VN'), 'vi');
  assert.equal(resolveLocale(null), 'vi');
  assert.equal(resolveLocale('fr'), 'vi');

  const viKeys = Object.keys(TRANSLATIONS.vi).sort();
  const enKeys = Object.keys(TRANSLATIONS.en).sort();
  assert.deepEqual(enKeys, viKeys, 'English and Vietnamese translation keys must match 1:1');

  for (const key of enKeys as Array<keyof typeof TRANSLATIONS.en>) {
    assert.ok(TRANSLATIONS.en[key].trim().length > 0, `Empty EN string for ${String(key)}`);
    assert.ok(TRANSLATIONS.vi[key].trim().length > 0, `Empty VI string for ${String(key)}`);
  }

  assert.equal(
    translate('en', 'cmd.kpi.totalEquity', { mode: 'PAPER' }),
    'Simulated Equity (PAPER)',
  );
  assert.equal(
    translate('vi', 'cmd.kpi.totalEquity', { mode: 'PAPER' }),
    'Tổng tài sản (PAPER)',
  );

  const enProfile = getCompanyProfile('en');
  assert.ok(enProfile.companyName.length > 0);
  assert.ok(enProfile.executiveThesis.length > 20);
  const enDivisions = getCompanyDivisions('en');
  assert.equal(enDivisions.length, getCompanyDivisions('vi').length);
  const totalAgents = enDivisions.reduce((sum, d) => sum + d.agentCount, 0);
  assert.equal(totalAgents, 19);
  assert.ok(getCompanyCharterRules('en').length >= 4);

  const okxEn = getLocalizedExchangeSpec('okx', 'en');
  assert.equal(okxEn.requiresPassphrase, true);
  assert.ok(okxEn.tierLabel.length > 0);
  assert.ok(okxEn.permissionChecklist.length > 0);

  const enStrategies = getStrategyCatalog('en');
  const viStrategies = getStrategyCatalog('vi');
  assert.equal(enStrategies.length, 5);
  assert.equal(viStrategies.length, 5);
  assert.notEqual(enStrategies[0].description, viStrategies[0].description);

  const invalidSlTp = validatePositionSlTpUpdate(
    { side: 'LONG', entryPrice: 100, markPrice: 105, stopLoss: 95, takeProfit: 120 } as Position,
    110,
    120,
    'en',
  );
  assert.equal(invalidSlTp.valid, false);
  assert.ok(invalidSlTp.reason && invalidSlTp.reason.includes('Stop Loss'));
});

test('24. Quant Intelligence: Hurst regime, TTM Squeeze, Order Flow, Fractional Kelly & Correlation Guard', () => {
  // 1) Persistent uptrend candles should produce higher efficiency ratio & Hurst > 0.50
  const trendCandles: Candle[] = [];
  let px = 100;
  const t0 = Date.UTC(2026, 10, 1, 0, 0, 0);
  for (let i = 0; i < 96; i++) {
    const open = px;
    const close = open * (i % 5 === 0 ? 0.999 : 1.006);
    trendCandles.push({
      timestamp: t0 + i * 3600_000,
      open,
      high: Math.max(open, close) * 1.002,
      low: Math.min(open, close) * 0.998,
      close,
      volume: 10_000 + i * 120,
    });
    px = close;
  }
  const hurstTrend = computeHurstRegime(trendCandles);
  assert.ok(hurstTrend.hurstExponent >= 0.5, `Expected trend Hurst >= 0.5, got ${hurstTrend.hurstExponent}`);
  assert.ok(hurstTrend.efficiencyRatio > 0.45, `Expected high ER, got ${hurstTrend.efficiencyRatio}`);
  assert.equal(hurstTrend.regimeClass, 'TRENDING_PERSISTENT');

  // 2) Microstructure Absorption & FVG detection
  const bookBull: OrderBookSnapshot = {
    symbol: 'BTC/USDT',
    exchange: 'Binance',
    timestampUtc: Date.now(),
    bids: [{ price: px * 0.999, quantity: 10, totalUsd: px * 10 }],
    asks: [{ price: px * 1.001, quantity: 4, totalUsd: px * 4 }],
    spreadBps: 2,
    imbalanceRatio: 0.42,
    dataStatus: 'LIVE_EXCHANGE',
  };
  const micro = computeMicrostructureIntel(trendCandles, bookBull);
  assert.ok(micro.vwapPrice > 0);
  assert.equal(micro.orderBookImbalancePct, 42);
  assert.equal(micro.orderFlowBias, 'ALIGNED_BULL');

  // 3) Quarter-Kelly sizing strictly respects maxRiskPerTradePct cap & zero on negative edge
  const positiveKelly = computeKellyAllocation({
    winProbability: 0.58,
    riskReward: 2.2,
    volatility24hPct: 3.5,
    riskConfig: DEFAULT_RISK_CONFIG,
    accountEquityUsd: 100_000,
  });
  assert.equal(positiveKelly.positiveEdge, true);
  assert.ok(positiveKelly.fullKellyPct > positiveKelly.quarterKellyPct);
  assert.ok(positiveKelly.volAdjustedRiskPct <= DEFAULT_RISK_CONFIG.maxRiskPerTradePct);
  assert.ok(positiveKelly.volAdjustedRiskPct > 0);

  const negativeKelly = computeKellyAllocation({
    winProbability: 0.25,
    riskReward: 1.1,
    volatility24hPct: 3.5,
    riskConfig: DEFAULT_RISK_CONFIG,
    accountEquityUsd: 100_000,
  });
  assert.equal(negativeKelly.positiveEdge, false);
  assert.equal(negativeKelly.volAdjustedRiskPct, 0);

  // 4) Snapshot integration
  const snap = computeQuantIntelligenceSnapshot({
    candles: trendCandles,
    orderBook: bookBull,
    winProbability: 0.58,
    riskReward: 2.2,
    riskConfig: DEFAULT_RISK_CONFIG,
    accountEquityUsd: 100_000,
  });
  assert.ok(snap.compositeEdgeScore >= 50 && snap.compositeEdgeScore <= 98);

  // 5) Pearson correlation & Portfolio Correlation Guard
  const inverseCandles = trendCandles.map((c, idx) => ({
    ...c,
    open: 200 / (trendCandles[idx].open / 100),
    close: 200 / (trendCandles[idx].close / 100),
    high: 200 / (trendCandles[idx].low / 100),
    low: 200 / (trendCandles[idx].high / 100),
  }));
  const identical = computePearsonReturnCorrelation(trendCandles, trendCandles);
  assert.ok(identical.correlation > 0.99);
  const inverse = computePearsonReturnCorrelation(trendCandles, inverseCandles);
  assert.ok(inverse.correlation < -0.95);

  const corrGuard = computePortfolioCorrelationGuard({
    positions: [
      {
        id: 'P1',
        symbol: 'BTC/USDT',
        exchange: 'Binance',
        marketType: 'PERPETUAL',
        side: 'LONG',
        quantity: 0.1,
        entryPrice: 60000,
        markPrice: 60500,
        stopLoss: 59000,
        takeProfit: 63000,
        leverage: 2,
        marginUsd: 3025,
        unrealizedPnlUsd: 50,
        unrealizedPnlPct: 1.65,
        liquidationPrice: 30500,
        fundingPaidUsd: 0,
        strategyName: 'Test',
        mode: 'PAPER',
        openedAtUtc: new Date().toISOString(),
      },
      {
        id: 'P2',
        symbol: 'ETH/USDT',
        exchange: 'Binance',
        marketType: 'PERPETUAL',
        side: 'LONG',
        quantity: 2,
        entryPrice: 3000,
        markPrice: 3050,
        stopLoss: 2900,
        takeProfit: 3200,
        leverage: 2,
        marginUsd: 3050,
        unrealizedPnlUsd: 100,
        unrealizedPnlPct: 3.28,
        liquidationPrice: 1525,
        fundingPaidUsd: 0,
        strategyName: 'Test',
        mode: 'PAPER',
        openedAtUtc: new Date().toISOString(),
      },
    ],
    candlesBySymbol: {
      'BTC/USDT': trendCandles,
      'ETH/USDT': trendCandles,
    },
  });
  assert.equal(corrGuard.concentrationWarning, 'HIGH');
  assert.equal(corrGuard.pairs[0].riskTier, 'HIGH_CONCENTRATION');
  assert.ok(corrGuard.diversificationScore < 20);
});

test('25. PWA Helpers: platform detection, standalone suppression, and manifest compliance', () => {
  assert.ok(PWA_MANIFEST_META.shortName.length <= 12);
  assert.equal(PWA_MANIFEST_META.startUrl, '/');
  assert.equal(PWA_MANIFEST_META.scope, '/');
  assert.equal(PWA_MANIFEST_META.themeColor, '#070B12');

  const iphoneUa =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const ipadDesktopUa =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  const iosChromeUa =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1';
  const androidUa =
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
  const desktopChromeUa =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  const desktopSafariUa =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

  assert.equal(detectPWAPlatform(iphoneUa, 5), 'ios-safari');
  assert.equal(detectPWAPlatform(ipadDesktopUa, 5), 'ios-safari');
  assert.equal(detectPWAPlatform(iosChromeUa, 5), 'ios-browser');
  assert.equal(detectPWAPlatform(androidUa, 5), 'android-chromium');
  assert.equal(detectPWAPlatform(desktopChromeUa, 0), 'desktop-chromium');
  assert.equal(detectPWAPlatform(desktopSafariUa, 0), 'desktop-safari');

  assert.equal(getRecommendedGuideTab('ios-safari'), 'ios');
  assert.equal(getRecommendedGuideTab('ios-browser'), 'ios');
  assert.equal(getRecommendedGuideTab('android-chromium'), 'android');
  assert.equal(getRecommendedGuideTab('desktop-chromium'), 'desktop');

  assert.equal(isRunningStandalone(true, false), true);
  assert.equal(isRunningStandalone(false, true), true);
  assert.equal(isRunningStandalone(false, false), false);

  const installedUi = computePWAUiState({
    isInstalled: true,
    canNativePrompt: true,
    platform: 'android-chromium',
  });
  assert.equal(installedUi.shouldShowInstallEntry, false);

  const nativePromptUi = computePWAUiState({
    isInstalled: false,
    canNativePrompt: true,
    platform: 'desktop-chromium',
  });
  assert.equal(nativePromptUi.shouldShowInstallEntry, true);
  assert.equal(nativePromptUi.primaryAction, 'native-prompt');
  assert.equal(nativePromptUi.recommendedGuideTab, 'desktop');

  const iosGuideUi = computePWAUiState({
    isInstalled: false,
    canNativePrompt: false,
    platform: 'ios-safari',
  });
  assert.equal(iosGuideUi.shouldShowInstallEntry, true);
  assert.equal(iosGuideUi.primaryAction, 'guide-modal');
  assert.equal(iosGuideUi.recommendedGuideTab, 'ios');
});

test('26. Autonomous 9-Gate Auto-Execution Engine: clamping, HTF/Hurst/Correlation/Cooldown/Kelly gates', () => {
  const clamped = clampAutoExecutionConfig({
    enabled: true,
    executionMode: 'FULL_AUTO',
    scanIntervalSeconds: 2,
    minRiskReward: 0.5,
    maxTradesPerHour: 99,
    minConfluenceScore: 10,
  });
  assert.equal(clamped.scanIntervalSeconds, 15);
  assert.equal(clamped.minRiskReward, 1.5);
  assert.equal(clamped.maxTradesPerHour, 12);
  assert.equal(clamped.minConfluenceScore, 55);

  const nowMs = Date.UTC(2026, 10, 24, 12, 0, 0);
  const candlesA: Candle[] = Array.from({ length: 40 }, (_, i) => {
    const close = 100 + i * 0.8 + Math.sin(i * 0.4) * 0.4;
    return {
      timestamp: nowMs - (40 - i) * 3_600_000,
      timestampUtc: new Date(nowMs - (40 - i) * 3_600_000).toISOString(),
      open: close - 0.5,
      high: close + 0.7,
      low: close - 0.7,
      close,
      volume: 1500,
    };
  });

  const ticker = makeValidTicker({
    symbol: 'SOL/USDT',
    exchange: 'Binance',
    marketType: 'PERPETUAL',
    lastPrice: 131.5,
    bidPrice: 131.48,
    askPrice: 131.52,
    volume24hUsd: 80_000_000,
  });

  const baseSignal: TradingSignal = {
    id: 'SIG-AUTO-1',
    symbol: 'SOL/USDT',
    exchange: 'Binance',
    marketType: 'PERPETUAL',
    direction: 'LONG',
    state: 'APPROVED',
    entryRange: [131.2, 131.6],
    stopLoss: 127.0,
    takeProfitLevels: [136.0, 142.0],
    positionSizeQty: 10,
    riskUsd: 500,
    rewardUsd: 1165,
    leverage: 2,
    riskReward: 2.33,
    timeHorizon: '4H-12H',
    marketRegime: 'BULL',
    technicalScore: 82,
    quantScore: 86,
    liquidityScore: 88,
    fundamentalScore: 78,
    sentimentScore: 76,
    dataQualityScore: 95,
    riskScore: 84,
    confidenceScore: 84,
    calibratedProbabilityNote: 'Empirical 62% win rate',
    recommendedRiskPct: 0.8,
    expectedValueR: 0.48,
    htfAlignment: 'ALIGNED_BULL',
    strategyName: 'Adaptive Alpha v4',
    reasoningSummary: 'Strong 4H + 1H alignment.',
    conflictsDetected: [],
    agentVotes: [],
    dataSource: 'LIVE_EXCHANGE',
    expiresAtUtc: new Date(nowMs + 3_600_000).toISOString(),
    riskCheck: {
      approved: true,
      decision: 'APPROVE',
      reasons: [],
      warnings: [],
      recommendedQuantity: 10,
      notionalValueUsd: 1315,
      requiredMarginUsd: 657.5,
      estimatedRiskUsd: 500,
      estimatedRiskPct: 0.5,
      riskRewardRatio: 2.33,
      estimatedFeesUsd: 1.5,
      estimatedSlippageUsd: 0.4,
      liquidationPriceEst: 66.0,
      checkedAtUtc: new Date(nowMs).toISOString(),
    },
    timestampUtc: new Date(nowMs).toISOString(),
    quantIntel: {
      hurst: {
        hurstExponent: 0.64,
        efficiencyRatio: 0.52,
        regimeClass: 'TRENDING_PERSISTENT',
        sampleBars: 40,
      },
      microstructure: {
        squeezeState: 'SQUEEZE_FIRING',
        squeezeCompressionRatio: 0.92,
        vwapPrice: 129,
        vwapZScore: 1.1,
        signedVolumeDeltaPct: 18,
        orderBookImbalancePct: 22,
        orderFlowBias: 'ALIGNED_BULL',
        fvgSignal: 'BULLISH_FVG',
        liquiditySweep: 'NONE',
      },
      kelly: {
        winProbabilityUsed: 0.62,
        payoffRatio: 2.33,
        fullKellyPct: 2.2,
        quarterKellyPct: 0.55,
        volAdjustedRiskPct: 0.45,
        recommendedMarginUsd: 600,
        positiveEdge: true,
      },
      compositeEdgeScore: 82,
      computedAtUtc: new Date(nowMs).toISOString(),
    },
  };

  const baseOpp = {
    rank: 1,
    symbol: 'SOL/USDT',
    baseAsset: 'SOL',
    quoteAsset: 'USDT',
    exchange: 'Binance',
    exchangeId: 'binance',
    marketType: 'PERPETUAL' as const,
    lastPrice: 131.5,
    bidPrice: 131.48,
    askPrice: 131.52,
    change24hPct: 4.5,
    volume24hUsd: 80_000_000,
    spreadBps: 3.1,
    volatility24hPct: 4.2,
    rangePositionPct: 72,
    fundingRatePct: 0.01,
    openInterestUsd: 120_000_000,
    maxLeverage: 50,
    archetype: 'MOMENTUM_BREAKOUT' as const,
    preScreenScore: 88,
    liquidityScore: 92,
    deepVerified: true,
    direction: 'LONG' as const,
    signalState: 'APPROVED' as const,
    confluenceScore: 84,
    htfAlignment: 'ALIGNED_BULL' as const,
    expectedValueR: 0.48,
    riskReward: 2.33,
    recommendedRiskPct: 0.8,
    entryPrice: 131.5,
    stopLoss: 127.0,
    takeProfit: 142.0,
    backtestWinRatePct: 62,
    backtestProfitFactor: 1.95,
    backtestReturnPct: 14.2,
    backtestTradesCount: 18,
    compositeAlphaScore: 89,
    reasoningSummary: 'Strong momentum breakout.',
  };

  const portfolioSummary = {
    mode: 'FULL_AUTO' as const,
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

  const cfg = { ...DEFAULT_AUTO_EXECUTION_CONFIG, enabled: true, executionMode: 'FULL_AUTO' as const };

  // 1. Clean pass + Quarter-Kelly cap (0.45% instead of 0.80%)
  const passRes = evaluateAutoExecutionCandidate({
    config: cfg,
    tradingMode: 'FULL_AUTO',
    opportunity: baseOpp,
    ticker,
    signal: baseSignal,
    riskConfig: DEFAULT_RISK_CONFIG,
    portfolio: portfolioSummary,
    openPositions: [],
    candlesBySymbol: { 'SOL/USDT': candlesA },
    tradesExecutedLastHour: 0,
    cooldownUntilMs: 0,
    recentIdempotencyKeys: [],
    nowMs,
  });
  assert.equal(passRes.passed, true);
  assert.equal(passRes.effectiveRiskPct, 0.45);
  assert.equal(passRes.gateFailures.length, 0);

  // 2. Blocks EMERGENCY_STOP
  const emStopRes = evaluateAutoExecutionCandidate({
    config: cfg,
    tradingMode: 'EMERGENCY_STOP',
    opportunity: baseOpp,
    ticker,
    signal: baseSignal,
    riskConfig: DEFAULT_RISK_CONFIG,
    portfolio: portfolioSummary,
    openPositions: [],
    tradesExecutedLastHour: 0,
    recentIdempotencyKeys: [],
    nowMs,
  });
  assert.equal(emStopRes.passed, false);

  // 3. Blocks COUNTER_TREND 4H
  const counterRes = evaluateAutoExecutionCandidate({
    config: cfg,
    tradingMode: 'FULL_AUTO',
    opportunity: { ...baseOpp, htfAlignment: 'COUNTER_TREND' },
    ticker,
    signal: { ...baseSignal, htfAlignment: 'COUNTER_TREND' },
    riskConfig: DEFAULT_RISK_CONFIG,
    portfolio: portfolioSummary,
    openPositions: [],
    tradesExecutedLastHour: 0,
    recentIdempotencyKeys: [],
    nowMs,
  });
  assert.equal(counterRes.passed, false);

  // 4. Blocks high same-side Pearson correlation (|ρ| >= 0.85)
  const corrBlocked = evaluateAutoExecutionCandidate({
    config: cfg,
    tradingMode: 'FULL_AUTO',
    opportunity: baseOpp,
    ticker,
    signal: baseSignal,
    riskConfig: DEFAULT_RISK_CONFIG,
    portfolio: portfolioSummary,
    openPositions: [
      {
        id: 'POS-BTC',
        symbol: 'BTC/USDT',
        exchange: 'Binance',
        marketType: 'PERPETUAL',
        side: 'LONG',
        quantity: 0.1,
        entryPrice: 60000,
        markPrice: 60200,
        stopLoss: 59000,
        takeProfit: 63000,
        leverage: 2,
        marginUsd: 3000,
        unrealizedPnlUsd: 20,
        unrealizedPnlPct: 0.6,
        liquidationPrice: 30000,
        fundingPaidUsd: 0,
        strategyName: 'Test',
        mode: 'PAPER',
        openedAtUtc: new Date(nowMs - 600_000).toISOString(),
      },
    ],
    candlesBySymbol: {
      'SOL/USDT': candlesA,
      'BTC/USDT': candlesA,
    },
    tradesExecutedLastHour: 0,
    recentIdempotencyKeys: [],
    nowMs,
  });
  assert.equal(corrBlocked.passed, false);
  assert.ok(corrBlocked.maxSameSideCorrelation >= 0.99);

  // 5. Blocks active cooldown & hourly velocity cap
  const cooldownRes = evaluateAutoExecutionCandidate({
    config: cfg,
    tradingMode: 'FULL_AUTO',
    opportunity: baseOpp,
    ticker,
    signal: baseSignal,
    riskConfig: DEFAULT_RISK_CONFIG,
    portfolio: portfolioSummary,
    openPositions: [],
    tradesExecutedLastHour: cfg.maxTradesPerHour,
    cooldownUntilMs: nowMs + 10 * 60_000,
    recentIdempotencyKeys: [],
    nowMs,
  });
  assert.equal(cooldownRes.passed, false);
  assert.ok(cooldownRes.gateFailures.length >= 2);
});

test('27. System Logic Sync: TradingMode <-> AutoExec invariants, Deep Opp entryPrice alignment & Backtest trailing override', async () => {
  // 1) Bidirectional TradingMode <-> AutoExecutionConfig state machine
  const armedFull = syncAutoConfigWithTradingMode('FULL_AUTO', DEFAULT_AUTO_EXECUTION_CONFIG);
  assert.equal(armedFull.enabled, true);
  assert.equal(armedFull.executionMode, 'FULL_AUTO');

  const armedSemi = syncAutoConfigWithTradingMode('SEMI_AUTO', armedFull);
  assert.equal(armedSemi.enabled, true);
  assert.equal(armedSemi.executionMode, 'SEMI_AUTO');

  const pausedByPaper = syncAutoConfigWithTradingMode('PAPER', armedFull);
  assert.equal(pausedByPaper.enabled, false);
  assert.equal(pausedByPaper.executionMode, 'FULL_AUTO');

  const lockedByEmStop = syncAutoConfigWithTradingMode('EMERGENCY_STOP', armedSemi);
  assert.equal(lockedByEmStop.enabled, false);

  assert.equal(resolveTradingModeAfterAutoConfig('PAPER', armedFull), 'FULL_AUTO');
  assert.equal(resolveTradingModeAfterAutoConfig('FULL_AUTO', pausedByPaper), 'PAPER');
  assert.equal(resolveTradingModeAfterAutoConfig('ANALYSIS_ONLY', pausedByPaper), 'ANALYSIS_ONLY');
  assert.equal(resolveTradingModeAfterAutoConfig('EMERGENCY_STOP', armedFull), 'EMERGENCY_STOP');

  // 2) FullMarketOpportunity.entryPrice strictly matches stage1.lastPrice (not entryRange[0])
  const { buildDeepVerifiedOpportunity } = await import('./marketScreener.ts');
  const stage1Price = 64250;
  const opp = buildDeepVerifiedOpportunity({
    stage1: {
      rank: 1,
      symbol: 'BTC/USDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      exchange: 'Binance',
      exchangeId: 'binance',
      marketType: 'PERPETUAL',
      lastPrice: stage1Price,
      bidPrice: 64249,
      askPrice: 64251,
      change24hPct: 3.1,
      volume24hUsd: 950_000_000,
      spreadBps: 0.3,
      volatility24hPct: 3.8,
      rangePositionPct: 75,
      fundingRatePct: 0.01,
      openInterestUsd: 800_000_000,
      maxLeverage: 50,
      archetype: 'MOMENTUM_BREAKOUT',
      preScreenScore: 88,
      liquidityScore: 98,
      deepVerified: false,
      direction: 'LONG',
      signalState: 'PRE_SCREEN',
      confluenceScore: 82,
      htfAlignment: 'ALIGNED_BULL',
      expectedValueR: 0.5,
      riskReward: 2.0,
      recommendedRiskPct: 0.5,
      entryPrice: stage1Price,
      stopLoss: 63250,
      takeProfit: 66250,
      backtestWinRatePct: null,
      backtestProfitFactor: null,
      backtestReturnPct: null,
      backtestTradesCount: 0,
      compositeAlphaScore: 88,
      reasoningSummary: 'Stage 1',
    },
    signal: {
      id: 'SIG-SYNC-1',
      symbol: 'BTC/USDT',
      exchange: 'Binance',
      marketType: 'PERPETUAL',
      direction: 'LONG',
      state: 'APPROVED',
      entryRange: [stage1Price * 0.999, stage1Price * 1.001],
      stopLoss: 63250,
      takeProfitLevels: [65650, 66250],
      positionSizeQty: 0.5,
      riskUsd: 500,
      rewardUsd: 1000,
      leverage: 2,
      riskReward: 2.0,
      timeHorizon: '4H-12H',
      marketRegime: 'BULL',
      technicalScore: 82,
      quantScore: 85,
      liquidityScore: 98,
      fundamentalScore: 76,
      sentimentScore: 74,
      dataQualityScore: 99,
      riskScore: 88,
      confidenceScore: 84,
      calibratedProbabilityNote: 'Empirical calibrated',
      htfAlignment: 'ALIGNED_BULL',
      expectedValueR: 0.5,
      recommendedRiskPct: 0.5,
      strategyName: 'Adaptive Confluence Alpha v4',
      reasoningSummary: 'Aligned breakout',
      conflictsDetected: [],
      agentVotes: [],
      dataSource: 'LIVE_EXCHANGE',
      timestampUtc: new Date().toISOString(),
      expiresAtUtc: new Date(Date.now() + 3600_000).toISOString(),
      riskCheck: {
        approved: true,
        decision: 'APPROVE',
        reasons: [],
        warnings: [],
        recommendedQuantity: 0.5,
        notionalValueUsd: 32125,
        requiredMarginUsd: 16062.5,
        estimatedRiskUsd: 500,
        estimatedRiskPct: 0.5,
        riskRewardRatio: 2.0,
        estimatedFeesUsd: 16,
        estimatedSlippageUsd: 9.6,
        liquidationPriceEst: 32500,
        checkedAtUtc: new Date().toISOString(),
      },
    } as any,
    backtest: null,
  });
  assert.equal(opp.entryPrice, stage1Price);

  // 3) Explicit useTrailingProfitLock = false overrides ADAPTIVE_CONFLUENCE_ALPHA default
  const candles = makeTestCandles('BTC/USDT', 60000, 140);
  const noTrail = runBacktest(
    candles,
    {
      symbol: 'BTC/USDT',
      timeframe: '1h',
      strategyId: 'ADAPTIVE_CONFLUENCE_ALPHA',
      marketType: 'PERPETUAL',
      initialCapitalUsd: 10_000,
      riskPerTradePct: 0.5,
      leverage: 2,
      feeRateBps: 5,
      slippageBps: 3,
      fundingRatePer8hPct: 0.01,
      stopLossAtrMult: 1.5,
      takeProfitAtrMult: 3.0,
      monteCarloRuns: 20,
      useTrailingProfitLock: false,
    },
    'Sync Test Fixture',
  );
  assert.equal(noTrail.trades.some((tr) => tr.exitReason === 'BREAKEVEN_TRAIL'), false);
});

test('28. Continuous Smart Execution: Live 3-Stage Trailing Lifecycle, L2 Consensus Tolerance & 2-Tier Tactical Continuity', () => {
  // 1) Live 3-Stage R-Multiple Profit Protection & Micro-Cap Decimal Safety
  const basePos: Position = {
    id: 'POS-TRAIL-1',
    symbol: 'DOGE/USDT',
    exchange: 'Binance',
    marketType: 'PERPETUAL',
    side: 'LONG',
    quantity: 10_000,
    entryPrice: 0.2,
    markPrice: 0.2,
    stopLoss: 0.19, // riskDist = 0.01 (5%)
    initialStopLoss: 0.19,
    takeProfit: 0.23, // 3R
    leverage: 2,
    marginUsd: 1000,
    unrealizedPnlUsd: 0,
    unrealizedPnlPct: 0,
    liquidationPrice: 0.102,
    fundingPaidUsd: 0,
    strategyName: 'AutoAlpha',
    mode: 'PAPER',
    openedAtUtc: new Date(Date.now() - 120_000).toISOString(),
  };

  // +0.7R (0.207) -> arms breakeven (+0.18% above entry = 0.20036)
  const stage1 = evaluateLivePositionLifecycle({
    position: basePos,
    markPrice: 0.207,
    canEvaluateTriggers: true,
  });
  assert.equal(stage1.closed, false);
  assert.equal(stage1.trailingStage, 'BREAKEVEN_ARMED');
  assert.ok(stage1.nextStopLoss > basePos.entryPrice);

  // +1.2R (0.212) -> advances SL to +0.55R (0.2055)
  const stage2Pos: Position = { ...basePos, stopLoss: stage1.nextStopLoss };
  const stage2 = evaluateLivePositionLifecycle({
    position: stage2Pos,
    markPrice: 0.212,
    canEvaluateTriggers: true,
  });
  assert.equal(stage2.closed, false);
  assert.equal(stage2.trailingStage, 'STEP_LOCK_055R');
  assert.ok(stage2.nextStopLoss >= 0.205);

  // +1.8R (0.218) -> advances SL to 55% Chandelier lock (~0.2099)
  const stage3Pos: Position = { ...stage2Pos, stopLoss: stage2.nextStopLoss };
  const stage3 = evaluateLivePositionLifecycle({
    position: stage3Pos,
    markPrice: 0.218,
    canEvaluateTriggers: true,
  });
  assert.equal(stage3.closed, false);
  assert.equal(stage3.trailingStage, 'CHANDELIER_55PCT');
  assert.ok(stage3.nextStopLoss > 0.209);

  // Price pulls back to trailed SL -> closes cleanly as TRAILING_PROFIT with net positive PnL
  const closedTrail = evaluateLivePositionLifecycle({
    position: { ...stage3Pos, stopLoss: stage3.nextStopLoss },
    markPrice: stage3.nextStopLoss - 0.0005,
    canEvaluateTriggers: true,
  });
  assert.equal(closedTrail.closed, true);
  assert.equal(closedTrail.closeReason, 'TRAILING_PROFIT');
  assert.ok((closedTrail.realizedNetUsd ?? 0) > 0);

  // 2) Multi-Agent Consensus tolerates mild resting L2 imbalance (-0.18) while vetoing thin/wide spreads
  const nowMs = Date.now();
  const uptrendCandles: Candle[] = Array.from({ length: 140 }, (_, i) => {
    const close = 100 * Math.pow(1.0028, i) + (i % 5 === 2 ? -0.45 : 0.2);
    return {
      timestamp: nowMs - (140 - i) * 3_600_000,
      open: close * 0.997,
      high: close * 1.004,
      low: close * 0.994,
      close,
      volume: 200_000 + i * 500,
    };
  });
  const lastPrice = uptrendCandles[uptrendCandles.length - 1].close;
  const trendTicker = makeValidTicker({
    symbol: 'AVAX/USDT',
    exchange: 'Binance',
    marketType: 'PERPETUAL',
    lastPrice,
    bidPrice: lastPrice * 0.9998,
    askPrice: lastPrice * 1.0002,
    change24hPct: 5.2,
    volume24hUsd: 120_000_000,
    spreadBps: 4,
    liquidityScore: 90,
    timestampUtc: nowMs,
  });
  const mildAskWallBook: OrderBookSnapshot = {
    symbol: 'AVAX/USDT',
    exchange: 'Binance',
    bids: [{ price: lastPrice * 0.9998, quantity: 1000, totalUsd: 100_000 }],
    asks: [{ price: lastPrice * 1.0002, quantity: 1450, totalUsd: 145_000 }],
    imbalanceRatio: -0.18,
    spreadBps: 4,
    dataStatus: 'LIVE_EXCHANGE',
    timestampUtc: nowMs,
  };
  const baseAgents = createInitialAgentRegistry(new Date(nowMs).toISOString());
  const consensusSignal = runMultiAgentDecisionPipeline({
    ticker: trendTicker,
    candles: uptrendCandles,
    orderBook: mildAskWallBook,
    agents: baseAgents,
    riskConfig: DEFAULT_RISK_CONFIG,
    riskContext: {
      tradingMode: 'FULL_AUTO',
      accountEquityUsd: 100_000,
      availableBalanceUsd: 100_000,
      dailyPnlPct: 0,
      weeklyPnlPct: 0,
      currentDrawdownPct: 0,
      openPositions: [],
      recentIdempotencyKeys: [],
    },
  });
  const obVote = consensusSignal.agentVotes.find((v) => v.agentId === 'ORDER_BOOK_LIQUIDITY');
  assert.equal(obVote?.stance, 'NEUTRAL');

  const wideSpreadSignal = runMultiAgentDecisionPipeline({
    ticker: { ...trendTicker, spreadBps: 42, liquidityScore: 32 },
    candles: uptrendCandles,
    orderBook: { ...mildAskWallBook, spreadBps: 42 },
    agents: baseAgents,
    riskConfig: DEFAULT_RISK_CONFIG,
    riskContext: {
      tradingMode: 'FULL_AUTO',
      accountEquityUsd: 100_000,
      availableBalanceUsd: 100_000,
      dailyPnlPct: 0,
      weeklyPnlPct: 0,
      currentDrawdownPct: 0,
      openPositions: [],
      recentIdempotencyKeys: [],
    },
  });
  assert.equal(wideSpreadSignal.state, 'REJECTED');

  // 3) 2-Tier Tactical Continuity scales risk defensively (0.72x) while enforcing Risk & Safety locks
  const cfg = {
    ...DEFAULT_AUTO_EXECUTION_CONFIG,
    enabled: true,
    executionMode: 'FULL_AUTO' as const,
  };
  const tacticalSignal: TradingSignal = {
    ...consensusSignal,
    direction: 'LONG',
    state: 'APPROVED',
    stopLoss: Number((lastPrice * 0.97).toFixed(4)),
    takeProfitLevels: [Number((lastPrice * 1.035).toFixed(4)), Number((lastPrice * 1.055).toFixed(4))],
    riskReward: 1.83,
    expectedValueR: 0.11,
    htfAlignment: 'NEUTRAL',
    recommendedRiskPct: 0.6,
    quantAlpha: {
      confluenceScore: 63,
      edgeScore: 60,
      regimeWeight: 0.55,
      longScore: 63,
      shortScore: 34,
      factors: [],
      atr14: lastPrice * 0.018,
      stopDistanceAtrMult: 1.6,
      targetDistanceAtrMult: 3.0,
      recommendedLeverage: 2,
    } as any,
    quantIntel: {
      hurst: {
        hurstExponent: 0.49,
        efficiencyRatio: 0.34,
        regimeClass: 'RANDOM_WALK_NOISE',
        sampleBars: 40,
      },
      microstructure: {
        squeezeState: 'NORMAL',
        squeezeCompressionRatio: 0.5,
        vwapPrice: lastPrice * 0.995,
        vwapZScore: 0.4,
        signedVolumeDeltaPct: 8,
        orderBookImbalancePct: -12,
        orderFlowBias: 'NEUTRAL',
        fvgSignal: 'NONE',
        liquiditySweep: 'NONE',
      },
      kelly: {
        winProbabilityUsed: 0.5,
        payoffRatio: 1.83,
        fullKellyPct: 1.8,
        quarterKellyPct: 0.45,
        volAdjustedRiskPct: 0.5,
        recommendedMarginUsd: 800,
        positiveEdge: true,
      },
      compositeEdgeScore: 58,
      computedAtUtc: new Date(nowMs).toISOString(),
    },
  };
  const tacticalOpp = {
    rank: 1,
    symbol: 'AVAX/USDT',
    baseAsset: 'AVAX',
    quoteAsset: 'USDT',
    exchange: 'Binance',
    exchangeId: 'binance',
    marketType: 'PERPETUAL' as const,
    lastPrice,
    bidPrice: lastPrice * 0.9998,
    askPrice: lastPrice * 1.0002,
    change24hPct: 5.2,
    volume24hUsd: 120_000_000,
    spreadBps: 4,
    volatility24hPct: 4.1,
    rangePositionPct: 68,
    fundingRatePct: 0.01,
    openInterestUsd: 85_000_000,
    maxLeverage: 50,
    archetype: 'MOMENTUM_BREAKOUT' as const,
    preScreenScore: 76,
    liquidityScore: 90,
    deepVerified: true,
    direction: 'LONG' as const,
    signalState: 'APPROVED' as const,
    confluenceScore: 63,
    htfAlignment: 'NEUTRAL' as const,
    expectedValueR: 0.11,
    riskReward: 1.83,
    recommendedRiskPct: 0.6,
    entryPrice: lastPrice,
    stopLoss: tacticalSignal.stopLoss,
    takeProfit: tacticalSignal.takeProfitLevels[1],
    backtestWinRatePct: null,
    backtestProfitFactor: null,
    backtestReturnPct: null,
    backtestTradesCount: 0,
    compositeAlphaScore: 74,
    reasoningSummary: 'Tactical continuation setup',
  };
  const portfolioSummary = {
    mode: 'FULL_AUTO' as const,
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

  // Fails strict Core 9-Gate (confluence 63 < 72, EV 0.11 < 0.18)
  const coreCheck = evaluateAutoExecutionCandidate({
    config: cfg,
    tradingMode: 'FULL_AUTO',
    opportunity: tacticalOpp,
    ticker: trendTicker,
    signal: tacticalSignal,
    riskConfig: DEFAULT_RISK_CONFIG,
    portfolio: portfolioSummary,
    openPositions: [],
    tradesExecutedLastHour: 0,
    recentIdempotencyKeys: [],
    allowTacticalFallback: false,
    nowMs,
  });
  assert.equal(coreCheck.passed, false);
  assert.equal(coreCheck.executionTier, 'CORE_9_GATE');

  // Passes Tactical Continuity with 0.72x scaled risk (0.5 * 0.72 = 0.36%)
  const tacticalCheck = evaluateAutoExecutionCandidate({
    config: cfg,
    tradingMode: 'FULL_AUTO',
    opportunity: tacticalOpp,
    ticker: trendTicker,
    signal: tacticalSignal,
    riskConfig: DEFAULT_RISK_CONFIG,
    portfolio: portfolioSummary,
    openPositions: [],
    tradesExecutedLastHour: 0,
    recentIdempotencyKeys: [],
    allowTacticalFallback: true,
    nowMs,
  });
  assert.equal(tacticalCheck.passed, true);
  assert.equal(tacticalCheck.executionTier, 'TACTICAL_CONTINUITY');
  assert.equal(tacticalCheck.effectiveRiskPct, 0.36);

  // Even Tactical Continuity must NEVER bypass EMERGENCY_STOP or RiskConfig minRiskReward
  const emergencyTactical = evaluateAutoExecutionCandidate({
    config: cfg,
    tradingMode: 'EMERGENCY_STOP',
    opportunity: tacticalOpp,
    ticker: trendTicker,
    signal: tacticalSignal,
    riskConfig: DEFAULT_RISK_CONFIG,
    portfolio: portfolioSummary,
    openPositions: [],
    tradesExecutedLastHour: 0,
    recentIdempotencyKeys: [],
    allowTacticalFallback: true,
    nowMs,
  });
  assert.equal(emergencyTactical.passed, false);
});

test('End-to-End A-Z Logic Sync: blocks self-hedge, blocks duplicate open pairs, syncs RiskConfig<->AutoConfig, and resolves signal freshness/dedupe', () => {
  const nowMs = Date.now();
  const openLongBtc: Position = {
    id: 'POS-BTC-1',
    symbol: 'BTC/USDT',
    exchange: 'Binance',
    marketType: 'PERPETUAL',
    side: 'LONG',
    quantity: 0.1,
    entryPrice: 60_000,
    markPrice: 60_200,
    stopLoss: 58_500,
    initialStopLoss: 58_500,
    takeProfit: 63_000,
    leverage: 2,
    marginUsd: 3_000,
    unrealizedPnlUsd: 20,
    unrealizedPnlPct: 0.67,
    liquidationPrice: 30_300,
    fundingPaidUsd: 0,
    strategyName: 'AutoAlpha',
    mode: 'PAPER',
    openedAtUtc: new Date(nowMs - 60_000).toISOString(),
  };

  // 1) Risk Engine must reject opposite-side self-hedge on the same (symbol, marketType)
  const selfHedgeRisk = evaluateOrderRisk(
    {
      symbol: 'BTC/USDT',
      exchange: 'Binance',
      marketType: 'PERPETUAL',
      side: 'SHORT',
      orderType: 'MARKET',
      entryPrice: 60_200,
      stopLoss: 61_200,
      takeProfit: 58_000,
      leverage: 2,
      idempotencyKey: 'self-hedge-1',
      dataStatus: 'LIVE_EXCHANGE',
    },
    DEFAULT_RISK_CONFIG,
    makeBaseContext({ openPositions: [openLongBtc] }),
  );
  assert.equal(selfHedgeRisk.approved, false);
  assert.ok(selfHedgeRisk.reasons.some((r) => r.includes('đối nghịch')));

  // 2) syncAutoConfigWithRiskConfig clamps auto slots & target active & minRiskReward to RiskConfig
  const tightRisk = {
    ...DEFAULT_RISK_CONFIG,
    maxOpenPositions: 2,
    minRiskReward: 2.2,
  };
  const syncedAuto = syncAutoConfigWithRiskConfig(
    {
      ...DEFAULT_AUTO_EXECUTION_CONFIG,
      maxSimultaneousAutoPositions: 5,
      targetActivePositions: 4,
      minRiskReward: 1.6,
    },
    tightRisk,
  );
  assert.equal(syncedAuto.maxSimultaneousAutoPositions, 2);
  assert.equal(syncedAuto.targetActivePositions, 2);
  assert.equal(syncedAuto.minRiskReward, 2.2);

  // 3) Auto-Execution blocks duplicate same-pair (same side or opposing side) AND expired signals
  const btcTicker = makeValidTicker({
    symbol: 'BTC/USDT',
    exchange: 'Binance',
    marketType: 'PERPETUAL',
    lastPrice: 60_200,
    bidPrice: 60_190,
    askPrice: 60_210,
    volume24hUsd: 800_000_000,
    spreadBps: 3,
    liquidityScore: 95,
    timestampUtc: nowMs,
  });
  const baseCandles = makeTestCandles('BTC/USDT', 59_500, 120, 3600_000, nowMs);
  const agents = createInitialAgentRegistry(new Date(nowMs).toISOString());
  const rawSig = runMultiAgentDecisionPipeline({
    ticker: btcTicker,
    candles: baseCandles,
    orderBook: {
      symbol: 'BTC/USDT',
      exchange: 'Binance',
      bids: [{ price: 60_190, quantity: 5, totalUsd: 300_950 }],
      asks: [{ price: 60_210, quantity: 5, totalUsd: 301_050 }],
      imbalanceRatio: 0.1,
      spreadBps: 3,
      dataStatus: 'LIVE_EXCHANGE',
      timestampUtc: nowMs,
    },
    agents,
    riskConfig: DEFAULT_RISK_CONFIG,
    riskContext: makeBaseContext(),
  });
  const freshApprovedSig: TradingSignal = {
    ...rawSig,
    id: 'SIG-FRESH-NEW',
    symbol: 'BTC/USDT',
    exchange: 'Binance',
    marketType: 'PERPETUAL',
    direction: 'LONG',
    state: 'APPROVED',
    stopLoss: 58_800,
    takeProfitLevels: [62_400, 63_600],
    riskReward: 2.43,
    expectedValueR: 0.42,
    htfAlignment: 'ALIGNED_BULL',
    timestampUtc: new Date(nowMs - 5_000).toISOString(),
    expiresAtUtc: new Date(nowMs + 900_000).toISOString(),
    quantAlpha: {
      ...(rawSig.quantAlpha ?? ({} as any)),
      confluenceScore: 84,
      edgeScore: 80,
      regimeWeight: 0.7,
    },
    quantIntel: rawSig.quantIntel
      ? {
          ...rawSig.quantIntel,
          hurst: { ...rawSig.quantIntel.hurst, regimeClass: 'TRENDING_PERSISTENT', hurstExponent: 0.62 },
          kelly: { ...rawSig.quantIntel.kelly, winProbabilityUsed: 0.62, volAdjustedRiskPct: 0.25 },
        }
      : undefined,
  };
  const baseOpp = {
    rank: 1,
    symbol: 'BTC/USDT',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    exchange: 'Binance',
    exchangeId: 'binance',
    marketType: 'PERPETUAL' as const,
    lastPrice: 60_200,
    bidPrice: 60_190,
    askPrice: 60_210,
    change24hPct: 2.5,
    volume24hUsd: 800_000_000,
    spreadBps: 3,
    volatility24hPct: 2.2,
    rangePositionPct: 60,
    fundingRatePct: 0.01,
    openInterestUsd: 900_000_000,
    maxLeverage: 50,
    archetype: 'MOMENTUM_BREAKOUT' as const,
    preScreenScore: 88,
    liquidityScore: 95,
    deepVerified: true,
    direction: 'LONG' as const,
    signalState: 'APPROVED' as const,
    confluenceScore: 84,
    htfAlignment: 'ALIGNED_BULL' as const,
    expectedValueR: 0.42,
    riskReward: 2.43,
    recommendedRiskPct: 0.25,
    entryPrice: 60_200,
    stopLoss: 58_800,
    takeProfit: 63_600,
    backtestWinRatePct: 60,
    backtestProfitFactor: 1.9,
    backtestReturnPct: 14,
    backtestTradesCount: 18,
    compositeAlphaScore: 1095,
    reasoningSummary: 'Sync guard test',
  };
  const basePortfolio = {
    mode: 'FULL_AUTO' as const,
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

  const duplicatePairGate = evaluateAutoExecutionCandidate({
    config: DEFAULT_AUTO_EXECUTION_CONFIG,
    tradingMode: 'FULL_AUTO',
    opportunity: baseOpp,
    ticker: btcTicker,
    signal: freshApprovedSig,
    riskConfig: DEFAULT_RISK_CONFIG,
    portfolio: basePortfolio,
    openPositions: [openLongBtc],
    tradesExecutedLastHour: 0,
    recentIdempotencyKeys: [],
    nowMs,
  });
  assert.equal(duplicatePairGate.passed, false);
  assert.ok(duplicatePairGate.gateFailures.some((f) => f.includes('trùng lặp')));

  const expiredSig: TradingSignal = {
    ...freshApprovedSig,
    id: 'SIG-EXPIRED-OLD',
    timestampUtc: new Date(nowMs - 1_200_000).toISOString(),
    expiresAtUtc: new Date(nowMs - 60_000).toISOString(),
  };
  const expiredGate = evaluateAutoExecutionCandidate({
    config: DEFAULT_AUTO_EXECUTION_CONFIG,
    tradingMode: 'FULL_AUTO',
    opportunity: baseOpp,
    ticker: btcTicker,
    signal: expiredSig,
    riskConfig: DEFAULT_RISK_CONFIG,
    portfolio: basePortfolio,
    openPositions: [],
    tradesExecutedLastHour: 0,
    recentIdempotencyKeys: [],
    nowMs,
  });
  assert.equal(expiredGate.passed, false);
  assert.ok(expiredGate.gateFailures.some((f) => f.includes('hết hạn')));

  // 4) dedupeSignalsByPair + findMatchingSignal pick freshest signal per (symbol, marketType, exchange)
  assert.equal(isSignalFresh(freshApprovedSig, nowMs), true);
  assert.equal(isSignalFresh(expiredSig, nowMs), false);
  const deduped = dedupeSignalsByPair([expiredSig, freshApprovedSig]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].id, 'SIG-FRESH-NEW');
  const matched = findMatchingSignal(
    [expiredSig, freshApprovedSig],
    { symbol: 'BTC/USDT', marketType: 'PERPETUAL', exchange: 'Binance' },
    nowMs,
  );
  assert.equal(matched?.id, 'SIG-FRESH-NEW');
});

test('Liquidation Cluster Radar estimates crowd leverage pools, optimizes Zero-Stop-Hunt SL/TP, and preserves micro-cap precision', () => {
  const nowMs = Date.now();
  const candles = makeTestCandles('BTC/USDT', 60_000, 90, 3600_000, nowMs);
  const ticker = makeValidTicker({
    symbol: 'BTC/USDT',
    exchange: 'Binance',
    marketType: 'PERPETUAL',
    lastPrice: 60_000,
    bidPrice: 59_990,
    askPrice: 60_010,
    volume24hUsd: 900_000_000,
    openInterestUsd: 1_200_000_000,
    fundingRatePct: 0.052, // crowded longs
    spreadBps: 3,
    liquidityScore: 95,
    timestampUtc: nowMs,
  });
  const book = {
    symbol: 'BTC/USDT',
    exchange: 'Binance',
    bids: [
      { price: 59_500, quantity: 12, totalUsd: 714_000 },
      { price: 58_600, quantity: 28, totalUsd: 1_640_800 },
    ],
    asks: [
      { price: 60_500, quantity: 10, totalUsd: 605_000 },
      { price: 62_350, quantity: 35, totalUsd: 2_182_250 },
    ],
    imbalanceRatio: 0.08,
    spreadBps: 3.3,
    dataStatus: 'LIVE_EXCHANGE' as const,
    timestampUtc: nowMs,
  };

  const radar = computeLiquidationRadar({
    candles,
    orderBook: book,
    ticker,
    atr14: 750,
    riskConfig: DEFAULT_RISK_CONFIG,
  });

  assert.equal(radar.fundingCrowdBias, 'CROWDED_LONGS');
  assert.ok(radar.clusters.length >= 8);
  assert.ok(radar.nearestLongLiqPrice !== null && radar.nearestLongLiqPrice < 60_000);
  assert.ok(radar.nearestShortLiqPrice !== null && radar.nearestShortLiqPrice > 60_000);
  assert.equal(radar.strongestShortWallPrice, 62_350);

  // Crowded longs must weight 50X LONG_LIQ pool higher than 50X SHORT_LIQ pool
  const long50 = radar.clusters.find((c) => c.id === 'LIQ-LONG-50X');
  const short50 = radar.clusters.find((c) => c.id === 'LIQ-SHORT-50X');
  assert.ok(long50 && short50 && long50.estimatedUsdM > short50.estimatedUsdM);

  // Recommend SL/TP invariants for LONG & SHORT
  assert.ok(radar.recommendedLongSl < radar.markPrice && radar.recommendedLongTp > radar.markPrice);
  assert.ok(radar.recommendedShortTp < radar.markPrice && radar.recommendedShortSl > radar.markPrice);
  const recLongRr =
    (radar.recommendedLongTp - radar.markPrice) / (radar.markPrice - radar.recommendedLongSl);
  const recShortRr =
    (radar.markPrice - radar.recommendedShortTp) / (radar.recommendedShortSl - radar.markPrice);
  assert.ok(recLongRr >= DEFAULT_RISK_CONFIG.minRiskReward - 0.01);
  assert.ok(recShortRr >= DEFAULT_RISK_CONFIG.minRiskReward - 0.01);

  // Placing an initial LONG SL right inside the 50X liquidation cluster forces Zero-Stop-Hunt shift lower
  assert.ok(long50);
  const optimizedLong = optimizeSlTpWithLiquidationRadar({
    side: 'LONG',
    entryPrice: 60_000,
    stopLoss: long50.priceLevel,
    takeProfit: 62_550, // right above the 62,350 OB ask wall -> should front-run or clear safely
    atr14: 750,
    minRiskReward: DEFAULT_RISK_CONFIG.minRiskReward,
    radar,
  });
  assert.equal(optimizedLong.slAdjusted, true);
  assert.ok(optimizedLong.stopLoss < long50.bandLow);
  assert.ok(
    (optimizedLong.takeProfit - 60_000) / (60_000 - optimizedLong.stopLoss) >=
      DEFAULT_RISK_CONFIG.minRiskReward,
  );

  // Micro-cap PEPE/USDT precision preserved through pipeline + embedded quantIntel.liquidationRadar
  const pepeCandles = makeTestCandles('PEPE/USDT', 0.0000084, 90, 3600_000, nowMs);
  const pepeTicker = makeValidTicker({
    symbol: 'PEPE/USDT',
    exchange: 'OKX',
    marketType: 'SPOT',
    lastPrice: 0.00000842,
    bidPrice: 0.00000841,
    askPrice: 0.00000843,
    volume24hUsd: 240_000_000,
    fundingRatePct: null,
    spreadBps: 4.5,
    liquidityScore: 90,
    timestampUtc: nowMs,
  });
  const pepeSignal = runMultiAgentDecisionPipeline({
    ticker: pepeTicker,
    candles: pepeCandles,
    orderBook: {
      symbol: 'PEPE/USDT',
      exchange: 'OKX',
      bids: [{ price: 0.00000838, quantity: 8_000_000_000, totalUsd: 67_040 }],
      asks: [{ price: 0.00000848, quantity: 7_500_000_000, totalUsd: 63_600 }],
      imbalanceRatio: 0.05,
      spreadBps: 4.5,
      dataStatus: 'LIVE_EXCHANGE',
      timestampUtc: nowMs,
    },
    agents: createInitialAgentRegistry(new Date(nowMs).toISOString()),
    riskConfig: DEFAULT_RISK_CONFIG,
    riskContext: makeBaseContext(),
  });
  assert.ok(pepeSignal.quantIntel?.liquidationRadar);
  assert.ok(pepeSignal.quantIntel.liquidationRadar.recommendedLongSl > 0);
  assert.ok(
    pepeSignal.quantIntel.liquidationRadar.recommendedLongSl <
      pepeSignal.quantIntel.liquidationRadar.markPrice,
  );
  assert.ok(
    pepeSignal.quantIntel.liquidationRadar.recommendedLongTp >
      pepeSignal.quantIntel.liquidationRadar.markPrice,
  );
});









