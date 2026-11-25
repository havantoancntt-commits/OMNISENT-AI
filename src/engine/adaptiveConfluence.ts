import {
  calculateATR,
  calculateBollingerBands,
  calculateEMA,
  calculateMACD,
  calculateRSI,
  calculateSupertrend,
} from './indicators.ts';
import type {
  AdaptiveConfluenceFactor,
  AdaptiveConfluenceSummary,
  BacktestStrategyId,
  Candle,
  HtfAlignment,
  MarketRegime,
  MarketType,
  OrderBookSnapshot,
  OrderSide,
  TechnicalIndicators,
} from './types.ts';

export const STRATEGY_CATALOG: Array<{
  id: BacktestStrategyId;
  label: string;
  shortLabel: string;
  tier: 'INSTITUTIONAL_ALPHA' | 'CLASSIC_BASELINE';
  description: string;
}> = [
  {
    id: 'ADAPTIVE_CONFLUENCE_ALPHA',
    label: 'Adaptive Confluence Alpha v4 (Institutional)',
    shortLabel: 'Adaptive Alpha v4',
    tier: 'INSTITUTIONAL_ALPHA',
    description:
      'Chiến lược đa nhân tố 5 lớp + Xác nhận đa khung 4H/1H + Chandelier Trailing ATR 3 tầng (khóa hòa vốn +0.65R, khóa lãi +1.15R, trailing ATR +1.65R+) giúp tối ưu Win Rate & Profit Factor.',
  },
  {
    id: 'EMA_CROSSOVER',
    label: 'EMA 9/21 Trend Crossover',
    shortLabel: 'EMA 9/21 Cross',
    tier: 'CLASSIC_BASELINE',
    description: 'Giao cắt EMA 9 và EMA 21 thuần theo xu hướng.',
  },
  {
    id: 'RSI_MEAN_REVERSION',
    label: 'RSI Mean Reversion',
    shortLabel: 'RSI Mean Rev',
    tier: 'CLASSIC_BASELINE',
    description: 'Đảo chiều RSI quá bán (<32) và quá mua (>68) kèm nến xác nhận.',
  },
  {
    id: 'BOLLINGER_BREAKOUT',
    label: 'Bollinger Volatility Breakout',
    shortLabel: 'BB Breakout',
    tier: 'CLASSIC_BASELINE',
    description: 'Phá vỡ biên Bollinger Band kèm động lượng RSI.',
  },
  {
    id: 'SUPERTREND_MOMENTUM',
    label: 'Supertrend Momentum',
    shortLabel: 'Supertrend',
    tier: 'CLASSIC_BASELINE',
    description: 'Đảo chiều xu hướng theo dải Supertrend ATR.',
  },
];

const STRATEGY_DESCRIPTIONS_EN: Record<BacktestStrategyId, string> = {
  ADAPTIVE_CONFLUENCE_ALPHA:
    '5-layer multi-factor engine + 4H/1H HTF alignment + 3-tier Chandelier ATR trailing (breakeven +0.65R, profit lock +1.15R, ATR trail +1.65R+) optimized for Win Rate & Profit Factor.',
  EMA_CROSSOVER: 'Pure trend-following strategy triggered by EMA 9 / EMA 21 crossovers.',
  RSI_MEAN_REVERSION: 'Counter-trend mean reversion at oversold (<32) and overbought (>68) RSI extremes with confirmation candles.',
  BOLLINGER_BREAKOUT: 'Volatility breakout outside Bollinger Bands confirmed by directional RSI momentum.',
  SUPERTREND_MOMENTUM: 'ATR-band trend reversal model tracking Supertrend regime flips.',
};

export function getStrategyCatalog(locale: 'en' | 'vi' = 'vi') {
  if (locale !== 'en') return STRATEGY_CATALOG;
  return STRATEGY_CATALOG.map((item) => ({
    ...item,
    description: STRATEGY_DESCRIPTIONS_EN[item.id] ?? item.description,
  }));
}


export interface ConfluencePrecomputedSeries {
  ema9: number[];
  ema21: number[];
  ema50: number[];
  ema200: number[];
  rsi14: number[];
  atr14: number[];
  macdHist: number[];
  bbUpper: number[];
  bbLower: number[];
  bbBandwidthPct: number[];
  supertrend: Array<{ direction: 'BULLISH' | 'BEARISH'; value: number }>;
  adxSeries: number[];
  volMean20: number[];
  volZ20: number[];
}

export function computeCausalAdxSeries(candles: Candle[], period = 14): number[] {
  const n = candles.length;
  const result: number[] = new Array(n).fill(20);
  if (n < period * 2 + 2) return result;

  const plusDM: number[] = new Array(n).fill(0);
  const minusDM: number[] = new Array(n).fill(0);
  const trList: number[] = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    trList[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    );
  }

  let trSum = 0;
  let plusSum = 0;
  let minusSum = 0;
  for (let i = 1; i <= period; i++) {
    trSum += trList[i];
    plusSum += plusDM[i];
    minusSum += minusDM[i];
  }

  const dxQueue: number[] = [];
  for (let i = period + 1; i < n; i++) {
    trSum = trSum - trSum / period + trList[i];
    plusSum = plusSum - plusSum / period + plusDM[i];
    minusSum = minusSum - minusSum / period + minusDM[i];
    const pDI = trSum > 0 ? (100 * plusSum) / trSum : 0;
    const mDI = trSum > 0 ? (100 * minusSum) / trSum : 0;
    const denom = pDI + mDI;
    const dx = denom > 0 ? (100 * Math.abs(pDI - mDI)) / denom : 0;
    dxQueue.push(dx);
    if (dxQueue.length > period) dxQueue.shift();
    result[i] = dxQueue.reduce((s, v) => s + v, 0) / dxQueue.length;
  }

  return result;
}

export function computeVolumeStatsSeries(
  candles: Candle[],
  window = 20,
): { volMean20: number[]; volZ20: number[] } {
  const n = candles.length;
  const volMean20: number[] = new Array(n).fill(0);
  const volZ20: number[] = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - window + 1);
    const sliceLen = i - start + 1;
    let sum = 0;
    for (let j = start; j <= i; j++) sum += candles[j].volume;
    const mean = sum / sliceLen;
    volMean20[i] = mean;

    if (sliceLen >= 5) {
      let sq = 0;
      for (let j = start; j <= i; j++) {
        const d = candles[j].volume - mean;
        sq += d * d;
      }
      const sd = Math.sqrt(sq / sliceLen);
      volZ20[i] = sd > 0 ? (candles[i].volume - mean) / sd : 0;
    }
  }
  return { volMean20, volZ20 };
}

export function buildConfluenceSeries(candles: Candle[]): ConfluencePrecomputedSeries {
  const closes = candles.map((c) => c.close);
  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const ema50 = calculateEMA(closes, Math.min(50, Math.max(21, closes.length - 2)));
  const ema200 = calculateEMA(closes, Math.min(200, Math.max(30, closes.length - 2)));
  const rsi14 = calculateRSI(closes, 14);
  const atr14 = calculateATR(candles, 14);
  const macd = calculateMACD(closes);
  const bb = calculateBollingerBands(closes, 20, 2);
  const supertrend = calculateSupertrend(candles, 10, 3);
  const adxSeries = computeCausalAdxSeries(candles, 14);
  const { volMean20, volZ20 } = computeVolumeStatsSeries(candles, 20);

  return {
    ema9,
    ema21,
    ema50,
    ema200,
    rsi14,
    atr14,
    macdHist: macd.histogram,
    bbUpper: bb.upper,
    bbLower: bb.lower,
    bbBandwidthPct: bb.bandwidthPct,
    supertrend,
    adxSeries,
    volMean20,
    volZ20,
  };
}

export interface HigherTimeframeBias {
  available: boolean;
  bias: 'BULL' | 'BEAR' | 'NEUTRAL';
  ema21SlopePct: number;
  stDir: 'BULLISH' | 'BEARISH';
}

export function classifyHigherTimeframeBias(htfCandles?: Candle[]): HigherTimeframeBias {
  if (!htfCandles || htfCandles.length < 22) {
    return { available: false, bias: 'NEUTRAL', ema21SlopePct: 0, stDir: 'BULLISH' };
  }
  const closes = htfCandles.map((c) => c.close);
  const ema21 = calculateEMA(closes, 21);
  const ema50 = calculateEMA(closes, Math.min(50, Math.max(21, closes.length - 2)));
  const st = calculateSupertrend(htfCandles, 10, 3);
  const idx = htfCandles.length - 1;
  const e21 = ema21[idx] ?? closes[idx];
  const e21Prev = ema21[Math.max(0, idx - 3)] ?? e21;
  const e50 = ema50[idx] ?? e21;
  const stDir = st[idx]?.direction ?? 'BULLISH';
  const slopePct = e21Prev > 0 ? ((e21 - e21Prev) / e21Prev) * 100 : 0;
  const lastClose = closes[idx];

  if (e21 > e50 && slopePct > 0.04 && (lastClose >= e21 * 0.99 || stDir === 'BULLISH')) {
    return { available: true, bias: 'BULL', ema21SlopePct: slopePct, stDir };
  }
  if (e21 < e50 && slopePct < -0.04 && (lastClose <= e21 * 1.01 || stDir === 'BEARISH')) {
    return { available: true, bias: 'BEAR', ema21SlopePct: slopePct, stDir };
  }
  return { available: true, bias: 'NEUTRAL', ema21SlopePct: slopePct, stDir };
}

export function evaluateAdaptiveConfluenceAtBar(params: {
  candles: Candle[];
  series: ConfluencePrecomputedSeries;
  index: number;
  marketType: MarketType;
  regimeHint?: MarketRegime;
  orderBook?: OrderBookSnapshot;
  htfBias?: HigherTimeframeBias;
}): AdaptiveConfluenceSummary {
  const { candles, series, index, marketType, regimeHint, orderBook, htfBias } = params;
  const cur = candles[index];
  const prev = candles[Math.max(0, index - 1)];

  const ema9 = Number.isFinite(series.ema9[index]) ? series.ema9[index] : cur.close;
  const ema21 = Number.isFinite(series.ema21[index]) ? series.ema21[index] : cur.close;
  const ema21Prev5 = Number.isFinite(series.ema21[Math.max(0, index - 5)])
    ? series.ema21[Math.max(0, index - 5)]
    : ema21;
  const ema50 = Number.isFinite(series.ema50[index]) ? series.ema50[index] : ema21;
  const ema200 = Number.isFinite(series.ema200[index]) ? series.ema200[index] : ema50;
  const rsi = Number.isFinite(series.rsi14[index]) ? series.rsi14[index] : 50;
  const atr = Number.isFinite(series.atr14[index]) && series.atr14[index] > 0
    ? series.atr14[index]
    : Math.max((cur.high - cur.low), cur.close * 0.012);
  const histCur = Number.isFinite(series.macdHist[index]) ? series.macdHist[index] : 0;
  const histPrev = Number.isFinite(series.macdHist[Math.max(0, index - 1)])
    ? series.macdHist[Math.max(0, index - 1)]
    : histCur;
  const bbUp = Number.isFinite(series.bbUpper[index]) ? series.bbUpper[index] : cur.close * 1.02;
  const bbLow = Number.isFinite(series.bbLower[index]) ? series.bbLower[index] : cur.close * 0.98;
  const bbBw = Number.isFinite(series.bbBandwidthPct[index]) ? series.bbBandwidthPct[index] : 4;
  const stDir = series.supertrend[index]?.direction ?? 'BULLISH';
  const adx = series.adxSeries[index] ?? 20;
  const volMean = series.volMean20[index] > 0 ? series.volMean20[index] : cur.volume;
  const volRatio = volMean > 0 ? cur.volume / volMean : 1;
  const volZ = series.volZ20[index] ?? 0;

  const ema21SlopePct = ema21Prev5 > 0 ? ((ema21 - ema21Prev5) / ema21Prev5) * 100 : 0;
  const isTrendMode = adx >= 18.5;
  const barRange = Math.max(0, cur.high - cur.low);
  const rangeAtr = atr > 0 ? barRange / atr : 1;
  const distEma21Atr = atr > 0 ? (cur.close - ema21) / atr : 0;
  const bbSpan = Math.max(bbUp - bbLow, cur.close * 0.0005, 1e-12);
  const pctB = (cur.close - bbLow) / bbSpan;

  const isBullCandle = cur.close > cur.open;
  const isBearCandle = cur.close < cur.open;
  const closePos = barRange > 0 ? (cur.close - cur.low) / barRange : 0.5;

  // --- Factor 1: Multi-Horizon Trend Alignment (0-20) ---
  let trendBull = 0;
  let trendBear = 0;
  if (ema21 > ema50 && ema21SlopePct > 0.02) {
    trendBull = 14 + (cur.close > ema200 ? 4 : 0) + (ema9 > ema21 ? 2 : 0);
  } else if (!isTrendMode && rsi <= 39 && isBullCandle) {
    trendBull = 12; // Mean-reversion stabilization allowance
  }

  if (ema21 < ema50 && ema21SlopePct < -0.02) {
    trendBear = 14 + (cur.close < ema200 ? 4 : 0) + (ema9 < ema21 ? 2 : 0);
  } else if (!isTrendMode && rsi >= 61 && isBearCandle) {
    trendBear = 12;
  }

  // --- Factor 2: Institutional Pullback / Mean-Reversion Value Zone (0-20) ---
  let zoneBull = 0;
  let zoneBear = 0;
  if (isTrendMode) {
    const touchedValueBull =
      cur.low <= ema21 * 1.006 || prev.low <= ema21 * 1.006 || cur.low <= ema9 * 1.002;
    if (
      distEma21Atr >= -0.75 &&
      distEma21Atr <= 1.15 &&
      touchedValueBull &&
      isBullCandle &&
      closePos >= 0.50 &&
      rsi >= 40 &&
      rsi <= 70
    ) {
      zoneBull = 20;
    } else if (
      distEma21Atr >= -0.4 &&
      distEma21Atr <= 1.35 &&
      touchedValueBull &&
      isBullCandle &&
      rsi <= 69
    ) {
      zoneBull = 14;
    } else if (
      ema9 > ema21 &&
      ema21 > ema50 &&
      adx >= 20 &&
      distEma21Atr >= 0 &&
      distEma21Atr <= 1.35 &&
      isBullCandle &&
      closePos >= 0.54 &&
      rsi >= 45 &&
      rsi <= 71
    ) {
      zoneBull = 15;
    }

    const touchedValueBear =
      cur.high >= ema21 * 0.994 || prev.high >= ema21 * 0.994 || cur.high >= ema9 * 0.998;
    if (
      distEma21Atr <= 0.75 &&
      distEma21Atr >= -1.15 &&
      touchedValueBear &&
      isBearCandle &&
      closePos <= 0.50 &&
      rsi <= 60 &&
      rsi >= 30
    ) {
      zoneBear = 20;
    } else if (
      distEma21Atr <= 0.4 &&
      distEma21Atr >= -1.35 &&
      touchedValueBear &&
      isBearCandle &&
      rsi >= 31
    ) {
      zoneBear = 14;
    } else if (
      ema9 < ema21 &&
      ema21 < ema50 &&
      adx >= 20 &&
      distEma21Atr <= 0 &&
      distEma21Atr >= -1.35 &&
      isBearCandle &&
      closePos <= 0.46 &&
      rsi <= 55 &&
      rsi >= 29
    ) {
      zoneBear = 15;
    }
  } else {
    if (pctB <= 0.28 && rsi <= 39 && isBullCandle && closePos >= 0.50) {
      zoneBull = 20;
    } else if (pctB <= 0.36 && rsi <= 42 && isBullCandle) {
      zoneBull = 13;
    }
    if (pctB >= 0.72 && rsi >= 61 && isBearCandle && closePos <= 0.50) {
      zoneBear = 20;
    } else if (pctB >= 0.64 && rsi >= 58 && isBearCandle) {
      zoneBear = 13;
    }
  }

  // --- Factor 3: Momentum Inflection & Supertrend (0-20) ---
  let momBull = 0;
  let momBear = 0;
  if (histCur > histPrev) momBull += 10;
  if (histCur > 0) momBull += 4;
  if (stDir === 'BULLISH') momBull += 6;

  if (histCur < histPrev) momBear += 10;
  if (histCur < 0) momBear += 4;
  if (stDir === 'BEARISH') momBear += 6;

  // --- Factor 4: Volume Participation Z-Score (0-20) ---
  let volBull = 0;
  let volBear = 0;
  if (isBullCandle) {
    volBull = volRatio >= 0.85 ? (volZ >= 0.35 ? 20 : 15) : volRatio >= 0.65 ? 10 : 5;
  } else if (volRatio >= 1.1 && closePos >= 0.58) {
    volBull = 10;
  }
  if (isBearCandle) {
    volBear = volRatio >= 0.85 ? (volZ >= 0.35 ? 20 : 15) : volRatio >= 0.65 ? 10 : 5;
  } else if (volRatio >= 1.1 && closePos <= 0.42) {
    volBear = 10;
  }

  // --- Factor 5: Volatility Regime & Shock Filter (0-20) ---
  const panicRegime = regimeHint === 'PANIC_MARKET' || regimeHint === 'LIQUIDITY_CRISIS';
  const spreadBad = orderBook ? orderBook.spreadBps >= 25 : false;
  const shockVeto = panicRegime || rangeAtr > 3.2 || spreadBad;

  let gateBull = 0;
  let gateBear = 0;
  if (!shockVeto) {
    const baseGate =
      rangeAtr <= 2.4 && bbBw >= 0.8 && bbBw <= 14 ? 20 : rangeAtr <= 3.0 ? 13 : 8;
    const bookBonusBull = orderBook && orderBook.imbalanceRatio > 0.1 ? 0 : orderBook && orderBook.imbalanceRatio < -0.35 ? -8 : 0;
    const bookBonusBear = orderBook && orderBook.imbalanceRatio < -0.1 ? 0 : orderBook && orderBook.imbalanceRatio > 0.35 ? -8 : 0;
    gateBull = Math.max(0, baseGate + bookBonusBull);
    gateBear = Math.max(0, baseGate + bookBonusBear);
  }

  // HTF (4H) trend multiplier when live multi-timeframe context is present
  const htfBullBonus = htfBias?.available ? (htfBias.bias === 'BULL' ? 4 : htfBias.bias === 'BEAR' ? -6 : 0) : 0;
  const htfBearBonus = htfBias?.available ? (htfBias.bias === 'BEAR' ? 4 : htfBias.bias === 'BULL' ? -6 : 0) : 0;

  const bullScore = Math.max(0, Math.min(100, trendBull + zoneBull + momBull + volBull + gateBull + htfBullBonus));
  const bearScore = Math.max(0, Math.min(100, trendBear + zoneBear + momBear + volBear + gateBear + htfBearBonus));

  // Counter-HTF filter: require elite confluence (>=82) to trade against 4H structural flow
  const minLongScore = htfBias?.available && htfBias.bias === 'BEAR' ? 82 : 70;
  const minShortScore = htfBias?.available && htfBias.bias === 'BULL' ? 82 : 70;

  let direction: OrderSide | 'NO_TRADE' = 'NO_TRADE';
  if (!shockVeto) {
    if (
      bullScore >= minLongScore &&
      trendBull >= 12 &&
      zoneBull >= 13 &&
      bullScore - bearScore >= 22 &&
      bearScore <= 44
    ) {
      direction = 'LONG';
    } else if (
      marketType !== 'SPOT' &&
      bearScore >= minShortScore &&
      trendBear >= 12 &&
      zoneBear >= 13 &&
      bearScore - bullScore >= 22 &&
      bullScore <= 44
    ) {
      direction = 'SHORT';
    }
  }

  const activeSide: OrderSide =
    direction === 'SHORT' || (direction === 'NO_TRADE' && bearScore > bullScore)
      ? 'SHORT'
      : 'LONG';
  const activeScore = activeSide === 'LONG' ? bullScore : bearScore;

  let htfAlignment: HtfAlignment = 'NEUTRAL';
  if (htfBias?.available) {
    if (htfBias.bias === 'BULL') {
      htfAlignment = activeSide === 'LONG' ? 'ALIGNED_BULL' : 'COUNTER_TREND';
    } else if (htfBias.bias === 'BEAR') {
      htfAlignment = activeSide === 'SHORT' ? 'ALIGNED_BEAR' : 'COUNTER_TREND';
    }
  }

  const htfAligned = htfAlignment === 'ALIGNED_BULL' || htfAlignment === 'ALIGNED_BEAR';
  const stopAtrMult = isTrendMode ? 1.65 : 1.55;
  const tpAtrMult = htfAligned ? (isTrendMode ? 2.85 : 2.65) : isTrendMode ? 2.6 : 2.45;
  const breakevenTriggerR = 0.65;

  const winProbProxy = Math.max(
    0.25,
    Math.min(
      0.72,
      0.38 +
        ((activeScore - 50) / 100) * 0.34 +
        (htfAligned ? 0.04 : htfAlignment === 'COUNTER_TREND' ? -0.06 : 0),
    ),
  );
  const plannedR = stopAtrMult > 0 ? tpAtrMult / stopAtrMult : 1.5;
  const expectedValueR = Number((winProbProxy * plannedR - (1 - winProbProxy) - 0.06).toFixed(2));
  const recommendedRiskPct =
    direction === 'NO_TRADE'
      ? 0.25
      : activeScore >= 82 && htfAligned
        ? 0.75
        : activeScore >= 74
          ? 0.55
          : 0.4;

  const regimeMode: AdaptiveConfluenceSummary['regimeMode'] = shockVeto
    ? 'STANDBY'
    : isTrendMode
      ? 'TREND_PULLBACK'
      : 'MEAN_REVERSION';

  const factors: AdaptiveConfluenceFactor[] = [
    {
      id: 'TREND',
      label: 'Trend Hierarchy (EMA21/50/200 + 4H)',
      score: activeSide === 'LONG' ? trendBull : trendBear,
      maxScore: 20,
      passed: (activeSide === 'LONG' ? trendBull : trendBear) >= 12,
      detail: `Slope5=${ema21SlopePct.toFixed(2)}%, ADX=${adx.toFixed(1)}${htfBias?.available ? `, 4H=${htfBias.bias}` : ''}`,
    },
    {
      id: 'VALUE_ZONE',
      label: isTrendMode ? 'Value Pullback Zone' : 'Mean-Reversion %B',
      score: activeSide === 'LONG' ? zoneBull : zoneBear,
      maxScore: 20,
      passed: (activeSide === 'LONG' ? zoneBull : zoneBear) >= 13,
      detail: isTrendMode
        ? `DistEMA21=${distEma21Atr.toFixed(2)} ATR`
        : `BB %B=${(pctB * 100).toFixed(0)}%, RSI=${rsi.toFixed(1)}`,
    },
    {
      id: 'MOMENTUM',
      label: 'MACD Inflection & Supertrend',
      score: activeSide === 'LONG' ? momBull : momBear,
      maxScore: 20,
      passed: (activeSide === 'LONG' ? momBull : momBear) >= 12,
      detail: `Hist ${(histCur - histPrev) >= 0 ? '↑' : '↓'}, ST=${stDir}`,
    },
    {
      id: 'VOLUME',
      label: 'Volume Participation Z-Score',
      score: activeSide === 'LONG' ? volBull : volBear,
      maxScore: 20,
      passed: (activeSide === 'LONG' ? volBull : volBear) >= 14,
      detail: `Vol=${volRatio.toFixed(2)}x avg (Z=${volZ.toFixed(2)})`,
    },
    {
      id: 'VOLATILITY_GATE',
      label: 'Volatility & Shock Gate',
      score: activeSide === 'LONG' ? gateBull : gateBear,
      maxScore: 20,
      passed: !shockVeto && (activeSide === 'LONG' ? gateBull : gateBear) >= 13,
      detail: shockVeto
        ? `VETO: Range=${rangeAtr.toFixed(2)}x ATR`
        : `Range=${rangeAtr.toFixed(2)}x ATR, BW=${bbBw.toFixed(1)}%`,
    },
  ];

  const passedFactors = factors.filter((f) => f.passed).length;

  return {
    strategyId: 'ADAPTIVE_CONFLUENCE_ALPHA',
    strategyName: 'Adaptive Confluence Alpha v4',
    regimeMode,
    direction,
    confluenceScore: activeScore,
    bullScore,
    bearScore,
    passedFactors,
    totalFactors: factors.length,
    shockVeto,
    stopAtrMult,
    tpAtrMult,
    breakevenTriggerR,
    htfAlignment,
    expectedValueR,
    recommendedRiskPct,
    factors,
  };
}

export function computeAdaptiveConfluenceLiveSnapshot(params: {
  candles: Candle[];
  htfCandles?: Candle[];
  indicators: TechnicalIndicators;
  regime: MarketRegime;
  marketType: MarketType;
  orderBook?: OrderBookSnapshot;
}): AdaptiveConfluenceSummary {
  const { candles, htfCandles, regime, marketType, orderBook } = params;
  if (candles.length < 15) {
    return {
      strategyId: 'ADAPTIVE_CONFLUENCE_ALPHA',
      strategyName: 'Adaptive Confluence Alpha v4',
      regimeMode: 'STANDBY',
      direction: 'NO_TRADE',
      confluenceScore: 0,
      bullScore: 0,
      bearScore: 0,
      passedFactors: 0,
      totalFactors: 5,
      shockVeto: true,
      stopAtrMult: 1.65,
      tpAtrMult: 2.65,
      breakevenTriggerR: 0.65,
      htfAlignment: 'NEUTRAL',
      expectedValueR: -0.2,
      recommendedRiskPct: 0.25,
      factors: [],
    };
  }
  const series = buildConfluenceSeries(candles);
  const htfBias = classifyHigherTimeframeBias(htfCandles);
  const lastIdx = candles.length - 1;
  const currentSnap = evaluateAdaptiveConfluenceAtBar({
    candles,
    series,
    index: lastIdx,
    marketType,
    regimeHint: regime,
    orderBook,
    htfBias,
  });

  if (currentSnap.direction !== 'NO_TRADE' || currentSnap.shockVeto || candles.length < 22) {
    return currentSnap;
  }

  // Fallback to most recently closed bar (lastIdx - 1) if still within valid entry proximity & un-invalidated
  const prevSnap = evaluateAdaptiveConfluenceAtBar({
    candles,
    series,
    index: lastIdx - 1,
    marketType,
    regimeHint: regime,
    orderBook,
    htfBias,
  });
  if (prevSnap.direction === 'NO_TRADE' || prevSnap.shockVeto) {
    return currentSnap;
  }

  const curBar = candles[lastIdx];
  const prevBar = candles[lastIdx - 1];
  const curAtr = Math.max(series.atr14[lastIdx] || 0, curBar.close * 0.01);
  const priceDrift = Math.abs(curBar.close - prevBar.close);
  const stillAlignedWithPrev =
    prevSnap.direction === 'LONG'
      ? curBar.close >= prevBar.low && priceDrift <= curAtr * 0.85 && currentSnap.bullScore >= 58
      : curBar.close <= prevBar.high && priceDrift <= curAtr * 0.85 && currentSnap.bearScore >= 58;

  return stillAlignedWithPrev ? prevSnap : currentSnap;
}
