import {
  buildConfluenceSeries,
  evaluateAdaptiveConfluenceAtBar,
  STRATEGY_CATALOG,
} from './adaptiveConfluence.ts';
import {
  calculateATR,
  calculateBollingerBands,
  calculateEMA,
  calculateRSI,
  calculateSupertrend,
} from './indicators.ts';
import { getSmartPriceDecimals } from './symbolSearch.ts';
import type {
  BacktestConfig,
  BacktestOptimizationResult,
  BacktestResult,
  BacktestStrategyId,
  BacktestTrade,
  Candle,
  EquityPoint,
  OptimizationCandidateSummary,
  OrderSide,
  StrategyBenchmarkEntry,
  StrategyBenchmarkResult,
} from './types.ts';

export function getTimeframeHours(timeframe: string): number {
  const tf = timeframe.trim().toLowerCase();
  const match = tf.match(/^(\d+)([mhdw])$/);
  if (!match) return 1;
  const n = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(n) || n <= 0) return 1;
  if (unit === 'm') return n / 60;
  if (unit === 'h') return n;
  if (unit === 'd') return n * 24;
  if (unit === 'w') return n * 24 * 7;
  return 1;
}

function computeStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Deterministic seeded PRNG for reproducible Monte Carlo trade bootstrapping.
 */
function createSeededRand(seedInput: number): () => number {
  let s = seedInput >>> 0 || 1337;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function runBacktest(
  candles: Candle[],
  config: BacktestConfig,
  dataSourceLabel: string,
): BacktestResult {
  if (candles.length < 40) {
    throw new Error('Cần tối thiểu 40 cây nến OHLCV để chạy kiểm thử chiến lược.');
  }

  const closes = candles.map((c) => c.close);
  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const rsi14 = calculateRSI(closes, 14);
  const bb = calculateBollingerBands(closes, 20, 2);
  const atr14 = calculateATR(candles, 14);
  const supertrend = calculateSupertrend(candles, 10, 3);

  const confluenceSeries =
    config.strategyId === 'ADAPTIVE_CONFLUENCE_ALPHA'
      ? buildConfluenceSeries(candles)
      : null;

  const feeRate = Math.max(0, config.feeRateBps) / 10_000;
  const slippageRate = Math.max(0, config.slippageBps) / 10_000;
  const leverage = config.marketType === 'SPOT' ? 1 : Math.max(1, config.leverage);
  const barHours = getTimeframeHours(config.timeframe);

  let equity = config.initialCapitalUsd;
  let peakEquity = equity;
  let maxDrawdownPct = 0;

  let totalFeesUsd = 0;
  let totalFundingUsd = 0;

  interface ActiveTrade {
    side: OrderSide;
    entryTime: number;
    entryPrice: number;
    peakPrice: number;
    quantity: number;
    stopLoss: number;
    takeProfit: number;
    initialStopDist: number;
    breakevenArmed: boolean;
    entryFeeUsd: number;
    barsHeld: number;
  }

  let active: ActiveTrade | null = null;
  let pendingSignal: {
    side: OrderSide;
    stopAtrMult: number;
    tpAtrMult: number;
  } | null = null;

  const trailingEnabled =
    config.useTrailingProfitLock ?? config.strategyId === 'ADAPTIVE_CONFLUENCE_ALPHA';

  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];
  const barReturns: number[] = [];
  let tradeIdCounter = 1;

  for (let i = 25; i < candles.length; i++) {
    const bar = candles[i];
    const prevEquity = equity;
    const barAtr =
      Number.isFinite(atr14[i - 1]) && atr14[i - 1] > 0
        ? atr14[i - 1]
        : bar.open * 0.015;

    // 1. Execute any pending signal from previous bar's close at this bar's open (zero look-ahead)
    if (pendingSignal && !active) {
      const atr = barAtr;
      const rawEntry = bar.open;
      const entryPrice =
        pendingSignal.side === 'LONG'
          ? rawEntry * (1 + slippageRate)
          : rawEntry * (1 - slippageRate);

      const stopDist = Math.max(atr * pendingSignal.stopAtrMult, entryPrice * 0.005);
      const tpDist = Math.max(atr * pendingSignal.tpAtrMult, stopDist * 1.5);

      const stopLoss =
        pendingSignal.side === 'LONG' ? entryPrice - stopDist : entryPrice + stopDist;
      const takeProfit =
        pendingSignal.side === 'LONG' ? entryPrice + tpDist : entryPrice - tpDist;

      const riskBudget = equity * (config.riskPerTradePct / 100);
      const effectiveStop = stopDist + entryPrice * (feeRate * 2 + slippageRate);
      let quantity = riskBudget / effectiveStop;
      const maxNotional = equity * leverage * 0.9;
      if (quantity * entryPrice > maxNotional) {
        quantity = maxNotional / entryPrice;
      }

      if (quantity * entryPrice >= 10) {
        const entryFeeUsd = quantity * entryPrice * feeRate;
        active = {
          side: pendingSignal.side,
          entryTime: bar.timestamp,
          entryPrice,
          peakPrice: entryPrice,
          quantity,
          stopLoss,
          takeProfit,
          initialStopDist: stopDist,
          breakevenArmed: false,
          entryFeeUsd,
          barsHeld: 0,
        };
      }
      pendingSignal = null;
    }

    // 2. Manage open position on current bar with causal 3-stage Chandelier Profit-Lock
    if (active) {
      active.barsHeld += 1;
      let exitPrice: number | null = null;
      let exitReason: BacktestTrade['exitReason'] | null = null;

      if (active.side === 'LONG') {
        if (bar.low <= active.stopLoss) {
          exitPrice = active.stopLoss * (1 - slippageRate);
          exitReason = active.breakevenArmed ? 'BREAKEVEN_TRAIL' : 'STOP_LOSS';
        } else if (bar.high >= active.takeProfit) {
          exitPrice = active.takeProfit * (1 - slippageRate);
          exitReason = 'TAKE_PROFIT';
        } else if (trailingEnabled) {
          if (bar.high > active.peakPrice) active.peakPrice = bar.high;
          const gainDist = active.peakPrice - active.entryPrice;
          if (gainDist >= active.initialStopDist * 1.65) {
            const chandelier = Math.max(
              active.entryPrice + active.initialStopDist * 0.85,
              active.peakPrice - barAtr * 1.05,
            );
            if (chandelier > active.stopLoss) {
              active.breakevenArmed = true;
              active.stopLoss = chandelier;
            }
          } else if (gainDist >= active.initialStopDist * 1.15) {
            const stepStop = active.entryPrice + active.initialStopDist * 0.58;
            if (stepStop > active.stopLoss) {
              active.breakevenArmed = true;
              active.stopLoss = stepStop;
            }
          } else if (
            !active.breakevenArmed &&
            gainDist >= active.initialStopDist * 0.65
          ) {
            // Arm +0.65R Breakeven Protection (+0.18R) for subsequent bars (strictly causal)
            active.breakevenArmed = true;
            active.stopLoss = active.entryPrice + active.initialStopDist * 0.18;
          }
        }
      } else {
        if (bar.high >= active.stopLoss) {
          exitPrice = active.stopLoss * (1 + slippageRate);
          exitReason = active.breakevenArmed ? 'BREAKEVEN_TRAIL' : 'STOP_LOSS';
        } else if (bar.low <= active.takeProfit) {
          exitPrice = active.takeProfit * (1 + slippageRate);
          exitReason = 'TAKE_PROFIT';
        } else if (trailingEnabled) {
          if (bar.low < active.peakPrice) active.peakPrice = bar.low;
          const gainDist = active.entryPrice - active.peakPrice;
          if (gainDist >= active.initialStopDist * 1.65) {
            const chandelier = Math.min(
              active.entryPrice - active.initialStopDist * 0.85,
              active.peakPrice + barAtr * 1.05,
            );
            if (chandelier < active.stopLoss) {
              active.breakevenArmed = true;
              active.stopLoss = chandelier;
            }
          } else if (gainDist >= active.initialStopDist * 1.15) {
            const stepStop = active.entryPrice - active.initialStopDist * 0.58;
            if (stepStop < active.stopLoss) {
              active.breakevenArmed = true;
              active.stopLoss = stepStop;
            }
          } else if (
            !active.breakevenArmed &&
            gainDist >= active.initialStopDist * 0.65
          ) {
            active.breakevenArmed = true;
            active.stopLoss = active.entryPrice - active.initialStopDist * 0.18;
          }
        }
      }

      // Close at end of series if still open on final bar
      if (!exitPrice && i === candles.length - 1) {
        exitPrice =
          active.side === 'LONG'
            ? bar.close * (1 - slippageRate)
            : bar.close * (1 + slippageRate);
        exitReason = 'END_OF_SERIES';
      }

      if (exitPrice !== null && exitReason !== null) {
        const exitFeeUsd = active.quantity * exitPrice * feeRate;
        const feesUsd = active.entryFeeUsd + exitFeeUsd;
        const grossPnlUsd =
          active.side === 'LONG'
            ? (exitPrice - active.entryPrice) * active.quantity
            : (active.entryPrice - exitPrice) * active.quantity;

        const fundingPeriods =
          config.marketType === 'SPOT' ? 0 : Math.floor((active.barsHeld * barHours) / 8);
        // Positive funding rate: LONG pays (+cost), SHORT receives (-cost). Negative rate: reversed.
        const fundingDirectionSign = active.side === 'LONG' ? 1 : -1;
        const fundingUsd =
          active.quantity *
          active.entryPrice *
          (config.fundingRatePer8hPct / 100) *
          fundingPeriods *
          fundingDirectionSign;

        const netPnlUsd = grossPnlUsd - feesUsd - fundingUsd;
        const notional = active.quantity * active.entryPrice;
        const returnPct = notional > 0 ? (netPnlUsd / (notional / leverage)) * 100 : 0;

        equity = Math.max(0, equity + netPnlUsd);
        totalFeesUsd += feesUsd;
        totalFundingUsd += fundingUsd;

        const entryDec = getSmartPriceDecimals(active.entryPrice);
        const exitDec = getSmartPriceDecimals(exitPrice);
        trades.push({
          id: tradeIdCounter++,
          side: active.side,
          entryTime: active.entryTime,
          exitTime: bar.timestamp,
          entryPrice: Number(active.entryPrice.toFixed(entryDec)),
          exitPrice: Number(exitPrice.toFixed(exitDec)),
          quantity: Number(active.quantity.toFixed(6)),
          grossPnlUsd: Number(grossPnlUsd.toFixed(2)),
          feesUsd: Number(feesUsd.toFixed(2)),
          fundingUsd: Number(fundingUsd.toFixed(2)),
          netPnlUsd: Number(netPnlUsd.toFixed(2)),
          returnPct: Number(returnPct.toFixed(2)),
          exitReason,
        });
        active = null;
      }
    }

    // 3. Evaluate strategy signal strictly using closed bar [i] (no future bars)
    if (!active && i < candles.length - 1) {
      let signalSide: OrderSide | null = null;
      let stopMult = config.stopLossAtrMult;
      let tpMult = config.takeProfitAtrMult;

      if (config.strategyId === 'ADAPTIVE_CONFLUENCE_ALPHA' && confluenceSeries) {
        const snap = evaluateAdaptiveConfluenceAtBar({
          candles,
          series: confluenceSeries,
          index: i,
          marketType: config.marketType,
        });
        if (snap.direction === 'LONG' || snap.direction === 'SHORT') {
          signalSide = snap.direction;
          stopMult = Math.max(config.stopLossAtrMult, snap.stopAtrMult);
          tpMult = Math.max(config.takeProfitAtrMult, snap.tpAtrMult);
        }
      } else if (config.strategyId === 'EMA_CROSSOVER') {
        const bullCross = ema9[i - 1] <= ema21[i - 1] && ema9[i] > ema21[i];
        const bearCross = ema9[i - 1] >= ema21[i - 1] && ema9[i] < ema21[i];
        if (bullCross) signalSide = 'LONG';
        else if (bearCross && config.marketType !== 'SPOT') signalSide = 'SHORT';
      } else if (config.strategyId === 'RSI_MEAN_REVERSION') {
        if (rsi14[i] < 32 && bar.close > bar.open) signalSide = 'LONG';
        else if (rsi14[i] > 68 && bar.close < bar.open && config.marketType !== 'SPOT') {
          signalSide = 'SHORT';
        }
      } else if (config.strategyId === 'BOLLINGER_BREAKOUT') {
        if (bar.close > bb.upper[i] && rsi14[i] > 55) signalSide = 'LONG';
        else if (bar.close < bb.lower[i] && rsi14[i] < 45 && config.marketType !== 'SPOT') {
          signalSide = 'SHORT';
        }
      } else if (config.strategyId === 'SUPERTREND_MOMENTUM') {
        const flipBull =
          supertrend[i - 1]?.direction === 'BEARISH' && supertrend[i]?.direction === 'BULLISH';
        const flipBear =
          supertrend[i - 1]?.direction === 'BULLISH' && supertrend[i]?.direction === 'BEARISH';
        if (flipBull) signalSide = 'LONG';
        else if (flipBear && config.marketType !== 'SPOT') signalSide = 'SHORT';
      }

      pendingSignal = signalSide
        ? { side: signalSide, stopAtrMult: stopMult, tpAtrMult: tpMult }
        : null;
    }

    if (equity > peakEquity) peakEquity = equity;
    const ddPct = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
    if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;

    equityCurve.push({
      timestamp: bar.timestamp,
      equityUsd: Number(equity.toFixed(2)),
      drawdownPct: Number(ddPct.toFixed(2)),
    });

    if (prevEquity > 0) {
      barReturns.push((equity - prevEquity) / prevEquity);
    }
  }

  const wins = trades.filter((t) => t.netPnlUsd > 0);
  const losses = trades.filter((t) => t.netPnlUsd <= 0);
  const grossProfitUsd = wins.reduce((s, t) => s + t.netPnlUsd, 0);
  const grossLossUsd = Math.abs(losses.reduce((s, t) => s + t.netPnlUsd, 0));
  const netProfitUsd = equity - config.initialCapitalUsd;
  const totalReturnPct =
    config.initialCapitalUsd > 0 ? (netProfitUsd / config.initialCapitalUsd) * 100 : 0;

  const winRatePct = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
  const profitFactor =
    grossLossUsd > 0 ? grossProfitUsd / grossLossUsd : grossProfitUsd > 0 ? 99 : 0;
  const expectancyUsd = trades.length > 0 ? netProfitUsd / trades.length : 0;
  const averageWinUsd = wins.length > 0 ? grossProfitUsd / wins.length : 0;
  const averageLossUsd = losses.length > 0 ? grossLossUsd / losses.length : 0;

  let maxConsecutiveLosses = 0;
  let curLossStreak = 0;
  for (const t of trades) {
    if (t.netPnlUsd <= 0) {
      curLossStreak += 1;
      if (curLossStreak > maxConsecutiveLosses) maxConsecutiveLosses = curLossStreak;
    } else {
      curLossStreak = 0;
    }
  }

  const meanRet =
    barReturns.length > 0
      ? barReturns.reduce((a, b) => a + b, 0) / barReturns.length
      : 0;
  const stdRet = computeStdDev(barReturns);
  // Institutional Sortino downside semi-deviation relative to MAR=0 across all bars
  const downSqSum = barReturns.reduce((acc, r) => (r < 0 ? acc + r * r : acc), 0);
  const downSemiDev =
    barReturns.length > 0 ? Math.sqrt(downSqSum / barReturns.length) : 0;
  const annualFactor = Math.sqrt((365 * 24) / barHours);
  const sharpeRatio = stdRet > 0 ? (meanRet / stdRet) * annualFactor : 0;
  const sortinoRatio =
    downSemiDev > 0 ? (meanRet / downSemiDev) * annualFactor : sharpeRatio;

  // Monte Carlo bootstrapping over trade PnL sequence
  const runs = Math.max(10, Math.min(500, config.monteCarloRuns || 100));
  const rand = createSeededRand(candles.length + trades.length * 17);
  const mcFinalEquities: number[] = [];
  const mcMaxDrawdowns: number[] = [];

  for (let r = 0; r < runs; r++) {
    let mcEq = config.initialCapitalUsd;
    let mcPeak = mcEq;
    let mcMaxDd = 0;
    for (let k = 0; k < trades.length; k++) {
      const idx = Math.floor(rand() * trades.length);
      mcEq = Math.max(0, mcEq + trades[idx].netPnlUsd);
      if (mcEq > mcPeak) mcPeak = mcEq;
      const dd = mcPeak > 0 ? ((mcPeak - mcEq) / mcPeak) * 100 : 0;
      if (dd > mcMaxDd) mcMaxDd = dd;
    }
    mcFinalEquities.push(mcEq);
    mcMaxDrawdowns.push(mcMaxDd);
  }

  mcFinalEquities.sort((a, b) => a - b);
  mcMaxDrawdowns.sort((a, b) => a - b);

  const percentile = (arr: number[], p: number) =>
    arr.length === 0 ? config.initialCapitalUsd : arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];

  return {
    config,
    dataSourceLabel,
    candleCount: candles.length,
    totalTrades: trades.length,
    winRatePct: Number(winRatePct.toFixed(2)),
    profitFactor: Number(profitFactor.toFixed(2)),
    expectancyUsd: Number(expectancyUsd.toFixed(2)),
    sharpeRatio: Number(sharpeRatio.toFixed(2)),
    sortinoRatio: Number(sortinoRatio.toFixed(2)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    totalReturnPct: Number(totalReturnPct.toFixed(2)),
    netProfitUsd: Number(netProfitUsd.toFixed(2)),
    grossProfitUsd: Number(grossProfitUsd.toFixed(2)),
    grossLossUsd: Number(grossLossUsd.toFixed(2)),
    averageWinUsd: Number(averageWinUsd.toFixed(2)),
    averageLossUsd: Number(averageLossUsd.toFixed(2)),
    maxConsecutiveLosses,
    totalFeesUsd: Number(totalFeesUsd.toFixed(2)),
    totalFundingUsd: Number(totalFundingUsd.toFixed(2)),
    monteCarlo: {
      runs,
      p5FinalEquityUsd: Number(percentile(mcFinalEquities, 0.05).toFixed(2)),
      p50FinalEquityUsd: Number(percentile(mcFinalEquities, 0.5).toFixed(2)),
      p95FinalEquityUsd: Number(percentile(mcFinalEquities, 0.95).toFixed(2)),
      p95MaxDrawdownPct: Number(
        (mcMaxDrawdowns.length > 0
          ? mcMaxDrawdowns[Math.min(mcMaxDrawdowns.length - 1, Math.floor(mcMaxDrawdowns.length * 0.95))]
          : 0
        ).toFixed(2),
      ),
    },
    equityCurve,
    trades,
    disclaimer:
      'Kết quả Backtest được tính từ dữ liệu lịch sử có mô phỏng phí, slippage và funding (không look-ahead). Không đại diện cho lợi nhuận thực tế và không đủ điều kiện triển khai tiền thật nếu chưa qua Paper Trading kiểm chứng.',
  };
}

/**
 * Runs all registered quantitative strategies on the identical OHLCV history
 * and empirically ranks them by Win Rate, Profit Factor, Sharpe & Drawdown.
 */
export function benchmarkAllStrategies(
  candles: Candle[],
  baseConfig: Omit<BacktestConfig, 'strategyId'>,
  dataSourceLabel: string,
): StrategyBenchmarkResult {
  const rawEntries = STRATEGY_CATALOG.map((meta) => {
    const result = runBacktest(
      candles,
      { ...baseConfig, strategyId: meta.id },
      dataSourceLabel,
    );
    const sampleCredibility = result.totalTrades >= 3 ? 1 : result.totalTrades > 0 ? 0.65 : 0;
    const rawScore =
      result.winRatePct * 0.45 +
      Math.min(result.profitFactor, 4) * 12 +
      Math.max(-5, Math.min(result.sharpeRatio, 4)) * 5 -
      result.maxDrawdownPct * 0.7;
    const compositeScore = Number((rawScore * sampleCredibility).toFixed(2));
    return {
      strategyId: meta.id,
      strategyLabel: meta.label,
      compositeScore,
      result,
    };
  });

  // Identify empirical highest win rate among strategies with >= 1 trade
  const traded = rawEntries.filter((e) => e.result.totalTrades > 0);
  const winSorted = [...(traded.length > 0 ? traded : rawEntries)].sort((a, b) => {
    if (b.result.winRatePct !== a.result.winRatePct) {
      return b.result.winRatePct - a.result.winRatePct;
    }
    if (b.result.profitFactor !== a.result.profitFactor) {
      return b.result.profitFactor - a.result.profitFactor;
    }
    return b.result.netProfitUsd - a.result.netProfitUsd;
  });
  const bestWinRateStrategyId: BacktestStrategyId =
    winSorted[0]?.strategyId ?? 'ADAPTIVE_CONFLUENCE_ALPHA';

  const ranked = [...rawEntries].sort((a, b) => {
    if (b.compositeScore !== a.compositeScore) return b.compositeScore - a.compositeScore;
    return b.result.winRatePct - a.result.winRatePct;
  });

  const entries: StrategyBenchmarkEntry[] = ranked.map((item, idx) => ({
    rank: idx + 1,
    strategyId: item.strategyId,
    strategyLabel: item.strategyLabel,
    compositeScore: item.compositeScore,
    isHighestWinRate: item.strategyId === bestWinRateStrategyId && item.result.totalTrades > 0,
    result: item.result,
  }));

  return {
    symbol: baseConfig.symbol,
    timeframe: baseConfig.timeframe,
    marketType: baseConfig.marketType,
    dataSourceLabel,
    candleCount: candles.length,
    bestWinRateStrategyId,
    bestCompositeStrategyId: entries[0]?.strategyId ?? 'ADAPTIVE_CONFLUENCE_ALPHA',
    entries,
  };
}

function scoreWalkForwardPerformance(res: BacktestResult, initialCapitalUsd: number): number {
  if (res.totalTrades === 0) return -50;
  const credibility = Math.min(1, res.totalTrades / 4);
  const returnScore = Math.max(-25, Math.min(35, res.totalReturnPct * 1.2));
  const expectancyScore = Math.max(
    -20,
    Math.min(25, (res.expectancyUsd / Math.max(1, initialCapitalUsd)) * 2500),
  );
  const raw =
    res.winRatePct * 0.45 +
    Math.min(res.profitFactor, 3.5) * 14 +
    Math.max(-4, Math.min(res.sharpeRatio, 3.5)) * 4 +
    returnScore +
    expectancyScore -
    res.maxDrawdownPct * 0.85;
  const adjusted = raw > 0 ? raw * credibility : raw;
  return Number(adjusted.toFixed(2));
}

function getOosQualityTier(c: OptimizationCandidateSummary): number {
  if (c.outOfSampleTrades <= 0) return 0;
  if (c.outOfSampleNetProfitUsd > 0 && c.outOfSampleWinRatePct >= 50) return 3;
  if (c.outOfSampleNetProfitUsd > 0) return 2;
  return 1;
}

/**
 * Chronological Walk-Forward Optimizer:
 * Splits candles into In-Sample (first ~62%) & Out-of-Sample (last ~38% unseen recent bars),
 * evaluates strategy + SL/TP ATR combinations + profit-lock trailing without future leakage,
 * and surfaces the configuration with the highest verified Out-of-Sample Win Rate & Profit Factor.
 */
export function optimizeStrategyWalkForward(
  candles: Candle[],
  baseConfig: Omit<BacktestConfig, 'strategyId' | 'stopLossAtrMult' | 'takeProfitAtrMult'>,
  dataSourceLabel: string,
): BacktestOptimizationResult {
  if (candles.length < 40) {
    throw new Error('Cần tối thiểu 40 cây nến OHLCV để tối ưu hóa Walk-Forward.');
  }

  const canSplitOos = candles.length >= 90;
  const splitIndex = canSplitOos
    ? Math.max(48, Math.min(candles.length - 40, Math.floor(candles.length * 0.62)))
    : candles.length;
  const inSampleCandles = canSplitOos ? candles.slice(0, splitIndex) : candles;
  const outOfSampleCandles = canSplitOos ? candles.slice(splitIndex) : candles;

  const atrPairs: Array<{ sl: number; tp: number; trail: boolean }> = [
    { sl: 1.4, tp: 2.3, trail: true },
    { sl: 1.65, tp: 2.75, trail: true },
    { sl: 1.9, tp: 3.1, trail: true },
    { sl: 1.6, tp: 2.5, trail: false },
  ];

  const evaluated: Array<{
    summary: OptimizationCandidateSummary;
    inSample: BacktestResult;
    outOfSample: BacktestResult;
  }> = [];

  const fastBase = {
    ...baseConfig,
    monteCarloRuns: Math.min(40, Math.max(20, baseConfig.monteCarloRuns || 40)),
  };

  for (const strat of STRATEGY_CATALOG) {
    for (const grid of atrPairs) {
      const cfg: BacktestConfig = {
        ...fastBase,
        strategyId: strat.id,
        stopLossAtrMult: grid.sl,
        takeProfitAtrMult: grid.tp,
        useTrailingProfitLock: grid.trail,
      };
      const inRes = runBacktest(inSampleCandles, cfg, `${dataSourceLabel} (In-Sample)`);
      const oosRes = canSplitOos
        ? runBacktest(outOfSampleCandles, cfg, `${dataSourceLabel} (Out-of-Sample)`)
        : inRes;

      const inScore = scoreWalkForwardPerformance(inRes, fastBase.initialCapitalUsd);
      const oosScore = scoreWalkForwardPerformance(oosRes, fastBase.initialCapitalUsd);
      // Anchor In-Sample score so a tiny-sample IS fluke (e.g. PF=99) never overrides genuine OOS performance
      const anchoredInScore = Math.min(oosScore + 15, inScore);
      const walkForwardScore = Number((oosScore * 0.85 + anchoredInScore * 0.15).toFixed(2));

      evaluated.push({
        summary: {
          strategyId: strat.id,
          strategyLabel: strat.shortLabel,
          stopLossAtrMult: grid.sl,
          takeProfitAtrMult: grid.tp,
          useTrailingProfitLock: grid.trail,
          inSampleWinRatePct: inRes.winRatePct,
          inSampleProfitFactor: inRes.profitFactor,
          inSampleNetProfitUsd: inRes.netProfitUsd,
          outOfSampleWinRatePct: oosRes.winRatePct,
          outOfSampleProfitFactor: oosRes.profitFactor,
          outOfSampleExpectancyUsd: oosRes.expectancyUsd,
          outOfSampleNetProfitUsd: oosRes.netProfitUsd,
          outOfSampleMaxDdPct: oosRes.maxDrawdownPct,
          outOfSampleTrades: oosRes.totalTrades,
          walkForwardScore,
        },
        inSample: inRes,
        outOfSample: oosRes,
      });
    }
  }

  evaluated.sort((a, b) => {
    const tierDiff = getOosQualityTier(b.summary) - getOosQualityTier(a.summary);
    if (tierDiff !== 0) return tierDiff;
    if (b.summary.walkForwardScore !== a.summary.walkForwardScore) {
      return b.summary.walkForwardScore - a.summary.walkForwardScore;
    }
    if (b.summary.outOfSampleWinRatePct !== a.summary.outOfSampleWinRatePct) {
      return b.summary.outOfSampleWinRatePct - a.summary.outOfSampleWinRatePct;
    }
    return b.summary.outOfSampleExpectancyUsd - a.summary.outOfSampleExpectancyUsd;
  });

  const winner = evaluated[0];
  const fullCfg: BacktestConfig = {
    ...baseConfig,
    strategyId: winner.summary.strategyId,
    stopLossAtrMult: winner.summary.stopLossAtrMult,
    takeProfitAtrMult: winner.summary.takeProfitAtrMult,
    useTrailingProfitLock: winner.summary.useTrailingProfitLock,
  };
  const fullHistoryResult = runBacktest(candles, fullCfg, dataSourceLabel);

  return {
    symbol: baseConfig.symbol,
    timeframe: baseConfig.timeframe,
    marketType: baseConfig.marketType,
    dataSourceLabel,
    candleCount: candles.length,
    inSampleBars: inSampleCandles.length,
    outOfSampleBars: outOfSampleCandles.length,
    bestStrategyId: winner.summary.strategyId,
    bestStrategyLabel:
      STRATEGY_CATALOG.find((s) => s.id === winner.summary.strategyId)?.label ??
      winner.summary.strategyLabel,
    bestStopLossAtrMult: winner.summary.stopLossAtrMult,
    bestTakeProfitAtrMult: winner.summary.takeProfitAtrMult,
    bestUseTrailingProfitLock: winner.summary.useTrailingProfitLock,
    inSampleResult: winner.inSample,
    outOfSampleResult: winner.outOfSample,
    fullHistoryResult,
    candidatesEvaluated: evaluated.length,
    topCandidates: evaluated.slice(0, 6).map((item) => item.summary),
  };
}


