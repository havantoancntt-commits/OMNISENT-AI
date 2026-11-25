import { computePearsonReturnCorrelation } from './quantIntelligence.ts';
import { evaluateOrderRisk } from './riskEngine.ts';
import type {
  AutoExecutionConfig,
  Candle,
  FullMarketOpportunity,
  MarketTicker,
  MarketType,
  OrderRequest,
  PortfolioSummary,
  Position,
  RiskCheckResult,
  RiskConfig,
  TradingMode,
  TradingSignal,
} from './types.ts';

export const DEFAULT_AUTO_EXECUTION_CONFIG: AutoExecutionConfig = {
  enabled: true,
  executionMode: 'FULL_AUTO',
  scanIntervalSeconds: 25,
  minConfluenceScore: 72,
  minExpectedValueR: 0.18,
  minWinProbability: 0.53,
  minRiskReward: 1.75,
  minVolume24hUsd: 5_000_000,
  maxTradesPerHour: 6,
  cooldownMinutesPerSymbol: 20,
  maxSimultaneousAutoPositions: 3,
  requireHtfAlignment: true,
  avoidRandomWalkHurst: true,
  useKellyAdaptiveRisk: true,
  enforceCorrelationGuard: true,
  maintainActivePositions: true,
  targetActivePositions: 2,
  allowedMarketTypes: ['PERPETUAL', 'SPOT'],
};

function clampNum(val: unknown, min: number, max: number, fallback: number): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

export function clampAutoExecutionConfig(
  partial: Partial<AutoExecutionConfig> | undefined,
  fallback: AutoExecutionConfig = DEFAULT_AUTO_EXECUTION_CONFIG,
): AutoExecutionConfig {
  if (!partial) return { ...fallback, allowedMarketTypes: [...fallback.allowedMarketTypes] };

  const rawMarkets = Array.isArray(partial.allowedMarketTypes)
    ? partial.allowedMarketTypes.filter(
        (m): m is MarketType => m === 'SPOT' || m === 'PERPETUAL' || m === 'FUTURES' || m === 'MARGIN',
      )
    : fallback.allowedMarketTypes;
  const allowedMarketTypes: MarketType[] =
    rawMarkets.length > 0 ? Array.from(new Set(rawMarkets)) : ['PERPETUAL', 'SPOT'];

  return {
    enabled: typeof partial.enabled === 'boolean' ? partial.enabled : fallback.enabled,
    executionMode:
      partial.executionMode === 'FULL_AUTO' || partial.executionMode === 'SEMI_AUTO'
        ? partial.executionMode
        : fallback.executionMode,
    scanIntervalSeconds: Math.round(
      clampNum(partial.scanIntervalSeconds, 15, 300, fallback.scanIntervalSeconds),
    ),
    minConfluenceScore: Math.round(
      clampNum(partial.minConfluenceScore, 55, 95, fallback.minConfluenceScore),
    ),
    minExpectedValueR: Number(
      clampNum(partial.minExpectedValueR, 0.05, 2.5, fallback.minExpectedValueR).toFixed(2),
    ),
    minWinProbability: Number(
      clampNum(partial.minWinProbability, 0.45, 0.85, fallback.minWinProbability).toFixed(2),
    ),
    minRiskReward: Number(
      clampNum(partial.minRiskReward, 1.5, 5.0, fallback.minRiskReward).toFixed(2),
    ),
    minVolume24hUsd: Math.round(
      clampNum(partial.minVolume24hUsd, 1_000_000, 100_000_000, fallback.minVolume24hUsd),
    ),
    maxTradesPerHour: Math.round(
      clampNum(partial.maxTradesPerHour, 1, 12, fallback.maxTradesPerHour),
    ),
    cooldownMinutesPerSymbol: Math.round(
      clampNum(partial.cooldownMinutesPerSymbol, 5, 240, fallback.cooldownMinutesPerSymbol),
    ),
    maxSimultaneousAutoPositions: Math.round(
      clampNum(partial.maxSimultaneousAutoPositions, 1, 6, fallback.maxSimultaneousAutoPositions),
    ),
    requireHtfAlignment:
      typeof partial.requireHtfAlignment === 'boolean'
        ? partial.requireHtfAlignment
        : fallback.requireHtfAlignment,
    avoidRandomWalkHurst:
      typeof partial.avoidRandomWalkHurst === 'boolean'
        ? partial.avoidRandomWalkHurst
        : fallback.avoidRandomWalkHurst,
    useKellyAdaptiveRisk:
      typeof partial.useKellyAdaptiveRisk === 'boolean'
        ? partial.useKellyAdaptiveRisk
        : fallback.useKellyAdaptiveRisk,
    enforceCorrelationGuard:
      typeof partial.enforceCorrelationGuard === 'boolean'
        ? partial.enforceCorrelationGuard
        : fallback.enforceCorrelationGuard,
    maintainActivePositions:
      typeof partial.maintainActivePositions === 'boolean'
        ? partial.maintainActivePositions
        : fallback.maintainActivePositions,
    targetActivePositions: Math.round(
      clampNum(
        partial.targetActivePositions,
        1,
        Math.round(
          clampNum(
            partial.maxSimultaneousAutoPositions,
            1,
            6,
            fallback.maxSimultaneousAutoPositions,
          ),
        ),
        fallback.targetActivePositions,
      ),
    ),
    allowedMarketTypes,
  };
}

export function syncAutoConfigWithTradingMode(
  targetMode: TradingMode,
  currentConfig: AutoExecutionConfig,
): AutoExecutionConfig {
  if (targetMode === 'FULL_AUTO') {
    return { ...currentConfig, enabled: true, executionMode: 'FULL_AUTO' };
  }
  if (targetMode === 'SEMI_AUTO') {
    return { ...currentConfig, enabled: true, executionMode: 'SEMI_AUTO' };
  }
  return { ...currentConfig, enabled: false };
}

export function resolveTradingModeAfterAutoConfig(
  currentMode: TradingMode,
  nextConfig: AutoExecutionConfig,
): TradingMode {
  if (currentMode === 'EMERGENCY_STOP') return 'EMERGENCY_STOP';
  if (nextConfig.enabled) return nextConfig.executionMode;
  if (currentMode === 'FULL_AUTO' || currentMode === 'SEMI_AUTO') return 'PAPER';
  return currentMode;
}

export function syncAutoConfigWithRiskConfig(
  autoConfig: AutoExecutionConfig,
  riskConfig: RiskConfig,
): AutoExecutionConfig {
  const maxSimultaneousAutoPositions = Math.max(
    1,
    Math.min(autoConfig.maxSimultaneousAutoPositions, Math.max(1, riskConfig.maxOpenPositions)),
  );
  const targetActivePositions = Math.max(
    1,
    Math.min(autoConfig.targetActivePositions, maxSimultaneousAutoPositions),
  );
  const minRiskReward = Number(
    Math.max(autoConfig.minRiskReward, riskConfig.minRiskReward).toFixed(2),
  );
  return {
    ...autoConfig,
    maxSimultaneousAutoPositions,
    targetActivePositions,
    minRiskReward,
  };
}

export interface AutoGateEvaluationInput {
  config: AutoExecutionConfig;
  tradingMode: TradingMode;
  opportunity: FullMarketOpportunity;
  ticker: MarketTicker;
  signal: TradingSignal;
  riskConfig: RiskConfig;
  portfolio: PortfolioSummary;
  openPositions: Position[];
  candlesBySymbol?: Record<string, Candle[]>;
  tradesExecutedLastHour: number;
  cooldownUntilMs?: number;
  recentIdempotencyKeys: string[];
  allowTacticalFallback?: boolean;
  nowMs?: number;
}

export interface AutoGateEvaluationResult {
  passed: boolean;
  executionTier: 'CORE_9_GATE' | 'TACTICAL_CONTINUITY';
  gateFailures: string[];
  maxSameSideCorrelation: number;
  effectiveRiskPct: number;
  winProbabilityEstimate: number;
  idempotencyKey: string;
  orderRequest: OrderRequest;
  riskCheck: RiskCheckResult;
}

export function evaluateAutoExecutionCandidate(
  input: AutoGateEvaluationInput,
): AutoGateEvaluationResult {
  const {
    config,
    tradingMode,
    opportunity,
    ticker,
    signal,
    riskConfig,
    portfolio,
    openPositions,
    candlesBySymbol = {},
    tradesExecutedLastHour,
    cooldownUntilMs = 0,
    recentIdempotencyKeys,
    allowTacticalFallback = false,
    nowMs = Date.now(),
  } = input;

  const gateFailures: string[] = [];

  // Gate 1: System Execution Mode Lock
  if (tradingMode === 'EMERGENCY_STOP') {
    gateFailures.push('EMERGENCY_STOP đang kích hoạt — khóa toàn bộ vào lệnh tự động.');
  } else if (tradingMode === 'ANALYSIS_ONLY') {
    gateFailures.push('Hệ thống đang ở ANALYSIS_ONLY — chưa cấp quyền khớp lệnh tự động.');
  }

  // Gate 2: Signal & Live Data Integrity
  if (ticker.dataStatus !== 'LIVE_EXCHANGE' || ticker.lastPrice <= 0) {
    gateFailures.push('Dữ liệu sàn chưa xác thực LIVE_EXCHANGE.');
  }
  if (signal.state !== 'APPROVED' || signal.direction === 'NO_TRADE') {
    gateFailures.push(`Tín hiệu AI đang ở trạng thái ${signal.state} (${signal.direction}).`);
  }
  const signalExpMs = signal.expiresAtUtc ? Date.parse(signal.expiresAtUtc) : NaN;
  if (Number.isFinite(signalExpMs) && signalExpMs < nowMs) {
    gateFailures.push(`Tín hiệu AI của ${ticker.symbol} đã hết hạn hiệu lực — chờ chu kỳ phân tích mới.`);
  }

  // Gate 3: Market Type, Liquidity & Spread Guard
  if (!config.allowedMarketTypes.includes(ticker.marketType)) {
    gateFailures.push(`Loại thị trường ${ticker.marketType} không nằm trong danh sách cho phép.`);
  }
  if (ticker.volume24hUsd < config.minVolume24hUsd) {
    gateFailures.push(
      `Thanh khoản 24h ($${Math.round(ticker.volume24hUsd).toLocaleString('en-US')}) thấp hơn ngưỡng $${config.minVolume24hUsd.toLocaleString('en-US')}.`,
    );
  }
  if (opportunity.spreadBps > 22) {
    gateFailures.push(`Spread (${opportunity.spreadBps} bps) vượt ngưỡng trượt giá an toàn (22 bps).`);
  }

  // Gate 4: Quantitative Alpha Thresholds (Core 9-Gate vs Tactical Continuity Tier)
  const effectiveMinConf = allowTacticalFallback
    ? Math.max(58, config.minConfluenceScore - 14)
    : config.minConfluenceScore;
  const effectiveMinEv = allowTacticalFallback
    ? Math.min(config.minExpectedValueR, 0.05)
    : config.minExpectedValueR;
  const effectiveMinWinProb = allowTacticalFallback
    ? Math.max(0.47, config.minWinProbability - 0.06)
    : config.minWinProbability;
  const effectiveMinRr = allowTacticalFallback
    ? Math.max(riskConfig.minRiskReward, Number((config.minRiskReward - 0.3).toFixed(2)))
    : Math.max(config.minRiskReward, riskConfig.minRiskReward);

  const confluenceScore = signal.quantAlpha?.confluenceScore ?? opportunity.confluenceScore;
  if (confluenceScore < effectiveMinConf) {
    gateFailures.push(
      `Confluence (${confluenceScore}/100) chưa đạt ngưỡng tối thiểu ${effectiveMinConf}/100.`,
    );
  }
  const evR = signal.expectedValueR ?? opportunity.expectedValueR;
  if (evR < effectiveMinEv) {
    gateFailures.push(
      `Expected Value (${evR.toFixed(2)}R) thấp hơn ngưỡng dương kỳ vọng ${effectiveMinEv.toFixed(2)}R.`,
    );
  }
  if (signal.riskReward < effectiveMinRr) {
    gateFailures.push(`Tỷ lệ R:R (${signal.riskReward.toFixed(2)}) nhỏ hơn mức yêu cầu ${effectiveMinRr.toFixed(2)}.`);
  }

  const winProbabilityEstimate = signal.quantIntel?.kelly.winProbabilityUsed ??
    Math.min(0.85, Math.max(0.4, (confluenceScore / 100) * 0.72));
  if (winProbabilityEstimate < effectiveMinWinProb) {
    gateFailures.push(
      `Xác suất thắng định lượng (${(winProbabilityEstimate * 100).toFixed(1)}%) thấp hơn ${(effectiveMinWinProb * 100).toFixed(0)}%.`,
    );
  }

  // Gate 5: 4H Multi-Timeframe Alignment
  const htf = signal.htfAlignment ?? opportunity.htfAlignment;
  if (
    config.requireHtfAlignment &&
    htf === 'COUNTER_TREND' &&
    !(allowTacticalFallback && confluenceScore >= 64)
  ) {
    gateFailures.push('Setup ngược pha khung lớn 4H (COUNTER_TREND) bị chặn bởi bộ lọc xu hướng.');
  }

  // Gate 6: Hurst Regime & Random-Walk Noise Filter
  const hurstClass = signal.quantIntel?.hurst.regimeClass;
  const edgeScore = signal.quantIntel?.compositeEdgeScore ?? 50;
  const squeezeFiring = signal.quantIntel?.microstructure.squeezeState === 'SQUEEZE_FIRING';
  if (
    config.avoidRandomWalkHurst &&
    hurstClass === 'RANDOM_WALK_NOISE' &&
    !(squeezeFiring && edgeScore >= 78) &&
    !(allowTacticalFallback && edgeScore >= 52 && confluenceScore >= 60)
  ) {
    gateFailures.push(
      `Hurst H(2) báo nhiễu ngẫu nhiên (${signal.quantIntel?.hurst.hurstExponent.toFixed(2)}) — chờ thoát nhiễu.`,
    );
  }

  // Gate 7: Cross-Asset Pearson Correlation Concentration Guard
  let maxSameSideCorrelation = 0;
  if (config.enforceCorrelationGuard && signal.direction !== 'NO_TRADE') {
    const candidateCandles = candlesBySymbol[ticker.symbol];
    if (candidateCandles && candidateCandles.length >= 25) {
      for (const pos of openPositions) {
        if (pos.side !== signal.direction) continue;
        const posCandles = candlesBySymbol[pos.symbol];
        if (!posCandles || posCandles.length < 25) continue;
        const corr = computePearsonReturnCorrelation(candidateCandles, posCandles);
        if (corr.overlapBars >= 20) {
          maxSameSideCorrelation = Math.max(maxSameSideCorrelation, corr.correlation);
        }
      }
      if (maxSameSideCorrelation >= 0.85) {
        gateFailures.push(
          `Tương quan đồng hướng quá cao (ρ=${maxSameSideCorrelation.toFixed(2)} >= 0.85) với vị thế đang mở — tránh tập trung rủi ro beta.`,
        );
      }
    }
  }

  // Gate 8: Velocity Limit, Symbol Cooldown, Duplicate/Self-Hedge Guard & Slot Cap
  const existingPairPosition = openPositions.find(
    (p) =>
      p.symbol.toUpperCase() === ticker.symbol.toUpperCase() &&
      p.marketType === ticker.marketType,
  );
  if (existingPairPosition) {
    gateFailures.push(
      `Đã có vị thế ${existingPairPosition.side} mở trên ${ticker.symbol} (${ticker.marketType}) — chặn trùng lặp hoặc tự hedge.`,
    );
  }
  if (tradesExecutedLastHour >= config.maxTradesPerHour) {
    gateFailures.push(
      `Đã đạt giới hạn tốc độ ${tradesExecutedLastHour}/${config.maxTradesPerHour} lệnh tự động trong 1 giờ.`,
    );
  }
  const slotCap = Math.min(config.maxSimultaneousAutoPositions, riskConfig.maxOpenPositions);
  if (openPositions.length >= slotCap) {
    gateFailures.push(`Số vị thế mở (${openPositions.length}) đã chạm trần Auto Slots (${slotCap}).`);
  }
  if (cooldownUntilMs > nowMs) {
    const minsLeft = Math.ceil((cooldownUntilMs - nowMs) / 60_000);
    gateFailures.push(`${ticker.symbol} đang trong thời gian hạ nhiệt Cooldown (còn ${minsLeft} phút).`);
  }

  // Gate 9: Quarter-Kelly Adaptive Risk Sizing + Deterministic Risk Engine
  const baseRiskPct = signal.recommendedRiskPct ?? riskConfig.riskPerTradePct;
  const kellyVolRisk = signal.quantIntel?.kelly.volAdjustedRiskPct;
  const rawRiskPct =
    config.useKellyAdaptiveRisk && typeof kellyVolRisk === 'number' && kellyVolRisk > 0
      ? Math.min(baseRiskPct, kellyVolRisk)
      : baseRiskPct;
  const scaledRiskPct = allowTacticalFallback ? rawRiskPct * 0.72 : rawRiskPct;
  const effectiveRiskPct = Number(
    Math.max(0.1, Math.min(riskConfig.maxRiskPerTradePct, scaledRiskPct)).toFixed(2),
  );

  const side = signal.direction === 'SHORT' ? 'SHORT' : 'LONG';
  const tpTarget = signal.takeProfitLevels[1] ?? signal.takeProfitLevels[0] ?? ticker.lastPrice;
  const bucketMinute = Math.floor(nowMs / 60_000);
  const idempotencyKey = `AUTO-${ticker.symbol.replace(/[^A-Z0-9]/gi, '')}-${side}-${bucketMinute}`;
  const executionTier: AutoGateEvaluationResult['executionTier'] = allowTacticalFallback
    ? 'TACTICAL_CONTINUITY'
    : 'CORE_9_GATE';

  const orderRequest: OrderRequest = {
    symbol: ticker.symbol,
    exchange: ticker.exchange,
    marketType: ticker.marketType,
    side,
    orderType: 'MARKET',
    entryPrice: ticker.lastPrice,
    stopLoss: signal.stopLoss,
    takeProfit: tpTarget,
    leverage: ticker.marketType === 'SPOT' ? 1 : Math.min(signal.leverage, riskConfig.maxLeverage),
    riskPctOverride: effectiveRiskPct,
    strategyName: `${allowTacticalFallback ? 'AutoTactical' : 'AutoAlpha'} · ${signal.strategyName}`,
    idempotencyKey,
    dataStatus: ticker.dataStatus,
    tradingStatus: ticker.tradingStatus,
  };

  const riskCheck = evaluateOrderRisk(orderRequest, riskConfig, {
    tradingMode,
    accountEquityUsd: portfolio.totalEquityUsd,
    availableBalanceUsd: portfolio.availableBalanceUsd,
    dailyPnlPct: portfolio.dailyPnlPct,
    weeklyPnlPct: portfolio.weeklyPnlPct,
    currentDrawdownPct: portfolio.currentDrawdownPct,
    openPositions,
    recentIdempotencyKeys,
  });

  if (!riskCheck.approved) {
    for (const r of riskCheck.reasons) {
      if (!gateFailures.includes(r)) {
        gateFailures.push(r);
      }
    }
  }

  return {
    passed: gateFailures.length === 0 && riskCheck.approved,
    executionTier,
    gateFailures,
    maxSameSideCorrelation: Number(maxSameSideCorrelation.toFixed(3)),
    effectiveRiskPct,
    winProbabilityEstimate: Number(winProbabilityEstimate.toFixed(3)),
    idempotencyKey,
    orderRequest,
    riskCheck,
  };
}
