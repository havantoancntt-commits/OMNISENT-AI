import React, { useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Radar,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { formatAssetPrice, formatCompactUsd } from '../engine/symbolSearch';
import { isSameTickerSelection } from '../engine/pairSelection';
import type {
  FullMarketOpportunity,
  FullMarketScanResponse,
  HtfAlignment,
  MarketTicker,
  MarketType,
  OrderSide,
  ScannerAssetUniverse,
  ScannerSetupArchetype,
  ScannerStrategyFocus,
} from '../engine/types';
import { useI18n } from '../i18n/I18nContext';
import { apiFetch } from '../lib/apiClient';

function formatArchetypeLabel(
  a: ScannerSetupArchetype,
  t: ReturnType<typeof useI18n>['t'],
): { label: string; cls: string } {
  switch (a) {
    case 'MOMENTUM_BREAKOUT':
      return { label: t('radar.arch.MOMENTUM_BREAKOUT'), cls: 'text-cyan-300' };
    case 'SHORT_SQUEEZE':
      return { label: t('radar.arch.SHORT_SQUEEZE'), cls: 'text-emerald-300' };
    case 'OVERSOLD_REBOUND':
      return { label: t('radar.arch.OVERSOLD_REBOUND'), cls: 'text-amber-300' };
    case 'FUNDING_EDGE':
      return { label: t('radar.arch.FUNDING_EDGE'), cls: 'text-indigo-300' };
    default:
      return { label: t('radar.arch.TREND_CONTINUATION'), cls: 'text-slate-300' };
  }
}

function formatHtfShort(
  htf: HtfAlignment,
  deepVerified: boolean,
  t: ReturnType<typeof useI18n>['t'],
): { label: string; cls: string } {
  if (!deepVerified) return { label: t('radar.htf.prescreen24h'), cls: 'text-slate-400' };
  switch (htf) {
    case 'ALIGNED_BULL':
      return { label: t('radar.htf.alignedBull'), cls: 'text-emerald-400' };
    case 'ALIGNED_BEAR':
      return { label: t('radar.htf.alignedBear'), cls: 'text-emerald-400' };
    case 'COUNTER_TREND':
      return { label: t('radar.htf.counter'), cls: 'text-amber-400' };
    default:
      return { label: t('radar.htf.neutral'), cls: 'text-slate-400' };
  }
}

interface FullMarketRadarProps {
  activeTicker: MarketTicker | null;
  onInspectOpportunity: (opp: FullMarketOpportunity, loadTicket: boolean) => Promise<void>;
}

export const FullMarketRadar: React.FC<FullMarketRadarProps> = ({
  activeTicker,
  onInspectOpportunity,
}) => {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(true);
  const [strategyFocus, setStrategyFocus] = useState<ScannerStrategyFocus>('HIGH_PROFIT_ALPHA');
  const [assetUniverse, setAssetUniverse] = useState<ScannerAssetUniverse>('CRYPTO');
  const [marketType, setMarketType] = useState<MarketType | 'ALL'>('ALL');
  const [exchange, setExchange] = useState<string>('ALL');
  const [minVolumeUsd, setMinVolumeUsd] = useState<number>(1_000_000);
  const [direction, setDirection] = useState<OrderSide | 'ALL'>('ALL');

  const [scanResult, setScanResult] = useState<FullMarketScanResponse | null>(null);
  const [loadingFast, setLoadingFast] = useState(false);
  const [loadingDeep, setLoadingDeep] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activatingKey, setActivatingKey] = useState<string | null>(null);

  const runScan = async (mode: 'FAST' | 'DEEP') => {
    setErrorMsg(null);
    if (mode === 'DEEP') setLoadingDeep(true);
    else setLoadingFast(true);

    try {
      const res = await apiFetch('/api/market/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          marketType,
          exchange,
          minVolumeUsd,
          strategyFocus,
          direction,
          assetUniverse,
          limit: mode === 'DEEP' ? 18 : 20,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || t('radar.err.scanFailed'));
      } else {
        setScanResult(data as FullMarketScanResponse);
      }
    } catch {
      setErrorMsg(t('radar.err.network'));
    } finally {
      setLoadingFast(false);
      setLoadingDeep(false);
    }
  };

  // Auto-load instantaneous Stage-1 Full Market Breadth & Fast Screener when filters change
  useEffect(() => {
    let cancelled = false;
    const loadFast = async () => {
      setLoadingFast(true);
      try {
        const params = new URLSearchParams({
          marketType,
          exchange,
          minVolumeUsd: String(minVolumeUsd),
          strategyFocus,
          direction,
          assetUniverse,
          limit: '20',
        });
        const res = await apiFetch(`/api/market/scan?${params.toString()}`);
        if (!res.ok) return;
        const data = (await res.json()) as FullMarketScanResponse;
        if (!cancelled) {
          setScanResult((prev) => {
            if (prev?.scanMode === 'DEEP' && prev.filters?.assetUniverse === assetUniverse) return prev;
            return data;
          });
        }
      } catch {
        // non-fatal background sync
      } finally {
        if (!cancelled) setLoadingFast(false);
      }
    };
    loadFast();
    return () => {
      cancelled = true;
    };
  }, [marketType, exchange, minVolumeUsd, strategyFocus, direction, assetUniverse]);

  const handleRowAction = async (opp: FullMarketOpportunity, loadTicket: boolean) => {
    const key = `${opp.symbol}|${opp.marketType}|${opp.exchange}|${loadTicket ? 'LOAD' : 'VIEW'}`;
    setActivatingKey(key);
    try {
      await onInspectOpportunity(opp, loadTicket);
    } finally {
      setActivatingKey(null);
    }
  };

  const breadth = scanResult?.breadth;
  const opportunities = scanResult?.opportunities ?? [];

  return (
    <section
      aria-label={t('radar.aria')}
      className="rounded-xl border border-slate-800/90 bg-[#0E1522] p-4 sm:p-5"
    >
      {/* Header Row */}
      <div className="flex flex-col gap-3 border-b border-slate-800/80 pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Radar className="h-4 w-4 text-cyan-400 shrink-0" />
            <h1 className="font-display text-base font-semibold text-slate-50 sm:text-lg">
              {t('radar.title')}
            </h1>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {t('radar.subtitleBefore')}{' '}
            <span className="font-mono tabular-nums text-slate-200">
              {breadth ? breadth.totalScannedPairs.toLocaleString('en-US') : '--'}
            </span>{' '}
            {t('radar.subtitleMid')}{' '}
            <span className="text-slate-200">{t('radar.subtitleBold')}</span>{' '}
            {t('radar.subtitleAfter')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => runScan('FAST')}
            disabled={loadingFast || loadingDeep}
            className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs font-medium text-slate-200 whitespace-nowrap hover:border-cyan-500/50 hover:text-cyan-300 disabled:opacity-50"
          >
            {loadingFast ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            <span>{t('radar.btn.fastScan')}</span>
          </button>

          <button
            type="button"
            onClick={() => runScan('DEEP')}
            disabled={loadingDeep}
            className="flex min-h-[38px] items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-emerald-500 px-4 text-xs font-bold text-slate-950 whitespace-nowrap hover:opacity-95 disabled:opacity-50"
          >
            {loadingDeep ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Zap className="h-3.5 w-3.5" />
            )}
            <span>{loadingDeep ? t('radar.btn.deepScanning') : t('radar.btn.deepScan')}</span>
          </button>

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? t('radar.btn.collapseAria') : t('radar.btn.expandAria')}
            className="flex min-h-[38px] items-center gap-1 rounded-lg border border-slate-800 bg-[#070B12] px-2.5 text-xs text-slate-300 whitespace-nowrap hover:border-slate-700"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            <span>{expanded ? t('radar.btn.collapse') : t('radar.btn.expand')}</span>
          </button>
        </div>
      </div>

      {/* Market Breadth Summary Strip (4 flat structured cells) */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-800/80 bg-[#070B12] px-3.5 py-2.5">
          <p className="text-[11px] text-slate-400">{t('radar.kpi.coverageTitle')}</p>
          <p className="mt-1 font-mono text-base font-semibold tabular-nums text-slate-100">
            {breadth
              ? t('radar.kpi.pairsCount', {
                  count: breadth.totalScannedPairs.toLocaleString('en-US'),
                })
              : '--'}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400 tabular-nums">
            {breadth
              ? t('radar.kpi.coverageMeta', {
                  coins: breadth.uniqueSymbolsCount,
                  exchanges: breadth.exchangesCovered.length,
                })
              : t('radar.kpi.syncing')}
          </p>
        </div>

        <div className="rounded-lg border border-slate-800/80 bg-[#070B12] px-3.5 py-2.5">
          <p className="text-[11px] text-slate-400">{t('radar.kpi.breadthTitle')}</p>
          <div className="mt-1 flex items-baseline justify-between font-mono text-sm font-semibold tabular-nums">
            <span className="text-emerald-400">
              {breadth ? t('radar.kpi.bullPct', { pct: breadth.breadthBullPct }) : '--'}
            </span>
            <span className="text-xs text-slate-400">
              {breadth ? `${breadth.advancersCount} / ${breadth.declinersCount}` : '--'}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-rose-500/40">
            <div
              className="h-full bg-emerald-400 transition-all"
              style={{ width: `${breadth?.breadthBullPct ?? 50}%` }}
            />
          </div>
        </div>

        <div className="rounded-lg border border-slate-800/80 bg-[#070B12] px-3.5 py-2.5">
          <p className="text-[11px] text-slate-400">{t('radar.kpi.liqVolTitle')}</p>
          <p className="mt-1 font-mono text-base font-semibold tabular-nums text-cyan-300">
            {breadth ? formatCompactUsd(breadth.totalVolume24hUsd) : '--'}
          </p>
          <p className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-400">
            {breadth
              ? t('radar.kpi.medianRange', {
                  med: breadth.medianVolatilityPct,
                  highLiq: breadth.highLiquidityCount,
                })
              : '--'}
          </p>
        </div>

        <div className="rounded-lg border border-slate-800/80 bg-[#070B12] px-3.5 py-2.5">
          <p className="text-[11px] text-slate-400">
            {scanResult?.scanMode === 'DEEP'
              ? t('radar.kpi.qualifiedDeep')
              : t('radar.kpi.qualifiedFast')}
          </p>
          <p className="mt-1 font-mono text-base font-semibold tabular-nums text-emerald-400">
            {scanResult?.scanMode === 'DEEP'
              ? t('radar.kpi.deepCount', {
                  approved: scanResult.approvedCount,
                  evaluated: scanResult.deepEvaluatedCount,
                })
              : t('radar.kpi.fastCount', { count: opportunities.length })}
          </p>
          <p className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-400">
            {scanResult
              ? `${
                  scanResult.scanMode === 'DEEP'
                    ? t('radar.kpi.deepMeta')
                    : t('radar.kpi.fastMeta')
                } · ${scanResult.durationMs}ms`
              : t('radar.kpi.waitingScan')}
          </p>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 space-y-3">
          {/* Interactive Screener Filter Bar */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-800/70 pb-3">
            <select
              value={strategyFocus}
              onChange={(e) => setStrategyFocus(e.target.value as ScannerStrategyFocus)}
              aria-label={t('radar.filter.focusAria')}
              className="min-h-[34px] rounded-lg border border-slate-800 bg-[#070B12] px-2 text-[11px] text-slate-100 focus:border-cyan-500 focus:outline-none"
            >
              <option value="HIGH_PROFIT_ALPHA">{t('radar.focus.HIGH_PROFIT_ALPHA')}</option>
              <option value="MOMENTUM_BREAKOUT">{t('radar.focus.MOMENTUM_BREAKOUT')}</option>
              <option value="MEAN_REVERSION">{t('radar.focus.MEAN_REVERSION')}</option>
              <option value="FUNDING_SQUEEZE">{t('radar.focus.FUNDING_SQUEEZE')}</option>
              <option value="ALL">{t('radar.focus.ALL')}</option>
            </select>

            <div className="flex items-center gap-0.5 rounded-lg bg-[#070B12] p-0.5 border border-slate-800">
              {(['ALL', 'PERPETUAL', 'SPOT'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMarketType(m)}
                  className={`min-h-[28px] rounded-md px-2 text-[11px] font-medium whitespace-nowrap transition-colors ${
                    marketType === m
                      ? 'bg-cyan-500/20 text-cyan-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {m === 'ALL' ? t('radar.filter.allMarkets') : m}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-0.5 rounded-lg bg-[#070B12] p-0.5 border border-slate-800">
              {(['ALL', 'LONG', 'SHORT'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDirection(d)}
                  className={`min-h-[28px] rounded-md px-2 text-[11px] font-medium whitespace-nowrap transition-colors ${
                    direction === d
                      ? d === 'SHORT'
                        ? 'bg-rose-500/20 text-rose-300'
                        : 'bg-emerald-500/20 text-emerald-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {d === 'ALL' ? t('radar.filter.allSides') : d}
                </button>
              ))}
            </div>

            <select
              value={exchange}
              onChange={(e) => setExchange(e.target.value)}
              aria-label={t('radar.filter.exchangeAria')}
              className="min-h-[34px] rounded-lg border border-slate-800 bg-[#070B12] px-2 text-[11px] text-slate-200 focus:border-cyan-500 focus:outline-none"
            >
              <option value="ALL">{t('radar.filter.allExchanges')}</option>
              <option value="Binance">Binance</option>
              <option value="Bybit">Bybit</option>
              <option value="OKX">OKX</option>
              <option value="Kraken">Kraken</option>
              <option value="Coinbase Advanced">Coinbase Advanced</option>
            </select>

            <div className="flex items-center gap-0.5 rounded-lg bg-[#070B12] p-0.5 border border-slate-800">
              {(['CRYPTO', 'ALL'] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setAssetUniverse(u)}
                  className={`min-h-[28px] rounded-md px-2 text-[11px] font-medium whitespace-nowrap transition-colors ${
                    assetUniverse === u
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {u === 'CRYPTO' ? t('radar.filter.cryptoOnly') : t('radar.filter.allAssets')}
                </button>
              ))}
            </div>

            <select
              value={minVolumeUsd}
              onChange={(e) => setMinVolumeUsd(Number(e.target.value))}
              aria-label={t('radar.filter.minVolAria')}
              className="min-h-[34px] rounded-lg border border-slate-800 bg-[#070B12] px-2 text-[11px] text-slate-200 focus:border-cyan-500 focus:outline-none"
            >
              <option value={500_000}>Vol ≥ $500K</option>
              <option value={1_000_000}>Vol ≥ $1M</option>
              <option value={5_000_000}>Vol ≥ $5M</option>
              <option value={25_000_000}>Vol ≥ $25M</option>
              <option value={100_000_000}>Vol ≥ $100M</option>
            </select>
          </div>

          {errorMsg && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {errorMsg}
            </div>
          )}

          {/* Ranked Opportunities Data Grid */}
          <div className="max-h-[400px] overflow-auto">
            {opportunities.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-800 bg-[#070B12] px-4 py-8 text-center text-xs text-slate-400">
                {loadingFast || loadingDeep ? t('radar.emptyLoading') : t('radar.emptyFiltered')}
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-[#0E1522]">
                  <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                    <th className="py-2 pr-2 font-medium">#</th>
                    <th className="py-2 pr-3 font-medium">{t('radar.th.pair')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('radar.th.price24h')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('radar.th.volSpread')}</th>
                    <th className="py-2 pr-3 font-medium">{t('radar.th.setup')}</th>
                    <th className="py-2 pr-3 font-medium">{t('radar.th.signal4h')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('radar.th.confluenceEv')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('radar.th.backtest')}</th>
                    <th className="py-2 text-right font-medium">{t('radar.th.action')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono tabular-nums">
                  {opportunities.map((opp) => {
                    const arch = formatArchetypeLabel(opp.archetype, t);
                    const htf = formatHtfShort(opp.htfAlignment, opp.deepVerified, t);
                    const up = opp.change24hPct >= 0;
                    const isSelected =
                      activeTicker &&
                      isSameTickerSelection(activeTicker, {
                        symbol: opp.symbol,
                        marketType: opp.marketType,
                        exchange: opp.exchange,
                      });
                    const baseKey = `${opp.symbol}|${opp.marketType}|${opp.exchange}`;
                    const loadingView = activatingKey === `${baseKey}|VIEW`;
                    const loadingLoad = activatingKey === `${baseKey}|LOAD`;

                    return (
                      <tr
                        key={`${baseKey}-${opp.rank}`}
                        className={`transition-colors ${
                          isSelected ? 'bg-cyan-500/12' : 'hover:bg-slate-800/30'
                        }`}
                      >
                        <td className="py-2.5 pr-2 text-slate-400">{opp.rank}</td>

                        <td className="py-2.5 pr-3 font-sans">
                          <div className="font-semibold text-slate-100">{opp.symbol}</div>
                          <div className="text-[11px] text-slate-400">
                            {opp.exchange} · {opp.marketType}
                            {opp.fundingRatePct !== null ? ` · FR ${opp.fundingRatePct.toFixed(3)}%` : ''}
                          </div>
                        </td>

                        <td className="py-2.5 pr-3 text-right">
                          <div className="text-slate-100">{formatAssetPrice(opp.lastPrice)}</div>
                          <div
                            className={`inline-flex items-center justify-end gap-0.5 text-[11px] ${
                              up ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {up ? (
                              <TrendingUp className="h-3 w-3" />
                            ) : (
                              <TrendingDown className="h-3 w-3" />
                            )}
                            {up ? '+' : ''}
                            {opp.change24hPct.toFixed(2)}%
                          </div>
                        </td>

                        <td className="py-2.5 pr-3 text-right">
                          <div className="text-slate-200">{formatCompactUsd(opp.volume24hUsd)}</div>
                          <div className="text-[11px] text-slate-400">
                            {opp.spreadBps.toFixed(1)} bps · {opp.volatility24hPct.toFixed(1)}% rng
                          </div>
                        </td>

                        <td className="py-2.5 pr-3 font-sans">
                          <div className={`font-medium ${arch.cls}`}>{arch.label}</div>
                          <div className="font-mono text-[11px] text-slate-400">
                            {t('radar.row.prescreen')} {opp.preScreenScore.toFixed(0)} · Liq {opp.liquidityScore}
                          </div>
                        </td>

                        <td className="py-2.5 pr-3 font-sans">
                          <div
                            className={`font-mono font-semibold ${
                              opp.deepVerified
                                ? opp.signalState === 'APPROVED' && opp.direction !== 'NO_TRADE'
                                  ? opp.direction === 'LONG'
                                    ? 'text-emerald-400'
                                    : 'text-rose-400'
                                  : 'text-slate-300'
                                : 'text-cyan-300'
                            }`}
                          >
                            {opp.deepVerified
                              ? `${opp.direction} · ${opp.signalState}`
                              : `Est. ${opp.direction}`}
                          </div>
                          <div className={`text-[11px] ${htf.cls}`}>{htf.label}</div>
                        </td>

                        <td className="py-2.5 pr-3 text-right">
                          <div className="text-cyan-300">{opp.confluenceScore}/100</div>
                          <div
                            className={`text-[11px] ${
                              opp.deepVerified
                                ? opp.expectedValueR > 0
                                  ? 'text-emerald-400'
                                  : 'text-amber-400'
                                : 'text-slate-500'
                            }`}
                          >
                            {opp.deepVerified
                              ? `${opp.expectedValueR >= 0 ? '+' : ''}${opp.expectedValueR.toFixed(2)}R · R:R ${opp.riskReward}`
                              : t('radar.row.waitDeep')}
                          </div>
                        </td>

                        <td className="py-2.5 pr-3 text-right">
                          {opp.backtestWinRatePct !== null ? (
                            <>
                              <div
                                className={
                                  opp.backtestWinRatePct >= 50
                                    ? 'text-emerald-400'
                                    : 'text-slate-200'
                                }
                              >
                                Win {opp.backtestWinRatePct.toFixed(1)}%
                              </div>
                              <div className="text-[11px] text-slate-400">
                                PF{' '}
                                {opp.backtestProfitFactor !== null && opp.backtestProfitFactor >= 50
                                  ? 'Max'
                                  : opp.backtestProfitFactor?.toFixed(2) ?? '0'}{' '}
                                ({opp.backtestTradesCount}L) ·{' '}
                                {(opp.backtestReturnPct ?? 0) >= 0 ? '+' : ''}
                                {(opp.backtestReturnPct ?? 0).toFixed(2)}%
                              </div>
                            </>
                          ) : (
                            <span className="text-slate-500">--</span>
                          )}
                        </td>

                        <td className="py-2.5 text-right font-sans">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              disabled={Boolean(activatingKey)}
                              onClick={() => handleRowAction(opp, false)}
                              className="min-h-[30px] rounded border border-slate-700 bg-slate-900 px-2.5 text-[11px] font-medium text-slate-200 whitespace-nowrap hover:border-cyan-500/50 hover:text-cyan-300 disabled:opacity-50"
                            >
                              {loadingView ? t('radar.row.loadingView') : t('radar.row.viewChart')}
                            </button>
                            <button
                              type="button"
                              disabled={Boolean(activatingKey)}
                              onClick={() => handleRowAction(opp, true)}
                              className="min-h-[30px] rounded bg-cyan-500/20 border border-cyan-500/40 px-2.5 text-[11px] font-semibold text-cyan-300 whitespace-nowrap hover:bg-cyan-500/30 disabled:opacity-50"
                            >
                              {loadingLoad ? t('radar.row.loadingLoad') : t('radar.row.loadOrder')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
