import WebSocket from 'ws';
import { computeAllIndicators, detectMarketRegime } from '../src/engine/indicators.ts';
import {
  mergeLiveTickIntoCandles,
  validateLiveQuoteTick,
} from '../src/engine/priceFeedGuard.ts';
import {
  getSmartPriceDecimals,
  type MarketDirectoryEntry,
  normalizeSymbolInput,
  parseMarketSearchQuery,
  searchMarketDirectory,
} from '../src/engine/symbolSearch.ts';
import type {
  Candle,
  DataSourceStatus,
  MarketRegime,
  MarketTicker,
  MarketType,
  OrderBookLevel,
  OrderBookSnapshot,
} from '../src/engine/types.ts';

interface UniversePairConfig {
  symbol: string;
  base: string;
  quote: string;
  exchange: 'Binance' | 'Bybit' | 'OKX' | 'Kraken' | 'Coinbase Advanced';
  exchangeId: 'binance' | 'bybit' | 'okx' | 'kraken' | 'coinbase';
  marketType: MarketType;
  nativeSymbol: string;
  maxLeverage: number;
}

export interface ExchangeProbeTelemetry {
  exchangeId: string;
  apiStatus: 'OPERATIONAL' | 'DEGRADED' | 'UNREACHABLE';
  wsStatus: 'CONNECTED' | 'RECONNECTING' | 'FALLBACK_POLLING' | 'OFFLINE';
  apiLatencyMs: number;
  lastSyncUtc: string;
  dataHealth: 'HEALTHY' | 'DEGRADED' | 'UNKNOWN';
}

const MARKET_UNIVERSE: UniversePairConfig[] = [
  { symbol: 'BTC/USDT', base: 'BTC', quote: 'USDT', exchange: 'Binance', exchangeId: 'binance', marketType: 'PERPETUAL', nativeSymbol: 'BTCUSDT', maxLeverage: 20 },
  { symbol: 'BTC/USDT', base: 'BTC', quote: 'USDT', exchange: 'Binance', exchangeId: 'binance', marketType: 'SPOT', nativeSymbol: 'BTCUSDT', maxLeverage: 1 },
  { symbol: 'ETH/USDT', base: 'ETH', quote: 'USDT', exchange: 'Binance', exchangeId: 'binance', marketType: 'PERPETUAL', nativeSymbol: 'ETHUSDT', maxLeverage: 20 },
  { symbol: 'ETH/USDT', base: 'ETH', quote: 'USDT', exchange: 'OKX', exchangeId: 'okx', marketType: 'SPOT', nativeSymbol: 'ETH-USDT', maxLeverage: 1 },
  { symbol: 'SOL/USDT', base: 'SOL', quote: 'USDT', exchange: 'Bybit', exchangeId: 'bybit', marketType: 'PERPETUAL', nativeSymbol: 'SOLUSDT', maxLeverage: 15 },
  { symbol: 'SOL/USDT', base: 'SOL', quote: 'USDT', exchange: 'Binance', exchangeId: 'binance', marketType: 'SPOT', nativeSymbol: 'SOLUSDT', maxLeverage: 1 },
  { symbol: 'BNB/USDT', base: 'BNB', quote: 'USDT', exchange: 'Binance', exchangeId: 'binance', marketType: 'PERPETUAL', nativeSymbol: 'BNBUSDT', maxLeverage: 15 },
  { symbol: 'XRP/USDT', base: 'XRP', quote: 'USDT', exchange: 'Binance', exchangeId: 'binance', marketType: 'PERPETUAL', nativeSymbol: 'XRPUSDT', maxLeverage: 10 },
  { symbol: 'AVAX/USDT', base: 'AVAX', quote: 'USDT', exchange: 'Bybit', exchangeId: 'bybit', marketType: 'PERPETUAL', nativeSymbol: 'AVAXUSDT', maxLeverage: 10 },
  { symbol: 'LINK/USD', base: 'LINK', quote: 'USD', exchange: 'Coinbase Advanced', exchangeId: 'coinbase', marketType: 'SPOT', nativeSymbol: 'LINK-USD', maxLeverage: 1 },
  { symbol: 'SUI/USDT', base: 'SUI', quote: 'USDT', exchange: 'OKX', exchangeId: 'okx', marketType: 'PERPETUAL', nativeSymbol: 'SUI-USDT-SWAP', maxLeverage: 10 },
  { symbol: 'TON/USDT', base: 'TON', quote: 'USDT', exchange: 'Binance', exchangeId: 'binance', marketType: 'SPOT', nativeSymbol: 'TONUSDT', maxLeverage: 1 },
  { symbol: 'ADA/USDT', base: 'ADA', quote: 'USDT', exchange: 'Kraken', exchangeId: 'kraken', marketType: 'SPOT', nativeSymbol: 'ADAUSDT', maxLeverage: 1 },
  { symbol: 'DOGE/USDT', base: 'DOGE', quote: 'USDT', exchange: 'Binance', exchangeId: 'binance', marketType: 'PERPETUAL', nativeSymbol: 'DOGEUSDT', maxLeverage: 10 },
  { symbol: 'NEAR/USDT', base: 'NEAR', quote: 'USDT', exchange: 'Binance', exchangeId: 'binance', marketType: 'PERPETUAL', nativeSymbol: 'NEARUSDT', maxLeverage: 10 },
  { symbol: 'ARB/USDT', base: 'ARB', quote: 'USDT', exchange: 'OKX', exchangeId: 'okx', marketType: 'PERPETUAL', nativeSymbol: 'ARB-USDT-SWAP', maxLeverage: 10 },
  { symbol: 'AAVE/USDT', base: 'AAVE', quote: 'USDT', exchange: 'Binance', exchangeId: 'binance', marketType: 'SPOT', nativeSymbol: 'AAVEUSDT', maxLeverage: 1 },
  { symbol: 'INJ/USDT', base: 'INJ', quote: 'USDT', exchange: 'Bybit', exchangeId: 'bybit', marketType: 'PERPETUAL', nativeSymbol: 'INJUSDT', maxLeverage: 10 },
  { symbol: 'DOT/USDT', base: 'DOT', quote: 'USDT', exchange: 'Kraken', exchangeId: 'kraken', marketType: 'SPOT', nativeSymbol: 'DOTUSDT', maxLeverage: 1 },
  { symbol: 'LTC/USD', base: 'LTC', quote: 'USD', exchange: 'Coinbase Advanced', exchangeId: 'coinbase', marketType: 'SPOT', nativeSymbol: 'LTC-USD', maxLeverage: 1 },
];

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = 6500): Promise<{ ok: boolean; data: T | null; latencyMs: number }> {
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const latencyMs = Date.now() - t0;
    if (!res.ok) {
      return { ok: false, data: null, latencyMs };
    }
    const data = (await res.json()) as T;
    return { ok: true, data, latencyMs };
  } catch {
    return { ok: false, data: null, latencyMs: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

function computeLiquidityScore(volume24hUsd: number, spreadBps: number): number {
  const volPts =
    volume24hUsd <= 0
      ? 0
      : Math.min(65, Math.max(8, Math.round((Math.log10(Math.max(10_000, volume24hUsd)) - 4) * 12.5)));
  const spreadPts =
    spreadBps <= 0
      ? 0
      : spreadBps <= 1.5
        ? 35
        : spreadBps <= 4
          ? 30
          : spreadBps <= 10
            ? 23
            : spreadBps <= 25
              ? 14
              : 6;
  return Math.max(0, Math.min(100, volPts + spreadPts));
}

function normalizePricePrecision(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0.01;
  if (price < 0.0001) return 0.00000001;
  if (price < 0.01) return 0.000001;
  if (price < 2) return 0.0001;
  if (price < 100) return 0.001;
  return 0.01;
}

function tickerKey(symbol: string, marketType: MarketType, exchange?: string): string {
  return `${symbol.toUpperCase()}|${marketType}|${(exchange ?? '').toUpperCase()}`;
}

export function safeDisposeWebSocket(ws: WebSocket): void {
  try {
    ws.removeAllListeners();
    // Re-attach error listener after removeAllListeners() so terminate() during CONNECTING
    // ("WebSocket was closed before the connection was established") cannot crash Node.js.
    ws.on('error', () => {
      // ignore teardown errors
    });
    if (ws.readyState !== WebSocket.CLOSED) {
      ws.terminate();
    }
  } catch {
    // ignore
  }
}

export class MarketFeedManager {
  private tickers: MarketTicker[] = [];
  private dynamicConfigs: UniversePairConfig[] = [];
  private marketDirectory: MarketDirectoryEntry[] = [];
  private candleCache = new Map<
    string,
    { candles: Candle[]; fetchedAt: number; status: DataSourceStatus; source: string }
  >();
  private orderBookCache = new Map<string, { book: OrderBookSnapshot; fetchedAt: number }>();
  private coinbaseStatsCache = new Map<string, { open: string; high: string; low: string; last: string; volume: string; fetchedAt: number }>();
  private exchangeTelemetry = new Map<string, ExchangeProbeTelemetry>();
  private wsSockets = new Map<string, WebSocket>();
  private wsReconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private wsPingTimers = new Map<string, ReturnType<typeof setInterval>>();
  private wsLastMsgMs = new Map<string, number>();
  private wsStreamSignatures = new Map<string, string>();
  private wsStarted = false;
  private priceDirty = false;
  private lastProbeMs = 0;
  private refreshing = false;

  constructor() {
    this.initEmptyUniverse();
  }

  private initEmptyUniverse(): void {
    const now = Date.now();
    this.tickers = MARKET_UNIVERSE.map((cfg) => ({
      symbol: cfg.symbol,
      baseAsset: cfg.base,
      quoteAsset: cfg.quote,
      exchange: cfg.exchange,
      marketType: cfg.marketType,
      lastPrice: 0,
      bidPrice: 0,
      askPrice: 0,
      change24hPct: 0,
      high24h: 0,
      low24h: 0,
      volume24hUsd: 0,
      openInterestUsd: null,
      fundingRatePct: null,
      spreadBps: 0,
      volatility24hPct: 0,
      rsi14: null,
      regime: 'UNKNOWN_REGIME',
      liquidityScore: 0,
      dataStatus: 'UNAVAILABLE',
      sourceLabel: `${cfg.exchange} REST (Pending Sync)`,
      timestampUtc: now,
      latencyMs: 0,
      tickSize: 0.01,
      lotSize: 0.001,
      minOrderUsd: 10,
      maxLeverage: cfg.maxLeverage,
      tradingStatus: 'TRADING',
    }));
  }

  private resolveWsStatusForExchange(exchangeId: string, apiOk: boolean): ExchangeProbeTelemetry['wsStatus'] {
    const now = Date.now();
    if (exchangeId === 'binance') {
      const fapiAge = now - (this.wsLastMsgMs.get('binance_fapi') ?? 0);
      const spotAge = now - (this.wsLastMsgMs.get('binance_spot') ?? 0);
      if (fapiAge < 15_000 || spotAge < 15_000) return 'CONNECTED';
      if (this.wsStarted) return 'RECONNECTING';
    } else if (exchangeId === 'bybit' || exchangeId === 'okx') {
      const age = now - (this.wsLastMsgMs.get(exchangeId) ?? 0);
      if (age < 15_000) return 'CONNECTED';
      if (this.wsStarted) return 'RECONNECTING';
    }
    return apiOk ? 'FALLBACK_POLLING' : 'OFFLINE';
  }

  private setExchangeProbe(
    exchangeId: string,
    ok: boolean,
    latencyMs: number,
  ): void {
    this.exchangeTelemetry.set(exchangeId, {
      exchangeId,
      apiStatus: ok ? (latencyMs > 1800 ? 'DEGRADED' : 'OPERATIONAL') : 'UNREACHABLE',
      wsStatus: this.resolveWsStatusForExchange(exchangeId, ok),
      apiLatencyMs: latencyMs,
      lastSyncUtc: new Date().toISOString(),
      dataHealth: ok ? (latencyMs > 1800 ? 'DEGRADED' : 'HEALTHY') : 'UNKNOWN',
    });
  }

  public getExchangeTelemetry(): ExchangeProbeTelemetry[] {
    return Array.from(this.exchangeTelemetry.values()).map((t) => {
      const wsStatus = this.resolveWsStatusForExchange(t.exchangeId, t.apiStatus !== 'UNREACHABLE');
      return {
        ...t,
        wsStatus,
      };
    });
  }

  public consumePriceDirty(): boolean {
    const dirty = this.priceDirty;
    this.priceDirty = false;
    return dirty;
  }

  private applyLiveQuoteTick(params: {
    exchangeId: UniversePairConfig['exchangeId'];
    marketType?: MarketType;
    nativeSymbol: string;
    lastPrice?: number;
    bidPrice?: number;
    askPrice?: number;
    high24h?: number;
    low24h?: number;
    change24hPct?: number;
    volume24hUsd?: number;
    fundingRatePct?: number | null;
    openInterestUsd?: number | null;
    sourceLabel: string;
    eventTimeMs?: number;
  }): boolean {
    const now = Date.now();
    const nativeUpper = params.nativeSymbol.toUpperCase();
    const matchingCfgs = this.getActiveConfigs().filter(
      (c) =>
        c.exchangeId === params.exchangeId &&
        c.nativeSymbol.toUpperCase() === nativeUpper &&
        (!params.marketType || c.marketType === params.marketType),
    );
    if (matchingCfgs.length === 0) return false;

    let applied = false;
    for (const cfg of matchingCfgs) {
      const idx = this.tickers.findIndex(
        (t) =>
          t.symbol.toUpperCase() === cfg.symbol.toUpperCase() &&
          t.marketType === cfg.marketType &&
          t.exchange.toUpperCase() === cfg.exchange.toUpperCase(),
      );
      if (idx < 0) continue;
      const prev = this.tickers[idx];
      const bid = params.bidPrice && params.bidPrice > 0 ? params.bidPrice : prev.bidPrice;
      const ask = params.askPrice && params.askPrice > 0 ? params.askPrice : prev.askPrice;
      const derivedLast =
        params.lastPrice && params.lastPrice > 0
          ? params.lastPrice
          : bid > 0 && ask >= bid
            ? Number(((bid + ask) / 2).toFixed(Math.min(10, getSmartPriceDecimals(bid) + 1)))
            : prev.lastPrice;

      const validation = validateLiveQuoteTick({
        lastPrice: derivedLast,
        bidPrice: bid,
        askPrice: ask,
        prevPrice: prev.lastPrice,
        prevTimestampMs: prev.timestampUtc,
        timestampMs: now,
      });
      if (!validation.valid) continue;

      const finalBid = bid > 0 ? bid : derivedLast;
      const finalAsk = ask >= finalBid ? ask : derivedLast;
      const spreadBps = validation.spreadBps > 0 ? validation.spreadBps : prev.spreadBps;
      const nextHigh24 = Math.max(prev.high24h, derivedLast, params.high24h ?? 0);
      const nextLow24 =
        prev.low24h > 0
          ? Math.min(prev.low24h, derivedLast, params.low24h && params.low24h > 0 ? params.low24h : prev.low24h)
          : params.low24h && params.low24h > 0
            ? Math.min(params.low24h, derivedLast)
            : derivedLast;
      const volPct =
        derivedLast > 0 && nextHigh24 >= nextLow24
          ? Number((((nextHigh24 - nextLow24) / derivedLast) * 100).toFixed(2))
          : prev.volatility24hPct;
      const nextVol24Usd =
        params.volume24hUsd && params.volume24hUsd > 0 ? Math.round(params.volume24hUsd) : prev.volume24hUsd;
      const computedLatency =
        params.eventTimeMs && params.eventTimeMs > 0
          ? Math.max(12, Math.min(950, now - params.eventTimeMs))
          : Math.min(prev.latencyMs > 0 ? prev.latencyMs : 55, 120);

      this.tickers[idx] = {
        ...prev,
        lastPrice: derivedLast,
        bidPrice: finalBid,
        askPrice: finalAsk,
        spreadBps,
        high24h: nextHigh24,
        low24h: nextLow24,
        change24hPct:
          params.change24hPct !== undefined && Number.isFinite(params.change24hPct)
            ? Number(params.change24hPct.toFixed(2))
            : prev.change24hPct,
        volume24hUsd: nextVol24Usd,
        volatility24hPct: volPct,
        liquidityScore: computeLiquidityScore(nextVol24Usd, spreadBps) || prev.liquidityScore,
        fundingRatePct:
          params.fundingRatePct !== undefined ? params.fundingRatePct : prev.fundingRatePct,
        openInterestUsd:
          params.openInterestUsd !== undefined ? params.openInterestUsd : prev.openInterestUsd,
        dataStatus: 'LIVE_EXCHANGE',
        sourceLabel: params.sourceLabel,
        timestampUtc: now,
        latencyMs: computedLatency,
        tickSize: normalizePricePrecision(derivedLast),
      };

      // Stitch live tick onto active cached candles so charts & indicators reflect sub-second ticks
      const cachePrefix = `${cfg.symbol.toUpperCase()}|${cfg.marketType}|${cfg.exchange.toUpperCase()}|`;
      for (const [cKey, cached] of this.candleCache.entries()) {
        if (!cKey.startsWith(cachePrefix) || cached.candles.length === 0) continue;
        const iv = cKey.slice(cachePrefix.length);
        cached.candles = mergeLiveTickIntoCandles(cached.candles, derivedLast, now, iv);
      }

      applied = true;
      this.priceDirty = true;
    }

    return applied;
  }

  public startRealtimeStreams(): void {
    if (
      this.wsStarted ||
      process.env.VERCEL ||
      process.env.VERCEL_ENV ||
      process.env.OMNISENT_SKIP_LISTEN
    ) {
      return;
    }
    this.wsStarted = true;
    this.syncRealtimeStreamSubscriptions();
  }

  private syncRealtimeStreamSubscriptions(): void {
    if (!this.wsStarted) return;
    this.connectBinanceStream('binance_fapi', 'PERPETUAL');
    this.connectBinanceStream('binance_spot', 'SPOT');
    this.connectBybitStream();
    this.connectOkxStream();
  }

  private clearStreamTimers(streamKey: string): void {
    const t = this.wsReconnectTimers.get(streamKey);
    if (t) {
      clearTimeout(t);
      this.wsReconnectTimers.delete(streamKey);
    }
    const p = this.wsPingTimers.get(streamKey);
    if (p) {
      clearInterval(p);
      this.wsPingTimers.delete(streamKey);
    }
  }

  private scheduleStreamReconnect(streamKey: string, reconnectFn: () => void, delayMs = 3500): void {
    if (!this.wsStarted) return;
    this.clearStreamTimers(streamKey);
    this.wsReconnectTimers.set(
      streamKey,
      setTimeout(() => {
        reconnectFn();
      }, delayMs),
    );
  }

  private connectBinanceStream(streamKey: 'binance_fapi' | 'binance_spot', marketType: MarketType): void {
    const pairs = Array.from(
      new Set(
        this.getActiveConfigs()
          .filter((c) => c.exchangeId === 'binance' && c.marketType === marketType)
          .map((c) => c.nativeSymbol.toLowerCase()),
      ),
    );
    if (pairs.length === 0) return;

    const streams: string[] = [];
    for (const sym of pairs) {
      streams.push(`${sym}@bookTicker`);
      if (marketType === 'PERPETUAL') {
        streams.push(`${sym}@markPrice@1s`);
      }
    }
    const sig = streams.join('/');
    const existing = this.wsSockets.get(streamKey);
    if (existing && this.wsStreamSignatures.get(streamKey) === sig && existing.readyState <= WebSocket.OPEN) {
      return;
    }
    if (existing) {
      safeDisposeWebSocket(existing);
      this.wsSockets.delete(streamKey);
    }
    this.clearStreamTimers(streamKey);
    this.wsStreamSignatures.set(streamKey, sig);

    const host =
      marketType === 'PERPETUAL'
        ? 'wss://fstream.binance.com/stream'
        : 'wss://stream.binance.com:9443/stream';
    const url = `${host}?streams=${sig}`;

    try {
      const ws = new WebSocket(url, { handshakeTimeout: 8000 });
      this.wsSockets.set(streamKey, ws);

      ws.on('message', (raw) => {
        this.wsLastMsgMs.set(streamKey, Date.now());
        try {
          const parsed = JSON.parse(raw.toString()) as {
            stream?: string;
            data?: {
              s?: string;
              b?: string;
              a?: string;
              p?: string;
              r?: string;
              E?: number;
            };
          };
          const d = parsed.data;
          if (!d?.s) return;
          if (parsed.stream?.endsWith('@bookTicker')) {
            const bid = Number(d.b);
            const ask = Number(d.a);
            if (bid > 0 && ask >= bid) {
              this.applyLiveQuoteTick({
                exchangeId: 'binance',
                marketType,
                nativeSymbol: d.s,
                bidPrice: bid,
                askPrice: ask,
                sourceLabel: marketType === 'PERPETUAL' ? 'Binance FAPI WS' : 'Binance Spot WS',
                eventTimeMs: d.E,
              });
            }
          } else if (parsed.stream?.includes('@markPrice') && marketType === 'PERPETUAL') {
            const mark = Number(d.p);
            const fr = Number(d.r);
            this.applyLiveQuoteTick({
              exchangeId: 'binance',
              marketType: 'PERPETUAL',
              nativeSymbol: d.s,
              lastPrice: mark > 0 ? mark : undefined,
              fundingRatePct: Number.isFinite(fr) ? Number((fr * 100).toFixed(4)) : undefined,
              sourceLabel: 'Binance FAPI WS',
              eventTimeMs: d.E,
            });
          }
        } catch {
          // ignore malformed frame
        }
      });

      ws.on('error', () => {
        // handled by close
      });

      ws.on('close', () => {
        if (this.wsSockets.get(streamKey) === ws) {
          this.wsSockets.delete(streamKey);
          this.scheduleStreamReconnect(streamKey, () => this.connectBinanceStream(streamKey, marketType));
        }
      });
    } catch {
      this.scheduleStreamReconnect(streamKey, () => this.connectBinanceStream(streamKey, marketType), 5000);
    }
  }

  private connectBybitStream(): void {
    const streamKey = 'bybit';
    const pairs = Array.from(
      new Set(
        this.getActiveConfigs()
          .filter((c) => c.exchangeId === 'bybit')
          .map((c) => `tickers.${c.nativeSymbol}`),
      ),
    );
    if (pairs.length === 0) return;

    const sig = pairs.join(',');
    const existing = this.wsSockets.get(streamKey);
    if (existing && this.wsStreamSignatures.get(streamKey) === sig && existing.readyState <= WebSocket.OPEN) {
      return;
    }
    if (existing) {
      safeDisposeWebSocket(existing);
      this.wsSockets.delete(streamKey);
    }
    this.clearStreamTimers(streamKey);
    this.wsStreamSignatures.set(streamKey, sig);

    try {
      const ws = new WebSocket('wss://stream.bybit.com/v5/public/linear', { handshakeTimeout: 8000 });
      this.wsSockets.set(streamKey, ws);

      ws.on('open', () => {
        for (let i = 0; i < pairs.length; i += 10) {
          ws.send(JSON.stringify({ op: 'subscribe', args: pairs.slice(i, i + 10) }));
        }
        const ping = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ op: 'ping' }));
          }
        }, 20_000);
        this.wsPingTimers.set(streamKey, ping);
      });

      ws.on('message', (raw) => {
        this.wsLastMsgMs.set(streamKey, Date.now());
        try {
          const parsed = JSON.parse(raw.toString()) as {
            topic?: string;
            ts?: number;
            data?: {
              symbol?: string;
              lastPrice?: string;
              bid1Price?: string;
              ask1Price?: string;
              highPrice24h?: string;
              lowPrice24h?: string;
              price24hPcnt?: string;
              turnover24h?: string;
              fundingRate?: string;
              openInterestValue?: string;
            };
          };
          const d = parsed.data;
          if (!parsed.topic?.startsWith('tickers.') || !d) return;
          const native = d.symbol || parsed.topic.slice('tickers.'.length);
          const fr = d.fundingRate !== undefined ? Number(d.fundingRate) : NaN;
          const oi = d.openInterestValue !== undefined ? Number(d.openInterestValue) : NaN;
          const pcnt = d.price24hPcnt !== undefined ? Number(d.price24hPcnt) : NaN;
          this.applyLiveQuoteTick({
            exchangeId: 'bybit',
            marketType: 'PERPETUAL',
            nativeSymbol: native,
            lastPrice: d.lastPrice ? Number(d.lastPrice) : undefined,
            bidPrice: d.bid1Price ? Number(d.bid1Price) : undefined,
            askPrice: d.ask1Price ? Number(d.ask1Price) : undefined,
            high24h: d.highPrice24h ? Number(d.highPrice24h) : undefined,
            low24h: d.lowPrice24h ? Number(d.lowPrice24h) : undefined,
            change24hPct: Number.isFinite(pcnt) ? pcnt * 100 : undefined,
            volume24hUsd: d.turnover24h ? Number(d.turnover24h) : undefined,
            fundingRatePct: Number.isFinite(fr) ? Number((fr * 100).toFixed(4)) : undefined,
            openInterestUsd: Number.isFinite(oi) && oi > 0 ? Math.round(oi) : undefined,
            sourceLabel: 'Bybit V5 WS',
            eventTimeMs: parsed.ts,
          });
        } catch {
          // ignore
        }
      });

      ws.on('error', () => {
        // handled on close
      });

      ws.on('close', () => {
        this.clearStreamTimers(streamKey);
        if (this.wsSockets.get(streamKey) === ws) {
          this.wsSockets.delete(streamKey);
          this.scheduleStreamReconnect(streamKey, () => this.connectBybitStream());
        }
      });
    } catch {
      this.scheduleStreamReconnect(streamKey, () => this.connectBybitStream(), 5000);
    }
  }

  private connectOkxStream(): void {
    const streamKey = 'okx';
    const pairs = Array.from(
      new Set(
        this.getActiveConfigs()
          .filter((c) => c.exchangeId === 'okx')
          .map((c) => c.nativeSymbol),
      ),
    );
    if (pairs.length === 0) return;

    const sig = pairs.join(',');
    const existing = this.wsSockets.get(streamKey);
    if (existing && this.wsStreamSignatures.get(streamKey) === sig && existing.readyState <= WebSocket.OPEN) {
      return;
    }
    if (existing) {
      safeDisposeWebSocket(existing);
      this.wsSockets.delete(streamKey);
    }
    this.clearStreamTimers(streamKey);
    this.wsStreamSignatures.set(streamKey, sig);

    try {
      const ws = new WebSocket('wss://ws.okx.com:8443/ws/v5/public', { handshakeTimeout: 8000 });
      this.wsSockets.set(streamKey, ws);

      ws.on('open', () => {
        ws.send(
          JSON.stringify({
            op: 'subscribe',
            args: pairs.map((instId) => ({ channel: 'tickers', instId })),
          }),
        );
        const ping = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send('ping');
          }
        }, 22_000);
        this.wsPingTimers.set(streamKey, ping);
      });

      ws.on('message', (raw) => {
        this.wsLastMsgMs.set(streamKey, Date.now());
        const text = raw.toString();
        if (text === 'pong') return;
        try {
          const parsed = JSON.parse(text) as {
            arg?: { channel?: string; instId?: string };
            data?: Array<{
              instId: string;
              last: string;
              bidPx: string;
              askPx: string;
              open24h: string;
              high24h: string;
              low24h: string;
              volCcy24h: string;
              ts?: string;
            }>;
          };
          const d = parsed.data?.[0];
          if (!d?.instId) return;
          const isSwap = d.instId.endsWith('-SWAP');
          const last = Number(d.last);
          const open24 = Number(d.open24h);
          const volCcy = Number(d.volCcy24h);
          this.applyLiveQuoteTick({
            exchangeId: 'okx',
            marketType: isSwap ? 'PERPETUAL' : 'SPOT',
            nativeSymbol: d.instId,
            lastPrice: last,
            bidPrice: Number(d.bidPx),
            askPrice: Number(d.askPx),
            high24h: Number(d.high24h),
            low24h: Number(d.low24h),
            change24hPct: open24 > 0 && last > 0 ? ((last - open24) / open24) * 100 : undefined,
            volume24hUsd: volCcy > 0 ? (isSwap ? volCcy * last : volCcy) : undefined,
            sourceLabel: isSwap ? 'OKX V5 Swap WS' : 'OKX V5 Spot WS',
            eventTimeMs: d.ts ? Number(d.ts) : undefined,
          });
        } catch {
          // ignore
        }
      });

      ws.on('error', () => {
        // handled on close
      });

      ws.on('close', () => {
        this.clearStreamTimers(streamKey);
        if (this.wsSockets.get(streamKey) === ws) {
          this.wsSockets.delete(streamKey);
          this.scheduleStreamReconnect(streamKey, () => this.connectOkxStream());
        }
      });
    } catch {
      this.scheduleStreamReconnect(streamKey, () => this.connectOkxStream(), 5000);
    }
  }

  public async refreshPairQuote(
    symbol: string,
    marketType?: MarketType,
    exchange?: string,
  ): Promise<MarketTicker | undefined> {
    const cfg = this.findUniverseConfig(symbol, marketType, exchange);
    if (!cfg) return this.getTicker(symbol, marketType, exchange);

    if (cfg.exchangeId === 'binance') {
      const url =
        cfg.marketType === 'PERPETUAL'
          ? `https://fapi.binance.com/fapi/v1/ticker/bookTicker?symbol=${encodeURIComponent(cfg.nativeSymbol)}`
          : `https://api.binance.com/api/v3/ticker/bookTicker?symbol=${encodeURIComponent(cfg.nativeSymbol)}`;
      const res = await fetchJsonWithTimeout<{ bidPrice?: string; askPrice?: string }>(url, 2200);
      if (res.ok && res.data) {
        const bid = Number(res.data.bidPrice);
        const ask = Number(res.data.askPrice);
        if (bid > 0 && ask >= bid) {
          this.applyLiveQuoteTick({
            exchangeId: 'binance',
            marketType: cfg.marketType,
            nativeSymbol: cfg.nativeSymbol,
            bidPrice: bid,
            askPrice: ask,
            sourceLabel: cfg.marketType === 'PERPETUAL' ? 'Binance FAPI Fast' : 'Binance Spot Fast',
            eventTimeMs: Date.now() - Math.min(250, res.latencyMs),
          });
        }
      }
    } else if (cfg.exchangeId === 'bybit') {
      const res = await fetchJsonWithTimeout<{
        retCode: number;
        result?: { list?: Array<{ lastPrice: string; bid1Price: string; ask1Price: string }> };
      }>(
        `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${encodeURIComponent(cfg.nativeSymbol)}`,
        2200,
      );
      const item = res.ok && res.data?.retCode === 0 ? res.data.result?.list?.[0] : undefined;
      if (item) {
        this.applyLiveQuoteTick({
          exchangeId: 'bybit',
          marketType: 'PERPETUAL',
          nativeSymbol: cfg.nativeSymbol,
          lastPrice: Number(item.lastPrice),
          bidPrice: Number(item.bid1Price),
          askPrice: Number(item.ask1Price),
          sourceLabel: 'Bybit V5 Fast',
          eventTimeMs: Date.now() - Math.min(250, res.latencyMs),
        });
      }
    } else if (cfg.exchangeId === 'okx') {
      const res = await fetchJsonWithTimeout<{
        code: string;
        data?: Array<{ last: string; bidPx: string; askPx: string }>;
      }>(
        `https://www.okx.com/api/v5/market/ticker?instId=${encodeURIComponent(cfg.nativeSymbol)}`,
        2200,
      );
      const item = res.ok && res.data?.code === '0' ? res.data.data?.[0] : undefined;
      if (item) {
        this.applyLiveQuoteTick({
          exchangeId: 'okx',
          marketType: cfg.marketType,
          nativeSymbol: cfg.nativeSymbol,
          lastPrice: Number(item.last),
          bidPrice: Number(item.bidPx),
          askPrice: Number(item.askPx),
          sourceLabel: cfg.marketType === 'PERPETUAL' ? 'OKX Swap Fast' : 'OKX Spot Fast',
          eventTimeMs: Date.now() - Math.min(250, res.latencyMs),
        });
      }
    } else if (cfg.exchangeId === 'kraken') {
      const res = await fetchJsonWithTimeout<{
        result?: Record<string, { a: [string]; b: [string]; c: [string] }>;
      }>(`https://api.kraken.com/0/public/Ticker?pair=${encodeURIComponent(cfg.nativeSymbol)}`, 2200);
      const item = res.ok && res.data?.result ? res.data.result[cfg.nativeSymbol] : undefined;
      if (item) {
        this.applyLiveQuoteTick({
          exchangeId: 'kraken',
          marketType: 'SPOT',
          nativeSymbol: cfg.nativeSymbol,
          lastPrice: Number(item.c[0]),
          bidPrice: Number(item.b[0]),
          askPrice: Number(item.a[0]),
          sourceLabel: 'Kraken Fast REST',
          eventTimeMs: Date.now() - Math.min(250, res.latencyMs),
        });
      }
    } else if (cfg.exchangeId === 'coinbase') {
      const res = await fetchJsonWithTimeout<{ price?: string; bid?: string; ask?: string }>(
        `https://api.exchange.coinbase.com/products/${encodeURIComponent(cfg.nativeSymbol)}/ticker`,
        2200,
      );
      if (res.ok && res.data?.price) {
        this.applyLiveQuoteTick({
          exchangeId: 'coinbase',
          marketType: 'SPOT',
          nativeSymbol: cfg.nativeSymbol,
          lastPrice: Number(res.data.price),
          bidPrice: Number(res.data.bid),
          askPrice: Number(res.data.ask),
          sourceLabel: 'Coinbase Fast REST',
          eventTimeMs: Date.now() - Math.min(250, res.latencyMs),
        });
      }
    }

    return this.getTicker(cfg.symbol, cfg.marketType, cfg.exchange);
  }

  private getActiveConfigs(): UniversePairConfig[] {
    return [...MARKET_UNIVERSE, ...this.dynamicConfigs];
  }

  private directoryEntryToConfig(entry: MarketDirectoryEntry): UniversePairConfig {
    return {
      symbol: entry.symbol,
      base: entry.baseAsset,
      quote: entry.quoteAsset,
      exchange: entry.exchange,
      exchangeId: entry.exchangeId,
      marketType: entry.marketType,
      nativeSymbol: entry.nativeSymbol,
      maxLeverage: entry.maxLeverage,
    };
  }

  private findUniverseConfig(
    symbol: string,
    marketType?: MarketType,
    exchange?: string,
  ): UniversePairConfig | undefined {
    const symUpper = normalizeSymbolInput(symbol);
    const active = this.getActiveConfigs();
    const exUpper = exchange?.trim().toUpperCase();

    const exact =
      active.find(
        (u) =>
          u.symbol.toUpperCase() === symUpper &&
          (!marketType || u.marketType === marketType) &&
          (!exUpper || u.exchange.toUpperCase() === exUpper || u.exchangeId.toUpperCase() === exUpper),
      ) ??
      active.find(
        (u) =>
          u.symbol.toUpperCase() === symUpper &&
          (!marketType || u.marketType === marketType),
      ) ??
      active.find((u) => u.symbol.toUpperCase() === symUpper);
    if (exact) return exact;

    // Fallback to full live multi-exchange MarketDirectory (sorted by liquidity)
    const dirCandidates = this.marketDirectory.filter(
      (d) =>
        d.symbol.toUpperCase() === symUpper &&
        (!marketType || d.marketType === marketType) &&
        (!exUpper || d.exchange.toUpperCase() === exUpper || d.exchangeId.toUpperCase() === exUpper),
    );
    const fallbackCandidates =
      dirCandidates.length > 0
        ? dirCandidates
        : this.marketDirectory.filter(
            (d) => d.symbol.toUpperCase() === symUpper && (!marketType || d.marketType === marketType),
          );
    const anyMatch =
      fallbackCandidates.length > 0
        ? fallbackCandidates
        : this.marketDirectory.filter((d) => d.symbol.toUpperCase() === symUpper);

    if (anyMatch.length > 0) {
      const sorted = [...anyMatch].sort((a, b) => b.volume24hUsd - a.volume24hUsd);
      return this.directoryEntryToConfig(sorted[0]);
    }

    return undefined;
  }

  /**
   * Fetches authentic live data concurrently from Binance (Spot & FAPI),
   * Bybit V5, OKX V5, Kraken, and Coinbase Advanced public REST endpoints.
   * Never fabricates fallback numbers when an exchange is offline.
   */
  public async refreshFeed(): Promise<void> {
    const now = Date.now();
    if (this.refreshing || now - this.lastProbeMs < 7000) {
      return;
    }
    this.refreshing = true;
    this.lastProbeMs = now;

    try {
      const activeConfigs = this.getActiveConfigs();
      const binancePerpSyms = Array.from(
        new Set(
          activeConfigs
            .filter((u) => u.exchangeId === 'binance' && u.marketType === 'PERPETUAL')
            .map((u) => u.nativeSymbol),
        ),
      );

      const okxSwapSyms = Array.from(
        new Set(
          activeConfigs
            .filter((u) => u.exchangeId === 'okx' && u.marketType === 'PERPETUAL')
            .map((u) => u.nativeSymbol),
        ),
      );

      const needLinkStats =
        !this.coinbaseStatsCache.has('LINK-USD') ||
        now - (this.coinbaseStatsCache.get('LINK-USD')?.fetchedAt ?? 0) > 60_000;
      const needLtcStats =
        !this.coinbaseStatsCache.has('LTC-USD') ||
        now - (this.coinbaseStatsCache.get('LTC-USD')?.fetchedAt ?? 0) > 60_000;

      const [
        bnSpotRes,
        bnSpotBookRes,
        bnFapi24Res,
        bnFapiBookRes,
        bnFapiPremRes,
        bybitLinearRes,
        okxSpotRes,
        okxSwapRes,
        okxOiRes,
        krakenRes,
        cbLinkTicker,
        cbLinkStats,
        cbLtcTicker,
        cbLtcStats,
        ...extraRes
      ] = await Promise.all([
        fetchJsonWithTimeout<Array<{
          symbol: string;
          lastPrice: string;
          bidPrice: string;
          askPrice: string;
          priceChangePercent: string;
          highPrice: string;
          lowPrice: string;
          quoteVolume: string;
        }>>('https://api.binance.com/api/v3/ticker/24hr'),
        fetchJsonWithTimeout<Array<{
          symbol: string;
          bidPrice: string;
          askPrice: string;
        }>>('https://api.binance.com/api/v3/ticker/bookTicker'),
        fetchJsonWithTimeout<Array<{
          symbol: string;
          lastPrice: string;
          priceChangePercent: string;
          highPrice: string;
          lowPrice: string;
          quoteVolume: string;
        }>>('https://fapi.binance.com/fapi/v1/ticker/24hr'),
        fetchJsonWithTimeout<Array<{
          symbol: string;
          bidPrice: string;
          askPrice: string;
        }>>('https://fapi.binance.com/fapi/v1/ticker/bookTicker'),
        fetchJsonWithTimeout<Array<{
          symbol: string;
          lastFundingRate: string;
        }>>('https://fapi.binance.com/fapi/v1/premiumIndex'),
        fetchJsonWithTimeout<{
          retCode: number;
          result?: {
            list?: Array<{
              symbol: string;
              lastPrice: string;
              bid1Price: string;
              ask1Price: string;
              price24hPcnt: string;
              highPrice24h: string;
              lowPrice24h: string;
              turnover24h: string;
              openInterestValue: string;
              fundingRate: string;
            }>;
          };
        }>('https://api.bybit.com/v5/market/tickers?category=linear'),
        fetchJsonWithTimeout<{
          code: string;
          data?: Array<{
            instId: string;
            last: string;
            bidPx: string;
            askPx: string;
            open24h: string;
            high24h: string;
            low24h: string;
            volCcy24h: string;
          }>;
        }>('https://www.okx.com/api/v5/market/tickers?instType=SPOT'),
        fetchJsonWithTimeout<{
          code: string;
          data?: Array<{
            instId: string;
            last: string;
            bidPx: string;
            askPx: string;
            open24h: string;
            high24h: string;
            low24h: string;
            volCcy24h: string;
          }>;
        }>('https://www.okx.com/api/v5/market/tickers?instType=SWAP'),
        fetchJsonWithTimeout<{
          code: string;
          data?: Array<{
            instId: string;
            oiUsd: string;
          }>;
        }>('https://www.okx.com/api/v5/public/open-interest?instType=SWAP'),
        fetchJsonWithTimeout<{
          error: string[];
          result?: Record<
            string,
            {
              a: [string, string, string];
              b: [string, string, string];
              c: [string, string];
              v: [string, string];
              p: [string, string];
              l: [string, string];
              h: [string, string];
              o: string;
            }
          >;
        }>('https://api.kraken.com/0/public/Ticker?pair=ADAUSDT,DOTUSDT'),
        fetchJsonWithTimeout<{ price: string; bid: string; ask: string }>('https://api.exchange.coinbase.com/products/LINK-USD/ticker'),
        needLinkStats
          ? fetchJsonWithTimeout<{ open: string; high: string; low: string; last: string; volume: string }>('https://api.exchange.coinbase.com/products/LINK-USD/stats')
          : Promise.resolve({ ok: true, data: this.coinbaseStatsCache.get('LINK-USD') ?? null, latencyMs: 0 }),
        fetchJsonWithTimeout<{ price: string; bid: string; ask: string }>('https://api.exchange.coinbase.com/products/LTC-USD/ticker'),
        needLtcStats
          ? fetchJsonWithTimeout<{ open: string; high: string; low: string; last: string; volume: string }>('https://api.exchange.coinbase.com/products/LTC-USD/stats')
          : Promise.resolve({ ok: true, data: this.coinbaseStatsCache.get('LTC-USD') ?? null, latencyMs: 0 }),
        ...binancePerpSyms.map((s) =>
          fetchJsonWithTimeout<{ symbol: string; openInterest: string }>(
            `https://fapi.binance.com/fapi/v1/openInterest?symbol=${s}`,
          ),
        ),
        ...okxSwapSyms.map((instId) =>
          fetchJsonWithTimeout<{ code: string; data?: Array<{ instId: string; fundingRate: string }> }>(
            `https://www.okx.com/api/v5/public/funding-rate?instId=${instId}`,
          ),
        ),
      ]);

      if (needLinkStats && cbLinkStats.ok && cbLinkStats.data) {
        this.coinbaseStatsCache.set('LINK-USD', { ...cbLinkStats.data, fetchedAt: now });
      }
      if (needLtcStats && cbLtcStats.ok && cbLtcStats.data) {
        this.coinbaseStatsCache.set('LTC-USD', { ...cbLtcStats.data, fetchedAt: now });
      }

      const bnOiResponses = extraRes.slice(0, binancePerpSyms.length) as Array<
        Awaited<ReturnType<typeof fetchJsonWithTimeout<{ symbol: string; openInterest: string }>>>
      >;
      const okxFrResponses = extraRes.slice(binancePerpSyms.length) as Array<
        Awaited<ReturnType<typeof fetchJsonWithTimeout<{ code: string; data?: Array<{ instId: string; fundingRate: string }> }>>>
      >;

      // Index exchange maps cleanly
      const bnSpotMap = new Map<string, NonNullable<typeof bnSpotRes.data>[number]>();
      if (bnSpotRes.ok && Array.isArray(bnSpotRes.data)) {
        for (const r of bnSpotRes.data) bnSpotMap.set(r.symbol, r);
      }

      const bnSpotBookMap = new Map<string, { bidPrice: string; askPrice: string }>();
      if (bnSpotBookRes.ok && Array.isArray(bnSpotBookRes.data)) {
        for (const r of bnSpotBookRes.data) bnSpotBookMap.set(r.symbol, r);
      }

      const bnFapi24Map = new Map<string, NonNullable<typeof bnFapi24Res.data>[number]>();
      if (bnFapi24Res.ok && Array.isArray(bnFapi24Res.data)) {
        for (const r of bnFapi24Res.data) bnFapi24Map.set(r.symbol, r);
      }

      const bnFapiBookMap = new Map<string, { bidPrice: string; askPrice: string }>();
      if (bnFapiBookRes.ok && Array.isArray(bnFapiBookRes.data)) {
        for (const r of bnFapiBookRes.data) bnFapiBookMap.set(r.symbol, r);
      }

      const bnFapiPremMap = new Map<string, { lastFundingRate: string }>();
      if (bnFapiPremRes.ok && Array.isArray(bnFapiPremRes.data)) {
        for (const r of bnFapiPremRes.data) bnFapiPremMap.set(r.symbol, r);
      }

      const bnOiQtyMap = new Map<string, number>();
      for (const oiRes of bnOiResponses) {
        if (oiRes.ok && oiRes.data?.symbol) {
          const q = Number(oiRes.data.openInterest);
          if (Number.isFinite(q) && q >= 0) bnOiQtyMap.set(oiRes.data.symbol, q);
        }
      }

      interface BybitTickerItem {
        symbol: string;
        lastPrice: string;
        bid1Price: string;
        ask1Price: string;
        price24hPcnt: string;
        highPrice24h: string;
        lowPrice24h: string;
        turnover24h: string;
        openInterestValue: string;
        fundingRate: string;
      }
      const bybitMap = new Map<string, BybitTickerItem>();
      if (bybitLinearRes.ok && bybitLinearRes.data?.retCode === 0 && bybitLinearRes.data.result?.list) {
        for (const r of bybitLinearRes.data.result.list) bybitMap.set(r.symbol, r);
      }

      const okxSpotMap = new Map<string, NonNullable<NonNullable<typeof okxSpotRes.data>['data']>[number]>();
      if (okxSpotRes.ok && okxSpotRes.data?.data) {
        for (const r of okxSpotRes.data.data) okxSpotMap.set(r.instId, r);
      }

      const okxSwapMap = new Map<string, NonNullable<NonNullable<typeof okxSwapRes.data>['data']>[number]>();
      if (okxSwapRes.ok && okxSwapRes.data?.data) {
        for (const r of okxSwapRes.data.data) okxSwapMap.set(r.instId, r);
      }

      const okxOiUsdMap = new Map<string, number>();
      if (okxOiRes.ok && okxOiRes.data?.data) {
        for (const r of okxOiRes.data.data) {
          const usd = Number(r.oiUsd);
          if (Number.isFinite(usd)) okxOiUsdMap.set(r.instId, usd);
        }
      }

      const okxFrPctMap = new Map<string, number>();
      for (const frRes of okxFrResponses) {
        const item = frRes.data?.data?.[0];
        if (frRes.ok && item?.instId) {
          const rate = Number(item.fundingRate) * 100;
          if (Number.isFinite(rate)) okxFrPctMap.set(item.instId, rate);
        }
      }

      const krakenResult = krakenRes.ok && krakenRes.data?.result ? krakenRes.data.result : {};
      const coinbasePairs: Record<
        string,
        {
          ticker: typeof cbLinkTicker;
          stats: typeof cbLinkStats;
        }
      > = {
        'LINK-USD': { ticker: cbLinkTicker, stats: cbLinkStats },
        'LTC-USD': { ticker: cbLtcTicker, stats: cbLtcStats },
      };

      // Record authentic probe telemetry per exchange
      this.setExchangeProbe(
        'binance',
        bnSpotRes.ok || bnFapi24Res.ok,
        Math.round((bnSpotRes.latencyMs + bnFapi24Res.latencyMs) / 2),
      );
      this.setExchangeProbe('bybit', bybitLinearRes.ok && bybitMap.size > 0, bybitLinearRes.latencyMs);
      this.setExchangeProbe(
        'okx',
        (okxSpotRes.ok && okxSpotMap.size > 0) || (okxSwapRes.ok && okxSwapMap.size > 0),
        Math.round((okxSpotRes.latencyMs + okxSwapRes.latencyMs) / 2),
      );
      this.setExchangeProbe('kraken', krakenRes.ok && Object.keys(krakenResult).length > 0, krakenRes.latencyMs);
      this.setExchangeProbe(
        'coinbase',
        cbLinkTicker.ok || cbLtcTicker.ok,
        Math.round((cbLinkTicker.latencyMs + cbLtcTicker.latencyMs) / 2),
      );

      // Rebuild authentic full multi-exchange MarketDirectory strictly from live responses
      const dirEntries: MarketDirectoryEntry[] = [];
      const parseBinancePair = (native: string): { base: string; quote: string } | null => {
        if (native.endsWith('USDT') && native.length > 4) {
          return { base: native.slice(0, -4), quote: 'USDT' };
        }
        if (native.endsWith('USDC') && native.length > 4) {
          return { base: native.slice(0, -4), quote: 'USDC' };
        }
        return null;
      };
      const isLeveragedJunkToken = (base: string) =>
        /(UP|DOWN|BULL|BEAR)$/.test(base) && base.length > 4;

      // 1) Binance FAPI Perpetual
      for (const q of bnFapi24Map.values()) {
        const parsed = parseBinancePair(q.symbol);
        if (!parsed) continue;
        const last = Number(q.lastPrice);
        const vol = Number(q.quoteVolume);
        if (!(last > 0 && vol >= 10_000)) continue;
        const bk = bnFapiBookMap.get(q.symbol);
        const prem = bnFapiPremMap.get(q.symbol);
        const bid = Number(bk?.bidPrice || last);
        const ask = Number(bk?.askPrice || last);
        const frNum = prem ? Number(prem.lastFundingRate) : NaN;
        dirEntries.push({
          symbol: `${parsed.base}/${parsed.quote}`,
          baseAsset: parsed.base,
          quoteAsset: parsed.quote,
          exchange: 'Binance',
          exchangeId: 'binance',
          marketType: 'PERPETUAL',
          nativeSymbol: q.symbol,
          lastPrice: last,
          bidPrice: bid > 0 ? bid : last,
          askPrice: ask > 0 ? ask : last,
          change24hPct: Number(q.priceChangePercent) || 0,
          volume24hUsd: Math.round(vol),
          maxLeverage: 20,
          high24h: Number(q.highPrice) || undefined,
          low24h: Number(q.lowPrice) || undefined,
          fundingRatePct: Number.isFinite(frNum) ? Number((frNum * 100).toFixed(4)) : null,
          openInterestUsd: null,
        });
      }

      // 2) Binance Spot
      for (const q of bnSpotMap.values()) {
        const parsed = parseBinancePair(q.symbol);
        if (!parsed || isLeveragedJunkToken(parsed.base)) continue;
        const last = Number(q.lastPrice);
        const vol = Number(q.quoteVolume);
        if (!(last > 0 && vol >= 25_000)) continue;
        const bk = bnSpotBookMap.get(q.symbol);
        const bid = Number(bk?.bidPrice || q.bidPrice || last);
        const ask = Number(bk?.askPrice || q.askPrice || last);
        dirEntries.push({
          symbol: `${parsed.base}/${parsed.quote}`,
          baseAsset: parsed.base,
          quoteAsset: parsed.quote,
          exchange: 'Binance',
          exchangeId: 'binance',
          marketType: 'SPOT',
          nativeSymbol: q.symbol,
          lastPrice: last,
          bidPrice: bid > 0 ? bid : last,
          askPrice: ask > 0 ? ask : last,
          change24hPct: Number(q.priceChangePercent) || 0,
          volume24hUsd: Math.round(vol),
          maxLeverage: 1,
          high24h: Number(q.highPrice) || undefined,
          low24h: Number(q.lowPrice) || undefined,
          fundingRatePct: null,
          openInterestUsd: null,
        });
      }

      // 3) Bybit V5 Linear Perpetual
      for (const q of bybitMap.values()) {
        const parsed = parseBinancePair(q.symbol);
        if (!parsed) continue;
        const last = Number(q.lastPrice);
        const vol = Number(q.turnover24h);
        if (!(last > 0 && vol >= 10_000)) continue;
        const bid = Number(q.bid1Price || last);
        const ask = Number(q.ask1Price || last);
        const frNum = Number(q.fundingRate);
        const oiNum = Number(q.openInterestValue);
        dirEntries.push({
          symbol: `${parsed.base}/${parsed.quote}`,
          baseAsset: parsed.base,
          quoteAsset: parsed.quote,
          exchange: 'Bybit',
          exchangeId: 'bybit',
          marketType: 'PERPETUAL',
          nativeSymbol: q.symbol,
          lastPrice: last,
          bidPrice: bid > 0 ? bid : last,
          askPrice: ask > 0 ? ask : last,
          change24hPct: Number(((Number(q.price24hPcnt) || 0) * 100).toFixed(2)),
          volume24hUsd: Math.round(vol),
          maxLeverage: 15,
          high24h: Number(q.highPrice24h) || undefined,
          low24h: Number(q.lowPrice24h) || undefined,
          fundingRatePct: Number.isFinite(frNum) ? Number((frNum * 100).toFixed(4)) : null,
          openInterestUsd: Number.isFinite(oiNum) && oiNum > 0 ? Math.round(oiNum) : null,
        });
      }

      // 4) OKX V5 Swap & Spot
      for (const q of okxSwapMap.values()) {
        if (!q.instId.endsWith('-USDT-SWAP') && !q.instId.endsWith('-USDC-SWAP')) continue;
        const parts = q.instId.split('-');
        if (parts.length < 3) continue;
        const [base, quote] = parts;
        const last = Number(q.last);
        const rawVol = Number(q.volCcy24h);
        const usdVol = Number.isFinite(rawVol) && rawVol > 0 ? rawVol * last : 0;
        if (!(last > 0 && usdVol >= 10_000)) continue;
        const open24 = Number(q.open24h);
        const chg = open24 > 0 ? ((last - open24) / open24) * 100 : 0;
        dirEntries.push({
          symbol: `${base}/${quote}`,
          baseAsset: base,
          quoteAsset: quote,
          exchange: 'OKX',
          exchangeId: 'okx',
          marketType: 'PERPETUAL',
          nativeSymbol: q.instId,
          lastPrice: last,
          bidPrice: Number(q.bidPx || last),
          askPrice: Number(q.askPx || last),
          change24hPct: Number(chg.toFixed(2)),
          volume24hUsd: Math.round(usdVol),
          maxLeverage: 15,
          high24h: Number(q.high24h) || undefined,
          low24h: Number(q.low24h) || undefined,
          fundingRatePct: okxFrPctMap.get(q.instId) ?? null,
          openInterestUsd: okxOiUsdMap.get(q.instId) ?? null,
        });
      }

      for (const q of okxSpotMap.values()) {
        if (!q.instId.endsWith('-USDT') && !q.instId.endsWith('-USDC')) continue;
        const [base, quote] = q.instId.split('-');
        if (!base || !quote) continue;
        const last = Number(q.last);
        const usdVol = Number(q.volCcy24h);
        if (!(last > 0 && usdVol >= 25_000)) continue;
        const open24 = Number(q.open24h);
        const chg = open24 > 0 ? ((last - open24) / open24) * 100 : 0;
        dirEntries.push({
          symbol: `${base}/${quote}`,
          baseAsset: base,
          quoteAsset: quote,
          exchange: 'OKX',
          exchangeId: 'okx',
          marketType: 'SPOT',
          nativeSymbol: q.instId,
          lastPrice: last,
          bidPrice: Number(q.bidPx || last),
          askPrice: Number(q.askPx || last),
          change24hPct: Number(chg.toFixed(2)),
          volume24hUsd: Math.round(usdVol),
          maxLeverage: 1,
          high24h: Number(q.high24h) || undefined,
          low24h: Number(q.low24h) || undefined,
          fundingRatePct: null,
          openInterestUsd: null,
        });
      }

      // 5) Kraken & Coinbase configured universe entries
      for (const cfg of activeConfigs) {
        if (cfg.exchangeId === 'kraken') {
          const q = krakenResult[cfg.nativeSymbol];
          if (q && Number(q.c?.[0]) > 0) {
            const last = Number(q.c[0]);
            const openToday = Number(q.o);
            const chg = openToday > 0 ? ((last - openToday) / openToday) * 100 : 0;
            const volUsd = Number(q.v[1]) * (Number(q.p[1]) || last);
            dirEntries.push({
              symbol: cfg.symbol,
              baseAsset: cfg.base,
              quoteAsset: cfg.quote,
              exchange: 'Kraken',
              exchangeId: 'kraken',
              marketType: 'SPOT',
              nativeSymbol: cfg.nativeSymbol,
              lastPrice: last,
              bidPrice: Number(q.b[0]),
              askPrice: Number(q.a[0]),
              change24hPct: Number(chg.toFixed(2)),
              volume24hUsd: Math.round(volUsd),
              maxLeverage: 1,
            });
          }
        } else if (cfg.exchangeId === 'coinbase') {
          const cb = coinbasePairs[cfg.nativeSymbol];
          const tData = cb?.ticker.ok ? cb.ticker.data : null;
          const sData = cb?.stats.ok ? cb.stats.data : null;
          if (tData && Number(tData.price) > 0) {
            const last = Number(tData.price);
            const open24 = sData ? Number(sData.open) : 0;
            const chg = open24 > 0 ? ((last - open24) / open24) * 100 : 0;
            const volUsd = sData ? Number(sData.volume) * last : 0;
            dirEntries.push({
              symbol: cfg.symbol,
              baseAsset: cfg.base,
              quoteAsset: cfg.quote,
              exchange: 'Coinbase Advanced',
              exchangeId: 'coinbase',
              marketType: 'SPOT',
              nativeSymbol: cfg.nativeSymbol,
              lastPrice: last,
              bidPrice: Number(tData.bid),
              askPrice: Number(tData.ask),
              change24hPct: Number(chg.toFixed(2)),
              volume24hUsd: Math.round(volUsd),
              maxLeverage: 1,
            });
          }
        }
      }

      if (dirEntries.length > 0) {
        this.marketDirectory = dirEntries;
      }

      // Update every pair in active universe (20 default + user-selected dynamic coins) strictly from native exchange data
      const prevByKey = new Map<string, MarketTicker>();
      for (const t of this.tickers) {
        prevByKey.set(tickerKey(t.symbol, t.marketType, t.exchange), t);
      }

      const nextTickers: MarketTicker[] = activeConfigs.map((cfg) => {
        const key = tickerKey(cfg.symbol, cfg.marketType, cfg.exchange);
        const prev = prevByKey.get(key);

        let lastPrice = 0;
        let bidPrice = 0;
        let askPrice = 0;
        let change24hPct = 0;
        let high24h = 0;
        let low24h = 0;
        let volume24hUsd = 0;
        let openInterestUsd: number | null = null;
        let fundingRatePct: number | null = null;
        let latencyMs = 0;
        let sourceLabel = `${cfg.exchange} Public REST`;
        let fetchedOk = false;

        if (cfg.exchangeId === 'binance' && cfg.marketType === 'PERPETUAL') {
          const q = bnFapi24Map.get(cfg.nativeSymbol);
          const bk = bnFapiBookMap.get(cfg.nativeSymbol);
          const prem = bnFapiPremMap.get(cfg.nativeSymbol);
          const oiQty = bnOiQtyMap.get(cfg.nativeSymbol);
          if (q && Number(q.lastPrice) > 0) {
            lastPrice = Number(q.lastPrice);
            bidPrice = bk && Number(bk.bidPrice) > 0 ? Number(bk.bidPrice) : lastPrice;
            askPrice = bk && Number(bk.askPrice) > 0 ? Number(bk.askPrice) : lastPrice;
            change24hPct = Number(q.priceChangePercent);
            high24h = Number(q.highPrice);
            low24h = Number(q.lowPrice);
            volume24hUsd = Number(q.quoteVolume);
            openInterestUsd = oiQty !== undefined ? Math.round(oiQty * lastPrice) : null;
            fundingRatePct = prem ? Number((Number(prem.lastFundingRate) * 100).toFixed(4)) : null;
            latencyMs = bnFapi24Res.latencyMs;
            sourceLabel = 'Binance Futures FAPI';
            fetchedOk = askPrice >= bidPrice && bidPrice > 0;
          }
        } else if (cfg.exchangeId === 'binance' && cfg.marketType === 'SPOT') {
          const q = bnSpotMap.get(cfg.nativeSymbol);
          const bk = bnSpotBookMap.get(cfg.nativeSymbol);
          if (q && Number(q.lastPrice) > 0) {
            lastPrice = Number(q.lastPrice);
            const rawBid = Number(bk?.bidPrice || q.bidPrice);
            const rawAsk = Number(bk?.askPrice || q.askPrice);
            bidPrice = rawBid > 0 ? rawBid : lastPrice;
            askPrice = rawAsk > 0 ? rawAsk : lastPrice;
            change24hPct = Number(q.priceChangePercent);
            high24h = Number(q.highPrice);
            low24h = Number(q.lowPrice);
            volume24hUsd = Number(q.quoteVolume);
            openInterestUsd = null;
            fundingRatePct = null;
            latencyMs = bnSpotRes.latencyMs;
            sourceLabel = 'Binance Spot REST';
            fetchedOk = askPrice >= bidPrice && bidPrice > 0;
          }
        } else if (cfg.exchangeId === 'bybit') {
          const q = bybitMap.get(cfg.nativeSymbol);
          if (q && Number(q.lastPrice) > 0) {
            lastPrice = Number(q.lastPrice);
            bidPrice = Number(q.bid1Price);
            askPrice = Number(q.ask1Price);
            change24hPct = Number(q.price24hPcnt) * 100;
            high24h = Number(q.highPrice24h);
            low24h = Number(q.lowPrice24h);
            volume24hUsd = Number(q.turnover24h);
            const oiVal = Number(q.openInterestValue);
            openInterestUsd = Number.isFinite(oiVal) && oiVal > 0 ? Math.round(oiVal) : null;
            const fr = Number(q.fundingRate);
            fundingRatePct = Number.isFinite(fr) ? Number((fr * 100).toFixed(4)) : null;
            latencyMs = bybitLinearRes.latencyMs;
            sourceLabel = 'Bybit V5 Linear REST';
            fetchedOk = askPrice >= bidPrice && bidPrice > 0;
          }
        } else if (cfg.exchangeId === 'okx') {
          const q =
            cfg.marketType === 'PERPETUAL'
              ? okxSwapMap.get(cfg.nativeSymbol)
              : okxSpotMap.get(cfg.nativeSymbol);
          if (q && Number(q.last) > 0) {
            lastPrice = Number(q.last);
            bidPrice = Number(q.bidPx);
            askPrice = Number(q.askPx);
            const open24 = Number(q.open24h);
            change24hPct = open24 > 0 ? ((lastPrice - open24) / open24) * 100 : 0;
            high24h = Number(q.high24h);
            low24h = Number(q.low24h);
            volume24hUsd =
              cfg.marketType === 'PERPETUAL'
                ? Number(q.volCcy24h) * lastPrice
                : Number(q.volCcy24h);
            if (cfg.marketType === 'PERPETUAL') {
              const oi = okxOiUsdMap.get(cfg.nativeSymbol);
              const fr = okxFrPctMap.get(cfg.nativeSymbol);
              openInterestUsd = oi !== undefined ? Math.round(oi) : null;
              fundingRatePct = fr !== undefined ? Number(fr.toFixed(4)) : null;
              sourceLabel = 'OKX V5 Swap REST';
              latencyMs = okxSwapRes.latencyMs;
            } else {
              openInterestUsd = null;
              fundingRatePct = null;
              sourceLabel = 'OKX V5 Spot REST';
              latencyMs = okxSpotRes.latencyMs;
            }
            fetchedOk = askPrice >= bidPrice && bidPrice > 0;
          }
        } else if (cfg.exchangeId === 'kraken') {
          const q = krakenResult[cfg.nativeSymbol];
          if (q && Number(q.c?.[0]) > 0) {
            lastPrice = Number(q.c[0]);
            bidPrice = Number(q.b[0]);
            askPrice = Number(q.a[0]);
            const openToday = Number(q.o);
            change24hPct = openToday > 0 ? ((lastPrice - openToday) / openToday) * 100 : 0;
            high24h = Number(q.h[1]);
            low24h = Number(q.l[1]);
            const volBase24 = Number(q.v[1]);
            const vwap24 = Number(q.p[1]) || lastPrice;
            volume24hUsd = volBase24 * vwap24;
            openInterestUsd = null;
            fundingRatePct = null;
            latencyMs = krakenRes.latencyMs;
            sourceLabel = 'Kraken Public REST';
            fetchedOk = askPrice >= bidPrice && bidPrice > 0;
          }
        } else if (cfg.exchangeId === 'coinbase') {
          const cb = coinbasePairs[cfg.nativeSymbol];
          const tData = cb?.ticker.ok ? cb.ticker.data : null;
          const sData = cb?.stats.ok ? cb.stats.data : null;
          if (tData && Number(tData.price) > 0) {
            lastPrice = Number(tData.price);
            bidPrice = Number(tData.bid);
            askPrice = Number(tData.ask);
            const open24 = sData ? Number(sData.open) : 0;
            change24hPct = open24 > 0 ? ((lastPrice - open24) / open24) * 100 : 0;
            high24h = sData ? Number(sData.high) : lastPrice;
            low24h = sData ? Number(sData.low) : lastPrice;
            const volBase = sData ? Number(sData.volume) : 0;
            volume24hUsd = volBase * lastPrice;
            openInterestUsd = null;
            fundingRatePct = null;
            latencyMs = cb.ticker.latencyMs;
            sourceLabel = 'Coinbase Exchange REST';
            fetchedOk = askPrice >= bidPrice && bidPrice > 0;
          }
        }

        if (fetchedOk && Number.isFinite(lastPrice) && lastPrice > 0) {
          // Preserve a fresher sub-second WebSocket tick if one arrived while slow REST probes were running
          const hasFresherWs =
            Boolean(
              prev &&
                prev.dataStatus === 'LIVE_EXCHANGE' &&
                prev.lastPrice > 0 &&
                prev.sourceLabel.includes('WS') &&
                Date.now() - prev.timestampUtc < 4000,
            );

          const effLastPrice = hasFresherWs && prev ? prev.lastPrice : lastPrice;
          const effBidPrice = hasFresherWs && prev ? prev.bidPrice : bidPrice;
          const effAskPrice = hasFresherWs && prev ? prev.askPrice : askPrice;
          const effSourceLabel = hasFresherWs && prev ? prev.sourceLabel : sourceLabel;
          const effTimestampUtc = hasFresherWs && prev ? prev.timestampUtc : now;
          const effLatencyMs = hasFresherWs && prev ? prev.latencyMs : latencyMs;
          const effHigh24 = Math.max(high24h, effLastPrice, prev?.high24h ?? 0);
          const effLow24 =
            low24h > 0
              ? prev && prev.low24h > 0
                ? Math.min(low24h, effLastPrice, prev.low24h)
                : Math.min(low24h, effLastPrice)
              : prev?.low24h ?? effLastPrice;

          const spreadBps = ((effAskPrice - effBidPrice) / effLastPrice) * 10_000;
          const volPct = effLastPrice > 0 && effHigh24 >= effLow24 ? ((effHigh24 - effLow24) / effLastPrice) * 100 : 0;
          const liq = computeLiquidityScore(volume24hUsd, spreadBps);

          // Check cached 1h candles to keep RSI & Market Regime grounded in real OHLCV
          const candleCacheKey = `${cfg.symbol.toUpperCase()}|${cfg.marketType}|${cfg.exchange.toUpperCase()}|1h`;
          const cachedCandles = this.candleCache.get(candleCacheKey);
          let rsi14: number | null = prev?.rsi14 ?? null;
          let regime: MarketRegime = prev?.regime ?? 'SIDEWAYS';
          if (cachedCandles && cachedCandles.candles.length >= 20) {
            const stitched = mergeLiveTickIntoCandles(cachedCandles.candles, effLastPrice, effTimestampUtc, '1h');
            const ind = computeAllIndicators(stitched);
            rsi14 = Number(ind.rsi14.toFixed(1));
            regime = detectMarketRegime(ind, effLastPrice, volPct);
          }

          return {
            symbol: cfg.symbol,
            baseAsset: cfg.base,
            quoteAsset: cfg.quote,
            exchange: cfg.exchange,
            marketType: cfg.marketType,
            lastPrice: effLastPrice,
            bidPrice: effBidPrice,
            askPrice: effAskPrice,
            change24hPct: Number(change24hPct.toFixed(2)),
            high24h: effHigh24,
            low24h: effLow24,
            volume24hUsd: Math.round(volume24hUsd),
            openInterestUsd,
            fundingRatePct,
            spreadBps: Number(spreadBps.toFixed(2)),
            volatility24hPct: Number(volPct.toFixed(2)),
            rsi14,
            regime,
            liquidityScore: liq,
            dataStatus: 'LIVE_EXCHANGE',
            sourceLabel: effSourceLabel,
            timestampUtc: effTimestampUtc,
            latencyMs: effLatencyMs,
            tickSize: normalizePricePrecision(effLastPrice),
            lotSize: 0.001,
            minOrderUsd: 10,
            maxLeverage: cfg.maxLeverage,
            tradingStatus: 'TRADING',
          };
        }

        // Endpoint unreachable: preserve last verified exchange snapshot as STALE if < 5 min old, else UNAVAILABLE
        if (prev && prev.dataStatus !== 'UNAVAILABLE' && prev.lastPrice > 0) {
          return {
            ...prev,
            dataStatus: 'STALE',
            sourceLabel: `${cfg.exchange} REST (Stale — Reconnecting)`,
          };
        }

        return {
          symbol: cfg.symbol,
          baseAsset: cfg.base,
          quoteAsset: cfg.quote,
          exchange: cfg.exchange,
          marketType: cfg.marketType,
          lastPrice: 0,
          bidPrice: 0,
          askPrice: 0,
          change24hPct: 0,
          high24h: 0,
          low24h: 0,
          volume24hUsd: 0,
          openInterestUsd: null,
          fundingRatePct: null,
          spreadBps: 0,
          volatility24hPct: 0,
          rsi14: null,
          regime: 'UNKNOWN_REGIME',
          liquidityScore: 0,
          dataStatus: 'UNAVAILABLE',
          sourceLabel: `${cfg.exchange} REST (Unavailable)`,
          timestampUtc: now,
          latencyMs: 0,
          tickSize: prev?.tickSize ?? 0.01,
          lotSize: prev?.lotSize ?? 0.001,
          minOrderUsd: prev?.minOrderUsd ?? 10,
          maxLeverage: cfg.maxLeverage,
          tradingStatus: 'TRADING',
        };
      });

      this.tickers = nextTickers;
    } finally {
      this.refreshing = false;
    }
  }

  /**
   * Pre-fetches authentic 1h OHLCV candles on startup so RSI(14) and Market Regime
   * on the market scanner are immediately computed from real exchange history.
   */
  public async warmTopCandles(): Promise<void> {
    await Promise.allSettled(
      MARKET_UNIVERSE.map((cfg) => this.getCandles(cfg.symbol, cfg.marketType, '1h', cfg.exchange)),
    );
  }

  public getTickers(): MarketTicker[] {
    return this.tickers;
  }

  public getDirectoryCount(): number {
    return this.marketDirectory.length;
  }

  public getMarketDirectory(): MarketDirectoryEntry[] {
    return this.marketDirectory;
  }

  public getTicker(
    symbol: string,
    marketType?: MarketType,
    exchange?: string,
  ): MarketTicker | undefined {
    const symUpper = normalizeSymbolInput(symbol);
    const exUpper = exchange?.trim().toUpperCase();
    return (
      this.tickers.find(
        (t) =>
          t.symbol.toUpperCase() === symUpper &&
          (!marketType || t.marketType === marketType) &&
          (!exUpper || t.exchange.toUpperCase() === exUpper),
      ) ??
      this.tickers.find(
        (t) =>
          t.symbol.toUpperCase() === symUpper &&
          (!marketType || t.marketType === marketType),
      ) ??
      this.tickers.find((t) => t.symbol.toUpperCase() === symUpper)
    );
  }

  /**
   * Smart search across all indexed multi-exchange markets (~1,500+ pairs).
   * If an exact base ticker isn't found in the cached directory, probes Binance/OKX live on demand.
   */
  public async searchMarkets(
    query: string,
    options?: {
      marketType?: MarketType | 'ALL';
      exchange?: string;
      limit?: number;
      sort?: 'relevance' | 'volume' | 'gainer' | 'loser';
    },
  ): Promise<{ results: MarketDirectoryEntry[]; totalIndexed: number }> {
    const limit = Math.min(60, Math.max(1, options?.limit ?? 30));
    let results = searchMarketDirectory(this.marketDirectory, query, {
      marketType: options?.marketType,
      exchange: options?.exchange,
      limit: query.trim() ? limit : 120,
    });

    // Apply optional discovery sort when query is empty or explicit sort chosen
    if (options?.sort && options.sort !== 'relevance') {
      const sorted = [...results];
      if (options.sort === 'volume') {
        sorted.sort((a, b) => b.volume24hUsd - a.volume24hUsd);
      } else if (options.sort === 'gainer') {
        sorted.sort((a, b) => b.change24hPct - a.change24hPct);
      } else if (options.sort === 'loser') {
        sorted.sort((a, b) => a.change24hPct - b.change24hPct);
      }
      results = sorted.slice(0, limit);
    } else {
      results = results.slice(0, limit);
    }

    // Live exchange fallback probe when an unknown valid ticker is searched (e.g. brand-new listing)
    const parsed = parseMarketSearchQuery(query);
    const base = parsed.normalizedBaseQuery.replace(/[^A-Z0-9]/g, '');
    if (results.length === 0 && base.length >= 2 && base.length <= 12) {
      const bnPair = `${base}USDT`;
      const okxSwap = `${base}-USDT-SWAP`;
      const [bnSpotProbe, bnFapiProbe, okxSwapProbe] = await Promise.all([
        fetchJsonWithTimeout<{
          symbol?: string;
          lastPrice?: string;
          bidPrice?: string;
          askPrice?: string;
          priceChangePercent?: string;
          quoteVolume?: string;
        }>(`https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(bnPair)}`, 2800),
        fetchJsonWithTimeout<{
          symbol?: string;
          lastPrice?: string;
          priceChangePercent?: string;
          quoteVolume?: string;
        }>(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${encodeURIComponent(bnPair)}`, 2800),
        fetchJsonWithTimeout<{
          code?: string;
          data?: Array<{
            instId: string;
            last: string;
            bidPx: string;
            askPx: string;
            open24h: string;
            volCcy24h: string;
          }>;
        }>(`https://www.okx.com/api/v5/market/ticker?instId=${encodeURIComponent(okxSwap)}`, 2800),
      ]);

      const probedEntries: MarketDirectoryEntry[] = [];
      if (bnFapiProbe.ok && Number(bnFapiProbe.data?.lastPrice) > 0) {
        const last = Number(bnFapiProbe.data!.lastPrice);
        probedEntries.push({
          symbol: `${base}/USDT`,
          baseAsset: base,
          quoteAsset: 'USDT',
          exchange: 'Binance',
          exchangeId: 'binance',
          marketType: 'PERPETUAL',
          nativeSymbol: bnPair,
          lastPrice: last,
          bidPrice: last,
          askPrice: last,
          change24hPct: Number(bnFapiProbe.data?.priceChangePercent) || 0,
          volume24hUsd: Math.round(Number(bnFapiProbe.data?.quoteVolume) || 0),
          maxLeverage: 20,
        });
      }
      if (bnSpotProbe.ok && Number(bnSpotProbe.data?.lastPrice) > 0) {
        const last = Number(bnSpotProbe.data!.lastPrice);
        probedEntries.push({
          symbol: `${base}/USDT`,
          baseAsset: base,
          quoteAsset: 'USDT',
          exchange: 'Binance',
          exchangeId: 'binance',
          marketType: 'SPOT',
          nativeSymbol: bnPair,
          lastPrice: last,
          bidPrice: Number(bnSpotProbe.data?.bidPrice) || last,
          askPrice: Number(bnSpotProbe.data?.askPrice) || last,
          change24hPct: Number(bnSpotProbe.data?.priceChangePercent) || 0,
          volume24hUsd: Math.round(Number(bnSpotProbe.data?.quoteVolume) || 0),
          maxLeverage: 1,
        });
      }
      const okxItem = okxSwapProbe.ok ? okxSwapProbe.data?.data?.[0] : undefined;
      if (okxItem && Number(okxItem.last) > 0) {
        const last = Number(okxItem.last);
        const open24 = Number(okxItem.open24h);
        probedEntries.push({
          symbol: `${base}/USDT`,
          baseAsset: base,
          quoteAsset: 'USDT',
          exchange: 'OKX',
          exchangeId: 'okx',
          marketType: 'PERPETUAL',
          nativeSymbol: okxSwap,
          lastPrice: last,
          bidPrice: Number(okxItem.bidPx) || last,
          askPrice: Number(okxItem.askPx) || last,
          change24hPct: open24 > 0 ? Number((((last - open24) / open24) * 100).toFixed(2)) : 0,
          volume24hUsd: Math.round((Number(okxItem.volCcy24h) || 0) * last),
          maxLeverage: 15,
        });
      }

      if (probedEntries.length > 0) {
        this.marketDirectory.push(...probedEntries);
        results = searchMarketDirectory(this.marketDirectory, query, {
          marketType: options?.marketType,
          exchange: options?.exchange,
          limit,
        });
      }
    }

    return {
      results,
      totalIndexed: this.marketDirectory.length,
    };
  }

  /**
   * Activates ANY searched pair into the live tracking watchlist and hydrates real
   * 1h OHLCV candles, RSI(14), Market Regime, and derivatives telemetry immediately.
   */
  public async activatePair(
    rawSymbol: string,
    marketType?: MarketType,
    exchange?: string,
  ): Promise<MarketTicker | null> {
    const symbol = normalizeSymbolInput(rawSymbol);
    const existing = this.getTicker(symbol, marketType, exchange);
    if (existing && existing.lastPrice > 0 && (!exchange || existing.exchange.toUpperCase() === exchange.trim().toUpperCase())) {
      if (existing.rsi14 === null) {
        await this.getCandles(existing.symbol, existing.marketType, '1h', existing.exchange);
      }
      return this.getTicker(existing.symbol, existing.marketType, existing.exchange) ?? existing;
    }

    // Ensure directory has matching entry (run live search probe if needed)
    let cfg = this.findUniverseConfig(symbol, marketType, exchange);
    if (!cfg) {
      const searchRes = await this.searchMarkets(symbol, {
        marketType: marketType ?? 'ALL',
        exchange: exchange ?? 'ALL',
        limit: 5,
      });
      if (searchRes.results.length > 0) {
        cfg = this.directoryEntryToConfig(searchRes.results[0]);
      }
    }
    if (!cfg) return null;

    // Register in dynamicConfigs if not already tracked in active configs
    const alreadyInConfigs = this.getActiveConfigs().some(
      (c) =>
        c.symbol.toUpperCase() === cfg!.symbol.toUpperCase() &&
        c.marketType === cfg!.marketType &&
        c.exchangeId === cfg!.exchangeId,
    );
    if (!alreadyInConfigs) {
      if (this.dynamicConfigs.length >= 35) {
        this.dynamicConfigs.shift();
      }
      this.dynamicConfigs.push(cfg);
    }

    // Build immediate MarketTicker snapshot from cached live marketDirectory entry
    const dirEntry =
      this.marketDirectory.find(
        (d) =>
          d.symbol.toUpperCase() === cfg!.symbol.toUpperCase() &&
          d.marketType === cfg!.marketType &&
          d.exchangeId === cfg!.exchangeId,
      ) ??
      this.marketDirectory.find(
        (d) => d.symbol.toUpperCase() === cfg!.symbol.toUpperCase() && d.marketType === cfg!.marketType,
      );

    const now = Date.now();
    const lastPrice = dirEntry?.lastPrice ?? 0;
    const bidPrice = dirEntry?.bidPrice ?? lastPrice;
    const askPrice = dirEntry?.askPrice ?? lastPrice;
    const spreadBps =
      lastPrice > 0 && askPrice >= bidPrice
        ? Number((((askPrice - bidPrice) / lastPrice) * 10_000).toFixed(2))
        : 0;
    const volume24hUsd = dirEntry?.volume24hUsd ?? 0;

    let openInterestUsd: number | null = null;
    let fundingRatePct: number | null = null;
    if (cfg.marketType === 'PERPETUAL' && lastPrice > 0) {
      if (cfg.exchangeId === 'binance') {
        const [oiRes, premRes] = await Promise.all([
          fetchJsonWithTimeout<{ openInterest?: string }>(
            `https://fapi.binance.com/fapi/v1/openInterest?symbol=${encodeURIComponent(cfg.nativeSymbol)}`,
            2500,
          ),
          fetchJsonWithTimeout<{ lastFundingRate?: string }>(
            `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${encodeURIComponent(cfg.nativeSymbol)}`,
            2500,
          ),
        ]);
        const oiQty = Number(oiRes.data?.openInterest);
        if (oiRes.ok && Number.isFinite(oiQty) && oiQty >= 0) {
          openInterestUsd = Math.round(oiQty * lastPrice);
        }
        const fr = Number(premRes.data?.lastFundingRate);
        if (premRes.ok && Number.isFinite(fr)) {
          fundingRatePct = Number((fr * 100).toFixed(4));
        }
      } else if (cfg.exchangeId === 'okx') {
        const [oiRes, frRes] = await Promise.all([
          fetchJsonWithTimeout<{ data?: Array<{ oiUsd?: string }> }>(
            `https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=${encodeURIComponent(cfg.nativeSymbol)}`,
            2500,
          ),
          fetchJsonWithTimeout<{ data?: Array<{ fundingRate?: string }> }>(
            `https://www.okx.com/api/v5/public/funding-rate?instId=${encodeURIComponent(cfg.nativeSymbol)}`,
            2500,
          ),
        ]);
        const oiUsd = Number(oiRes.data?.data?.[0]?.oiUsd);
        if (oiRes.ok && Number.isFinite(oiUsd) && oiUsd >= 0) openInterestUsd = Math.round(oiUsd);
        const fr = Number(frRes.data?.data?.[0]?.fundingRate);
        if (frRes.ok && Number.isFinite(fr)) fundingRatePct = Number((fr * 100).toFixed(4));
      }
    }

    const sourceLabel =
      cfg.exchangeId === 'binance'
        ? cfg.marketType === 'PERPETUAL'
          ? 'Binance Futures FAPI'
          : 'Binance Spot REST'
        : cfg.exchangeId === 'bybit'
          ? 'Bybit V5 Linear REST'
          : cfg.exchangeId === 'okx'
            ? cfg.marketType === 'PERPETUAL'
              ? 'OKX V5 Swap REST'
              : 'OKX V5 Spot REST'
            : `${cfg.exchange} REST`;

    const activated: MarketTicker = {
      symbol: cfg.symbol,
      baseAsset: cfg.base,
      quoteAsset: cfg.quote,
      exchange: cfg.exchange,
      marketType: cfg.marketType,
      lastPrice,
      bidPrice,
      askPrice,
      change24hPct: dirEntry?.change24hPct ?? 0,
      high24h: lastPrice,
      low24h: lastPrice,
      volume24hUsd,
      openInterestUsd,
      fundingRatePct,
      spreadBps,
      volatility24hPct: 0,
      rsi14: null,
      regime: 'SIDEWAYS',
      liquidityScore: computeLiquidityScore(volume24hUsd, spreadBps),
      dataStatus: lastPrice > 0 ? 'LIVE_EXCHANGE' : 'UNAVAILABLE',
      sourceLabel,
      timestampUtc: now,
      latencyMs: this.exchangeTelemetry.get(cfg.exchangeId)?.apiLatencyMs ?? 120,
      tickSize: normalizePricePrecision(lastPrice),
      lotSize: 0.001,
      minOrderUsd: 10,
      maxLeverage: cfg.maxLeverage,
      tradingStatus: 'TRADING',
    };

    const tkIdx = this.tickers.findIndex(
      (t) =>
        t.symbol.toUpperCase() === activated.symbol.toUpperCase() &&
        t.marketType === activated.marketType &&
        t.exchange === activated.exchange,
    );
    if (tkIdx >= 0) {
      this.tickers[tkIdx] = activated;
    } else {
      this.tickers.push(activated);
    }

    // Hydrate real 1h OHLCV candles immediately so high24h/low24h/RSI/Regime are accurate
    const candleRes = await this.getCandles(cfg.symbol, cfg.marketType, '1h', cfg.exchange);
    if (candleRes.candles.length >= 24) {
      const last24 = candleRes.candles.slice(-24);
      const high24 = Math.max(...last24.map((c) => c.high));
      const low24 = Math.min(...last24.map((c) => c.low));
      activated.high24h = high24;
      activated.low24h = low24;
      if (activated.lastPrice > 0 && high24 >= low24) {
        activated.volatility24hPct = Number(
          (((high24 - low24) / activated.lastPrice) * 100).toFixed(2),
        );
      }
      const ind = computeAllIndicators(candleRes.candles);
      activated.rsi14 = Number(ind.rsi14.toFixed(1));
      activated.regime = detectMarketRegime(ind, activated.lastPrice, activated.volatility24hPct);
    }

    if (this.wsStarted) {
      this.syncRealtimeStreamSubscriptions();
    }

    return activated;
  }

  public async getCandles(
    symbol: string,
    marketType: MarketType = 'PERPETUAL',
    interval = '1h',
    exchange?: string,
  ): Promise<{ candles: Candle[]; status: DataSourceStatus; source: string }> {
    const cfg = this.findUniverseConfig(symbol, marketType, exchange);
    const resolvedExchange = (cfg?.exchange ?? exchange ?? '').toUpperCase();
    const key = `${symbol.toUpperCase()}|${marketType}|${resolvedExchange}|${interval}`;
    const liveTicker = this.getTicker(symbol, marketType, cfg?.exchange ?? exchange);
    const cached = this.candleCache.get(key);
    if (cached && cached.candles.length > 0 && Date.now() - cached.fetchedAt < 30_000) {
      const stitched =
        liveTicker && liveTicker.dataStatus === 'LIVE_EXCHANGE' && liveTicker.lastPrice > 0
          ? mergeLiveTickIntoCandles(cached.candles, liveTicker.lastPrice, liveTicker.timestampUtc, interval)
          : cached.candles;
      return { candles: stitched, status: cached.status, source: cached.source };
    }

    let candles: Candle[] = [];
    let sourceLabel = cfg ? `${cfg.exchange} Klines` : 'Exchange Klines';

    if (cfg) {
      if (cfg.exchangeId === 'binance') {
        const baseUrl =
          cfg.marketType === 'PERPETUAL'
            ? 'https://fapi.binance.com/fapi/v1/klines'
            : 'https://api.binance.com/api/v3/klines';
        const res = await fetchJsonWithTimeout<Array<[number, string, string, string, string, string]>>(
          `${baseUrl}?symbol=${encodeURIComponent(cfg.nativeSymbol)}&interval=${encodeURIComponent(interval)}&limit=160`,
          3500,
        );
        if (res.ok && Array.isArray(res.data)) {
          candles = res.data.map((k) => ({
            timestamp: Number(k[0]),
            open: Number(k[1]),
            high: Number(k[2]),
            low: Number(k[3]),
            close: Number(k[4]),
            volume: Number(k[5]),
          }));
          sourceLabel =
            cfg.marketType === 'PERPETUAL' ? 'Binance Futures Klines' : 'Binance Spot Klines';
        }
      } else if (cfg.exchangeId === 'bybit') {
        const bybitIv =
          interval === '15m' ? '15' : interval === '4h' ? '240' : interval === '1d' ? 'D' : '60';
        const res = await fetchJsonWithTimeout<{
          retCode: number;
          result?: { list?: Array<[string, string, string, string, string, string]> };
        }>(
          `https://api.bybit.com/v5/market/kline?category=linear&symbol=${encodeURIComponent(cfg.nativeSymbol)}&interval=${bybitIv}&limit=160`,
          3500,
        );
        if (res.ok && res.data?.retCode === 0 && Array.isArray(res.data.result?.list)) {
          candles = [...res.data.result.list]
            .reverse()
            .map((k) => ({
              timestamp: Number(k[0]),
              open: Number(k[1]),
              high: Number(k[2]),
              low: Number(k[3]),
              close: Number(k[4]),
              volume: Number(k[5]),
            }));
          sourceLabel = 'Bybit V5 Linear Klines';
        }
      } else if (cfg.exchangeId === 'okx') {
        const okxBar =
          interval === '15m' ? '15m' : interval === '4h' ? '4H' : interval === '1d' ? '1D' : '1H';
        const res = await fetchJsonWithTimeout<{
          code: string;
          data?: Array<[string, string, string, string, string, string]>;
        }>(
          `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(cfg.nativeSymbol)}&bar=${okxBar}&limit=160`,
          3500,
        );
        if (res.ok && res.data?.code === '0' && Array.isArray(res.data.data)) {
          candles = [...res.data.data]
            .reverse()
            .map((k) => ({
              timestamp: Number(k[0]),
              open: Number(k[1]),
              high: Number(k[2]),
              low: Number(k[3]),
              close: Number(k[4]),
              volume: Number(k[5]),
            }));
          sourceLabel = `OKX V5 ${cfg.marketType} Candles`;
        }
      } else if (cfg.exchangeId === 'kraken') {
        const krIv =
          interval === '15m' ? 15 : interval === '4h' ? 240 : interval === '1d' ? 1440 : 60;
        const res = await fetchJsonWithTimeout<{
          error: string[];
          result?: Record<string, Array<[number, string, string, string, string, string, string]>>;
        }>(
          `https://api.kraken.com/0/public/OHLC?pair=${encodeURIComponent(cfg.nativeSymbol)}&interval=${krIv}`,
          3500,
        );
        const series = res.ok && res.data?.result ? res.data.result[cfg.nativeSymbol] : undefined;
        if (Array.isArray(series)) {
          candles = series.slice(-160).map((k) => ({
            timestamp: Number(k[0]) * 1000,
            open: Number(k[1]),
            high: Number(k[2]),
            low: Number(k[3]),
            close: Number(k[4]),
            volume: Number(k[6]),
          }));
          sourceLabel = 'Kraken OHLC REST';
        }
      } else if (cfg.exchangeId === 'coinbase') {
        const gran =
          interval === '15m' ? 900 : interval === '4h' ? 14400 : interval === '1d' ? 86400 : 3600;
        const res = await fetchJsonWithTimeout<Array<[number, number, number, number, number, number]>>(
          `https://api.exchange.coinbase.com/products/${encodeURIComponent(cfg.nativeSymbol)}/candles?granularity=${gran}`,
          3500,
        );
        if (res.ok && Array.isArray(res.data)) {
          candles = [...res.data]
            .slice(0, 160)
            .reverse()
            .map((k) => ({
              timestamp: Number(k[0]) * 1000,
              low: Number(k[1]),
              high: Number(k[2]),
              open: Number(k[3]),
              close: Number(k[4]),
              volume: Number(k[5]),
            }));
          sourceLabel = 'Coinbase Exchange Candles';
        }
      }
    }

    // Authentic Cross-Venue Fallback: if the primary exchange endpoint timed out or is regionally blocked (e.g. HTTP 451),
    // try live OKX / Bybit / Coinbase klines for the exact same normalized asset before reporting unavailable.
    if (candles.length < 20) {
      const [rawBase, rawQuote = 'USDT'] = symbol.toUpperCase().split('/');
      const base = rawBase.trim();
      const quote = rawQuote.trim() || 'USDT';

      if (candles.length < 20 && cfg?.exchangeId !== 'okx') {
        const okxBar =
          interval === '15m' ? '15m' : interval === '4h' ? '4H' : interval === '1d' ? '1D' : '1H';
        const okxInstId =
          marketType === 'PERPETUAL' ? `${base}-${quote}-SWAP` : `${base}-${quote}`;
        const res = await fetchJsonWithTimeout<{
          code: string;
          data?: Array<[string, string, string, string, string, string]>;
        }>(
          `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(okxInstId)}&bar=${okxBar}&limit=160`,
          3500,
        );
        if (res.ok && res.data?.code === '0' && Array.isArray(res.data.data) && res.data.data.length >= 20) {
          candles = [...res.data.data]
            .reverse()
            .map((k) => ({
              timestamp: Number(k[0]),
              open: Number(k[1]),
              high: Number(k[2]),
              low: Number(k[3]),
              close: Number(k[4]),
              volume: Number(k[5]),
            }));
          sourceLabel = `${cfg?.exchange ?? 'Exchange'} · OKX Cross-Venue Fallback`;
        }
      }

      if (candles.length < 20 && cfg?.exchangeId !== 'bybit') {
        const bybitIv =
          interval === '15m' ? '15' : interval === '4h' ? '240' : interval === '1d' ? 'D' : '60';
        const bybitCategory = marketType === 'PERPETUAL' ? 'linear' : 'spot';
        const res = await fetchJsonWithTimeout<{
          retCode: number;
          result?: { list?: Array<[string, string, string, string, string, string]> };
        }>(
          `https://api.bybit.com/v5/market/kline?category=${bybitCategory}&symbol=${encodeURIComponent(`${base}${quote}`)}&interval=${bybitIv}&limit=160`,
          3500,
        );
        if (
          res.ok &&
          res.data?.retCode === 0 &&
          Array.isArray(res.data.result?.list) &&
          res.data.result.list.length >= 20
        ) {
          candles = [...res.data.result.list]
            .reverse()
            .map((k) => ({
              timestamp: Number(k[0]),
              open: Number(k[1]),
              high: Number(k[2]),
              low: Number(k[3]),
              close: Number(k[4]),
              volume: Number(k[5]),
            }));
          sourceLabel = `${cfg?.exchange ?? 'Exchange'} · Bybit Cross-Venue Fallback`;
        }
      }

      if (candles.length < 20 && cfg?.exchangeId !== 'coinbase') {
        const gran =
          interval === '15m' ? 900 : interval === '4h' ? 14400 : interval === '1d' ? 86400 : 3600;
        const cbProduct = `${base}-${quote === 'USDT' ? 'USD' : quote}`;
        const res = await fetchJsonWithTimeout<Array<[number, number, number, number, number, number]>>(
          `https://api.exchange.coinbase.com/products/${encodeURIComponent(cbProduct)}/candles?granularity=${gran}`,
          3500,
        );
        if (res.ok && Array.isArray(res.data) && res.data.length >= 20) {
          candles = [...res.data]
            .slice(0, 160)
            .reverse()
            .map((k) => ({
              timestamp: Number(k[0]) * 1000,
              low: Number(k[1]),
              high: Number(k[2]),
              open: Number(k[3]),
              close: Number(k[4]),
              volume: Number(k[5]),
            }));
          sourceLabel = `${cfg?.exchange ?? 'Exchange'} · Coinbase Cross-Venue Fallback`;
        }
      }
    }

    // Enforce strict chronological monotonicity & finite positive OHLC values
    const cleanCandles: Candle[] = [];
    let lastTs = -1;
    candles.sort((a, b) => a.timestamp - b.timestamp);
    for (const c of candles) {
      if (
        c.timestamp > lastTs &&
        c.open > 0 &&
        c.high > 0 &&
        c.low > 0 &&
        c.close > 0 &&
        c.high >= Math.max(c.open, c.close) &&
        c.low <= Math.min(c.open, c.close) &&
        c.volume >= 0
      ) {
        cleanCandles.push(c);
        lastTs = c.timestamp;
      }
    }

    if (cleanCandles.length >= 20) {
      const stitchedCandles =
        liveTicker && liveTicker.dataStatus === 'LIVE_EXCHANGE' && liveTicker.lastPrice > 0
          ? mergeLiveTickIntoCandles(cleanCandles, liveTicker.lastPrice, liveTicker.timestampUtc, interval)
          : cleanCandles;
      this.candleCache.set(key, {
        candles: stitchedCandles,
        fetchedAt: Date.now(),
        status: 'LIVE_EXCHANGE',
        source: sourceLabel,
      });

      // Keep ticker RSI(14) & Market Regime synchronized with live 1h OHLCV
      if (interval === '1h' && cfg) {
        const tk = this.getTicker(cfg.symbol, cfg.marketType, cfg.exchange);
        if (tk && tk.lastPrice > 0) {
          const ind = computeAllIndicators(stitchedCandles);
          tk.rsi14 = Number(ind.rsi14.toFixed(1));
          tk.regime = detectMarketRegime(ind, tk.lastPrice, tk.volatility24hPct);
        }
      }

      return { candles: stitchedCandles, status: 'LIVE_EXCHANGE', source: sourceLabel };
    }

    if (cached && cached.candles.length > 0) {
      return { candles: cached.candles, status: 'STALE', source: `${cached.source} (Cached)` };
    }

    return {
      candles: [],
      status: 'UNAVAILABLE',
      source: `${cfg?.exchange ?? 'Exchange'} OHLCV Unavailable`,
    };
  }

  /**
   * Fetches authentic Level-2 Order Book depth directly from the pair's exchange.
   * Never fabricates synthetic liquidity levels.
   */
  public async getOrderBook(
    symbol: string,
    marketType: MarketType = 'PERPETUAL',
    exchange?: string,
  ): Promise<OrderBookSnapshot> {
    const cfg = this.findUniverseConfig(symbol, marketType, exchange);
    const ticker = this.getTicker(symbol, marketType, cfg?.exchange ?? exchange);
    const resolvedExchange = (cfg?.exchange ?? ticker?.exchange ?? exchange ?? '').toUpperCase();
    const cacheKey = `${symbol.toUpperCase()}|${marketType}|${resolvedExchange}`;
    const cached = this.orderBookCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < 2000) {
      return cached.book;
    }

    const rawBids: Array<[number, number]> = [];
    const rawAsks: Array<[number, number]> = [];

    if (cfg) {
      if (cfg.exchangeId === 'binance') {
        const baseUrl =
          cfg.marketType === 'PERPETUAL'
            ? 'https://fapi.binance.com/fapi/v1/depth'
            : 'https://api.binance.com/api/v3/depth';
        const res = await fetchJsonWithTimeout<{
          bids?: Array<[string, string]>;
          asks?: Array<[string, string]>;
        }>(`${baseUrl}?symbol=${encodeURIComponent(cfg.nativeSymbol)}&limit=10`, 2800);
        if (res.ok && res.data?.bids && res.data?.asks) {
          for (const [p, q] of res.data.bids.slice(0, 10)) rawBids.push([Number(p), Number(q)]);
          for (const [p, q] of res.data.asks.slice(0, 10)) rawAsks.push([Number(p), Number(q)]);
        }
      } else if (cfg.exchangeId === 'bybit') {
        const res = await fetchJsonWithTimeout<{
          retCode: number;
          result?: { b?: Array<[string, string]>; a?: Array<[string, string]> };
        }>(
          `https://api.bybit.com/v5/market/orderbook?category=linear&symbol=${encodeURIComponent(cfg.nativeSymbol)}&limit=10`,
          2800,
        );
        if (res.ok && res.data?.retCode === 0 && res.data.result?.b && res.data.result?.a) {
          for (const [p, q] of res.data.result.b.slice(0, 10)) rawBids.push([Number(p), Number(q)]);
          for (const [p, q] of res.data.result.a.slice(0, 10)) rawAsks.push([Number(p), Number(q)]);
        }
      } else if (cfg.exchangeId === 'okx') {
        const res = await fetchJsonWithTimeout<{
          code: string;
          data?: Array<{ bids: Array<[string, string]>; asks: Array<[string, string]> }>;
        }>(
          `https://www.okx.com/api/v5/market/books?instId=${encodeURIComponent(cfg.nativeSymbol)}&sz=10`,
          2800,
        );
        const book = res.ok && res.data?.code === '0' ? res.data.data?.[0] : undefined;
        if (book?.bids && book?.asks) {
          for (const [p, q] of book.bids.slice(0, 10)) rawBids.push([Number(p), Number(q)]);
          for (const [p, q] of book.asks.slice(0, 10)) rawAsks.push([Number(p), Number(q)]);
        }
      } else if (cfg.exchangeId === 'kraken') {
        const res = await fetchJsonWithTimeout<{
          error: string[];
          result?: Record<string, { bids: Array<[string, string]>; asks: Array<[string, string]> }>;
        }>(
          `https://api.kraken.com/0/public/Depth?pair=${encodeURIComponent(cfg.nativeSymbol)}&count=10`,
          2800,
        );
        const book = res.ok && res.data?.result ? res.data.result[cfg.nativeSymbol] : undefined;
        if (book?.bids && book?.asks) {
          for (const [p, q] of book.bids.slice(0, 10)) rawBids.push([Number(p), Number(q)]);
          for (const [p, q] of book.asks.slice(0, 10)) rawAsks.push([Number(p), Number(q)]);
        }
      } else if (cfg.exchangeId === 'coinbase') {
        const res = await fetchJsonWithTimeout<{
          bids?: Array<[string, string]>;
          asks?: Array<[string, string]>;
        }>(
          `https://api.exchange.coinbase.com/products/${encodeURIComponent(cfg.nativeSymbol)}/book?level=2`,
          2800,
        );
        if (res.ok && res.data?.bids && res.data?.asks) {
          for (const [p, q] of res.data.bids.slice(0, 10)) rawBids.push([Number(p), Number(q)]);
          for (const [p, q] of res.data.asks.slice(0, 10)) rawAsks.push([Number(p), Number(q)]);
        }
      }
    }

    if (rawBids.length > 0 && rawAsks.length > 0) {
      let bidVolUsd = 0;
      let askVolUsd = 0;
      const bids: OrderBookLevel[] = rawBids.map(([price, quantity]) => {
        const totalUsd = Math.round(price * quantity);
        bidVolUsd += price * quantity;
        return { price, quantity, totalUsd };
      });
      const asks: OrderBookLevel[] = rawAsks.map(([price, quantity]) => {
        const totalUsd = Math.round(price * quantity);
        askVolUsd += price * quantity;
        return { price, quantity, totalUsd };
      });

      const bestBid = bids[0].price;
      const bestAsk = asks[0].price;
      const mid = (bestBid + bestAsk) / 2;
      const spreadBps = mid > 0 ? Number((((bestAsk - bestBid) / mid) * 10_000).toFixed(2)) : 0;
      const total = bidVolUsd + askVolUsd;
      const imbalanceRatio = total > 0 ? Number(((bidVolUsd - askVolUsd) / total).toFixed(3)) : 0;

      const snapshot: OrderBookSnapshot = {
        symbol: ticker?.symbol ?? cfg?.symbol ?? symbol,
        exchange: ticker?.exchange ?? cfg?.exchange ?? 'Exchange',
        timestampUtc: Date.now(),
        bids,
        asks,
        spreadBps,
        imbalanceRatio,
        dataStatus: 'LIVE_EXCHANGE',
      };
      this.orderBookCache.set(cacheKey, { book: snapshot, fetchedAt: Date.now() });
      return snapshot;
    }

    if (cached) {
      return { ...cached.book, dataStatus: 'STALE' };
    }

    return {
      symbol: ticker?.symbol ?? cfg?.symbol ?? symbol,
      exchange: ticker?.exchange ?? cfg?.exchange ?? 'Exchange',
      timestampUtc: Date.now(),
      bids: [],
      asks: [],
      spreadBps: ticker?.spreadBps ?? 0,
      imbalanceRatio: 0,
      dataStatus: 'UNAVAILABLE',
    };
  }

  public isLiveFeedActive(): boolean {
    return this.tickers.some((t) => t.dataStatus === 'LIVE_EXCHANGE');
  }
}

export const marketFeed = new MarketFeedManager();
