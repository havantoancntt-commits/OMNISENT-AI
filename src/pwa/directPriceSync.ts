import { validateLiveQuoteTick } from '../engine/priceFeedGuard.ts';
import type {
  MarketTicker,
  MarketType,
  PortfolioSummary,
  Position,
} from '../engine/types.ts';

function makeTickerIdentity(t: Pick<MarketTicker, 'symbol' | 'marketType' | 'exchange'>): string {
  return `${t.symbol.toUpperCase()}|${t.marketType}|${t.exchange.toUpperCase()}`;
}

export function hasAnyLiveTickerPrice(tickers: readonly MarketTicker[]): boolean {
  return tickers.some((t) => Number.isFinite(t.lastPrice) && t.lastPrice > 0);
}

/**
 * Merges incoming REST/WS ticker snapshots into the current UI state without allowing
 * a stale or $0/UNAVAILABLE response to overwrite a fresher LIVE_EXCHANGE quote.
 */
export function mergeTickerFeedSnapshots(
  current: readonly MarketTicker[],
  incoming: readonly MarketTicker[],
): MarketTicker[] {
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return [...current];
  }

  const currentMap = new Map<string, MarketTicker>();
  for (const tk of current) {
    currentMap.set(makeTickerIdentity(tk), tk);
  }

  const merged: MarketTicker[] = [];
  const seenKeys = new Set<string>();

  for (const next of incoming) {
    const key = makeTickerIdentity(next);
    seenKeys.add(key);
    const prev = currentMap.get(key);

    if (!prev) {
      merged.push(next);
      continue;
    }

    const prevLive = prev.dataStatus === 'LIVE_EXCHANGE' && prev.lastPrice > 0;
    const nextLive = next.dataStatus === 'LIVE_EXCHANGE' && next.lastPrice > 0;

    // Never regress a live price back to $0 / UNAVAILABLE
    if (prevLive && (!nextLive || next.lastPrice <= 0)) {
      merged.push(prev);
      continue;
    }

    // Preserve sub-second client/WS tick if incoming REST poll carries an older timestamp
    if (prevLive && nextLive && prev.timestampUtc > next.timestampUtc + 120) {
      merged.push({
        ...next,
        lastPrice: prev.lastPrice,
        bidPrice: prev.bidPrice,
        askPrice: prev.askPrice,
        spreadBps: prev.spreadBps,
        high24h: Math.max(next.high24h, prev.high24h, prev.lastPrice),
        low24h:
          next.low24h > 0 && prev.low24h > 0
            ? Math.min(next.low24h, prev.low24h, prev.lastPrice)
            : next.low24h || prev.low24h,
        timestampUtc: prev.timestampUtc,
        sourceLabel: prev.sourceLabel,
      });
      continue;
    }

    merged.push({
      ...next,
      rsi14: next.rsi14 ?? prev.rsi14,
      regime: next.regime !== 'UNKNOWN_REGIME' ? next.regime : prev.regime,
    });
  }

  for (const prev of current) {
    const key = makeTickerIdentity(prev);
    if (!seenKeys.has(key) && prev.lastPrice > 0) {
      merged.push(prev);
    }
  }

  return merged;
}

/**
 * Selects the healthiest live ticker for a benchmark symbol so Command Center
 * never shows "--" when an exchange relay or spot/perp peer has live quotes.
 */
export function pickBestBenchmarkTicker(
  tickers: readonly MarketTicker[],
  symbol: string,
  preferredMarketType?: MarketType,
): MarketTicker | undefined {
  const symUpper = symbol.toUpperCase();
  const candidates = tickers.filter((t) => t.symbol.toUpperCase() === symUpper);
  if (candidates.length === 0) return undefined;

  const livePreferred = preferredMarketType
    ? candidates.find(
        (t) =>
          t.marketType === preferredMarketType &&
          t.dataStatus === 'LIVE_EXCHANGE' &&
          t.lastPrice > 0,
      )
    : undefined;
  if (livePreferred) return livePreferred;

  const anyLive = candidates.find(
    (t) => t.dataStatus === 'LIVE_EXCHANGE' && t.lastPrice > 0,
  );
  if (anyLive) return anyLive;

  const anyPositive = candidates.find((t) => t.lastPrice > 0);
  if (anyPositive) return anyPositive;

  return candidates[0];
}

export interface DirectExchangeTickInput {
  symbol: string;
  marketType: MarketType;
  lastPrice: number;
  bidPrice: number;
  askPrice: number;
  high24h?: number;
  low24h?: number;
  open24h?: number;
  volume24hUsd?: number;
  timestampUtc: number;
  sourceLabel: string;
}

/**
 * Applies a verified direct public exchange tick to matching tickers cleanly.
 * Rejects crossed books, toxic spreads, or anomalous spikes deterministically.
 */
export function applyDirectExchangeWsTick(
  tickers: readonly MarketTicker[],
  tick: DirectExchangeTickInput,
): MarketTicker[] {
  if (!Number.isFinite(tick.lastPrice) || tick.lastPrice <= 0) {
    return [...tickers];
  }

  const targetSym = tick.symbol.toUpperCase();
  const bid = tick.bidPrice > 0 ? tick.bidPrice : tick.lastPrice;
  const ask = tick.askPrice > 0 ? tick.askPrice : tick.lastPrice;

  const guard = validateLiveQuoteTick({
    lastPrice: tick.lastPrice,
    bidPrice: bid,
    askPrice: ask,
    timestampMs: tick.timestampUtc,
  });
  if (!guard.valid) {
    return [...tickers];
  }

  let updatedAny = false;
  const next = tickers.map((tk) => {
    if (tk.symbol.toUpperCase() !== targetSym || tk.marketType !== tick.marketType) {
      return tk;
    }

    // Only apply direct fallback to another exchange row if that row has no price yet
    // or is stale (> 2.5s old); exact OKX rows update unconditionally.
    const isOkxNative = tk.exchange.toUpperCase() === 'OKX';
    const isUnavailableOrStale =
      tk.lastPrice <= 0 ||
      tk.dataStatus !== 'LIVE_EXCHANGE' ||
      tick.timestampUtc - tk.timestampUtc > 2500;
    if (!isOkxNative && !isUnavailableOrStale) {
      return tk;
    }

    const change24hPct =
      tick.open24h && tick.open24h > 0
        ? Number((((tick.lastPrice - tick.open24h) / tick.open24h) * 100).toFixed(2))
        : tk.change24hPct;
    const high24h = Math.max(tick.high24h ?? 0, tick.lastPrice, tk.high24h);
    const low24h =
      tick.low24h && tick.low24h > 0
        ? tk.low24h > 0
          ? Math.min(tick.low24h, tk.low24h, tick.lastPrice)
          : Math.min(tick.low24h, tick.lastPrice)
        : tk.low24h > 0
          ? Math.min(tk.low24h, tick.lastPrice)
          : tick.lastPrice;
    const volPct =
      high24h >= low24h && tick.lastPrice > 0
        ? Number((((high24h - low24h) / tick.lastPrice) * 100).toFixed(2))
        : tk.volatility24hPct;

    updatedAny = true;
    return {
      ...tk,
      lastPrice: tick.lastPrice,
      bidPrice: bid,
      askPrice: ask,
      spreadBps: Number(guard.spreadBps.toFixed(2)),
      change24hPct,
      high24h,
      low24h,
      volume24hUsd:
        tick.volume24hUsd && tick.volume24hUsd > 0
          ? Math.round(tick.volume24hUsd)
          : tk.volume24hUsd,
      volatility24hPct: volPct,
      dataStatus: 'LIVE_EXCHANGE' as const,
      sourceLabel: isOkxNative ? tick.sourceLabel : `${tk.exchange} · ${tick.sourceLabel}`,
      timestampUtc: tick.timestampUtc,
      latencyMs: Math.max(12, Math.min(450, Math.abs(Date.now() - tick.timestampUtc) || 45)),
      regime:
        tk.regime !== 'UNKNOWN_REGIME'
          ? tk.regime
          : change24hPct >= 2.5
            ? 'STRONG_BULL'
            : change24hPct >= 0.4
              ? 'BULL'
              : change24hPct <= -2.5
                ? 'STRONG_BEAR'
                : change24hPct <= -0.4
                  ? 'BEAR'
                  : 'SIDEWAYS',
    };
  });

  return updatedAny ? next : [...tickers];
}

/**
 * Reprices floating open positions and portfolio unrealized equity cleanly when direct
 * sub-second client WebSocket ticks arrive between authoritative server sync frames.
 */
export function repricePortfolioAndPositions(
  portfolio: PortfolioSummary,
  positions: readonly Position[],
  tickers: readonly MarketTicker[],
): { portfolio: PortfolioSummary; positions: Position[] } {
  if (positions.length === 0) {
    const exactEquity = Number((portfolio.initialEquityUsd + portfolio.realizedPnlUsd).toFixed(2));
    const exactAvail = Number(Math.max(0, exactEquity).toFixed(2));
    if (
      portfolio.unrealizedPnlUsd === 0 &&
      portfolio.usedMarginUsd === 0 &&
      portfolio.totalEquityUsd === exactEquity &&
      portfolio.availableBalanceUsd === exactAvail
    ) {
      return { portfolio, positions: [...positions] };
    }
    const dailyBase =
      portfolio.dailyBaselineEquityUsd && portfolio.dailyBaselineEquityUsd > 0
        ? portfolio.dailyBaselineEquityUsd
        : portfolio.initialEquityUsd;
    const weeklyBase =
      portfolio.weeklyBaselineEquityUsd && portfolio.weeklyBaselineEquityUsd > 0
        ? portfolio.weeklyBaselineEquityUsd
        : portfolio.initialEquityUsd;
    const dailyPnlPct =
      dailyBase > 0
        ? Number((((exactEquity - dailyBase) / dailyBase) * 100).toFixed(2))
        : portfolio.dailyPnlPct;
    const weeklyPnlPct =
      weeklyBase > 0
        ? Number((((exactEquity - weeklyBase) / weeklyBase) * 100).toFixed(2))
        : portfolio.weeklyPnlPct;
    const peakEquityUsd = Math.max(portfolio.peakEquityUsd, exactEquity);
    const currentDrawdownPct =
      peakEquityUsd > 0
        ? Number((Math.max(0, (peakEquityUsd - exactEquity) / peakEquityUsd) * 100).toFixed(2))
        : portfolio.currentDrawdownPct;
    return {
      positions: [],
      portfolio: {
        ...portfolio,
        unrealizedPnlUsd: 0,
        usedMarginUsd: 0,
        totalEquityUsd: exactEquity,
        availableBalanceUsd: exactAvail,
        dailyPnlPct,
        weeklyPnlPct,
        peakEquityUsd,
        currentDrawdownPct,
      },
    };
  }

  let unrealizedSum = 0;
  let usedMarginSum = 0;
  let positionsChanged = false;

  const updatedPositions = positions.map((pos) => {
    usedMarginSum += pos.marginUsd;
    const matched =
      tickers.find(
        (t) =>
          t.symbol.toUpperCase() === pos.symbol.toUpperCase() &&
          t.marketType === pos.marketType &&
          t.exchange.toUpperCase() === pos.exchange.toUpperCase() &&
          t.lastPrice > 0,
      ) ??
      tickers.find(
        (t) =>
          t.symbol.toUpperCase() === pos.symbol.toUpperCase() &&
          t.marketType === pos.marketType &&
          t.lastPrice > 0,
      ) ??
      tickers.find((t) => t.symbol.toUpperCase() === pos.symbol.toUpperCase() && t.lastPrice > 0);

    const markPrice = matched && matched.lastPrice > 0 ? matched.lastPrice : pos.markPrice;
    const direction = pos.side === 'LONG' ? 1 : -1;
    const unrealizedPnlUsd = Number(
      ((markPrice - pos.entryPrice) * direction * pos.quantity).toFixed(2),
    );
    const unrealizedPnlPct =
      pos.marginUsd > 0 ? Number(((unrealizedPnlUsd / pos.marginUsd) * 100).toFixed(2)) : 0;
    unrealizedSum += unrealizedPnlUsd;

    if (
      markPrice === pos.markPrice &&
      unrealizedPnlUsd === pos.unrealizedPnlUsd &&
      unrealizedPnlPct === pos.unrealizedPnlPct
    ) {
      return pos;
    }

    positionsChanged = true;
    return {
      ...pos,
      markPrice,
      unrealizedPnlUsd,
      unrealizedPnlPct,
    };
  });

  const roundedUnrealized = Number(unrealizedSum.toFixed(2));
  const roundedUsedMargin = Number(usedMarginSum.toFixed(2));
  const totalEquityUsd = Number(
    (portfolio.initialEquityUsd + portfolio.realizedPnlUsd + roundedUnrealized).toFixed(2),
  );
  const availableBalanceUsd = Number(Math.max(0, totalEquityUsd - roundedUsedMargin).toFixed(2));
  const dailyBase =
    portfolio.dailyBaselineEquityUsd && portfolio.dailyBaselineEquityUsd > 0
      ? portfolio.dailyBaselineEquityUsd
      : portfolio.initialEquityUsd;
  const weeklyBase =
    portfolio.weeklyBaselineEquityUsd && portfolio.weeklyBaselineEquityUsd > 0
      ? portfolio.weeklyBaselineEquityUsd
      : portfolio.initialEquityUsd;
  const dailyPnlPct =
    dailyBase > 0
      ? Number((((totalEquityUsd - dailyBase) / dailyBase) * 100).toFixed(2))
      : portfolio.dailyPnlPct;
  const weeklyPnlPct =
    weeklyBase > 0
      ? Number((((totalEquityUsd - weeklyBase) / weeklyBase) * 100).toFixed(2))
      : portfolio.weeklyPnlPct;
  const peakEquityUsd = Math.max(portfolio.peakEquityUsd, totalEquityUsd);
  const currentDrawdownPct =
    peakEquityUsd > 0
      ? Number((Math.max(0, (peakEquityUsd - totalEquityUsd) / peakEquityUsd) * 100).toFixed(2))
      : portfolio.currentDrawdownPct;

  const portfolioChanged =
    portfolio.unrealizedPnlUsd !== roundedUnrealized ||
    portfolio.usedMarginUsd !== roundedUsedMargin ||
    portfolio.totalEquityUsd !== totalEquityUsd ||
    portfolio.availableBalanceUsd !== availableBalanceUsd ||
    portfolio.dailyPnlPct !== dailyPnlPct ||
    portfolio.weeklyPnlPct !== weeklyPnlPct ||
    portfolio.peakEquityUsd !== peakEquityUsd ||
    portfolio.currentDrawdownPct !== currentDrawdownPct;

  if (!positionsChanged && !portfolioChanged) {
    return { portfolio, positions: [...positions] };
  }

  return {
    positions: positionsChanged ? updatedPositions : [...positions],
    portfolio: portfolioChanged
      ? {
          ...portfolio,
          unrealizedPnlUsd: roundedUnrealized,
          usedMarginUsd: roundedUsedMargin,
          totalEquityUsd,
          availableBalanceUsd,
          dailyPnlPct,
          weeklyPnlPct,
          peakEquityUsd,
          currentDrawdownPct,
        }
      : portfolio,
  };
}

export function buildOkxSubscriptionArgs(tickers: readonly MarketTicker[]): Array<{ channel: 'tickers'; instId: string }> {
  const seen = new Set<string>();
  const args: Array<{ channel: 'tickers'; instId: string }> = [];

  const defaults = [
    'BTC-USDT-SWAP',
    'BTC-USDT',
    'ETH-USDT-SWAP',
    'ETH-USDT',
    'SOL-USDT-SWAP',
    'SOL-USDT',
    'BNB-USDT-SWAP',
    'XRP-USDT-SWAP',
    'DOGE-USDT-SWAP',
    'AVAX-USDT-SWAP',
    'SUI-USDT-SWAP',
    'TON-USDT',
    'ADA-USDT',
    'LINK-USDT',
    'AAVE-USDT',
  ];

  for (const id of defaults) {
    seen.add(id);
    args.push({ channel: 'tickers', instId: id });
  }

  for (const tk of tickers) {
    if (args.length >= 30) break;
    const [base, quote = 'USDT'] = tk.symbol.toUpperCase().split('/');
    if (!base || quote === 'USD') continue;
    const instId = tk.marketType === 'PERPETUAL' ? `${base}-${quote}-SWAP` : `${base}-${quote}`;
    if (!seen.has(instId)) {
      seen.add(instId);
      args.push({ channel: 'tickers', instId });
    }
  }

  return args;
}

export function parseOkxPublicTickerFrame(rawText: string): DirectExchangeTickInput | null {
  if (!rawText || rawText === 'pong') return null;
  try {
    const parsed = JSON.parse(rawText) as {
      data?: Array<{
        instId?: string;
        last?: string;
        bidPx?: string;
        askPx?: string;
        open24h?: string;
        high24h?: string;
        low24h?: string;
        volCcy24h?: string;
        ts?: string;
      }>;
    };
    const item = parsed.data?.[0];
    if (!item?.instId || !item.last) return null;
    const isSwap = item.instId.endsWith('-SWAP');
    const cleanId = isSwap ? item.instId.slice(0, -5) : item.instId;
    const [base, quote] = cleanId.split('-');
    if (!base || !quote) return null;

    const lastPrice = Number(item.last);
    if (!Number.isFinite(lastPrice) || lastPrice <= 0) return null;
    const bidPrice = Number(item.bidPx) || lastPrice;
    const askPrice = Number(item.askPx) || lastPrice;
    const open24h = Number(item.open24h) || undefined;
    const high24h = Number(item.high24h) || undefined;
    const low24h = Number(item.low24h) || undefined;
    const rawVol = Number(item.volCcy24h);
    const volume24hUsd =
      Number.isFinite(rawVol) && rawVol > 0 ? (isSwap ? rawVol * lastPrice : rawVol) : undefined;
    const tsNum = Number(item.ts);

    return {
      symbol: `${base}/${quote}`,
      marketType: isSwap ? 'PERPETUAL' : 'SPOT',
      lastPrice,
      bidPrice,
      askPrice,
      open24h,
      high24h,
      low24h,
      volume24hUsd,
      timestampUtc: Number.isFinite(tsNum) && tsNum > 0 ? tsNum : Date.now(),
      sourceLabel: isSwap ? 'OKX Direct WS' : 'OKX Spot Direct WS',
    };
  } catch {
    return null;
  }
}
