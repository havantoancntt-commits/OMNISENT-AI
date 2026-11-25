import type { Candle, MarketRegime, TechnicalIndicators } from './types.ts';

export function calculateSMA(values: number[], period: number): number[] {
  if (period <= 0 || values.length === 0) return [];
  const result: number[] = new Array(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) {
      sum -= values[i - period];
    }
    if (i >= period - 1) {
      result[i] = sum / period;
    }
  }
  return result;
}

export function calculateEMA(values: number[], period: number): number[] {
  if (period <= 0 || values.length === 0) return [];
  const result: number[] = new Array(values.length).fill(NaN);
  const k = 2 / (period + 1);

  if (values.length < period) {
    // Fallback progressive EMA when series shorter than period
    let ema = values[0];
    result[0] = ema;
    for (let i = 1; i < values.length; i++) {
      ema = values[i] * k + ema * (1 - k);
      result[i] = ema;
    }
    return result;
  }

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  let ema = sum / period;
  result[period - 1] = ema;

  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    result[i] = ema;
  }
  return result;
}

export function calculateRSI(closes: number[], period = 14): number[] {
  const result: number[] = new Array(closes.length).fill(NaN);
  if (closes.length <= period) return result;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum += Math.abs(diff);
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return result;
}

export function calculateMACD(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): { line: number[]; signal: number[]; histogram: number[] } {
  const emaFast = calculateEMA(closes, fast);
  const emaSlow = calculateEMA(closes, slow);
  const line = closes.map((_, i) =>
    Number.isFinite(emaFast[i]) && Number.isFinite(emaSlow[i])
      ? emaFast[i] - emaSlow[i]
      : NaN,
  );

  const validStart = line.findIndex((v) => Number.isFinite(v));
  const signal: number[] = new Array(closes.length).fill(NaN);
  if (validStart !== -1) {
    const validSlice = line.slice(validStart);
    const emaSignal = calculateEMA(validSlice, signalPeriod);
    for (let i = 0; i < emaSignal.length; i++) {
      signal[validStart + i] = emaSignal[i];
    }
  }

  const histogram = line.map((v, i) =>
    Number.isFinite(v) && Number.isFinite(signal[i]) ? v - signal[i] : NaN,
  );

  return { line, signal, histogram };
}

export function calculateATR(candles: Candle[], period = 14): number[] {
  const result: number[] = new Array(candles.length).fill(NaN);
  if (candles.length <= period) return result;

  const tr: number[] = new Array(candles.length).fill(0);
  tr[0] = candles[0].high - candles[0].low;
  for (let i = 1; i < candles.length; i++) {
    const prevClose = candles[i - 1].close;
    tr[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - prevClose),
      Math.abs(candles[i].low - prevClose),
    );
  }

  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  let atr = sum / period;
  result[period] = atr;

  for (let i = period + 1; i < candles.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
    result[i] = atr;
  }
  return result;
}

export function calculateBollingerBands(
  closes: number[],
  period = 20,
  stdDevMult = 2,
): { upper: number[]; middle: number[]; lower: number[]; bandwidthPct: number[] } {
  const middle = calculateSMA(closes, period);
  const upper: number[] = new Array(closes.length).fill(NaN);
  const lower: number[] = new Array(closes.length).fill(NaN);
  const bandwidthPct: number[] = new Array(closes.length).fill(NaN);

  for (let i = period - 1; i < closes.length; i++) {
    const mean = middle[i];
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = closes[j] - mean;
      variance += diff * diff;
    }
    const sd = Math.sqrt(variance / period);
    upper[i] = mean + stdDevMult * sd;
    lower[i] = mean - stdDevMult * sd;
    bandwidthPct[i] = mean > 0 ? ((upper[i] - lower[i]) / mean) * 100 : 0;
  }

  return { upper, middle, lower, bandwidthPct };
}

export function calculateVWAP(candles: Candle[]): number {
  if (candles.length === 0) return 0;
  const recent = candles.slice(-24);
  let pvSum = 0;
  let volSum = 0;
  for (const c of recent) {
    const typical = (c.high + c.low + c.close) / 3;
    pvSum += typical * c.volume;
    volSum += c.volume;
  }
  return volSum > 0 ? pvSum / volSum : candles[candles.length - 1].close;
}

export function calculateADX(candles: Candle[], period = 14): number {
  if (candles.length < period * 2 + 1) return 20;
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const trList: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    trList.push(
      Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close),
      ),
    );
  }

  let trSum = trList.slice(0, period).reduce((a, b) => a + b, 0);
  let plusSum = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
  let minusSum = minusDM.slice(0, period).reduce((a, b) => a + b, 0);

  const dxValues: number[] = [];
  for (let i = period; i < trList.length; i++) {
    trSum = trSum - trSum / period + trList[i];
    plusSum = plusSum - plusSum / period + plusDM[i];
    minusSum = minusSum - minusSum / period + minusDM[i];
    const pDI = trSum > 0 ? (100 * plusSum) / trSum : 0;
    const mDI = trSum > 0 ? (100 * minusSum) / trSum : 0;
    const denom = pDI + mDI;
    dxValues.push(denom > 0 ? (100 * Math.abs(pDI - mDI)) / denom : 0);
  }

  if (dxValues.length === 0) return 20;
  const tail = dxValues.slice(-period);
  return tail.reduce((a, b) => a + b, 0) / tail.length;
}

export function calculateSupertrend(
  candles: Candle[],
  period = 10,
  multiplier = 3,
): { direction: 'BULLISH' | 'BEARISH'; value: number }[] {
  const atr = calculateATR(candles, period);
  const result: { direction: 'BULLISH' | 'BEARISH'; value: number }[] = [];
  let prevUpper = 0;
  let prevLower = 0;
  let prevTrend: 'BULLISH' | 'BEARISH' = 'BULLISH';

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const hl2 = (c.high + c.low) / 2;
    const curAtr = Number.isFinite(atr[i]) ? atr[i] : (c.high - c.low) * 1.5;
    let upper = hl2 + multiplier * curAtr;
    let lower = hl2 - multiplier * curAtr;

    if (i > 0) {
      const prevClose = candles[i - 1].close;
      if (lower > prevLower || prevClose < prevLower) {
        // keep new lower
      } else {
        lower = prevLower;
      }
      if (upper < prevUpper || prevClose > prevUpper) {
        // keep new upper
      } else {
        upper = prevUpper;
      }
    }

    let trend: 'BULLISH' | 'BEARISH' = prevTrend;
    if (prevTrend === 'BULLISH' && c.close < lower) {
      trend = 'BEARISH';
    } else if (prevTrend === 'BEARISH' && c.close > upper) {
      trend = 'BULLISH';
    }

    prevUpper = upper;
    prevLower = lower;
    prevTrend = trend;
    result.push({
      direction: trend,
      value: trend === 'BULLISH' ? lower : upper,
    });
  }
  return result;
}

export function detectMarketRegime(
  indicators: TechnicalIndicators,
  lastPrice: number,
  volatilityPct: number,
): MarketRegime {
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) return 'UNKNOWN_REGIME';

  const { ema9, ema21, ema50, ema200, rsi14, adx14, bollinger, supertrend } = indicators;

  if (volatilityPct > 9 && rsi14 < 28) return 'PANIC_MARKET';
  if (volatilityPct > 7.5 && bollinger.bandwidthPct > 12) return 'HIGH_VOLATILITY';
  if (bollinger.bandwidthPct < 2.2 && adx14 < 18) return 'LOW_VOLATILITY';

  const bullAligned = ema9 > ema21 && ema21 > ema50 && lastPrice > ema50;
  const bearAligned = ema9 < ema21 && ema21 < ema50 && lastPrice < ema50;

  if (lastPrice > bollinger.upper && adx14 > 25 && supertrend.direction === 'BULLISH') {
    return 'BREAKOUT';
  }
  if (bullAligned && adx14 >= 28 && lastPrice > ema200) return 'STRONG_BULL';
  if (bullAligned && adx14 >= 18) return 'BULL';
  if (lastPrice > ema21 && ema21 > ema50 && rsi14 >= 48 && rsi14 <= 60) return 'WEAK_BULL';

  if (bearAligned && adx14 >= 28 && lastPrice < ema200) return 'STRONG_BEAR';
  if (bearAligned && adx14 >= 18) return 'BEAR';

  if (
    (supertrend.direction === 'BULLISH' && ema21 < ema50 && rsi14 > 52) ||
    (supertrend.direction === 'BEARISH' && ema21 > ema50 && rsi14 < 48)
  ) {
    return 'TREND_REVERSAL';
  }

  return 'SIDEWAYS';
}

export function computeAllIndicators(candles: Candle[]): TechnicalIndicators {
  if (candles.length === 0) {
    return {
      ema9: 0,
      ema21: 0,
      ema50: 0,
      ema200: 0,
      sma20: 0,
      rsi14: 50,
      macd: { line: 0, signal: 0, histogram: 0 },
      atr14: 0,
      bollinger: { upper: 0, middle: 0, lower: 0, bandwidthPct: 0 },
      vwap: 0,
      adx14: 20,
      supertrend: { direction: 'BULLISH', value: 0 },
      support: 0,
      resistance: 0,
    };
  }

  const closes = candles.map((c) => c.close);
  const lastIdx = closes.length - 1;
  const lastClose = closes[lastIdx];

  const ema9Arr = calculateEMA(closes, 9);
  const ema21Arr = calculateEMA(closes, 21);
  const ema50Arr = calculateEMA(closes, 50);
  const ema200Arr = calculateEMA(closes, Math.min(200, Math.max(20, closes.length - 1)));
  const sma20Arr = calculateSMA(closes, Math.min(20, closes.length));
  const rsiArr = calculateRSI(closes, Math.min(14, Math.max(2, closes.length - 2)));
  const macd = calculateMACD(closes);
  const atrArr = calculateATR(candles, Math.min(14, Math.max(2, candles.length - 2)));
  const bb = calculateBollingerBands(closes, Math.min(20, closes.length), 2);
  const st = calculateSupertrend(candles, Math.min(10, Math.max(2, candles.length - 2)), 3);
  const adx14 = calculateADX(candles, Math.min(14, Math.max(3, Math.floor(candles.length / 3))));
  const vwap = calculateVWAP(candles);

  const lookback = candles.slice(-30);
  const support = Math.min(...lookback.map((c) => c.low));
  const resistance = Math.max(...lookback.map((c) => c.high));

  const safeVal = (arr: number[], fallback: number) =>
    Number.isFinite(arr[lastIdx]) ? arr[lastIdx] : fallback;

  return {
    ema9: safeVal(ema9Arr, lastClose),
    ema21: safeVal(ema21Arr, lastClose),
    ema50: safeVal(ema50Arr, lastClose),
    ema200: safeVal(ema200Arr, lastClose),
    sma20: safeVal(sma20Arr, lastClose),
    rsi14: safeVal(rsiArr, 50),
    macd: {
      line: safeVal(macd.line, 0),
      signal: safeVal(macd.signal, 0),
      histogram: safeVal(macd.histogram, 0),
    },
    atr14: safeVal(atrArr, Math.max(lastClose * 0.015, 0.0001)),
    bollinger: {
      upper: safeVal(bb.upper, lastClose * 1.02),
      middle: safeVal(bb.middle, lastClose),
      lower: safeVal(bb.lower, lastClose * 0.98),
      bandwidthPct: safeVal(bb.bandwidthPct, 4),
    },
    vwap,
    adx14,
    supertrend: st[lastIdx] ?? { direction: 'BULLISH', value: lastClose * 0.97 },
    support,
    resistance,
  };
}
