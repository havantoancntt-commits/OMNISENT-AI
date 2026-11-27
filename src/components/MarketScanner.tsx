import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Search,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  formatAssetPrice,
  formatCompactUsd,
  getSmartPriceDecimals,
  type MarketDirectoryEntry,
} from '../engine/symbolSearch';
import { isSameTickerSelection } from '../engine/pairSelection';
import {
  classifyFeedFreshness,
  computeCrossVenueBasisBps,
  mergeLiveTickIntoCandles,
} from '../engine/priceFeedGuard';
import { apiFetch } from '../lib/apiClient';
import type {
  Candle,
  ClosePositionResponse,
  FullMarketOpportunity,
  MarketTicker,
  MarketType,
  OrderBookSnapshot,
  OrderSide,
  OrderType,
  Position,
  QuantIntelligenceSnapshot,
  RiskCheckResult,
  RiskConfig,
  TechnicalIndicators,
  TradingMode,
  TradingSignal,
} from '../engine/types';
import { ActivePositionsPanel } from './ActivePositionsPanel';
import { CandlestickChart } from './CandlestickChart';
import { FullMarketRadar } from './FullMarketRadar';
import { LiquidationRadarPanel } from './LiquidationRadarPanel';
import { useI18n } from '../i18n/I18nContext';

interface MarketScannerProps {
  tickers: MarketTicker[];
  selectedTicker: MarketTicker | null;
  orderBook: OrderBookSnapshot | null;
  positions?: Position[];
  riskConfig: RiskConfig;
  tradingMode: TradingMode;
  latestSignal?: TradingSignal | null;
  onSelectSymbol: (symbol: string, marketType: MarketType, exchange?: string) => void;
  onSelectRemotePair?: (
    symbol: string,
    marketType: MarketType,
    exchange: string,
    options?: { runAi?: boolean },
  ) => Promise<void>;
  onOpenGlobalSearch?: () => void;
  onRunPipeline?: (symbol: string, marketType: MarketType, exchange?: string) => void;
  pipelineLoading?: boolean;
  onOrderPlaced: () => void;
  onClosePosition?: (id: string) => Promise<ClosePositionResponse | void> | void;
  onUpdateSlTp?: (id: string, stopLoss: number, takeProfit: number) => Promise<{ ok: boolean; error?: string }>;
}

export const MarketScanner: React.FC<MarketScannerProps> = ({
  tickers,
  selectedTicker,
  orderBook,
  positions = [],
  riskConfig,
  tradingMode,
  latestSignal = null,
  onSelectSymbol,
  onSelectRemotePair,
  onOpenGlobalSearch,
  onRunPipeline,
  pipelineLoading = false,
  onOrderPlaced,
  onClosePosition,
  onUpdateSlTp,
}) => {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [marketFilter, setMarketFilter] = useState<'ALL' | 'SPOT' | 'PERPETUAL'>('ALL');
  const [exchangeFilter, setExchangeFilter] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<'DEFAULT' | 'VOLUME' | 'CHANGE' | 'RSI'>('DEFAULT');
  const [remoteResults, setRemoteResults] = useState<MarketDirectoryEntry[]>([]);
  const [totalIndexed, setTotalIndexed] = useState<number>(0);
  const [remoteSearching, setRemoteSearching] = useState(false);
  const [activatingPairKey, setActivatingPairKey] = useState<string | null>(null);
  const [interval, setIntervalState] = useState<string>('1h');

  const [candles, setCandles] = useState<Candle[]>([]);
  const [indicators, setIndicators] = useState<TechnicalIndicators | null>(null);
  const [quantIntel, setQuantIntel] = useState<QuantIntelligenceSnapshot | null>(null);
  const [candleSource, setCandleSource] = useState<string>('');

  // Order Ticket state
  const [side, setSide] = useState<OrderSide>('LONG');
  const [orderType, setOrderType] = useState<OrderType>('MARKET');
  const [entryPrice, setEntryPrice] = useState<string>('');
  const [stopLoss, setStopLoss] = useState<string>('');
  const [takeProfit, setTakeProfit] = useState<string>('');
  const [leverage, setLeverage] = useState<number>(riskConfig.defaultLeverage);
  const [riskCheck, setRiskCheck] = useState<RiskCheckResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [orderFeedback, setOrderFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const active = selectedTicker ?? tickers[0] ?? null;
  const prevPriceRef = useRef<{ key: string; price: number }>({ key: '', price: 0 });
  const [tickDir, setTickDir] = useState<'UP' | 'DOWN' | 'FLAT'>('FLAT');

  useEffect(() => {
    if (!active || !(active.lastPrice > 0)) {
      setTickDir('FLAT');
      return;
    }
    const pairKey = `${active.symbol}|${active.marketType}|${active.exchange}`;
    if (prevPriceRef.current.key !== pairKey) {
      prevPriceRef.current = { key: pairKey, price: active.lastPrice };
      setTickDir('FLAT');
      return;
    }
    if (active.lastPrice > prevPriceRef.current.price) {
      setTickDir('UP');
    } else if (active.lastPrice < prevPriceRef.current.price) {
      setTickDir('DOWN');
    }
    prevPriceRef.current.price = active.lastPrice;
  }, [active?.symbol, active?.marketType, active?.exchange, active?.lastPrice]);

  const liveCandles = useMemo(() => {
    if (!active || !(active.lastPrice > 0) || active.dataStatus !== 'LIVE_EXCHANGE') {
      return candles;
    }
    return mergeLiveTickIntoCandles(candles, active.lastPrice, active.timestampUtc, interval);
  }, [candles, active?.lastPrice, active?.timestampUtc, active?.dataStatus, interval]);

  const activeFreshness = useMemo(
    () => (active ? classifyFeedFreshness(active.timestampUtc) : { ageMs: Infinity, tier: 'UNAVAILABLE' as const }),
    [active?.timestampUtc, active?.lastPrice],
  );

  const activeBasis = useMemo(
    () => (active ? computeCrossVenueBasisBps(tickers, active) : { medianRefPrice: 0, basisBps: 0, peerCount: 0 }),
    [tickers, active],
  );

  const matchedSignal =
    active && latestSignal && isSameTickerSelection(active, latestSignal)
      ? latestSignal
      : null;
  const activeSymbolPosition = active
    ? positions.find((p) => isSameTickerSelection(active, p)) ??
      positions.find((p) => p.symbol === active.symbol && p.marketType === active.marketType) ??
      null
    : null;
  const hasDraftLevels =
    Number(entryPrice) > 0 || Number(stopLoss) > 0 || Number(takeProfit) > 0;
  const effectiveEntryNum =
    active && orderType === 'MARKET'
      ? hasDraftLevels
        ? active.lastPrice
        : 0
      : Number(entryPrice);
  const chartEntryPrice =
    effectiveEntryNum > 0 ? effectiveEntryNum : activeSymbolPosition?.entryPrice;
  const chartStopLoss =
    Number(stopLoss) > 0 ? Number(stopLoss) : activeSymbolPosition?.stopLoss;
  const chartTakeProfit =
    Number(takeProfit) > 0 ? Number(takeProfit) : activeSymbolPosition?.takeProfit;

  // Load candles whenever active (symbol, marketType, exchange) or interval changes
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const params = new URLSearchParams({
      symbol: active.symbol,
      marketType: active.marketType,
      interval,
      exchange: active.exchange,
    });
    apiFetch(`/api/market/candles?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setCandles(data.candles ?? []);
        setIndicators(data.indicators ?? null);
        setQuantIntel(data.quantIntel ?? null);
        setCandleSource(data.source ?? '');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [active?.symbol, active?.marketType, active?.exchange, interval]);

  const pendingPresetRef = useRef<{
    symbol: string;
    marketType: MarketType;
    exchange: string;
    side: OrderSide;
    orderType: OrderType;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    leverage: number;
  } | null>(null);

  // Clear order inputs cleanly when switching symbol/marketType/exchange, unless applying an explicit scanned preset
  useEffect(() => {
    const preset = pendingPresetRef.current;
    if (
      active &&
      preset &&
      preset.symbol === active.symbol &&
      preset.marketType === active.marketType &&
      (!preset.exchange || preset.exchange === active.exchange)
    ) {
      pendingPresetRef.current = null;
      const dec = getSmartPriceDecimals(preset.entryPrice || active.lastPrice);
      const effSide: OrderSide = active.marketType === 'SPOT' ? 'LONG' : preset.side;
      setSide(effSide);
      setOrderType(preset.orderType);
      setEntryPrice(preset.entryPrice.toFixed(dec));
      setStopLoss(preset.stopLoss.toFixed(dec));
      setTakeProfit(preset.takeProfit.toFixed(dec));
      setLeverage(active.marketType === 'SPOT' ? 1 : preset.leverage);
      setRiskCheck(null);
      setOrderFeedback(null);
      return;
    }

    setEntryPrice('');
    setStopLoss('');
    setTakeProfit('');
    setRiskCheck(null);
    setOrderFeedback(null);
    if (active?.marketType === 'SPOT') {
      setSide('LONG');
      setLeverage(1);
    }
  }, [active?.symbol, active?.marketType, active?.exchange]);

  const prevDefaultLevRef = useRef<number>(riskConfig.defaultLeverage);
  useEffect(() => {
    if (active?.marketType === 'SPOT') {
      setLeverage(1);
      prevDefaultLevRef.current = riskConfig.defaultLeverage;
      return;
    }
    setLeverage((prev) => {
      if (prev === prevDefaultLevRef.current) {
        return riskConfig.defaultLeverage;
      }
      return Math.min(riskConfig.maxLeverage, Math.max(1, prev));
    });
    prevDefaultLevRef.current = riskConfig.defaultLeverage;
  }, [riskConfig.defaultLeverage, riskConfig.maxLeverage, active?.marketType]);

  const applyZeroStopHuntLevels = (targetSide?: OrderSide) => {
    if (!active) return;
    const effSide: OrderSide =
      active.marketType === 'SPOT' ? 'LONG' : (targetSide ?? side);
    if (effSide !== side) {
      setSide(effSide);
    }
    const px = active.lastPrice;
    const dec = getSmartPriceDecimals(px);
    const radar = quantIntel?.liquidationRadar;
    if (radar) {
      setEntryPrice(px.toFixed(dec));
      if (effSide === 'LONG') {
        setStopLoss(radar.recommendedLongSl.toFixed(dec));
        setTakeProfit(radar.recommendedLongTp.toFixed(dec));
      } else {
        setStopLoss(radar.recommendedShortSl.toFixed(dec));
        setTakeProfit(radar.recommendedShortTp.toFixed(dec));
      }
      return;
    }
    const minPx = Math.pow(10, -dec);
    const atr = indicators?.atr14 && indicators.atr14 > 0 ? indicators.atr14 : px * 0.015;
    const stopDist = Math.max(atr * 1.5, px * 0.012);
    const tpDist = stopDist * Math.max(1.8, riskConfig.minRiskReward);
    setEntryPrice(px.toFixed(dec));
    if (effSide === 'LONG') {
      setStopLoss(Math.max(minPx, px - stopDist).toFixed(dec));
      setTakeProfit((px + tpDist).toFixed(dec));
    } else {
      setStopLoss((px + stopDist).toFixed(dec));
      setTakeProfit(Math.max(minPx, px - tpDist).toFixed(dec));
    }
  };

  const applyMarketAtrLevels = () => {
    applyZeroStopHuntLevels(side);
  };

  const applyAiSignalLevels = () => {
    if (!active || !matchedSignal || matchedSignal.direction === 'NO_TRADE') {
      return;
    }
    if (active.marketType === 'SPOT' && matchedSignal.direction === 'SHORT') {
      return;
    }
    const entry = matchedSignal.entryRange[0];
    const tp = matchedSignal.takeProfitLevels[1] ?? matchedSignal.takeProfitLevels[0];
    if (!(entry > 0 && matchedSignal.stopLoss > 0 && tp > 0)) {
      return;
    }
    const dec = getSmartPriceDecimals(active.lastPrice);
    setOrderType('LIMIT');
    setSide(matchedSignal.direction);
    setEntryPrice(entry.toFixed(dec));
    setStopLoss(matchedSignal.stopLoss.toFixed(dec));
    setTakeProfit(tp.toFixed(dec));
    if (active.marketType !== 'SPOT') {
      setLeverage(Math.max(1, Math.min(riskConfig.maxLeverage, matchedSignal.leverage)));
    } else {
      setLeverage(1);
    }
  };

  // Query full global multi-exchange MarketDirectory whenever user types in Scanner search
  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setRemoteResults([]);
      setRemoteSearching(false);
      return;
    }
    let cancelled = false;
    setRemoteSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          q,
          marketType: marketFilter,
          exchange: exchangeFilter,
          limit: '24',
        });
        const res = await apiFetch(`/api/market/search?${params.toString()}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setRemoteResults(Array.isArray(data.results) ? data.results : []);
          if (Number(data.totalIndexed) > 0) setTotalIndexed(Number(data.totalIndexed));
        }
      } catch {
        // non-fatal
      } finally {
        if (!cancelled) setRemoteSearching(false);
      }
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search, marketFilter, exchangeFilter]);

  // Live Risk Engine Pre-Flight Evaluation (only runs when user explicitly provides SL/TP)
  useEffect(() => {
    if (!active) return;
    const ep = orderType === 'MARKET' ? active.lastPrice : Number(entryPrice);
    const sl = Number(stopLoss);
    const tp = Number(takeProfit);
    if (!(ep > 0 && sl > 0 && tp > 0)) {
      setRiskCheck(null);
      return;
    }
    const timer = setTimeout(() => {
      apiFetch('/api/orders/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: active.symbol,
          exchange: active.exchange,
          marketType: active.marketType,
          side,
          orderType,
          entryPrice: ep,
          stopLoss: sl,
          takeProfit: tp,
          leverage: active.marketType === 'SPOT' ? 1 : leverage,
        }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (d.riskCheck) setRiskCheck(d.riskCheck);
        })
        .catch(() => {});
    }, 180);
    return () => clearTimeout(timer);
  }, [active?.symbol, active?.marketType, active?.exchange, active?.lastPrice, side, orderType, entryPrice, stopLoss, takeProfit, leverage]);

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!active) return;
    setSubmitting(true);
    setOrderFeedback(null);
    try {
      const idempotencyKey = `UI-${active.symbol}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const submittedEntry =
        orderType === 'MARKET' ? active.lastPrice : Number(entryPrice);
      const res = await apiFetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: active.symbol,
          exchange: active.exchange,
          marketType: active.marketType,
          side,
          orderType,
          entryPrice: submittedEntry,
          stopLoss: Number(stopLoss),
          takeProfit: Number(takeProfit),
          leverage: active.marketType === 'SPOT' ? 1 : leverage,
          idempotencyKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOrderFeedback({ ok: false, text: data.error || t('scanner.ticket.rejected') });
      } else {
        setOrderFeedback({
          ok: true,
          text: t('scanner.ticket.filled', {
            mode: data.position.mode,
            side: data.position.side,
            qty: data.position.quantity,
            symbol: data.position.symbol,
            price: data.position.entryPrice,
          }),
        });
        onOrderPlaced();
      }
    } catch {
      setOrderFeedback({ ok: false, text: t('scanner.ticket.networkErr') });
    } finally {
      setSubmitting(false);
    }
  };

  const filteredBase = tickers.filter((t) => {
    const matchSearch =
      !search.trim() ||
      t.symbol.toLowerCase().includes(search.trim().toLowerCase()) ||
      t.baseAsset.toLowerCase().includes(search.trim().toLowerCase()) ||
      t.exchange.toLowerCase().includes(search.trim().toLowerCase());
    const matchMarket = marketFilter === 'ALL' || t.marketType === marketFilter;
    const matchExchange = exchangeFilter === 'ALL' || t.exchange === exchangeFilter;
    return matchSearch && matchMarket && matchExchange;
  });

  const filtered = [...filteredBase].sort((a, b) => {
    if (sortBy === 'VOLUME') return b.volume24hUsd - a.volume24hUsd;
    if (sortBy === 'CHANGE') return b.change24hPct - a.change24hPct;
    if (sortBy === 'RSI') return (b.rsi14 ?? 0) - (a.rsi14 ?? 0);
    return 0;
  });

  const localKeys = new Set(
    tickers.map((t) => `${t.symbol.toUpperCase()}|${t.marketType}|${t.exchange.toUpperCase()}`),
  );
  const extraRemoteResults = search.trim()
    ? remoteResults.filter(
        (r) =>
          !localKeys.has(
            `${r.symbol.toUpperCase()}|${r.marketType}|${r.exchange.toUpperCase()}`,
          ),
      )
    : [];

  const handleActivateRemote = async (entry: MarketDirectoryEntry) => {
    const key = `${entry.symbol}|${entry.marketType}|${entry.exchangeId}`;
    setActivatingPairKey(key);
    try {
      if (onSelectRemotePair) {
        await onSelectRemotePair(entry.symbol, entry.marketType, entry.exchange);
      } else {
        onSelectSymbol(entry.symbol, entry.marketType, entry.exchange);
      }
    } finally {
      setActivatingPairKey(null);
    }
  };

  const handleInspectOpportunity = async (
    opp: FullMarketOpportunity,
    loadTicket: boolean,
  ) => {
    if (loadTicket) {
      const dec = getSmartPriceDecimals(opp.lastPrice);
      const minPx = Math.pow(10, -dec);
      const effSide: OrderSide =
        opp.marketType === 'SPOT'
          ? 'LONG'
          : opp.direction === 'SHORT'
            ? 'SHORT'
            : 'LONG';
      const hasExactSignal =
        opp.deepVerified && opp.entryPrice > 0 && opp.stopLoss > 0 && opp.takeProfit > 0;
      const fallbackDist = Math.max(
        opp.lastPrice * 0.015,
        opp.lastPrice * (Math.max(2, opp.volatility24hPct) / 100) * 0.25,
      );
      const ep = hasExactSignal ? opp.entryPrice : opp.lastPrice;
      const sl = hasExactSignal
        ? opp.stopLoss
        : effSide === 'LONG'
          ? Math.max(minPx, ep - fallbackDist)
          : ep + fallbackDist;
      const tp = hasExactSignal
        ? opp.takeProfit
        : effSide === 'LONG'
          ? ep + fallbackDist * Math.max(1.8, riskConfig.minRiskReward)
          : Math.max(minPx, ep - fallbackDist * Math.max(1.8, riskConfig.minRiskReward));
      const lev =
        opp.marketType === 'SPOT'
          ? 1
          : Math.min(riskConfig.maxLeverage, riskConfig.defaultLeverage, opp.maxLeverage);

      const alreadyActive =
        active &&
        active.symbol === opp.symbol &&
        active.marketType === opp.marketType &&
        active.exchange === opp.exchange;

      if (alreadyActive) {
        setSide(effSide);
        setOrderType(hasExactSignal ? 'LIMIT' : 'MARKET');
        setEntryPrice(ep.toFixed(dec));
        setStopLoss(sl.toFixed(dec));
        setTakeProfit(tp.toFixed(dec));
        setLeverage(lev);
      } else {
        pendingPresetRef.current = {
          symbol: opp.symbol,
          marketType: opp.marketType,
          exchange: opp.exchange,
          side: effSide,
          orderType: hasExactSignal ? 'LIMIT' : 'MARKET',
          entryPrice: ep,
          stopLoss: sl,
          takeProfit: tp,
          leverage: lev,
        };
      }
    }

    if (onSelectRemotePair) {
      await onSelectRemotePair(opp.symbol, opp.marketType, opp.exchange);
    } else {
      onSelectSymbol(opp.symbol, opp.marketType, opp.exchange);
    }
  };

  const allExchanges = ['Binance', 'Bybit', 'OKX', 'Kraken', 'Coinbase Advanced'];

  return (
    <div className="space-y-6">
      <FullMarketRadar
        activeTicker={active}
        onInspectOpportunity={handleInspectOpportunity}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Universal Coin & Market Scanner */}
        <section className="rounded-xl border border-slate-800/90 bg-[#0E1522] p-4 lg:col-span-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-100">
              {t('scanner.title')}
            </h2>
            <p className="text-[11px] text-slate-400">
              {t('scanner.watchlistCount', { count: filtered.length })}
              {totalIndexed > 0
                ? t('scanner.indexedSuffix', { total: totalIndexed.toLocaleString('en-US') })
                : ''}
            </p>
          </div>
          {onOpenGlobalSearch && (
            <button
              type="button"
              onClick={onOpenGlobalSearch}
              aria-label={t('scanner.quickSearchAria')}
              className="flex min-h-[34px] items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-2.5 text-[11px] font-semibold text-cyan-300 hover:bg-cyan-500/20 whitespace-nowrap"
            >
              <Search className="h-3 w-3" />
              <span>{t('scanner.quickSearchBtn')}</span>
            </button>
          )}
        </div>

        <div className="mt-3 space-y-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('scanner.searchPlaceholder')}
              aria-label={t('scanner.searchAria')}
              className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#070B12] pr-9 pl-9 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label={t('scanner.clearSearchAria')}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {(['ALL', 'SPOT', 'PERPETUAL'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMarketFilter(m)}
                className={`min-h-[36px] rounded-lg px-2.5 py-1 text-xs font-medium whitespace-nowrap ${
                  marketFilter === m
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200'
                }`}
              >
                {m === 'ALL' ? t('scanner.filterAll') : m}
              </button>
            ))}

            <select
              value={exchangeFilter}
              onChange={(e) => setExchangeFilter(e.target.value)}
              aria-label={t('scanner.filterExchangeAria')}
              className="min-h-[36px] rounded-lg border border-slate-800 bg-[#070B12] px-2 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
            >
              <option value="ALL">{t('scanner.allExchanges')}</option>
              {allExchanges.map((ex) => (
                <option key={ex} value={ex}>
                  {ex}
                </option>
              ))}
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              aria-label={t('scanner.sortAria')}
              className="min-h-[36px] rounded-lg border border-slate-800 bg-[#070B12] px-2 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
            >
              <option value="DEFAULT">{t('scanner.sortDefault')}</option>
              <option value="VOLUME">{t('scanner.sortVol')}</option>
              <option value="CHANGE">{t('scanner.sortChange')}</option>
              <option value="RSI">RSI(14)</option>
            </select>
          </div>
        </div>

        <div className="mt-3 max-h-[470px] space-y-2 overflow-y-auto pr-1">
          {filtered.length > 0 && (
            <div className="divide-y divide-slate-800/60">
              {filtered.map((t) => {
                const isSelected =
                  active?.symbol === t.symbol &&
                  active?.marketType === t.marketType &&
                  active?.exchange === t.exchange;
                const up = t.change24hPct >= 0;
                return (
                  <button
                    key={`${t.symbol}-${t.marketType}-${t.exchange}`}
                    type="button"
                    onClick={() => onSelectSymbol(t.symbol, t.marketType, t.exchange)}
                    className={`flex min-h-[56px] w-full items-center justify-between rounded-lg px-2 py-2.5 text-left transition-colors ${
                      isSelected ? 'bg-cyan-500/10' : 'hover:bg-slate-800/30'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-display text-sm font-semibold text-slate-100">
                          {t.symbol}
                        </span>
                        <span className="text-[11px] text-slate-400">{t.marketType}</span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-slate-500">
                        {t.exchange} · {t.regime} · Vol {formatCompactUsd(t.volume24hUsd)}
                      </p>
                    </div>
                    <div className="shrink-0 pl-2 text-right">
                      <p className="font-mono text-sm font-semibold tabular-nums text-slate-100">
                        {formatAssetPrice(t.lastPrice)}
                      </p>
                      <p
                        className={`flex items-center justify-end gap-0.5 font-mono text-xs tabular-nums ${
                          up ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        {up ? '+' : ''}
                        {t.change24hPct.toFixed(2)}%
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Global Multi-Exchange Live Discovery Results for searched coins outside watchlist */}
          {search.trim() && (
            <div className="border-t border-slate-800 pt-2.5">
              <div className="mb-1.5 flex items-center justify-between px-1 text-[11px]">
                <span className="font-semibold text-cyan-300">
                  {t('scanner.globalExpandHeader', { count: extraRemoteResults.length })}
                </span>
                {remoteSearching && <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" />}
              </div>

              {extraRemoteResults.length === 0 && !remoteSearching ? (
                filtered.length === 0 && (
                  <p className="px-2 py-4 text-center text-xs text-slate-400">
                    {t('scanner.noMatch', { query: search })}
                  </p>
                )
              ) : (
                <div className="divide-y divide-slate-800/60">
                  {extraRemoteResults.map((entry) => {
                    const key = `${entry.symbol}|${entry.marketType}|${entry.exchangeId}`;
                    const loadingRow = activatingPairKey === key;
                    const up = entry.change24hPct >= 0;
                    return (
                      <button
                        key={key}
                        type="button"
                        disabled={Boolean(activatingPairKey)}
                        onClick={() => handleActivateRemote(entry)}
                        className="flex min-h-[56px] w-full items-center justify-between rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-cyan-500/10 disabled:opacity-60"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-display text-sm font-semibold text-cyan-200">
                              {entry.symbol}
                            </span>
                            <span className="text-[11px] text-slate-400">{entry.marketType}</span>
                          </div>
                          <p className="mt-0.5 truncate text-[11px] text-slate-400">
                            {entry.exchange} · Vol {formatCompactUsd(entry.volume24hUsd)} · {t('scanner.clickToAnalyze')}
                          </p>
                        </div>
                        <div className="shrink-0 pl-2 text-right">
                          {loadingRow ? (
                            <Loader2 className="ml-auto h-4 w-4 animate-spin text-cyan-400" />
                          ) : (
                            <>
                              <p className="font-mono text-sm font-semibold tabular-nums text-slate-100">
                                {formatAssetPrice(entry.lastPrice)}
                              </p>
                              <p
                                className={`flex items-center justify-end gap-0.5 font-mono text-xs tabular-nums ${
                                  up ? 'text-emerald-400' : 'text-rose-400'
                                }`}
                              >
                                {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                {up ? '+' : ''}
                                {entry.change24hPct.toFixed(2)}%
                              </p>
                            </>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Center + Right: Chart, Indicators, Order Book & Risk-Gated Order Ticket */}
      <div className="space-y-6 lg:col-span-8">
        {active && (
          <>
            {/* Symbol Header & Timeframe Selector */}
            <div className="rounded-xl border border-slate-800/90 bg-[#0E1522] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="font-display text-xl font-bold text-slate-50">
                      {active.symbol}
                    </h2>
                    <span
                      className={`font-mono text-lg font-bold tabular-nums transition-colors duration-200 ${
                        tickDir === 'UP'
                          ? 'text-emerald-400'
                          : tickDir === 'DOWN'
                            ? 'text-rose-400'
                            : 'text-slate-100'
                      }`}
                    >
                      {formatAssetPrice(active.lastPrice)}
                    </span>
                    <span className="text-xs text-slate-400">
                      {active.exchange} · {active.marketType} ·{' '}
                      <span
                        className={`font-mono ${
                          activeFreshness.tier === 'REALTIME' || activeFreshness.tier === 'LIVE'
                            ? 'text-emerald-400'
                            : activeFreshness.tier === 'AGING'
                              ? 'text-amber-400'
                              : 'text-rose-400'
                        }`}
                      >
                        {t(`feed.tier.${activeFreshness.tier}`)}
                      </span>
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {active.sourceLabel.includes('WS') ? active.sourceLabel : (candleSource || active.sourceLabel)}
                    {' · '}
                    <span className="font-mono tabular-nums">
                      {t('feed.latencyLabel', { ms: active.latencyMs })}
                    </span>
                    {' · '}Spread{' '}
                    <span className="font-mono tabular-nums">{active.spreadBps.toFixed(2)} bps</span>
                    {activeBasis.peerCount > 0 && (
                      <>
                        {' · '}
                        <span
                          className={`font-mono tabular-nums ${
                            Math.abs(activeBasis.basisBps) >= 12 ? 'text-amber-300' : 'text-slate-300'
                          }`}
                        >
                          {t('feed.basisLabel', {
                            bps: `${activeBasis.basisBps >= 0 ? '+' : ''}${activeBasis.basisBps.toFixed(1)}`,
                          })}
                        </span>
                      </>
                    )}
                    {active.fundingRatePct !== null && (
                      <>
                        {' · '}Funding{' '}
                        <span className="font-mono tabular-nums">
                          {active.fundingRatePct.toFixed(4)}%
                        </span>
                      </>
                    )}
                  </p>
                </div>

                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      {(['15m', '1h', '4h', '1d'] as const).map((tf) => (
                        <button
                          key={tf}
                          type="button"
                          onClick={() => setIntervalState(tf)}
                          className={`min-h-[38px] rounded-lg px-3 py-1 text-xs font-mono ${
                            interval === tf
                              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                              : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200'
                          }`}
                        >
                          {tf}
                        </button>
                      ))}
                    </div>
                    {onRunPipeline && (
                      <button
                        type="button"
                        disabled={pipelineLoading}
                        onClick={() =>
                          onRunPipeline(active.symbol, active.marketType, active.exchange)
                        }
                        className="flex min-h-[38px] items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-emerald-500 px-3 text-xs font-bold text-slate-950 hover:opacity-95 disabled:opacity-50 whitespace-nowrap"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>{pipelineLoading ? t('scanner.runningAi') : t('scanner.runAi')}</span>
                      </button>
                    )}
                  </div>
                </div>

              <div className="mt-4">
                <CandlestickChart
                  candles={liveCandles}
                  indicators={indicators}
                  livePrice={active.lastPrice}
                  entryPrice={chartEntryPrice}
                  stopLoss={chartStopLoss}
                  takeProfit={chartTakeProfit}
                  longLiqZone={quantIntel?.liquidationRadar?.nearestLongLiqPrice ?? null}
                  shortLiqZone={quantIntel?.liquidationRadar?.nearestShortLiqPrice ?? null}
                />
              </div>

              {/* Computed Technical Indicators Strip */}
              {indicators && (
                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-800/80 pt-3 text-xs sm:grid-cols-4">
                  <div>
                    <p className="text-slate-400">RSI (14)</p>
                    <p className="font-mono font-semibold tabular-nums text-slate-100">
                      {indicators.rsi14.toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400">EMA 9 / 21</p>
                    <p className="font-mono font-semibold tabular-nums text-slate-100">
                      {indicators.ema9.toFixed(getSmartPriceDecimals(indicators.ema9))} /{' '}
                      {indicators.ema21.toFixed(getSmartPriceDecimals(indicators.ema21))}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400">ATR (14) · ADX</p>
                    <p className="font-mono font-semibold tabular-nums text-slate-100">
                      {indicators.atr14.toFixed(getSmartPriceDecimals(active.lastPrice))} ·{' '}
                      {indicators.adx14.toFixed(1)}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400">Supertrend</p>
                    <p
                      className={`font-mono font-semibold ${
                        indicators.supertrend.direction === 'BULLISH'
                          ? 'text-emerald-400'
                          : 'text-rose-400'
                      }`}
                    >
                      {indicators.supertrend.direction}
                    </p>
                  </div>
                </div>
              )}

              {/* Quantitative Microstructure, Hurst & Quarter-Kelly Strip */}
              {quantIntel && (
                <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-800/70 pt-3 text-xs sm:grid-cols-4">
                  <div>
                    <p className="text-slate-400">{t('quantIntel.hurstLabel')}</p>
                    <p
                      className={`font-mono font-semibold tabular-nums ${
                        quantIntel.hurst.regimeClass === 'TRENDING_PERSISTENT'
                          ? 'text-emerald-400'
                          : quantIntel.hurst.regimeClass === 'MEAN_REVERTING'
                            ? 'text-cyan-400'
                            : 'text-amber-400'
                      }`}
                    >
                      H={quantIntel.hurst.hurstExponent.toFixed(2)} · ER {quantIntel.hurst.efficiencyRatio.toFixed(2)}
                    </p>
                    <p className="mt-0.5 text-[10px] text-slate-400">
                      {t(`quantIntel.hurst.${quantIntel.hurst.regimeClass}`)}
                    </p>
                  </div>

                  <div>
                    <p className="text-slate-400">{t('quantIntel.squeezeLabel')}</p>
                    <p
                      className={`font-mono font-semibold tabular-nums ${
                        quantIntel.microstructure.squeezeState === 'SQUEEZE_FIRING'
                          ? 'text-emerald-400'
                          : quantIntel.microstructure.squeezeState === 'ACTIVE_SQUEEZE'
                            ? 'text-amber-300'
                            : 'text-slate-200'
                      }`}
                    >
                      {quantIntel.microstructure.squeezeCompressionRatio.toFixed(2)}x BB/KC
                    </p>
                    <p className="mt-0.5 text-[10px] text-slate-400">
                      {t(`quantIntel.squeeze.${quantIntel.microstructure.squeezeState}`)}
                    </p>
                  </div>

                  <div>
                    <p className="text-slate-400">{t('quantIntel.orderFlowLabel')}</p>
                    <p className="font-mono font-semibold tabular-nums text-slate-100">
                      Z {quantIntel.microstructure.vwapZScore >= 0 ? '+' : ''}
                      {quantIntel.microstructure.vwapZScore.toFixed(2)} · Δ{' '}
                      {quantIntel.microstructure.signedVolumeDeltaPct >= 0 ? '+' : ''}
                      {quantIntel.microstructure.signedVolumeDeltaPct.toFixed(0)}%
                    </p>
                    <p className="mt-0.5 text-[10px] text-cyan-300">
                      {t(`quantIntel.flow.${quantIntel.microstructure.orderFlowBias}`)}
                      {quantIntel.microstructure.fvgSignal !== 'NONE'
                        ? ` · ${quantIntel.microstructure.fvgSignal.replace('_', ' ')}`
                        : quantIntel.microstructure.liquiditySweep !== 'NONE'
                          ? ` · ${quantIntel.microstructure.liquiditySweep.replaceAll('_', ' ')}`
                          : ''}
                    </p>
                  </div>

                  <div>
                    <p className="text-slate-400">{t('quantIntel.kellyLabel')}</p>
                    <p className="font-mono font-semibold tabular-nums text-emerald-400">
                      {quantIntel.kelly.volAdjustedRiskPct.toFixed(2)}% Equity ($
                      {quantIntel.kelly.recommendedMarginUsd.toLocaleString('en-US', {
                        maximumFractionDigits: 0,
                      })}
                      )
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] tabular-nums text-slate-400">
                      {t('quantIntel.edgeScore', { score: quantIntel.compositeEdgeScore })} · 1/4K{' '}
                      {quantIntel.kelly.quarterKellyPct.toFixed(2)}%
                    </p>
                  </div>
                </div>
              )}
            </div>

            {quantIntel?.liquidationRadar && (
              <LiquidationRadarPanel
                radar={quantIntel.liquidationRadar}
                selectedSide={side}
                marketType={active.marketType}
                onApplyZeroStopHunt={applyZeroStopHuntLevels}
              />
            )}

            {/* Order Execution Ticket + L2 Order Book */}
            <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
              <form
                onSubmit={handleSubmitOrder}
                className="rounded-xl border border-slate-800/90 bg-[#0E1522] p-4 md:col-span-7"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-sm font-semibold text-slate-100">
                    {t('scanner.ticket.title', { mode: tradingMode })}
                  </h3>
                  <span className="font-mono text-xs text-amber-400">
                    {t('scanner.ticket.paperBadge')}
                  </span>
                </div>

                {/* Side Tabs */}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSide('LONG')}
                    className={`min-h-[44px] rounded-lg text-sm font-semibold transition-colors ${
                      side === 'LONG'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50'
                        : 'bg-slate-900 text-slate-400 border border-slate-800'
                    }`}
                  >
                    {t('scanner.ticket.longBtn')}
                  </button>
                  <button
                    type="button"
                    disabled={active.marketType === 'SPOT'}
                    onClick={() => setSide('SHORT')}
                    className={`min-h-[44px] rounded-lg text-sm font-semibold transition-colors disabled:opacity-40 ${
                      side === 'SHORT'
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/50'
                        : 'bg-slate-900 text-slate-400 border border-slate-800'
                    }`}
                  >
                    {t('scanner.ticket.shortBtn')}
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-slate-400" htmlFor="order-type">
                      {t('scanner.ticket.orderType')}
                    </label>
                    <select
                      id="order-type"
                      value={orderType}
                      onChange={(e) => setOrderType(e.target.value as OrderType)}
                      className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-3 text-sm text-slate-100"
                    >
                      <option value="MARKET">MARKET</option>
                      <option value="LIMIT">LIMIT</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs text-slate-400" htmlFor="order-leverage">
                      {t('scanner.ticket.leverage', { max: riskConfig.maxLeverage })}
                    </label>
                    <input
                      id="order-leverage"
                      type="number"
                      min={1}
                      max={10}
                      step={1}
                      disabled={active.marketType === 'SPOT'}
                      value={leverage}
                      onChange={(e) => setLeverage(Number(e.target.value))}
                      className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-3 font-mono text-sm tabular-nums text-slate-100 disabled:opacity-50"
                    />
                  </div>
                </div>

                {/* Explicit Optional Price Fill Helpers (Zero Auto-Defaults) */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={applyMarketAtrLevels}
                    className="min-h-[34px] rounded-lg border border-slate-700 bg-slate-900 px-2.5 text-[11px] font-medium text-slate-200 hover:border-cyan-500/50 hover:text-cyan-300"
                  >
                    {t('scanner.ticket.fillMarketAtr')}
                  </button>
                  {matchedSignal && matchedSignal.direction !== 'NO_TRADE' && (
                      <button
                        type="button"
                        onClick={applyAiSignalLevels}
                        className="min-h-[34px] rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-2.5 text-[11px] font-medium text-cyan-300 hover:bg-cyan-500/25"
                      >
                        {t('scanner.ticket.fillAiSignal', { dir: matchedSignal.direction })}
                      </button>
                    )}
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs text-slate-400" htmlFor="entry-price">
                      {orderType === 'MARKET'
                        ? t('scanner.ticket.entryMarket')
                        : t('scanner.ticket.entryLimit')}
                    </label>
                    <input
                      id="entry-price"
                      type="number"
                      step="any"
                      disabled={orderType === 'MARKET'}
                      placeholder={
                        orderType === 'MARKET'
                          ? active.lastPrice > 0
                            ? formatAssetPrice(active.lastPrice)
                            : t('scanner.ticket.marketPricePh')
                          : t('scanner.ticket.limitPricePh')
                      }
                      value={orderType === 'MARKET' ? '' : entryPrice}
                      onChange={(e) => setEntryPrice(e.target.value)}
                      className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-3 font-mono text-sm tabular-nums text-slate-100 placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-75"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-400" htmlFor="sl-price">
                      {t('scanner.ticket.slLabel')}
                    </label>
                    <input
                      id="sl-price"
                      type="number"
                      step="any"
                      placeholder={t('scanner.ticket.slPh')}
                      value={stopLoss}
                      onChange={(e) => setStopLoss(e.target.value)}
                      className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-3 font-mono text-sm tabular-nums text-slate-100 placeholder:text-slate-600"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-400" htmlFor="tp-price">
                      {t('scanner.ticket.tpLabel')}
                    </label>
                    <input
                      id="tp-price"
                      type="number"
                      step="any"
                      placeholder={t('scanner.ticket.tpPh')}
                      value={takeProfit}
                      onChange={(e) => setTakeProfit(e.target.value)}
                      className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-3 font-mono text-sm tabular-nums text-slate-100 placeholder:text-slate-600"
                    />
                  </div>
                </div>

                {/* Live Deterministic Risk Engine Pre-Flight Check */}
                {riskCheck ? (
                  <div className="mt-3 rounded-lg border border-slate-800 bg-[#070B12] p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-300">
                        Risk Engine Pre-Flight
                      </span>
                      <span
                        className={`font-mono font-semibold ${
                          riskCheck.approved ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {riskCheck.decision}
                      </span>
                    </div>

                    <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-[11px] tabular-nums text-slate-300">
                      <div>
                        <span className="block text-slate-500">{t('scanner.ticket.size')}</span>
                        <span>{riskCheck.recommendedQuantity}</span>
                      </div>
                      <div>
                        <span className="block text-slate-500">R:R</span>
                        <span>{riskCheck.riskRewardRatio}</span>
                      </div>
                      <div>
                        <span className="block text-slate-500">{t('scanner.ticket.risk')}</span>
                        <span>${riskCheck.estimatedRiskUsd} ({riskCheck.estimatedRiskPct}%)</span>
                      </div>
                    </div>

                    {riskCheck.reasons.length > 0 && (
                      <div className="mt-2 flex items-start gap-1.5 text-rose-400">
                        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{riskCheck.reasons[0]}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-3 rounded-lg border border-dashed border-slate-800 bg-[#070B12] p-3 text-[11px] text-slate-400">
                    {t('scanner.ticket.emptyCheckBefore')}{' '}
                    <strong className="text-slate-200">{t('scanner.ticket.fillMarketAtr')}</strong>{' '}
                    {t('scanner.ticket.emptyCheckAfter')}
                  </div>
                )}

                {orderFeedback && (
                  <div
                    className={`mt-3 flex items-start gap-2 rounded-lg border p-2.5 text-xs ${
                      orderFeedback.ok
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                        : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                    }`}
                  >
                    {orderFeedback.ok ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    ) : (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    )}
                    <span>{orderFeedback.text}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className={`mt-4 flex min-h-[46px] w-full items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-50 ${
                    side === 'LONG'
                      ? 'bg-emerald-600 hover:bg-emerald-500'
                      : 'bg-rose-600 hover:bg-rose-500'
                  }`}
                >
                  {submitting
                    ? t('scanner.ticket.submitting')
                    : t('scanner.ticket.submitBtn', { side, symbol: active.symbol })}
                </button>
              </form>

              {/* L2 Order Book Depth */}
              <div className="rounded-xl border border-slate-800/90 bg-[#0E1522] p-4 md:col-span-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-sm font-semibold text-slate-100">
                    Order Book Depth
                  </h3>
                  <span className="font-mono text-[11px] tabular-nums text-slate-400">
                    Imbalance {orderBook ? `${(orderBook.imbalanceRatio * 100).toFixed(1)}%` : '--'}
                  </span>
                </div>

                {orderBook && orderBook.bids.length > 0 && orderBook.asks.length > 0 ? (
                  <div className="mt-3 space-y-2 font-mono text-xs tabular-nums">
                    <div className="grid grid-cols-3 text-[11px] text-slate-500">
                      <span>{t('scanner.ob.price')}</span>
                      <span className="text-right">{t('scanner.ob.qty')}</span>
                      <span className="text-right">{t('scanner.ob.usd')}</span>
                    </div>

                    <div className="space-y-1">
                      {orderBook.asks
                        .slice(0, 5)
                        .reverse()
                        .map((a, idx) => (
                          <div key={idx} className="grid grid-cols-3 text-rose-400">
                            <span>{a.price.toFixed(getSmartPriceDecimals(a.price))}</span>
                            <span className="text-right text-slate-300">{a.quantity}</span>
                            <span className="text-right text-slate-400">
                              ${a.totalUsd.toLocaleString('en-US')}
                            </span>
                          </div>
                        ))}
                    </div>

                    <div className="border-y border-slate-800 py-1.5 text-center text-sm font-semibold text-cyan-300">
                      {formatAssetPrice(active.lastPrice)} · Spread {orderBook.spreadBps.toFixed(2)} bps
                    </div>

                    <div className="space-y-1">
                      {orderBook.bids.slice(0, 5).map((b, idx) => (
                        <div key={idx} className="grid grid-cols-3 text-emerald-400">
                          <span>{b.price.toFixed(getSmartPriceDecimals(b.price))}</span>
                          <span className="text-right text-slate-300">{b.quantity}</span>
                          <span className="text-right text-slate-400">
                            ${b.totalUsd.toLocaleString('en-US')}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="mt-6 text-xs text-slate-400">
                    {orderBook?.dataStatus === 'UNAVAILABLE'
                      ? t('scanner.ob.unavailable', { exchange: active.exchange })
                      : t('scanner.ob.loading')}
                  </p>
                )}
              </div>
            </div>

            {positions.length > 0 && onClosePosition && (
              <ActivePositionsPanel
                positions={positions}
                title={t('scanner.positionsTitle', { count: positions.length })}
                onClosePosition={onClosePosition}
                onUpdateSlTp={onUpdateSlTp}
                onInspectSymbol={onSelectSymbol}
              />
            )}
          </>
        )}
      </div>
      </div>
    </div>
  );
};
