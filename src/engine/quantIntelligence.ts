import { calculateATR, calculateBollingerBands, calculateSMA, calculateVWAP } from './indicators.ts';
import { computeLiquidationRadar } from './liquidationRadar.ts';
import type {
  Candle,
  CorrelationPairEntry,
  HurstRegimeClass,
  HurstRegimeResult,
  KellyAllocationResult,
  MarketTicker,
  MicrostructureIntel,
  OrderBookSnapshot,
  OrderFlowBias,
  PortfolioCorrelationGuard,
  Position,
  QuantIntelligenceSnapshot,
  RiskConfig,
  SqueezeState,
} from './types.ts';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Multi-horizon Generalized Hurst Exponent H(2) (Di Matteo log-price structure function)
 * + Kaufman Efficiency Ratio:
 * - H >= 0.56: persistent trending regime
 * - H <= 0.44: mean-reverting / anti-persistent regime
 * - 0.44..0.56: random-walk noise / chop
 */
export function computeHurstRegime(candles: Candle[]): HurstRegimeResult {
  const sampleBars = candles.length;
  if (sampleBars < 24) {
    return {
      hurstExponent: 0.5,
      efficiencyRatio: 0.2,
      regimeClass: 'RANDOM_WALK_NOISE',
      sampleBars,
    };
  }

  const closes = candles.map((c) => c.close);
  const logCloses = closes.map((c) => (c > 0 ? Math.log(c) : 0));

  // Kaufman Efficiency Ratio over up to 24 recent bars
  const erWindow = Math.min(24, closes.length - 1);
  const netMove = Math.abs(closes[closes.length - 1] - closes[closes.length - 1 - erWindow]);
  let pathSum = 0;
  for (let i = closes.length - erWindow; i < closes.length; i++) {
    pathSum += Math.abs(closes[i] - closes[i - 1]);
  }
  const efficiencyRatio = pathSum > 0 ? Number(clamp(netMove / pathSum, 0, 1).toFixed(3)) : 0;

  // Generalized Hurst Exponent H(2): S_2(tau) = sqrt(E[(X(t+tau) - X(t))^2]) ~ tau^H
  const candidateLags = [1, 2, 4, 8, 12, 16].filter((tau) => logCloses.length >= tau * 3);
  const logTau: number[] = [];
  const logS2: number[] = [];

  for (const tau of candidateLags) {
    let sqSum = 0;
    let count = 0;
    for (let i = tau; i < logCloses.length; i++) {
      const diff = logCloses[i] - logCloses[i - tau];
      sqSum += diff * diff;
      count += 1;
    }
    if (count > 0) {
      const rms = Math.sqrt(sqSum / count);
      if (rms > 1e-12) {
        logTau.push(Math.log(tau));
        logS2.push(Math.log(rms));
      }
    }
  }

  let hurstExponent = 0.5;
  if (logTau.length >= 2) {
    const mX = logTau.reduce((s, x) => s + x, 0) / logTau.length;
    const mY = logS2.reduce((s, y) => s + y, 0) / logS2.length;
    let num = 0;
    let den = 0;
    for (let i = 0; i < logTau.length; i++) {
      const dx = logTau[i] - mX;
      num += dx * (logS2[i] - mY);
      den += dx * dx;
    }
    if (den > 0) {
      hurstExponent = Number(clamp(num / den, 0.15, 0.92).toFixed(3));
    }
  }

  let regimeClass: HurstRegimeClass = 'RANDOM_WALK_NOISE';
  if (hurstExponent >= 0.56 || (hurstExponent >= 0.53 && efficiencyRatio >= 0.48)) {
    regimeClass = 'TRENDING_PERSISTENT';
  } else if (hurstExponent <= 0.44 || (hurstExponent <= 0.47 && efficiencyRatio <= 0.22)) {
    regimeClass = 'MEAN_REVERTING';
  }

  return {
    hurstExponent,
    efficiencyRatio,
    regimeClass,
    sampleBars,
  };
}

/**
 * TTM Volatility Squeeze (Bollinger 20,2 inside Keltner 20,1.5*ATR) +
 * Microstructure Order Flow (Signed Candle Delta vs L2 Order Book Imbalance) +
 * Fair Value Gap (FVG) & Liquidity Sweep Detection.
 */
export function computeMicrostructureIntel(
  candles: Candle[],
  orderBook?: OrderBookSnapshot | null,
  ticker?: MarketTicker | null,
): MicrostructureIntel {
  if (candles.length < 22) {
    const obPct = orderBook ? Number((orderBook.imbalanceRatio * 100).toFixed(1)) : 0;
    return {
      squeezeState: 'NORMAL',
      squeezeCompressionRatio: 1,
      vwapPrice: ticker?.lastPrice ?? candles[candles.length - 1]?.close ?? 0,
      vwapZScore: 0,
      signedVolumeDeltaPct: 0,
      orderBookImbalancePct: obPct,
      orderFlowBias: 'NEUTRAL',
      fvgSignal: 'NONE',
      liquiditySweep: 'NONE',
    };
  }

  const closes = candles.map((c) => c.close);
  const bb = calculateBollingerBands(closes, 20, 2);
  const sma20 = calculateSMA(closes, 20);
  const atr14 = calculateATR(candles, 14);
  const lastIdx = candles.length - 1;
  const prevIdx = Math.max(0, lastIdx - 1);

  const ratioAt = (idx: number): number => {
    const bbU = bb.upper[idx];
    const bbL = bb.lower[idx];
    const mid = sma20[idx];
    const atr = atr14[idx];
    if (!Number.isFinite(bbU) || !Number.isFinite(bbL) || !Number.isFinite(mid) || !Number.isFinite(atr) || atr <= 0) {
      return 1.1;
    }
    const kcWidth = 3.0 * atr; // +/- 1.5x ATR
    const bbWidth = Math.max(0, bbU - bbL);
    return kcWidth > 0 ? bbWidth / kcWidth : 1.1;
  };

  const curRatio = ratioAt(lastIdx);
  const prevRatio = ratioAt(prevIdx);
  let squeezeState: SqueezeState = 'NORMAL';
  if (curRatio < 1.0) {
    squeezeState = 'ACTIVE_SQUEEZE';
  } else if (prevRatio < 1.0 && curRatio >= 1.0) {
    squeezeState = 'SQUEEZE_FIRING';
  }

  // Rolling 24-bar VWAP + Z-Score
  const vwapPrice = calculateVWAP(candles);
  const recent24 = candles.slice(-24);
  const vwapDeviations = recent24.map((c) => c.close - vwapPrice);
  const meanDev = vwapDeviations.reduce((s, d) => s + d, 0) / Math.max(1, vwapDeviations.length);
  const varDev =
    vwapDeviations.reduce((s, d) => s + (d - meanDev) ** 2, 0) /
    Math.max(1, vwapDeviations.length);
  const sdDev = Math.sqrt(varDev);
  const lastClose = closes[lastIdx];
  const vwapZScore =
    sdDev > 1e-12 ? Number(clamp((lastClose - vwapPrice) / sdDev, -4, 4).toFixed(2)) : 0;

  // Signed Volume Delta across recent 12 candles
  const flowSlice = candles.slice(-12);
  let totalVol = 0;
  let netDelta = 0;
  for (const c of flowSlice) {
    const range = c.high - c.low;
    const pressure = range > 0 ? (2 * (c.close - c.low)) / range - 1 : 0;
    netDelta += c.volume * pressure;
    totalVol += c.volume;
  }
  const signedVolumeDeltaPct =
    totalVol > 0 ? Number(clamp((netDelta / totalVol) * 100, -100, 100).toFixed(1)) : 0;
  const orderBookImbalancePct = orderBook
    ? Number(clamp(orderBook.imbalanceRatio * 100, -100, 100).toFixed(1))
    : 0;

  let orderFlowBias: OrderFlowBias = 'NEUTRAL';
  if (signedVolumeDeltaPct >= 14 && orderBookImbalancePct >= 10) {
    orderFlowBias = 'ALIGNED_BULL';
  } else if (signedVolumeDeltaPct <= -14 && orderBookImbalancePct <= -10) {
    orderFlowBias = 'ALIGNED_BEAR';
  } else if (signedVolumeDeltaPct <= -10 && orderBookImbalancePct >= 18) {
    orderFlowBias = 'BULLISH_ABSORPTION';
  } else if (signedVolumeDeltaPct >= 10 && orderBookImbalancePct <= -18) {
    orderFlowBias = 'BEARISH_DISTRIBUTION';
  }

  // Fair Value Gap (3-candle imbalance) over last 6 bars
  let fvgSignal: MicrostructureIntel['fvgSignal'] = 'NONE';
  for (let i = Math.max(2, candles.length - 6); i < candles.length; i++) {
    const c0 = candles[i - 2];
    const c2 = candles[i];
    if (c2.low > c0.high * 1.001) {
      fvgSignal = 'BULLISH_FVG';
    } else if (c2.high < c0.low * 0.999) {
      fvgSignal = 'BEARISH_FVG';
    }
  }

  // Structural Liquidity Sweep & Reclaim on most recent 2 bars against prior 12-bar swing
  let liquiditySweep: MicrostructureIntel['liquiditySweep'] = 'NONE';
  if (candles.length >= 15) {
    const lookback = candles.slice(-14, -2);
    const priorLow = Math.min(...lookback.map((c) => c.low));
    const priorHigh = Math.max(...lookback.map((c) => c.high));
    const cur = candles[lastIdx];
    const prev = candles[prevIdx];
    if ((cur.low < priorLow || prev.low < priorLow) && cur.close > priorLow) {
      liquiditySweep = 'LOW_SWEEP_RECLAIM';
    } else if ((cur.high > priorHigh || prev.high > priorHigh) && cur.close < priorHigh) {
      liquiditySweep = 'HIGH_SWEEP_RECLAIM';
    }
  }

  return {
    squeezeState,
    squeezeCompressionRatio: Number(clamp(curRatio, 0.2, 3.0).toFixed(2)),
    vwapPrice: Number(vwapPrice.toFixed(lastClose < 0.01 ? 8 : lastClose < 1 ? 5 : 2)),
    vwapZScore,
    signedVolumeDeltaPct,
    orderBookImbalancePct,
    orderFlowBias,
    fvgSignal,
    liquiditySweep,
  };
}

/**
 * Fractional Quarter-Kelly & Volatility-Targeted Position Risk Sizing.
 * Strictly capped by riskConfig.maxRiskPerTradePct (zero martingale).
 */
export function computeKellyAllocation(params: {
  winProbability: number;
  riskReward: number;
  volatility24hPct: number;
  riskConfig: RiskConfig;
  accountEquityUsd: number;
}): KellyAllocationResult {
  const winProbabilityUsed = Number(clamp(params.winProbability, 0.05, 0.95).toFixed(3));
  const payoffRatio = Number(Math.max(0.2, params.riskReward).toFixed(2));
  const rawKelly = (winProbabilityUsed * payoffRatio - (1 - winProbabilityUsed)) / payoffRatio;
  const fullKellyPct = Number(Math.max(0, rawKelly * 100).toFixed(2));
  const quarterKellyPct = Number((fullKellyPct * 0.25).toFixed(2));

  // Volatility damper: reduce size gracefully if 24h volatility exceeds 6%
  const volScaler =
    params.volatility24hPct > 6
      ? clamp(6 / params.volatility24hPct, 0.4, 1)
      : params.volatility24hPct > 0 && params.volatility24hPct < 2.2
        ? 1.1
        : 1.0;

  const positiveEdge = rawKelly > 0;
  const volAdjustedRiskPct = positiveEdge
    ? Number(
        clamp(
          quarterKellyPct * volScaler,
          Math.min(0.1, params.riskConfig.maxRiskPerTradePct),
          params.riskConfig.maxRiskPerTradePct,
        ).toFixed(2),
      )
    : 0;

  const recommendedMarginUsd =
    params.accountEquityUsd > 0
      ? Number(((params.accountEquityUsd * volAdjustedRiskPct) / 100).toFixed(2))
      : 0;

  return {
    winProbabilityUsed,
    payoffRatio,
    fullKellyPct,
    quarterKellyPct,
    volAdjustedRiskPct,
    recommendedMarginUsd,
    positiveEdge,
  };
}

/**
 * Full Quant Intelligence Snapshot combining Hurst, Microstructure, and Fractional Kelly.
 */
export function computeQuantIntelligenceSnapshot(params: {
  candles: Candle[];
  orderBook?: OrderBookSnapshot | null;
  ticker?: MarketTicker | null;
  winProbability: number;
  riskReward: number;
  riskConfig: RiskConfig;
  accountEquityUsd: number;
}): QuantIntelligenceSnapshot {
  const hurst = computeHurstRegime(params.candles);
  const microstructure = computeMicrostructureIntel(
    params.candles,
    params.orderBook,
    params.ticker,
  );
  const kelly = computeKellyAllocation({
    winProbability: params.winProbability,
    riskReward: params.riskReward,
    volatility24hPct: params.ticker?.volatility24hPct ?? 3.5,
    riskConfig: params.riskConfig,
    accountEquityUsd: params.accountEquityUsd,
  });

  // Composite Quantitative Edge Score (0-100)
  let score = 48;
  if (hurst.regimeClass === 'TRENDING_PERSISTENT') score += 14;
  else if (hurst.regimeClass === 'MEAN_REVERTING') score += 10;
  else score -= 8;

  if (microstructure.squeezeState === 'SQUEEZE_FIRING') score += 12;
  else if (microstructure.squeezeState === 'ACTIVE_SQUEEZE') score += 5;

  if (
    microstructure.orderFlowBias === 'ALIGNED_BULL' ||
    microstructure.orderFlowBias === 'ALIGNED_BEAR' ||
    microstructure.orderFlowBias === 'BULLISH_ABSORPTION' ||
    microstructure.orderFlowBias === 'BEARISH_DISTRIBUTION'
  ) {
    score += 10;
  }
  if (microstructure.fvgSignal !== 'NONE') score += 5;
  if (microstructure.liquiditySweep !== 'NONE') score += 6;
  if (kelly.positiveEdge) score += Math.min(12, Math.round(kelly.quarterKellyPct * 4));
  else score -= 12;

  const liquidationRadar = computeLiquidationRadar({
    candles: params.candles,
    orderBook: params.orderBook,
    ticker: params.ticker,
    riskConfig: params.riskConfig,
  });

  return {
    hurst,
    microstructure,
    kelly,
    liquidationRadar,
    compositeEdgeScore: Math.round(clamp(score, 5, 98)),
    computedAtUtc: new Date().toISOString(),
  };
}

/**
 * Computes Pearson return correlation between two candle return series aligned by length.
 */
export function computePearsonReturnCorrelation(
  candlesA: Candle[],
  candlesB: Candle[],
): { correlation: number; overlapBars: number } {
  const len = Math.min(candlesA.length, candlesB.length);
  if (len < 12) return { correlation: 0, overlapBars: 0 };

  const sliceA = candlesA.slice(-len);
  const sliceB = candlesB.slice(-len);
  const retA: number[] = [];
  const retB: number[] = [];

  for (let i = 1; i < len; i++) {
    if (sliceA[i - 1].close > 0 && sliceB[i - 1].close > 0) {
      retA.push(Math.log(sliceA[i].close / sliceA[i - 1].close));
      retB.push(Math.log(sliceB[i].close / sliceB[i - 1].close));
    }
  }
  if (retA.length < 10) return { correlation: 0, overlapBars: retA.length };

  const meanA = retA.reduce((s, x) => s + x, 0) / retA.length;
  const meanB = retB.reduce((s, x) => s + x, 0) / retB.length;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < retA.length; i++) {
    const da = retA[i] - meanA;
    const db = retB[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const denom = Math.sqrt(denA * denB);
  const corr = denom > 1e-12 ? clamp(num / denom, -1, 1) : 0;
  return {
    correlation: Number(corr.toFixed(3)),
    overlapBars: retA.length,
  };
}

/**
 * Evaluates Cross-Asset Portfolio Correlation & Concentration Guard across open positions
 * (or top benchmark pairs when 0 open positions exist so risk managers still see real market correlation).
 */
export function computePortfolioCorrelationGuard(params: {
  positions: Position[];
  candlesBySymbol: Record<string, Candle[]>;
  benchmarkSymbols?: string[];
}): PortfolioCorrelationGuard {
  const { positions, candlesBySymbol, benchmarkSymbols = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'] } =
    params;

  let netDirectionalExposureUsd = 0;
  let grossExposureUsd = 0;
  for (const pos of positions) {
    const notional = pos.quantity * (pos.markPrice > 0 ? pos.markPrice : pos.entryPrice);
    grossExposureUsd += notional;
    netDirectionalExposureUsd += pos.side === 'LONG' ? notional : -notional;
  }

  const targetSymbols =
    positions.length >= 2
      ? Array.from(new Set(positions.map((p) => p.symbol)))
      : Array.from(
          new Set([
            ...positions.map((p) => p.symbol),
            ...benchmarkSymbols.filter((s) => (candlesBySymbol[s]?.length ?? 0) >= 12),
          ]),
        ).slice(0, 4);

  const pairs: CorrelationPairEntry[] = [];
  for (let i = 0; i < targetSymbols.length; i++) {
    for (let j = i + 1; j < targetSymbols.length; j++) {
      const symA = targetSymbols[i];
      const symB = targetSymbols[j];
      const cA = candlesBySymbol[symA] ?? [];
      const cB = candlesBySymbol[symB] ?? [];
      if (cA.length < 12 || cB.length < 12) continue;

      const { correlation, overlapBars } = computePearsonReturnCorrelation(cA, cB);
      const absCorr = Math.abs(correlation);
      const riskTier: CorrelationPairEntry['riskTier'] =
        correlation <= -0.2
          ? 'HEDGED'
          : absCorr >= 0.78
            ? 'HIGH_CONCENTRATION'
            : absCorr >= 0.45
              ? 'MODERATE'
              : 'DIVERSIFIED';

      pairs.push({
        symbolA: symA,
        symbolB: symB,
        correlation,
        overlapBars,
        riskTier,
      });
    }
  }

  const averageAbsCorrelation =
    pairs.length > 0
      ? Number(
          (pairs.reduce((s, p) => s + Math.abs(p.correlation), 0) / pairs.length).toFixed(3),
        )
      : 0;

  const diversificationScore =
    pairs.length > 0
      ? Math.round(clamp((1 - averageAbsCorrelation) * 100, 5, 98))
      : 100;

  const concentrationWarning: PortfolioCorrelationGuard['concentrationWarning'] =
    positions.length >= 2 && averageAbsCorrelation >= 0.75
      ? 'HIGH'
      : positions.length >= 2 && averageAbsCorrelation >= 0.55
        ? 'MODERATE'
        : 'LOW';

  return {
    openPositionsCount: positions.length,
    averageAbsCorrelation,
    diversificationScore,
    concentrationWarning,
    netDirectionalExposureUsd: Number(netDirectionalExposureUsd.toFixed(2)),
    grossExposureUsd: Number(grossExposureUsd.toFixed(2)),
    pairs,
  };
}
