import type { Candle, DataIntegrityReport, MarketTicker } from './types.ts';

export const MAX_STALE_MS = 30_000;
export const MAX_SPREAD_BPS = 250; // 2.5% anomalous spread threshold

export function validateTickerIntegrity(
  ticker: MarketTicker,
  nowMs = Date.now(),
): DataIntegrityReport {
  const anomalies: string[] = [];
  const freshnessMs = Math.max(0, nowMs - ticker.timestampUtc);

  if (!Number.isFinite(ticker.lastPrice) || ticker.lastPrice <= 0) {
    anomalies.push('INVALID_LAST_PRICE');
  }
  if (!Number.isFinite(ticker.bidPrice) || !Number.isFinite(ticker.askPrice) || ticker.bidPrice <= 0 || ticker.askPrice <= 0) {
    anomalies.push('MISSING_BID_ASK');
  } else if (ticker.askPrice < ticker.bidPrice) {
    anomalies.push('CROSSED_BOOK_BID_GT_ASK');
  }

  if (ticker.spreadBps > MAX_SPREAD_BPS) {
    anomalies.push(`ABNORMAL_SPREAD_${ticker.spreadBps.toFixed(1)}BPS`);
  }
  if (ticker.volume24hUsd < 0 || !Number.isFinite(ticker.volume24hUsd)) {
    anomalies.push('INVALID_VOLUME');
  }
  if (freshnessMs > MAX_STALE_MS) {
    anomalies.push(`STALE_DATA_${Math.round(freshnessMs / 1000)}S`);
  }
  if (ticker.tradingStatus !== 'TRADING') {
    anomalies.push(`SYMBOL_STATUS_${ticker.tradingStatus}`);
  }

  if (ticker.dataStatus !== 'LIVE_EXCHANGE') {
    anomalies.push(`NON_LIVE_FEED_${ticker.dataStatus}`);
  }

  let status = ticker.dataStatus;
  if (freshnessMs > MAX_STALE_MS && status === 'LIVE_EXCHANGE') {
    status = 'STALE';
  }
  if (anomalies.some((a) => a.startsWith('INVALID') || a.startsWith('MISSING') || a.startsWith('CROSSED'))) {
    status = 'UNKNOWN';
  }

  return {
    symbol: ticker.symbol,
    exchange: ticker.exchange,
    valid: anomalies.length === 0 && status === 'LIVE_EXCHANGE',
    status,
    freshnessMs,
    anomalies,
    checkedAtUtc: new Date(nowMs).toISOString(),
  };
}

export function validateOhlcvConsistency(candles: Candle[]): {
  valid: boolean;
  anomalies: string[];
} {
  const anomalies: string[] = [];
  if (candles.length === 0) {
    return { valid: false, anomalies: ['EMPTY_CANDLE_SERIES'] };
  }

  let prevTs = -1;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (c.timestamp <= prevTs) {
      anomalies.push(`NON_MONOTONIC_TIMESTAMP_AT_${i}`);
      break;
    }
    prevTs = c.timestamp;

    if (c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0) {
      anomalies.push(`NON_POSITIVE_PRICE_AT_${i}`);
      break;
    }
    if (c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close)) {
      anomalies.push(`OHLC_INVARIANT_VIOLATION_AT_${i}`);
      break;
    }
    if (c.volume < 0 || !Number.isFinite(c.volume)) {
      anomalies.push(`NEGATIVE_VOLUME_AT_${i}`);
      break;
    }
  }

  return { valid: anomalies.length === 0, anomalies };
}
