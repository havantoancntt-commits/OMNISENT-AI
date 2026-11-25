import { computeAdaptiveConfluenceLiveSnapshot } from './adaptiveConfluence.ts';
import { validateOhlcvConsistency, validateTickerIntegrity } from './dataIntegrity.ts';
import { computeAllIndicators, detectMarketRegime } from './indicators.ts';
import { computeLiquidationRadar, optimizeSlTpWithLiquidationRadar } from './liquidationRadar.ts';
import { computeQuantIntelligenceSnapshot } from './quantIntelligence.ts';
import { evaluateOrderRisk } from './riskEngine.ts';
import { formatAssetPrice, getSmartPriceDecimals } from './symbolSearch.ts';
import type {
  AgentState,
  AgentVote,
  Candle,
  DebateTurn,
  MarketTicker,
  OrderBookSnapshot,
  OrderSide,
  RiskConfig,
  RiskContext,
  TradingSignal,
} from './types.ts';

export function createInitialAgentRegistry(nowIso = new Date().toISOString()): AgentState[] {
  const defs: Array<Pick<AgentState, 'id' | 'name' | 'category' | 'currentTask' | 'dataSource'>> = [
    {
      id: 'MASTER_ORCHESTRATOR',
      name: 'Master AI Orchestrator',
      category: 'ORCHESTRATION',
      currentTask: 'Điều phối đồng thuận đa tác nhân & phân bổ nhiệm vụ',
      dataSource: 'Internal Event Bus',
    },
    {
      id: 'MARKET_DATA',
      name: 'Market Data Agent',
      category: 'DATA',
      currentTask: 'Thu thập Ticker, OHLCV, Funding & Open Interest',
      dataSource: 'Exchange REST/WS Feed',
    },
    {
      id: 'DATA_INTEGRITY',
      name: 'Data Integrity Agent',
      category: 'DATA',
      currentTask: 'Kiểm định freshness, spread, OHLCV & anomaly',
      dataSource: 'Ingestion Stream',
    },
    {
      id: 'MARKET_REGIME',
      name: 'Market Regime Agent',
      category: 'ANALYSIS',
      currentTask: 'Phân loại trạng thái Bull/Bear/Sideways/Panic',
      dataSource: 'OHLCV + Volatility',
    },
    {
      id: 'TECHNICAL_ANALYSIS',
      name: 'Technical Analysis Agent',
      category: 'ANALYSIS',
      currentTask: 'Tính EMA, RSI, MACD, ATR, Supertrend, S/R',
      dataSource: 'Multi-TF Candles',
    },
    {
      id: 'ORDER_BOOK_LIQUIDITY',
      name: 'Order Book & Liquidity Agent',
      category: 'ANALYSIS',
      currentTask: 'Đo độ sâu Bid/Ask, imbalance & ước tính slippage',
      dataSource: 'L2 Order Book',
    },
    {
      id: 'QUANT_AI',
      name: 'Quant AI Agent',
      category: 'ANALYSIS',
      currentTask: 'Đánh giá momentum, mean-reversion & chi phí thực thi',
      dataSource: 'Quant Feature Engine',
    },
    {
      id: 'FUNDAMENTAL_RESEARCH',
      name: 'Fundamental & Token Agent',
      category: 'ANALYSIS',
      currentTask: 'Theo dõi cung lưu thông, unlock & rủi ro niêm yết',
      dataSource: 'Token Registry',
    },
    {
      id: 'ON_CHAIN_INTELLIGENCE',
      name: 'On-Chain Intelligence Agent',
      category: 'ANALYSIS',
      currentTask: 'Giám sát dòng tiền sàn & biến động thanh khoản on-chain',
      dataSource: 'Verified On-Chain Feed',
    },
    {
      id: 'NEWS_SENTIMENT',
      name: 'News & Sentiment Agent',
      category: 'ANALYSIS',
      currentTask: 'Đánh giá sự kiện vĩ mô, ETF & rủi ro bảo mật',
      dataSource: 'Verified News Stream',
    },
    {
      id: 'STRATEGY_GENERATION',
      name: 'AI Strategy Generation Agent',
      category: 'STRATEGY',
      currentTask: 'Thiết kế Entry, SL, TP & horizon theo chế độ thị trường',
      dataSource: 'Agent Consensus',
    },
    {
      id: 'STRATEGY_VALIDATION',
      name: 'AI Strategy Validation Agent',
      category: 'STRATEGY',
      currentTask: 'Kiểm chứng R:R, phí, slippage & chống overfit',
      dataSource: 'Backtest & Paper Ledger',
    },
    {
      id: 'RISK_MANAGEMENT',
      name: 'Risk Management Agent',
      category: 'RISK',
      currentTask: 'Kiểm soát định mức rủi ro, drawdown & cấp quyền lệnh',
      dataSource: 'Deterministic Risk Engine',
    },
    {
      id: 'EXECUTION_AGENT',
      name: 'Execution Agent',
      category: 'EXECUTION',
      currentTask: 'Thực thi lệnh chuẩn quy tắc sàn & chống gửi trùng',
      dataSource: 'Exchange Connector',
    },
    {
      id: 'PORTFOLIO_MANAGEMENT',
      name: 'Portfolio Management Agent',
      category: 'EXECUTION',
      currentTask: 'Theo dõi equity, ký quỹ, tương quan & phân bổ vốn',
      dataSource: 'Portfolio Ledger',
    },
    {
      id: 'POSITION_MONITORING',
      name: 'Position Monitoring Agent',
      category: 'EXECUTION',
      currentTask: 'Giám sát SL/TP, giá thanh lý & funding 24/7',
      dataSource: 'Live Mark Price',
    },
    {
      id: 'EXIT_STRATEGY',
      name: 'Exit Strategy Agent',
      category: 'EXECUTION',
      currentTask: 'Bảo vệ vốn, đề xuất partial exit & trailing stop',
      dataSource: 'Position + Volatility',
    },
    {
      id: 'AI_PERFORMANCE',
      name: 'AI Performance Agent',
      category: 'STRATEGY',
      currentTask: 'Đo Win Rate, Profit Factor, Sharpe & phát hiện suy giảm',
      dataSource: 'Closed Trade Ledger',
    },
    {
      id: 'CYBERSECURITY',
      name: 'Cybersecurity Agent',
      category: 'SECURITY',
      currentTask: 'Mã hóa API Vault, chặn quyền rút tiền & audit logs',
      dataSource: 'Security Perimeter',
    },
  ];

  return defs.map((d) => ({
    ...d,
    status: 'ONLINE',
    lastActivityUtc: nowIso,
    latencyMs: 0,
    healthPct: 100,
    errorCount: 0,
    evalCount: 0,
    lastOutput: 'Sẵn sàng tiếp nhận dữ liệu LIVE trực tiếp từ sàn giao dịch.',
    version: '2.4.0',
    enabled: true,
  }));
}

/**
 * Executes the deterministic 17-step Multi-Agent Decision Engine pipeline
 * for a given symbol using verified OHLCV + Order Book + Risk Engine.
 * Never allows AI votes to bypass Risk Management veto.
 */
export function runMultiAgentDecisionPipeline(params: {
  ticker: MarketTicker;
  candles: Candle[];
  htfCandles?: Candle[];
  orderBook: OrderBookSnapshot;
  riskConfig: RiskConfig;
  riskContext: RiskContext;
  agents: AgentState[];
}): TradingSignal {
  const { ticker, candles, htfCandles, orderBook, riskConfig, riskContext, agents } = params;
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresIso = new Date(now.getTime() + 15 * 60_000).toISOString();

  // Step 1 & 2: Data Integrity Gate (strictly LIVE_EXCHANGE + real L2 depth)
  const tickerReport = validateTickerIntegrity(ticker, now.getTime());
  const ohlcvReport = validateOhlcvConsistency(candles);
  const hasRealBook = orderBook.dataStatus === 'LIVE_EXCHANGE' && orderBook.bids.length > 0 && orderBook.asks.length > 0;
  const spreadBonus = ticker.spreadBps < 5 ? 4 : ticker.spreadBps < 15 ? 2 : 0;
  const dataQualityScore =
    tickerReport.valid && ohlcvReport.valid
      ? 88 + (hasRealBook ? 8 : 0) + spreadBonus
      : 15;

  // Step 3 & 4: Market Regime & Technical Indicators from actual OHLCV
  const indicators = computeAllIndicators(candles);
  const regime = detectMarketRegime(indicators, ticker.lastPrice, ticker.volatility24hPct);

  const isAgentEnabled = (id: AgentState['id']) =>
    agents.find((a) => a.id === id)?.enabled ?? true;
  const dataIntegrityEnabled = isAgentEnabled('DATA_INTEGRITY');
  const marketDataEnabled = isAgentEnabled('MARKET_DATA');
  const techEnabled = isAgentEnabled('TECHNICAL_ANALYSIS');
  const obEnabled = isAgentEnabled('ORDER_BOOK_LIQUIDITY');
  const regimeEnabled = isAgentEnabled('MARKET_REGIME');
  const quantEnabled = isAgentEnabled('QUANT_AI');
  const fundEnabled = isAgentEnabled('FUNDAMENTAL_RESEARCH');
  const sentEnabled = isAgentEnabled('NEWS_SENTIMENT');

  const votes: AgentVote[] = [];
  const conflicts: string[] = [];

  if (!dataIntegrityEnabled || !marketDataEnabled) {
    conflicts.push(
      'Data Integrity hoặc Market Data Agent đang bị tắt — tạm dừng cấp tín hiệu để đảm bảo an toàn dữ liệu.',
    );
  }

  // Technical Analysis Agent vote
  let techScore = 50;
  let techStance: AgentVote['stance'] = 'NEUTRAL';
  if (techEnabled) {
    if (
      (indicators.ema9 > indicators.ema21 &&
        indicators.macd.histogram > 0 &&
        indicators.rsi14 < 72) ||
      (indicators.ema21 > indicators.ema50 &&
        indicators.supertrend.direction === 'BULLISH' &&
        indicators.adx14 >= 18 &&
        indicators.rsi14 >= 42 &&
        indicators.rsi14 < 70)
    ) {
      techScore = 76;
      techStance = 'BULLISH';
    } else if (
      (indicators.ema9 < indicators.ema21 &&
        indicators.macd.histogram < 0 &&
        indicators.rsi14 > 28) ||
      (indicators.ema21 < indicators.ema50 &&
        indicators.supertrend.direction === 'BEARISH' &&
        indicators.adx14 >= 18 &&
        indicators.rsi14 <= 58 &&
        indicators.rsi14 > 30)
    ) {
      techScore = 74;
      techStance = 'BEARISH';
    }
  }
  const pxDec = Math.max(2, getSmartPriceDecimals(ticker.lastPrice) + 2);
  votes.push({
    agentId: 'TECHNICAL_ANALYSIS',
    agentName: 'Technical Analysis Agent',
    stance: techStance,
    score: techScore,
    rationale: techEnabled
      ? `EMA9/21=${indicators.ema9.toFixed(getSmartPriceDecimals(ticker.lastPrice))}/${indicators.ema21.toFixed(getSmartPriceDecimals(ticker.lastPrice))}, RSI14=${indicators.rsi14.toFixed(1)}, ADX=${indicators.adx14.toFixed(1)}, Supertrend=${indicators.supertrend.direction}`
      : 'Agent đang bị tắt — không tham gia biểu quyết hướng lệnh.',
  });

  // Order Book & Liquidity Agent vote (veto on thin/wide spread; directional only on meaningful >28% skew)
  const liqScore = Math.max(
    0,
    Math.min(100, Math.round(ticker.liquidityScore - ticker.spreadBps * 0.8)),
  );
  const obStance: AgentVote['stance'] = !obEnabled
    ? 'NEUTRAL'
    : liqScore < 40 || orderBook.spreadBps > 35
      ? 'VETO'
      : orderBook.imbalanceRatio > 0.28
        ? 'BULLISH'
        : orderBook.imbalanceRatio < -0.28
          ? 'BEARISH'
          : 'NEUTRAL';
  votes.push({
    agentId: 'ORDER_BOOK_LIQUIDITY',
    agentName: 'Order Book & Liquidity Agent',
    stance: obStance,
    score: obEnabled ? liqScore : 50,
    rationale: obEnabled
      ? `Imbalance=${(orderBook.imbalanceRatio * 100).toFixed(1)}%, Spread=${orderBook.spreadBps.toFixed(2)} bps, Liquidity=${liqScore}/100`
      : 'Agent đang bị tắt — không tham gia biểu quyết thanh khoản.',
  });

  // Market Regime Agent vote
  const regimeStance: AgentVote['stance'] = !regimeEnabled
    ? 'NEUTRAL'
    : regime === 'PANIC_MARKET' || regime === 'LIQUIDITY_CRISIS' || regime === 'UNKNOWN_REGIME'
      ? 'VETO'
      : regime.includes('BULL') || regime === 'BREAKOUT'
        ? 'BULLISH'
        : regime.includes('BEAR')
          ? 'BEARISH'
          : 'NEUTRAL';
  votes.push({
    agentId: 'MARKET_REGIME',
    agentName: 'Market Regime Agent',
    stance: regimeStance,
    score: !regimeEnabled ? 50 : regimeStance === 'VETO' ? 25 : 72,
    rationale: regimeEnabled
      ? `Phân loại chế độ thị trường: ${regime} (Vol 24h=${ticker.volatility24hPct.toFixed(2)}%)`
      : 'Agent đang bị tắt — bỏ qua đánh giá chế độ thị trường.',
  });

  // Quant AI Agent vote — powered by Adaptive Confluence Alpha v4 (1H + 4H Multi-Timeframe)
  const quantAlpha = quantEnabled
    ? computeAdaptiveConfluenceLiveSnapshot({
        candles,
        htfCandles,
        indicators,
        regime,
        marketType: ticker.marketType,
        orderBook,
      })
    : undefined;
  const quantEdge = quantAlpha
    ? Math.max(
        quantAlpha.confluenceScore,
        indicators.adx14 >= 22 && ticker.spreadBps < 25 && liqScore >= 55 ? 68 : 42,
      )
    : 50;
  const quantStance: AgentVote['stance'] = !quantAlpha
    ? 'NEUTRAL'
    : quantAlpha.direction === 'LONG'
      ? 'BULLISH'
      : quantAlpha.direction === 'SHORT'
        ? 'BEARISH'
        : quantAlpha.confluenceScore >= 64 &&
            indicators.adx14 >= 22 &&
            ticker.spreadBps < 25 &&
            liqScore >= 55 &&
            quantAlpha.htfAlignment !== 'COUNTER_TREND'
          ? indicators.supertrend.direction === 'BULLISH'
            ? 'BULLISH'
            : 'BEARISH'
          : 'NEUTRAL';
  const htfTag = quantAlpha?.htfAlignment ? `, 4H=${quantAlpha.htfAlignment}` : '';
  votes.push({
    agentId: 'QUANT_AI',
    agentName: 'Quant AI Agent',
    stance: quantStance,
    score: quantEdge,
    rationale: quantAlpha
      ? `Adaptive Alpha v4 (${quantAlpha.regimeMode}): Confluence=${quantAlpha.confluenceScore}/100 (${quantAlpha.passedFactors}/${quantAlpha.totalFactors} factors${htfTag}), EV=${(quantAlpha.expectedValueR ?? 0) >= 0 ? '+' : ''}${quantAlpha.expectedValueR ?? 0}R, ADX=${indicators.adx14.toFixed(1)}.`
      : 'Agent đang bị tắt — không tham gia biểu quyết định lượng.',
  });

  // Fundamental & Sentiment Agents (conservative neutral unless clear signal)
  const fundamentalScore = ticker.volume24hUsd > 50_000_000 ? 78 : 55;
  const sentimentScore =
    ticker.fundingRatePct !== null && Math.abs(ticker.fundingRatePct) > 0.08
      ? 42
      : 62;
  votes.push({
    agentId: 'FUNDAMENTAL_RESEARCH',
    agentName: 'Fundamental & Token Agent',
    stance: !fundEnabled ? 'NEUTRAL' : ticker.tradingStatus === 'TRADING' ? 'NEUTRAL' : 'VETO',
    score: fundEnabled ? fundamentalScore : 50,
    rationale: fundEnabled
      ? `Trạng thái sàn=${ticker.tradingStatus}, KL 24h=$${(ticker.volume24hUsd / 1e6).toFixed(1)}M (${ticker.exchange}).`
      : 'Agent đang bị tắt.',
  });
  votes.push({
    agentId: 'NEWS_SENTIMENT',
    agentName: 'Sentiment & Funding Agent',
    stance: 'NEUTRAL',
    score: sentEnabled ? sentimentScore : 50,
    rationale: !sentEnabled
      ? 'Agent đang bị tắt.'
      : ticker.fundingRatePct !== null
        ? `Funding thực tế=${ticker.fundingRatePct.toFixed(4)}% (chưa có dấu hiệu quá nóng đòn bẩy).`
        : 'Thị trường Spot — không áp dụng Funding Rate.',
  });

  // Conflict Detection (only treat true core/regime conflicts as blocking, not mild resting L2 walls)
  const bullVotes = votes.filter((v) => v.stance === 'BULLISH').length;
  const bearVotes = votes.filter((v) => v.stance === 'BEARISH').length;
  const vetos = votes.filter((v) => v.stance === 'VETO');
  const coreBullBearConflict =
    (techStance === 'BULLISH' && quantStance === 'BEARISH') ||
    (techStance === 'BEARISH' && quantStance === 'BULLISH');
  const extremeBookAgainstBull = obStance === 'BEARISH' && orderBook.imbalanceRatio <= -0.45;
  const extremeBookAgainstBear = obStance === 'BULLISH' && orderBook.imbalanceRatio >= 0.45;

  if (coreBullBearConflict || (bullVotes > 0 && bearVotes > 0 && bullVotes === bearVotes)) {
    conflicts.push(
      `Xung đột tín hiệu giữa nhóm Bullish (${bullVotes} agent) và Bearish (${bearVotes} agent).`,
    );
  }
  if (!tickerReport.valid || !ohlcvReport.valid) {
    conflicts.push(
      `Cảnh báo Data Integrity: ${[...tickerReport.anomalies, ...ohlcvReport.anomalies].join(', ')}`,
    );
  }
  if (vetos.length > 0) {
    conflicts.push(`Veto từ: ${vetos.map((v) => v.agentName).join(', ')}`);
  }

  // Master Orchestrator Direction Synthesis (weighted consensus without resting L2 noise deadlock)
  let direction: OrderSide | 'NO_TRADE' = 'NO_TRADE';
  const riskAgentEnabled = isAgentEnabled('RISK_MANAGEMENT');

  if (
    vetos.length === 0 &&
    tickerReport.valid &&
    ohlcvReport.valid &&
    dataIntegrityEnabled &&
    marketDataEnabled &&
    !coreBullBearConflict
  ) {
    const netBullVotes = bullVotes - bearVotes;
    const quantLongSupported =
      quantAlpha?.direction === 'LONG' &&
      techStance !== 'BEARISH' &&
      !extremeBookAgainstBull;
    const quantShortSupported =
      ticker.marketType !== 'SPOT' &&
      quantAlpha?.direction === 'SHORT' &&
      techStance !== 'BULLISH' &&
      !extremeBookAgainstBear;

    if ((bullVotes >= 2 && (bearVotes === 0 || netBullVotes >= 1) && !extremeBookAgainstBull) || quantLongSupported) {
      direction = 'LONG';
    } else if (
      ticker.marketType !== 'SPOT' &&
      ((bearVotes >= 2 && (bullVotes === 0 || -netBullVotes >= 1) && !extremeBookAgainstBear) || quantShortSupported)
    ) {
      direction = 'SHORT';
    }
  }

  const entry = ticker.lastPrice;
  const atr = Math.max(indicators.atr14, entry * 0.01);
  const alphaActive = quantAlpha && quantAlpha.direction === direction && direction !== 'NO_TRADE';
  const stopDist = atr * (alphaActive ? quantAlpha.stopAtrMult : 1.5);
  const tpDist = alphaActive
    ? Math.max(atr * quantAlpha.tpAtrMult, stopDist * Math.max(1.6, riskConfig.minRiskReward))
    : stopDist * Math.max(1.8, riskConfig.minRiskReward);

  const roundPx = (val: number) => Number(val.toFixed(pxDec));
  const rawStopLoss =
    direction === 'SHORT'
      ? roundPx(entry + stopDist)
      : roundPx(Math.max(entry * 0.5, entry - stopDist));
  const rawTp2 =
    direction === 'SHORT'
      ? roundPx(Math.max(entry * 0.1, entry - tpDist))
      : roundPx(entry + tpDist);

  const radar = computeLiquidationRadar({
    candles,
    orderBook,
    ticker,
    atr14: atr,
    riskConfig,
  });

  const radarOptimization =
    direction === 'NO_TRADE'
      ? null
      : optimizeSlTpWithLiquidationRadar({
          side: direction,
          entryPrice: entry,
          stopLoss: rawStopLoss,
          takeProfit: rawTp2,
          atr14: atr,
          minRiskReward: riskConfig.minRiskReward,
          radar,
        });

  const stopLoss = radarOptimization ? radarOptimization.stopLoss : rawStopLoss;
  const tp2 = radarOptimization ? radarOptimization.takeProfit : rawTp2;
  const finalTpDist = Math.abs(tp2 - entry);
  const tp1 =
    direction === 'SHORT'
      ? roundPx(Math.max(entry * 0.2, entry - finalTpDist * 0.65))
      : roundPx(entry + finalTpDist * 0.65);

  const leverage = ticker.marketType === 'SPOT' ? 1 : Math.min(riskConfig.defaultLeverage, riskConfig.maxLeverage);
  const signalId = `SIG-${ticker.symbol.replace(/[^A-Z0-9]/g, '')}-${now.getTime()}`;

  const htfAligned =
    quantAlpha?.htfAlignment === 'ALIGNED_BULL' || quantAlpha?.htfAlignment === 'ALIGNED_BEAR';
  const convictionRiskPct =
    direction === 'NO_TRADE' || !quantAlpha
      ? riskConfig.riskPerTradePct
      : Math.max(
          Math.min(riskConfig.riskPerTradePct * 0.75, riskConfig.maxRiskPerTradePct),
          Math.min(
            riskConfig.maxRiskPerTradePct,
            Number(
              (
                riskConfig.riskPerTradePct *
                (quantAlpha.confluenceScore >= 82 && htfAligned
                  ? 1.35
                  : quantAlpha.confluenceScore >= 72
                    ? 1.05
                    : 0.85)
              ).toFixed(2),
            ),
          ),
        );

  // Step 12: Mandatory Deterministic Risk Management Evaluation (bounded strictly <= maxRiskPerTradePct)
  const riskCheck = evaluateOrderRisk(
    {
      symbol: ticker.symbol,
      exchange: ticker.exchange,
      marketType: ticker.marketType,
      side: direction === 'SHORT' ? 'SHORT' : 'LONG',
      orderType: 'LIMIT',
      entryPrice: entry,
      stopLoss,
      takeProfit: tp2,
      leverage,
      riskPctOverride: convictionRiskPct,
      strategyName: `Multi-Agent ${regime}`,
      idempotencyKey: signalId,
      dataStatus: ticker.dataStatus,
      tradingStatus: ticker.tradingStatus,
    },
    riskConfig,
    riskContext,
  );

  const htfScoreBoost = htfAligned
    ? 4
    : quantAlpha?.htfAlignment === 'COUNTER_TREND'
      ? -7
      : 0;
  const rawConfidence = Math.round(
    techScore * 0.3 +
      liqScore * 0.25 +
      quantEdge * 0.25 +
      dataQualityScore * 0.2 +
      htfScoreBoost -
      conflicts.length * 14,
  );
  const confidenceScore = Math.max(0, Math.min(95, rawConfidence));

  let state: TradingSignal['state'] = 'ANALYZING';
  if (direction === 'NO_TRADE' || !riskAgentEnabled) {
    state = 'REJECTED';
  } else if (!riskCheck.approved) {
    state = 'REJECTED';
  } else {
    state = 'APPROVED';
  }

  const precisionTier: TradingSignal['precisionTier'] =
    state === 'APPROVED' && confidenceScore >= 70 && conflicts.length === 0
      ? 'HIGH_CONVICTION'
      : state === 'APPROVED'
        ? 'MODERATE'
        : 'REJECTED_PRESERVE_CAPITAL';

  // --- Adversarial Multi-Robot Debate Transcript (7 structured turns) ---
  const imbalancePct = (orderBook.imbalanceRatio * 100).toFixed(1);
  const debateRounds: DebateTurn[] = [
    {
      step: 1,
      phase: 'PROPOSE',
      speakerId: 'TECHNICAL_ANALYSIS',
      speakerName: 'Technical Analysis Robot',
      speakerRole: 'Phân tích cấu trúc giá',
      targetId: 'QUANT_AI',
      targetName: 'Quant AI Robot',
      stance: techStance,
      confidenceDelta: techStance === 'NEUTRAL' ? 0 : 12,
      argument:
        techStance === 'BULLISH'
          ? `Đề xuất kịch bản LONG ${ticker.symbol}: EMA9 (${formatAssetPrice(indicators.ema9)}) cắt lên EMA21 (${formatAssetPrice(indicators.ema21)}), MACD histogram dương và Supertrend giữ hướng BULLISH.`
          : techStance === 'BEARISH'
            ? `Đề xuất kịch bản SHORT ${ticker.symbol}: EMA9 dưới EMA21 kèm động lượng MACD âm, lực bán kiểm soát khung 1H.`
            : `Cấu trúc kỹ thuật ${ticker.symbol} đang trung tính (RSI=${indicators.rsi14.toFixed(1)}), chưa có giao cắt xác nhận rõ nét.`,
      evidenceMetric: `EMA9/21 ${formatAssetPrice(indicators.ema9)}/${formatAssetPrice(indicators.ema21)} · RSI ${indicators.rsi14.toFixed(1)}`,
    },
    {
      step: 2,
      phase: 'CHALLENGE',
      speakerId: 'ORDER_BOOK_LIQUIDITY',
      speakerName: 'Order Book & Liquidity Robot',
      speakerRole: 'Phản biện thanh khoản L2',
      targetId: 'TECHNICAL_ANALYSIS',
      targetName: 'Technical Analysis Robot',
      stance: obStance,
      confidenceDelta: obStance === 'VETO' ? -25 : obStance === techStance ? 8 : -7,
      argument:
        obStance === 'VETO'
          ? `Phản đối! Thanh khoản sổ lệnh quá mỏng (${liqScore}/100) hoặc spread giãn ${orderBook.spreadBps.toFixed(2)} bps, trượt giá sẽ ăn mòn toàn bộ lợi thế kỹ thuật.`
          : techStance === 'BULLISH' && orderBook.imbalanceRatio < 0
            ? `Phản biện: Dù biểu đồ tăng, sổ lệnh L2 đang lệch phía Ask (${imbalancePct}%), cần thận trọng tường bán chặn vùng ${formatAssetPrice(entry * 1.003)}.`
            : `Kiểm chứng L2 & Radar Thanh Lý: Spread ${orderBook.spreadBps.toFixed(2)} bps (${imbalancePct}% imbalance), Stop-Hunt Risk ${radar.stopHuntRiskScore}/100 (${radarOptimization && (radarOptimization.slAdjusted || radarOptimization.tpAdjusted) ? radarOptimization.note : 'SL đặt ngoài vùng quét thanh khoản'}).`,
      evidenceMetric: `Spread ${orderBook.spreadBps.toFixed(2)} bps · LiQ Risk ${radar.stopHuntRiskScore}/100`,
    },
    {
      step: 3,
      phase: 'CHALLENGE',
      speakerId: 'MARKET_REGIME',
      speakerName: 'Market Regime Robot',
      speakerRole: 'Kiểm định bối cảnh vĩ mô',
      targetId: 'QUANT_AI',
      targetName: 'Quant AI Robot',
      stance: regimeStance,
      confidenceDelta: regimeStance === 'VETO' ? -30 : regimeStance === 'NEUTRAL' ? -6 : 9,
      argument:
        regimeStance === 'VETO'
          ? `Cảnh báo khẩn: Thị trường rơi vào chế độ ${regime} (biến động ${ticker.volatility24hPct.toFixed(2)}%), yêu cầu đình chỉ mở vị thế mới!`
          : regime === 'SIDEWAYS' || regime === 'LOW_VOLATILITY'
            ? `Phản biện: Thị trường đang ở pha ${regime}, các tín hiệu phá vỡ rất dễ thành bẫy thanh khoản (fake breakout).`
            : `Xác nhận bối cảnh ${regime} ủng hộ giao dịch theo xu hướng với biến động 24h ở mức ${ticker.volatility24hPct.toFixed(2)}%.`,
      evidenceMetric: `Regime ${regime} · Vol24h ${ticker.volatility24hPct.toFixed(2)}%`,
    },
    {
      step: 4,
      phase: 'CHALLENGE',
      speakerId: 'NEWS_SENTIMENT',
      speakerName: 'Sentiment & Funding Robot',
      speakerRole: 'Giám sát hưng phấn & Funding',
      targetId: 'STRATEGY_GENERATION',
      targetName: 'Strategy Generation Robot',
      stance:
        indicators.rsi14 > 68 && techStance === 'BULLISH'
          ? 'BEARISH'
          : indicators.rsi14 < 32 && techStance === 'BEARISH'
            ? 'BULLISH'
            : 'NEUTRAL',
      confidenceDelta: indicators.rsi14 > 68 || indicators.rsi14 < 32 ? -8 : 3,
      argument:
        indicators.rsi14 > 68
          ? `Phản biện quá mua: RSI14 chạm ${indicators.rsi14.toFixed(1)}, không nên FOMO mua đuổi tại đỉnh sóng — yêu cầu lùi Entry hoặc siết khối lượng.`
          : ticker.fundingRatePct !== null && Math.abs(ticker.fundingRatePct) > 0.05
            ? `Cảnh báo đòn bẩy đông đúc: Funding Rate đạt ${ticker.fundingRatePct.toFixed(4)}%, rủi ro quét thanh lý hai đầu tăng cao.`
            : `Tâm lý thị trường cân bằng (${ticker.fundingRatePct !== null ? `Funding ${ticker.fundingRatePct.toFixed(4)}%` : 'Spot 1x'}), không có dấu hiệu FOMO cực đoan.`,
      evidenceMetric: `RSI ${indicators.rsi14.toFixed(1)} · Funding ${ticker.fundingRatePct !== null ? `${ticker.fundingRatePct.toFixed(4)}%` : 'N/A'}`,
    },
    {
      step: 5,
      phase: 'REBUTTAL',
      speakerId: 'QUANT_AI',
      speakerName: 'Quant AI Robot',
      speakerRole: 'Trọng tài thống kê & Chi phí',
      targetId: 'ORDER_BOOK_LIQUIDITY',
      targetName: 'Order Book & Liquidity Robot',
      stance: quantStance,
      confidenceDelta: quantEdge >= 68 ? 12 : quantEdge >= 58 ? 4 : -5,
      argument: quantAlpha && quantAlpha.direction !== 'NO_TRADE'
        ? `Adaptive Confluence Alpha v4 (${quantAlpha.regimeMode}): Đạt ${quantAlpha.confluenceScore}/100 điểm (${quantAlpha.passedFactors}/5 nhân tố đồng pha), đặt SL ${quantAlpha.stopAtrMult}x ATR & kích hoạt bảo vệ hòa vốn +${quantAlpha.breakevenTriggerR}R với R:R=${riskCheck.riskRewardRatio}x.`
        : quantEdge >= 65
          ? `Phản hồi & Tinh chỉnh: ADX14 đạt ${indicators.adx14.toFixed(1)} kèm Confluence ${quantAlpha?.confluenceScore ?? quantEdge}/100; kỳ vọng R:R=${riskCheck.riskRewardRatio}x đủ bù chi phí ~13 bps.`
          : `Nhượng bộ phản biện: Confluence ${quantAlpha?.confluenceScore ?? 50}/100 & ADX14=${indicators.adx14.toFixed(1)} chưa đủ hội tụ 5 lớp, ưu tiên giữ vốn với SL ${formatAssetPrice(stopLoss)}.`,
      evidenceMetric: `Confluence ${quantAlpha?.confluenceScore ?? quantEdge}/100 · R:R ${riskCheck.riskRewardRatio}x`,
    },
    {
      step: 6,
      phase:
        !riskAgentEnabled || !riskCheck.approved || direction === 'NO_TRADE'
          ? 'VETO'
          : 'REBUTTAL',
      speakerId: 'RISK_MANAGEMENT',
      speakerName: 'Risk Management Enforcer',
      speakerRole: 'Kiểm soát rủi ro độc lập AI',
      targetId: 'MASTER_ORCHESTRATOR',
      targetName: 'Master AI Orchestrator',
      stance:
        !riskAgentEnabled || !riskCheck.approved
          ? 'VETO'
          : 'NEUTRAL',
      confidenceDelta: !riskAgentEnabled || !riskCheck.approved ? -40 : direction === 'NO_TRADE' ? 0 : 10,
      argument: !riskAgentEnabled
        ? 'VETO BẮT BUỘC: Risk Management Agent đang tắt — hệ thống từ chối cấp quyền giao dịch.'
        : !riskCheck.approved
          ? `PHỦ QUYẾT (VETO): ${riskCheck.reasons[0] ?? 'Vi phạm giới hạn an toàn vốn.'}`
          : direction === 'NO_TRADE'
            ? `ĐỨNG NGOÀI (STANDBY): Hội đồng AI chưa có đề xuất hướng lệnh đồng thuận (${ticker.symbol}) — Risk Enforcer giữ nguyên trạng thái bảo toàn vốn.`
            : `Phê duyệt định mức ${direction}: KL=${riskCheck.recommendedQuantity} ${ticker.baseAsset} (Rủi ro ${riskCheck.estimatedRiskPct}% <= ${riskConfig.maxRiskPerTradePct}%, Ký quỹ $${riskCheck.requiredMarginUsd}, Đòn bẩy ${leverage}x).`,
      evidenceMetric:
        direction === 'NO_TRADE' && riskCheck.approved && riskAgentEnabled
          ? `STANDBY · Bảo toàn 100% vốn`
          : `Risk ${riskCheck.estimatedRiskPct}% · ${riskCheck.decision}`,
    },
    {
      step: 7,
      phase: 'VERDICT',
      speakerId: 'MASTER_ORCHESTRATOR',
      speakerName: 'Master AI Orchestrator',
      speakerRole: 'Tổng hợp kết luận cuối cùng',
      targetId: 'EXECUTION_AGENT',
      targetName: 'Execution Robot',
      stance:
        state === 'APPROVED'
          ? direction === 'LONG'
            ? 'BULLISH'
            : 'BEARISH'
          : 'VETO',
      confidenceDelta: 0,
      argument:
        state === 'APPROVED'
          ? `KẾT LUẬN ĐỒNG THUẬN (${precisionTier}): Thực thi ${direction} ${ticker.symbol} quanh ${formatAssetPrice(entry)}, SL ${formatAssetPrice(stopLoss)}, TP ${formatAssetPrice(tp2)} (R:R ${riskCheck.riskRewardRatio}x, Độ tin cậy ${confidenceScore}/100).`
          : `KẾT LUẬN BẢO TOÀN VỐN (NO_TRADE): Tạm dừng giao dịch ${ticker.symbol} vì ${conflicts[0] ?? riskCheck.reasons[0] ?? 'chưa đủ đồng thuận đa tác nhân'}.`,
      evidenceMetric: `State ${state} · Conf ${confidenceScore}/100`,
    },
  ];

  const evR =
    quantAlpha?.expectedValueR ??
    Number((riskCheck.riskRewardRatio * 0.45 - 0.55 - 0.06).toFixed(2));
  const estWinProb =
    quantAlpha
      ? Math.max(0.28, Math.min(0.74, (evR + 1.06) / Math.max(1.2, riskCheck.riskRewardRatio + 1)))
      : Math.max(0.28, Math.min(0.7, confidenceScore / 135));

  const quantIntel = computeQuantIntelligenceSnapshot({
    candles,
    orderBook,
    ticker,
    winProbability: estWinProb,
    riskReward: Math.max(1.1, riskCheck.riskRewardRatio),
    riskConfig,
    accountEquityUsd: riskContext.accountEquityUsd,
  });

  return {
    id: signalId,
    symbol: ticker.symbol,
    exchange: ticker.exchange,
    marketType: ticker.marketType,
    direction,
    entryRange: [roundPx(entry * 0.999), roundPx(entry * 1.001)],
    stopLoss,
    takeProfitLevels: [tp1, tp2],
    positionSizeQty: riskCheck.recommendedQuantity,
    leverage,
    riskUsd: riskCheck.estimatedRiskUsd,
    rewardUsd: Number((riskCheck.estimatedRiskUsd * riskCheck.riskRewardRatio).toFixed(2)),
    riskReward: riskCheck.riskRewardRatio,
    timeHorizon: '4H – 1D Intraday/Swing',
    marketRegime: regime,
    technicalScore: techScore,
    quantScore: quantEdge,
    liquidityScore: liqScore,
    fundamentalScore,
    sentimentScore,
    dataQualityScore,
    riskScore: riskCheck.approved ? 85 : 15,
    confidenceScore,
    calibratedProbabilityNote:
      'Điểm tổng hợp chưa hiệu chuẩn xác suất thắng — dùng Gemini Decisions API để hiệu chuẩn xác suất thực & Risk Engine kiểm duyệt độc lập.',
    strategyName:
      direction === 'NO_TRADE'
        ? 'No-Trade Capital Preservation'
        : quantAlpha && quantAlpha.direction === direction
          ? `Adaptive Confluence Alpha v4 (${quantAlpha.regimeMode})`
          : `${regime} Consensus Setup`,
    reasoningSummary:
      direction === 'NO_TRADE'
        ? `Không kích hoạt giao dịch do ${conflicts.length > 0 ? conflicts.join(' ') : 'chưa đủ đồng thuận đa tác nhân'}.`
        : `Đồng thuận ${direction} từ Technical (${techScore}) & Adaptive Alpha v4 (${quantEdge}/100${quantAlpha?.htfAlignment ? `, 4H ${quantAlpha.htfAlignment}` : ''}) · Hurst H=${quantIntel.hurst.hurstExponent} · Radar ${radarOptimization && (radarOptimization.slAdjusted || radarOptimization.tpAdjusted) ? radarOptimization.note : 'Zero-Stop-Hunt SL/TP'} · Kelly ${quantIntel.kelly.quarterKellyPct}% trên ${ticker.symbol}.`,
    conflictsDetected: conflicts,
    agentVotes: votes,
    debateRounds,
    precisionTier,
    dataSource: ticker.dataStatus,
    timestampUtc: nowIso,
    expiresAtUtc: expiresIso,
    state,
    riskCheck,
    quantAlpha,
    quantIntel,
    htfAlignment: quantAlpha?.htfAlignment ?? 'NEUTRAL',
    expectedValueR: evR,
    recommendedRiskPct: convictionRiskPct,
  };
}
