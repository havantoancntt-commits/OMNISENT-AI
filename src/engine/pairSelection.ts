import type { MarketTicker, MarketType, TradingSignal } from './types';

export interface PairSelection {
  symbol: string;
  marketType: MarketType;
  exchange?: string;
}

const SEP = '|';

export function serializePairSelection(pair: PairSelection): string {
  return `${pair.symbol}${SEP}${pair.marketType}${SEP}${pair.exchange ?? ''}`;
}

export function parsePairSelection(raw: string): PairSelection | null {
  const parts = raw.split(SEP);
  if (parts.length < 2 || !parts[0]) return null;
  const symbol = parts[0].trim();
  const marketType = (parts[1].trim() || 'PERPETUAL') as MarketType;
  const exchange = parts[2]?.trim() || undefined;
  return { symbol, marketType, exchange };
}

export function normalizeExchange(exchange?: string | null): string {
  return (exchange ?? '').trim().toUpperCase();
}

export function isSameTickerSelection(
  ticker: Pick<MarketTicker, 'symbol' | 'marketType' | 'exchange'> | null | undefined,
  selection: PairSelection | null | undefined,
): boolean {
  if (!ticker || !selection) return false;
  if (ticker.symbol.toUpperCase() !== selection.symbol.toUpperCase()) return false;
  if (ticker.marketType !== selection.marketType) return false;
  if (selection.exchange) {
    return normalizeExchange(ticker.exchange) === normalizeExchange(selection.exchange);
  }
  return true;
}

export function dedupeTickersByPair(tickers: MarketTicker[]): MarketTicker[] {
  const seen = new Set<string>();
  const out: MarketTicker[] = [];
  for (const t of tickers) {
    const key = `${t.symbol.toUpperCase()}${SEP}${t.marketType}${SEP}${normalizeExchange(t.exchange)}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}

export function findMatchingTicker(
  tickers: MarketTicker[],
  selection: PairSelection | null | undefined,
): MarketTicker | null {
  if (tickers.length === 0) return null;
  if (!selection || !selection.symbol) return tickers[0];

  const symUpper = selection.symbol.toUpperCase();
  const exUpper = normalizeExchange(selection.exchange);

  if (exUpper) {
    const exactAll = tickers.find(
      (t) =>
        t.symbol.toUpperCase() === symUpper &&
        t.marketType === selection.marketType &&
        normalizeExchange(t.exchange) === exUpper,
    );
    if (exactAll) return exactAll;
  }

  const exactSymMkt = tickers.find(
    (t) => t.symbol.toUpperCase() === symUpper && t.marketType === selection.marketType,
  );
  if (exactSymMkt) return exactSymMkt;

  const exactSym = tickers.find((t) => t.symbol.toUpperCase() === symUpper);
  if (exactSym) return exactSym;

  return tickers[0];
}

export function isSignalFresh(signal: TradingSignal, nowMs = Date.now()): boolean {
  const expMs = Date.parse(signal.expiresAtUtc);
  if (!Number.isFinite(expMs)) return true;
  return expMs > nowMs;
}

export function dedupeSignalsByPair(signals: TradingSignal[]): TradingSignal[] {
  const sorted = [...signals].sort((a, b) => {
    const ta = Date.parse(a.timestampUtc);
    const tb = Date.parse(b.timestampUtc);
    return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
  });
  const seen = new Set<string>();
  const out: TradingSignal[] = [];
  for (const s of sorted) {
    const key = `${s.symbol.toUpperCase()}${SEP}${s.marketType}${SEP}${normalizeExchange(s.exchange)}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(s);
    }
  }
  return out;
}

function pickNewestFreshFirst(matches: TradingSignal[], nowMs: number): TradingSignal | null {
  if (matches.length === 0) return null;
  const sorted = [...matches].sort((a, b) => {
    const ta = Date.parse(a.timestampUtc);
    const tb = Date.parse(b.timestampUtc);
    return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
  });
  return sorted.find((s) => isSignalFresh(s, nowMs)) ?? sorted[0];
}

/**
 * Strictly matches the AI TradingSignal belonging to the currently active
 * (symbol, marketType, exchange) selection. Returns `null` if the active
 * pair has not been analyzed yet rather than leaking a different coin's signal.
 */
export function findMatchingSignal(
  signals: TradingSignal[],
  selection: PairSelection | null | undefined,
  nowMs = Date.now(),
): TradingSignal | null {
  if (!selection || !selection.symbol || signals.length === 0) return null;

  const symUpper = selection.symbol.toUpperCase();
  const exUpper = normalizeExchange(selection.exchange);

  if (exUpper) {
    const exactAll = signals.filter(
      (s) =>
        s.symbol.toUpperCase() === symUpper &&
        s.marketType === selection.marketType &&
        normalizeExchange(s.exchange) === exUpper,
    );
    const chosen = pickNewestFreshFirst(exactAll, nowMs);
    if (chosen) return chosen;
  }

  const exactSymMkt = signals.filter(
    (s) => s.symbol.toUpperCase() === symUpper && s.marketType === selection.marketType,
  );
  return pickNewestFreshFirst(exactSymMkt, nowMs);
}

export function formatPairLabel(pair: PairSelection): string {
  return pair.exchange
    ? `${pair.symbol} · ${pair.exchange} · ${pair.marketType}`
    : `${pair.symbol} · ${pair.marketType}`;
}
