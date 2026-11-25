import type { Candle, MarketTicker } from './types.ts';

export type FeedFreshnessTier = 'REALTIME' | 'LIVE' | 'AGING' | 'STALE' | 'UNAVAILABLE';

export interface LiveQuoteValidationResult {
  valid: boolean;
  reason?: string;
  spreadBps: number;
}

/**
 * Validates an incoming real-time price tick against crossed-book corruption,
 * extreme spreads, and flash-glitch outliers (>14% instantaneous jump in <3s).
 */
export function validateLiveQuoteTick(params: {
  lastPrice: number;
  bidPrice?: number;
  askPrice?: number;
  prevPrice?: number;
  prevTimestampMs?: number;
  timestampMs: number;
}): LiveQuoteValidationResult {
  const { lastPrice, bidPrice = 0, askPrice = 0, prevPrice = 0, prevTimestampMs = 0, timestampMs } = params;

  if (!Number.isFinite(lastPrice) || lastPrice <= 0) {
    return { valid: false, reason: 'NON_POSITIVE_PRICE', spreadBps: 0 };
  }

  if (bidPrice > 0 && askPrice > 0 && bidPrice > askPrice * 1.0001) {
    return { valid: false, reason: 'CROSSED_BOOK', spreadBps: 0 };
  }

  const spreadBps =
    bidPrice > 0 && askPrice >= bidPrice
      ? Number((((askPrice - bidPrice) / ((bidPrice + askPrice) / 2)) * 10_000).toFixed(2))
      : 0;

  if (spreadBps > 500) {
    return { valid: false, reason: 'TOXIC_SPREAD', spreadBps };
  }

  if (prevPrice > 0 && prevTimestampMs > 0) {
    const dtMs = Math.max(0, timestampMs - prevTimestampMs);
    const jumpRatio = Math.abs(lastPrice - prevPrice) / prevPrice;
    if (dtMs <= 3000 && jumpRatio > 0.14) {
      return { valid: false, reason: 'OUTLIER_SPIKE', spreadBps };
    }
  }

  return { valid: true, spreadBps };
}

export function classifyFeedFreshness(
  timestampUtc: number,
  nowMs = Date.now(),
): { ageMs: number; tier: FeedFreshnessTier } {
  if (!Number.isFinite(timestampUtc) || timestampUtc <= 0) {
    return { ageMs: Number.POSITIVE_INFINITY, tier: 'UNAVAILABLE' };
  }
  const ageMs = Math.max(0, nowMs - timestampUtc);
  if (ageMs <= 2500) return { ageMs, tier: 'REALTIME' };
  if (ageMs <= 10_000) return { ageMs, tier: 'LIVE' };
  if (ageMs <= 30_000) return { ageMs, tier: 'AGING' };
  return { ageMs, tier: 'STALE' };
}

export function intervalToMs(interval: string): number {
  switch (interval) {
    case '1m':
      return 60_000;
    case '5m':
      return 5 * 60_000;
    case '15m':
      return 15 * 60_000;
    case '4h':
      return 4 * 3600_000;
    case '1d':
      return 24 * 3600_000;
    case '1h':
    default:
      return 3600_000;
  }
}

/**
 * Stitches the newest live quote tick onto the active OHLCV candle array without mutating inputs.
 * Updates the active bar's close/high/low, or opens a fresh chronological bar when timestamp
 * crosses into the next bucket.
 */
export function mergeLiveTickIntoCandles(
  candles: Candle[],
  livePrice: number,
  timestampMs: number,
  interval = '1h',
): Candle[] {
  if (candles.length === 0 || !Number.isFinite(livePrice) || livePrice <= 0) {
    return candles;
  }

  const bucketMs = intervalToMs(interval);
  const last = candles[candles.length - 1];
  const tickBucket = Math.floor((timestampMs > 0 ? timestampMs : Date.now()) / bucketMs) * bucketMs;

  if (tickBucket > last.timestamp) {
    const newCandle: Candle = {
      timestamp: tickBucket,
      open: last.close,
      high: Math.max(last.close, livePrice),
      low: Math.min(last.close, livePrice),
      close: livePrice,
      volume: 0,
    };
    return [...candles.slice(1), newCandle];
  }

  const updatedLast: Candle = {
    ...last,
    high: Math.max(last.high, livePrice),
    low: Math.min(last.low, livePrice),
    close: livePrice,
  };
  return [...candles.slice(0, -1), updatedLast];
}

/**
 * Computes cross-venue fair reference price and basis divergence (bps) against same-symbol peers.
 */
export function computeCrossVenueBasisBps(
  tickers: MarketTicker[],
  target: MarketTicker,
): { medianRefPrice: number; basisBps: number; peerCount: number } {
  if (!(target.lastPrice > 0)) {
    return { medianRefPrice: 0, basisBps: 0, peerCount: 0 };
  }
  const peers = tickers.filter(
    (t) =>
      t.symbol.toUpperCase() === target.symbol.toUpperCase() &&
      t.dataStatus === 'LIVE_EXCHANGE' &&
      t.lastPrice > 0 &&
      (t.exchange !== target.exchange || t.marketType !== target.marketType),
  );
  if (peers.length === 0) {
    return { medianRefPrice: target.lastPrice, basisBps: 0, peerCount: 0 };
  }
  const sorted = peers.map((p) => p.lastPrice).sort((a, b) => a - b);
  const midIdx = Math.floor(sorted.length / 2);
  const medianRefPrice =
    sorted.length % 2 === 1 ? sorted[midIdx] : (sorted[midIdx - 1] + sorted[midIdx]) / 2;
  const basisBps =
    medianRefPrice > 0
      ? Number((((target.lastPrice - medianRefPrice) / medianRefPrice) * 10_000).toFixed(2))
      : 0;
  return {
    medianRefPrice,
    basisBps,
    peerCount: peers.length,
  };
}

export interface FeedHealthSummary {
  liveCount: number;
  totalCount: number;
  realtimeWsCount: number;
  medianLatencyMs: number;
  medianAgeMs: number;
  freshness: FeedFreshnessTier;
}

export function computeFeedHealthMetrics(
  tickers: MarketTicker[],
  nowMs = Date.now(),
): FeedHealthSummary {
  const live = tickers.filter((t) => t.dataStatus === 'LIVE_EXCHANGE' && t.lastPrice > 0);
  if (live.length === 0) {
    return {
      liveCount: 0,
      totalCount: tickers.length,
      realtimeWsCount: 0,
      medianLatencyMs: 0,
      medianAgeMs: 0,
      freshness: 'UNAVAILABLE',
    };
  }
  const latencies = live.map((t) => t.latencyMs).sort((a, b) => a - b);
  const ages = live.map((t) => Math.max(0, nowMs - t.timestampUtc)).sort((a, b) => a - b);
  const mid = Math.floor(live.length / 2);
  const medianAgeMs = ages[mid] ?? 0;
  const freshness = classifyFeedFreshness(nowMs - medianAgeMs, nowMs).tier;
  const realtimeWsCount = live.filter((t) => t.sourceLabel.includes('WS')).length;

  return {
    liveCount: live.length,
    totalCount: tickers.length,
    realtimeWsCount,
    medianLatencyMs: latencies[mid] ?? 0,
    medianAgeMs,
    freshness,
  };
}
