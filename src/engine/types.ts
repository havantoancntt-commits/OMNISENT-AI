export type MarketType = 'SPOT' | 'FUTURES' | 'PERPETUAL' | 'MARGIN';
export type OrderSide = 'LONG' | 'SHORT';
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP';
export type TradingMode =
  | 'ANALYSIS_ONLY'
  | 'PAPER'
  | 'SEMI_AUTO'
  | 'FULL_AUTO'
  | 'EMERGENCY_STOP';

export type DataSourceStatus = 'LIVE_EXCHANGE' | 'UNAVAILABLE' | 'STALE' | 'UNKNOWN';

export type MarketRegime =
  | 'STRONG_BULL'
  | 'BULL'
  | 'WEAK_BULL'
  | 'SIDEWAYS'
  | 'HIGH_VOLATILITY'
  | 'LOW_VOLATILITY'
  | 'BEAR'
  | 'STRONG_BEAR'
  | 'PANIC_MARKET'
  | 'TREND_REVERSAL'
  | 'BREAKOUT'
  | 'FAKE_BREAKOUT'
  | 'LIQUIDITY_CRISIS'
  | 'UNKNOWN_REGIME';

export type AgentStatus =
  | 'ONLINE'
  | 'OFFLINE'
  | 'BUSY'
  | 'ERROR'
  | 'DEGRADED'
  | 'WAITING'
  | 'DISABLED';

export type AgentCategory =
  | 'ORCHESTRATION'
  | 'DATA'
  | 'ANALYSIS'
  | 'STRATEGY'
  | 'RISK'
  | 'EXECUTION'
  | 'SECURITY';

export type AgentId =
  | 'MASTER_ORCHESTRATOR'
  | 'MARKET_DATA'
  | 'DATA_INTEGRITY'
  | 'MARKET_REGIME'
  | 'TECHNICAL_ANALYSIS'
  | 'ORDER_BOOK_LIQUIDITY'
  | 'QUANT_AI'
  | 'FUNDAMENTAL_RESEARCH'
  | 'ON_CHAIN_INTELLIGENCE'
  | 'NEWS_SENTIMENT'
  | 'STRATEGY_GENERATION'
  | 'STRATEGY_VALIDATION'
  | 'RISK_MANAGEMENT'
  | 'EXECUTION_AGENT'
  | 'PORTFOLIO_MANAGEMENT'
  | 'POSITION_MONITORING'
  | 'EXIT_STRATEGY'
  | 'AI_PERFORMANCE'
  | 'CYBERSECURITY';

export interface AgentState {
  id: AgentId;
  name: string;
  category: AgentCategory;
  status: AgentStatus;
  currentTask: string;
  dataSource: string;
  lastActivityUtc: string;
  latencyMs: number;
  healthPct: number;
  errorCount: number;
  evalCount: number;
  lastOutput: string;
  version: string;
  enabled: boolean;
}

export interface AgentLogEntry {
  id: string;
  agentId: AgentId;
  level: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
  message: string;
  timestampUtc: string;
}

export interface Candle {
  timestamp: number; // UTC ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
  totalUsd: number;
}

export interface OrderBookSnapshot {
  symbol: string;
  exchange: string;
  timestampUtc: number;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  spreadBps: number;
  imbalanceRatio: number; // -1 (ask heavy) to +1 (bid heavy)
  dataStatus: DataSourceStatus;
}

export interface MarketTicker {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  exchange: string;
  marketType: MarketType;
  lastPrice: number;
  bidPrice: number;
  askPrice: number;
  change24hPct: number;
  high24h: number;
  low24h: number;
  volume24hUsd: number;
  openInterestUsd: number | null;
  fundingRatePct: number | null;
  spreadBps: number;
  volatility24hPct: number;
  rsi14: number | null;
  regime: MarketRegime;
  liquidityScore: number; // 0 - 100
  dataStatus: DataSourceStatus;
  sourceLabel: string;
  timestampUtc: number;
  latencyMs: number;
  tickSize: number;
  lotSize: number;
  minOrderUsd: number;
  maxLeverage: number;
  tradingStatus: 'TRADING' | 'HALTED' | 'DELISTING_RISK';
}

export interface TechnicalIndicators {
  ema9: number;
  ema21: number;
  ema50: number;
  ema200: number;
  sma20: number;
  rsi14: number;
  macd: {
    line: number;
    signal: number;
    histogram: number;
  };
  atr14: number;
  bollinger: {
    upper: number;
    middle: number;
    lower: number;
    bandwidthPct: number;
  };
  vwap: number;
  adx14: number;
  supertrend: {
    direction: 'BULLISH' | 'BEARISH';
    value: number;
  };
  support: number;
  resistance: number;
}

export interface DataIntegrityReport {
  symbol: string;
  exchange: string;
  valid: boolean;
  status: DataSourceStatus;
  freshnessMs: number;
  anomalies: string[];
  checkedAtUtc: string;
}

export interface RiskConfig {
  riskPerTradePct: number;
  maxRiskPerTradePct: number;
  dailyLossLimitPct: number;
  weeklyLossLimitPct: number;
  maxDrawdownPct: number;
  defaultLeverage: number;
  maxLeverage: number;
  maxOpenPositions: number;
  minRiskReward: number;
  allowMartingale: false; // Strictly locked false per policy
  requireStopLoss: boolean;
  maxSingleAssetExposurePct: number;
}

export interface OrderRequest {
  symbol: string;
  exchange: string;
  marketType: MarketType;
  side: OrderSide;
  orderType: OrderType;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  leverage: number;
  quantity?: number;
  riskPctOverride?: number;
  strategyName?: string;
  idempotencyKey: string;
  dataStatus: DataSourceStatus;
  tradingStatus?: 'TRADING' | 'HALTED' | 'DELISTING_RISK';
  tickerTimestampUtc?: number;
  nowMs?: number;
}

export interface RiskContext {
  tradingMode: TradingMode;
  accountEquityUsd: number;
  availableBalanceUsd: number;
  dailyPnlPct: number;
  weeklyPnlPct: number;
  currentDrawdownPct: number;
  openPositions: Position[];
  recentIdempotencyKeys: string[];
}

export type RiskDecision =
  | 'APPROVE'
  | 'REJECT'
  | 'REDUCE_POSITION'
  | 'PAUSE'
  | 'LOCK_SYSTEM';

export interface RiskCheckResult {
  decision: RiskDecision;
  approved: boolean;
  reasons: string[];
  warnings: string[];
  recommendedQuantity: number;
  notionalValueUsd: number;
  requiredMarginUsd: number;
  estimatedRiskUsd: number;
  estimatedRiskPct: number;
  riskRewardRatio: number;
  estimatedFeesUsd: number;
  estimatedSlippageUsd: number;
  liquidationPriceEst: number | null;
  checkedAtUtc: string;
}

export interface Position {
  id: string;
  symbol: string;
  exchange: string;
  marketType: MarketType;
  side: OrderSide;
  quantity: number;
  entryPrice: number;
  markPrice: number;
  stopLoss: number;
  initialStopLoss?: number;
  takeProfit: number;
  leverage: number;
  marginUsd: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
  liquidationPrice: number | null;
  fundingPaidUsd: number;
  strategyName: string;
  mode: 'PAPER' | 'LIVE';
  openedAtUtc: string;
}

export interface ClosePositionReceipt {
  positionId: string;
  symbol: string;
  exchange: string;
  marketType: MarketType;
  side: OrderSide;
  leverage: number;
  quantity: number;
  entryPrice: number;
  closePrice: number;
  grossPnlUsd: number;
  closeFeeUsd: number;
  realizedNetUsd: number;
  rMultiple: number;
  closeReason: 'MANUAL_CLOSE' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'TRAILING_PROFIT';
  closedAtUtc: string;
}

export interface ClosePositionResponse {
  ok: boolean;
  alreadyClosed?: boolean;
  closedNetPnlUsd?: number;
  receipt?: ClosePositionReceipt;
  error?: string;
}

export interface OrderRecord {
  id: string;
  idempotencyKey: string;
  symbol: string;
  exchange: string;
  marketType: MarketType;
  side: OrderSide;
  orderType: OrderType;
  quantity: number;
  price: number;
  stopLoss: number;
  takeProfit: number;
  leverage: number;
  feesUsd: number;
  slippageUsd: number;
  status: 'FILLED' | 'REJECTED' | 'CANCELLED' | 'OPEN';
  mode: 'PAPER' | 'LIVE';
  strategyName: string;
  riskDecision: RiskDecision;
  createdAtUtc: string;
}

export interface PortfolioSummary {
  mode: TradingMode;
  initialEquityUsd: number;
  totalEquityUsd: number;
  availableBalanceUsd: number;
  usedMarginUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  totalFeesUsd: number;
  dailyPnlPct: number;
  weeklyPnlPct: number;
  peakEquityUsd: number;
  currentDrawdownPct: number;
  winCount: number;
  lossCount: number;
  totalClosedTrades: number;
  winRatePct: number | null; // null if 0 closed trades (never fake win rate)
}

export type SignalState =
  | 'DETECTED'
  | 'ANALYZING'
  | 'VALIDATING'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXECUTING'
  | 'OPEN'
  | 'PARTIALLY_FILLED'
  | 'CLOSED'
  | 'EXPIRED'
  | 'FAILED';

export type DebatePhase = 'PROPOSE' | 'CHALLENGE' | 'REBUTTAL' | 'VETO' | 'VERDICT';

export interface DebateTurn {
  step: number;
  phase: DebatePhase;
  speakerId: AgentId;
  speakerName: string;
  speakerRole: string;
  targetId: AgentId;
  targetName: string;
  stance: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'VETO';
  confidenceDelta: number;
  argument: string;
  evidenceMetric: string;
}

export interface AgentVote {
  agentId: AgentId;
  agentName: string;
  stance: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'VETO';
  score: number; // 0 - 100
  rationale: string;
}

export interface TradingSignal {
  id: string;
  symbol: string;
  exchange: string;
  marketType: MarketType;
  direction: OrderSide | 'NO_TRADE';
  entryRange: [number, number];
  stopLoss: number;
  takeProfitLevels: number[];
  positionSizeQty: number;
  leverage: number;
  riskUsd: number;
  rewardUsd: number;
  riskReward: number;
  timeHorizon: string;
  marketRegime: MarketRegime;
  technicalScore: number;
  quantScore: number;
  liquidityScore: number;
  fundamentalScore: number;
  sentimentScore: number;
  dataQualityScore: number;
  riskScore: number;
  confidenceScore: number; // Uncalibrated composite score unless empirically validated
  calibratedProbabilityNote: string;
  strategyName: string;
  reasoningSummary: string;
  conflictsDetected: string[];
  agentVotes: AgentVote[];
  debateRounds?: DebateTurn[];
  precisionTier?: 'HIGH_CONVICTION' | 'MODERATE' | 'REJECTED_PRESERVE_CAPITAL';
  dataSource: DataSourceStatus;
  timestampUtc: string;
  expiresAtUtc: string;
  state: SignalState;
  riskCheck: RiskCheckResult;
  quantAlpha?: AdaptiveConfluenceSummary;
  quantIntel?: QuantIntelligenceSnapshot;
  htfAlignment?: HtfAlignment;
  expectedValueR?: number;
  recommendedRiskPct?: number;
}

export type HtfAlignment = 'ALIGNED_BULL' | 'ALIGNED_BEAR' | 'NEUTRAL' | 'COUNTER_TREND';

export interface SmartOpportunityCandidate {
  rank: number;
  symbol: string;
  exchange: string;
  marketType: MarketType;
  lastPrice: number;
  change24hPct: number;
  direction: OrderSide | 'NO_TRADE';
  state: SignalState;
  confidenceScore: number;
  confluenceScore: number;
  htfAlignment: HtfAlignment;
  riskReward: number;
  expectedValueR: number;
  opportunityScore: number;
  reasoningSummary: string;
}

export interface AdaptiveConfluenceFactor {
  id: 'TREND' | 'VALUE_ZONE' | 'MOMENTUM' | 'VOLUME' | 'VOLATILITY_GATE';
  label: string;
  score: number;
  maxScore: number;
  passed: boolean;
  detail: string;
}

export interface AdaptiveConfluenceSummary {
  strategyId: 'ADAPTIVE_CONFLUENCE_ALPHA';
  strategyName: string;
  regimeMode: 'TREND_PULLBACK' | 'MEAN_REVERSION' | 'STANDBY';
  direction: OrderSide | 'NO_TRADE';
  confluenceScore: number; // 0 - 100
  bullScore: number;
  bearScore: number;
  passedFactors: number;
  totalFactors: number;
  shockVeto: boolean;
  stopAtrMult: number;
  tpAtrMult: number;
  breakevenTriggerR: number;
  htfAlignment?: HtfAlignment;
  expectedValueR?: number;
  recommendedRiskPct?: number;
  factors: AdaptiveConfluenceFactor[];
}

export type BacktestStrategyId =
  | 'ADAPTIVE_CONFLUENCE_ALPHA'
  | 'EMA_CROSSOVER'
  | 'RSI_MEAN_REVERSION'
  | 'BOLLINGER_BREAKOUT'
  | 'SUPERTREND_MOMENTUM';

export interface BacktestConfig {
  symbol: string;
  timeframe: string;
  strategyId: BacktestStrategyId;
  marketType: MarketType;
  initialCapitalUsd: number;
  riskPerTradePct: number;
  leverage: number;
  feeRateBps: number;
  slippageBps: number;
  fundingRatePer8hPct: number;
  stopLossAtrMult: number;
  takeProfitAtrMult: number;
  monteCarloRuns: number;
  useTrailingProfitLock?: boolean;
}

export interface BacktestTrade {
  id: number;
  side: OrderSide;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  grossPnlUsd: number;
  feesUsd: number;
  fundingUsd: number;
  netPnlUsd: number;
  returnPct: number;
  exitReason: 'TAKE_PROFIT' | 'STOP_LOSS' | 'BREAKEVEN_TRAIL' | 'SIGNAL_EXIT' | 'END_OF_SERIES';
}

export interface EquityPoint {
  timestamp: number;
  equityUsd: number;
  drawdownPct: number;
}

export interface BacktestResult {
  config: BacktestConfig;
  dataSourceLabel: string;
  candleCount: number;
  totalTrades: number;
  winRatePct: number;
  profitFactor: number;
  expectancyUsd: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdownPct: number;
  totalReturnPct: number;
  netProfitUsd: number;
  grossProfitUsd: number;
  grossLossUsd: number;
  averageWinUsd: number;
  averageLossUsd: number;
  maxConsecutiveLosses: number;
  totalFeesUsd: number;
  totalFundingUsd: number;
  monteCarlo: {
    runs: number;
    p5FinalEquityUsd: number;
    p50FinalEquityUsd: number;
    p95FinalEquityUsd: number;
    p95MaxDrawdownPct: number;
  };
  equityCurve: EquityPoint[];
  trades: BacktestTrade[];
  disclaimer: string;
}

export interface StrategyBenchmarkEntry {
  rank: number;
  strategyId: BacktestStrategyId;
  strategyLabel: string;
  compositeScore: number;
  isHighestWinRate: boolean;
  result: BacktestResult;
}

export interface StrategyBenchmarkResult {
  symbol: string;
  timeframe: string;
  marketType: MarketType;
  dataSourceLabel: string;
  candleCount: number;
  bestWinRateStrategyId: BacktestStrategyId;
  bestCompositeStrategyId: BacktestStrategyId;
  entries: StrategyBenchmarkEntry[];
}

export interface OptimizationCandidateSummary {
  strategyId: BacktestStrategyId;
  strategyLabel: string;
  stopLossAtrMult: number;
  takeProfitAtrMult: number;
  useTrailingProfitLock: boolean;
  inSampleWinRatePct: number;
  inSampleProfitFactor: number;
  inSampleNetProfitUsd: number;
  outOfSampleWinRatePct: number;
  outOfSampleProfitFactor: number;
  outOfSampleExpectancyUsd: number;
  outOfSampleNetProfitUsd: number;
  outOfSampleMaxDdPct: number;
  outOfSampleTrades: number;
  walkForwardScore: number;
}

export interface BacktestOptimizationResult {
  symbol: string;
  timeframe: string;
  marketType: MarketType;
  dataSourceLabel: string;
  candleCount: number;
  inSampleBars: number;
  outOfSampleBars: number;
  bestStrategyId: BacktestStrategyId;
  bestStrategyLabel: string;
  bestStopLossAtrMult: number;
  bestTakeProfitAtrMult: number;
  bestUseTrailingProfitLock: boolean;
  inSampleResult: BacktestResult;
  outOfSampleResult: BacktestResult;
  fullHistoryResult: BacktestResult;
  candidatesEvaluated: number;
  topCandidates: OptimizationCandidateSummary[];
}

export type ExchangeEnvironment = 'MAINNET' | 'TESTNET';

export type ExchangeAuthScheme =
  | 'HMAC_SHA256'
  | 'HMAC_SHA256_PASSPHRASE'
  | 'HMAC_SHA512'
  | 'ECDSA_OR_HMAC'
  | 'CLIENT_SIGNATURE';

export type ExchangeVerificationStatus =
  | 'NOT_CONFIGURED'
  | 'VERIFIED_LIVE'
  | 'VERIFIED_TESTNET'
  | 'VAULT_STORED_UNVERIFIED'
  | 'AUTH_FAILED';

export interface ExchangeInfo {
  id: string;
  name: string;
  connectionStatus: 'CONNECTED' | 'PUBLIC_ONLY' | 'DISCONNECTED' | 'ERROR';
  apiStatus: 'OPERATIONAL' | 'DEGRADED' | 'UNREACHABLE';
  supportedMarkets: MarketType[];
  wsStatus: 'CONNECTED' | 'RECONNECTING' | 'FALLBACK_POLLING' | 'OFFLINE';
  apiLatencyMs: number;
  lastSyncUtc: string;
  dataHealth: 'HEALTHY' | 'DEGRADED' | 'UNKNOWN';
  hasApiKeyConfigured: boolean;
  maskedApiKey: string | null;
  environment: ExchangeEnvironment;
  verificationStatus: ExchangeVerificationStatus;
  lastVerifiedUtc: string | null;
  verificationNote: string | null;
  accountEquitySummaryUsd: number | null;
  permissions: {
    read: boolean;
    spotTrade: boolean;
    futuresTrade: boolean;
    withdrawalBlocked: boolean; // Always true by cybersecurity invariant
  };
  makerFeeBps: number;
  takerFeeBps: number;
}

export interface AuditLogEntry {
  id: string;
  category: 'ORDER' | 'RISK' | 'AGENT' | 'SECURITY' | 'SYSTEM' | 'EMERGENCY';
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  actor: string;
  action: string;
  details: string;
  timestampUtc: string;
}

export type PnlTimeWindow = '15m' | '1h' | '6h' | '24h' | 'ALL';

export interface PnlHistoryPoint {
  timestampMs: number;
  timestampUtc: string;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  netPnlUsd: number;
  totalEquityUsd: number;
  openPositionsCount: number;
  eventTag?: string;
}

export type ScannerSetupArchetype =
  | 'MOMENTUM_BREAKOUT'
  | 'TREND_CONTINUATION'
  | 'OVERSOLD_REBOUND'
  | 'SHORT_SQUEEZE'
  | 'FUNDING_EDGE';

export type ScannerAssetUniverse = 'CRYPTO' | 'ALL';

export type ScannerStrategyFocus =
  | 'ALL'
  | 'HIGH_PROFIT_ALPHA'
  | 'MOMENTUM_BREAKOUT'
  | 'MEAN_REVERSION'
  | 'FUNDING_SQUEEZE';

export interface MarketBreadthStats {
  totalScannedPairs: number;
  uniqueSymbolsCount: number;
  exchangesCovered: string[];
  advancersCount: number;
  declinersCount: number;
  breadthBullPct: number;
  totalVolume24hUsd: number;
  medianVolatilityPct: number;
  highLiquidityCount: number;
}

export interface FullMarketOpportunity {
  rank: number;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  exchange: string;
  exchangeId: string;
  marketType: MarketType;
  lastPrice: number;
  bidPrice: number;
  askPrice: number;
  change24hPct: number;
  volume24hUsd: number;
  spreadBps: number;
  volatility24hPct: number;
  rangePositionPct: number;
  fundingRatePct: number | null;
  openInterestUsd: number | null;
  maxLeverage: number;
  archetype: ScannerSetupArchetype;
  preScreenScore: number;
  liquidityScore: number;
  deepVerified: boolean;
  direction: OrderSide | 'NO_TRADE';
  signalState: SignalState | 'PRE_SCREEN';
  confluenceScore: number;
  htfAlignment: HtfAlignment;
  expectedValueR: number;
  riskReward: number;
  recommendedRiskPct: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  backtestWinRatePct: number | null;
  backtestProfitFactor: number | null;
  backtestReturnPct: number | null;
  backtestTradesCount: number;
  compositeAlphaScore: number;
  reasoningSummary: string;
}

export interface FullMarketScanResponse {
  scanMode: 'FAST' | 'DEEP';
  filters: {
    marketType: MarketType | 'ALL';
    exchange: string;
    minVolumeUsd: number;
    strategyFocus: ScannerStrategyFocus;
    direction: OrderSide | 'ALL';
    assetUniverse?: ScannerAssetUniverse;
  };
  breadth: MarketBreadthStats;
  stage1CandidatesCount: number;
  deepEvaluatedCount: number;
  approvedCount: number;
  durationMs: number;
  scannedAtUtc: string;
  opportunities: FullMarketOpportunity[];
}

export type HurstRegimeClass =
  | 'TRENDING_PERSISTENT'
  | 'MEAN_REVERTING'
  | 'RANDOM_WALK_NOISE';

export interface HurstRegimeResult {
  hurstExponent: number; // 0.15 - 0.90
  efficiencyRatio: number; // Kaufman ER 0 - 1
  regimeClass: HurstRegimeClass;
  sampleBars: number;
}

export type SqueezeState = 'ACTIVE_SQUEEZE' | 'SQUEEZE_FIRING' | 'NORMAL';
export type OrderFlowBias =
  | 'BULLISH_ABSORPTION'
  | 'BEARISH_DISTRIBUTION'
  | 'ALIGNED_BULL'
  | 'ALIGNED_BEAR'
  | 'NEUTRAL';

export interface MicrostructureIntel {
  squeezeState: SqueezeState;
  squeezeCompressionRatio: number; // BB width / Keltner width (<1 means squeeze)
  vwapPrice: number;
  vwapZScore: number;
  signedVolumeDeltaPct: number; // -100 to +100
  orderBookImbalancePct: number; // -100 to +100
  orderFlowBias: OrderFlowBias;
  fvgSignal: 'BULLISH_FVG' | 'BEARISH_FVG' | 'NONE';
  liquiditySweep: 'LOW_SWEEP_RECLAIM' | 'HIGH_SWEEP_RECLAIM' | 'NONE';
}

export interface KellyAllocationResult {
  winProbabilityUsed: number; // 0 - 1
  payoffRatio: number; // R:R
  fullKellyPct: number;
  quarterKellyPct: number;
  volAdjustedRiskPct: number; // clamped <= maxRiskPerTradePct
  recommendedMarginUsd: number;
  positiveEdge: boolean;
}

export type LiquidationClusterSide = 'LONG_LIQ' | 'SHORT_LIQ';

export type LiquidationClusterSource = 'LEVERAGE_BAND' | 'SWING_POOL' | 'OB_WALL';

export interface LiquidationClusterZone {
  id: string;
  side: LiquidationClusterSide;
  leverageTier: '100X' | '50X' | '25X' | '10X' | 'SWING' | 'WALL';
  source: LiquidationClusterSource;
  priceLevel: number;
  bandLow: number;
  bandHigh: number;
  distancePct: number;
  estimatedUsdM: number;
  intensityScore: number; // 0 - 100
}

export interface LiquidationRadarSnapshot {
  markPrice: number;
  atr14: number;
  fundingRatePct: number | null;
  openInterestUsdM: number;
  fundingCrowdBias: 'CROWDED_LONGS' | 'CROWDED_SHORTS' | 'BALANCED';
  dominantSweepDirection: 'DOWNSIDE_LONG_SWEEP' | 'UPSIDE_SHORT_SWEEP' | 'TWO_SIDED';
  stopHuntRiskScore: number; // 0 - 100
  nearestLongLiqPrice: number | null;
  nearestShortLiqPrice: number | null;
  strongestLongWallPrice: number | null;
  strongestShortWallPrice: number | null;
  recommendedLongSl: number;
  recommendedLongTp: number;
  recommendedShortSl: number;
  recommendedShortTp: number;
  longSafetyBufferPct: number;
  shortSafetyBufferPct: number;
  longClusterAdjustmentApplied: boolean;
  shortClusterAdjustmentApplied: boolean;
  clusters: LiquidationClusterZone[];
}

export interface QuantIntelligenceSnapshot {
  hurst: HurstRegimeResult;
  microstructure: MicrostructureIntel;
  kelly: KellyAllocationResult;
  liquidationRadar?: LiquidationRadarSnapshot;
  compositeEdgeScore: number; // 0 - 100
  computedAtUtc: string;
}

export interface CorrelationPairEntry {
  symbolA: string;
  symbolB: string;
  correlation: number; // -1 to +1
  overlapBars: number;
  riskTier: 'HIGH_CONCENTRATION' | 'MODERATE' | 'DIVERSIFIED' | 'HEDGED';
}

export interface PortfolioCorrelationGuard {
  openPositionsCount: number;
  averageAbsCorrelation: number;
  diversificationScore: number; // 0 - 100
  concentrationWarning: 'LOW' | 'MODERATE' | 'HIGH';
  netDirectionalExposureUsd: number;
  grossExposureUsd: number;
  pairs: CorrelationPairEntry[];
}

export interface GeminiGroundingSource {
  title: string;
  uri: string;
}

export interface GeminiDecisionCalibration {
  model: 'gemini-decision-1';
  winEdgeProbability: number; // 0.01 - 0.99
  winEdgeConfidence: number;
  liquiditySafetyProbability: number;
  recommendedRoute: string;
  routeConfidence: number;
  qualityRubricScore: number; // 0 - 4
  qualityRubricNormalizedPct: number; // 0 - 100
  qualityTopLabel: string;
  totalOutputTokens: 0;
}

export type AutoExecutionSubMode = 'SEMI_AUTO' | 'FULL_AUTO';

export interface AutoExecutionConfig {
  enabled: boolean;
  executionMode: AutoExecutionSubMode;
  scanIntervalSeconds: number;
  minConfluenceScore: number;
  minExpectedValueR: number;
  minWinProbability: number; // 0.45 - 0.85
  minRiskReward: number;
  minVolume24hUsd: number;
  maxTradesPerHour: number;
  cooldownMinutesPerSymbol: number;
  maxSimultaneousAutoPositions: number;
  requireHtfAlignment: boolean;
  avoidRandomWalkHurst: boolean;
  useKellyAdaptiveRisk: boolean;
  enforceCorrelationGuard: boolean;
  maintainActivePositions: boolean;
  targetActivePositions: number;
  allowedMarketTypes: MarketType[];
}

export type AutoProposalStatus = 'PENDING' | 'EXECUTED' | 'REJECTED' | 'EXPIRED';

export interface AutoExecutionProposal {
  id: string;
  symbol: string;
  exchange: string;
  marketType: MarketType;
  side: OrderSide;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  leverage: number;
  recommendedQuantity: number;
  recommendedRiskPct: number;
  requiredMarginUsd: number;
  confluenceScore: number;
  expectedValueR: number;
  riskReward: number;
  winProbabilityPct: number;
  compositeAlphaScore: number;
  hurstRegime: HurstRegimeClass;
  orderFlowBias: OrderFlowBias;
  htfAlignment: HtfAlignment;
  maxSameSideCorrelation: number;
  strategyName: string;
  reasoningSummary: string;
  status: AutoProposalStatus;
  createdAtUtc: string;
  expiresAtUtc: string;
  executedOrderId?: string;
}

export interface AutoExecutionActivityEntry {
  id: string;
  timestampUtc: string;
  symbol: string;
  exchange: string;
  side: OrderSide | 'NO_TRADE';
  action: 'EXECUTED' | 'PROPOSED' | 'SKIPPED' | 'BLOCKED';
  reason: string;
  alphaScore?: number;
  expectedValueR?: number;
  tier?: 'CORE_9_GATE' | 'TACTICAL_CONTINUITY';
}

export interface AutoExecutionEngineStatus {
  config: AutoExecutionConfig;
  tradingMode: TradingMode;
  engineRunning: boolean;
  cycleInProgress: boolean;
  lastCycleAtUtc: string | null;
  nextCycleAtUtc: string | null;
  lastScanDurationMs: number | null;
  lastSummary: string;
  tradesExecutedLastHour: number;
  autoTradesTotalCount: number;
  symbolCooldowns: Record<string, string>;
  recentActivity: AutoExecutionActivityEntry[];
  pendingProposals: AutoExecutionProposal[];
}

