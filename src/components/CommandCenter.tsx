import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Cpu,
  Radar,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { formatAssetPrice } from '../engine/symbolSearch';
import { isSameTickerSelection } from '../engine/pairSelection';
import { computeFeedHealthMetrics } from '../engine/priceFeedGuard';
import { pickBestBenchmarkTicker } from '../pwa/directPriceSync';
import type {
  AgentState,
  ClosePositionResponse,
  HtfAlignment,
  MarketTicker,
  OrderBookSnapshot,
  PortfolioSummary,
  Position,
  SmartOpportunityCandidate,
  TradingMode,
  TradingSignal,
} from '../engine/types';
import { ActivePositionsPanel } from './ActivePositionsPanel';
import { CompanyProfileBoard } from './CompanyProfileBoard';
import { Workspace3D } from './Workspace3D';
import { useI18n } from '../i18n/I18nContext';

function formatHtfLabel(
  htf: HtfAlignment | undefined,
  t: ReturnType<typeof useI18n>['t'],
): { label: string; cls: string } {
  switch (htf) {
    case 'ALIGNED_BULL':
      return { label: t('cmd.radar.htfAlignedBull'), cls: 'text-emerald-400' };
    case 'ALIGNED_BEAR':
      return { label: t('cmd.radar.htfAlignedBear'), cls: 'text-emerald-400' };
    case 'COUNTER_TREND':
      return { label: t('cmd.radar.htfCounter'), cls: 'text-amber-400' };
    default:
      return { label: t('cmd.radar.htfNeutral'), cls: 'text-slate-400' };
  }
}

interface CommandCenterProps {
  tickers: MarketTicker[];
  selectedTicker: MarketTicker | null;
  selectedSignal: TradingSignal | null;
  orderBook: OrderBookSnapshot | null;
  portfolio: PortfolioSummary;
  positions: Position[];
  agents: AgentState[];
  signals: TradingSignal[];
  tradingMode: TradingMode;
  liveFeedActive: boolean;
  serverUtc: string;
  onSelectSymbol: (symbol: string, marketType: MarketTicker['marketType'], exchange?: string) => void;
  onNavigate: (tab: string) => void;
  onRunPipeline: (symbol: string, marketType: MarketTicker['marketType'], exchange?: string) => void;
  onSmartScan?: () => void;
  smartOpportunities?: SmartOpportunityCandidate[];
  onClosePosition: (id: string) => Promise<ClosePositionResponse | void> | void;
  onUpdateSlTp: (id: string, stopLoss: number, takeProfit: number) => Promise<{ ok: boolean; error?: string }>;
  pipelineLoading: boolean;
}

export const CommandCenter: React.FC<CommandCenterProps> = ({
  tickers,
  selectedTicker,
  selectedSignal,
  orderBook,
  portfolio,
  positions,
  agents,
  signals,
  tradingMode,
  liveFeedActive,
  serverUtc,
  onSelectSymbol,
  onNavigate,
  onRunPipeline,
  onSmartScan,
  smartOpportunities = [],
  onClosePosition,
  onUpdateSlTp,
  pipelineLoading,
}) => {
  const { t } = useI18n();
  const btc = pickBestBenchmarkTicker(tickers, 'BTC/USDT', 'PERPETUAL');
  const eth = pickBestBenchmarkTicker(tickers, 'ETH/USDT', 'PERPETUAL');
  const sol = pickBestBenchmarkTicker(tickers, 'SOL/USDT', 'PERPETUAL');
  const benchmarkList = [btc, eth, sol].filter((x): x is MarketTicker => Boolean(x));
  const selectedInBenchmarks = benchmarkList.some((b) =>
    isSameTickerSelection(b, selectedTicker),
  );
  const pulseTickers = [
    ...(!selectedInBenchmarks && selectedTicker ? [selectedTicker] : []),
    ...benchmarkList,
  ];
  const onlineAgents = agents.filter((a) => a.status === 'ONLINE' && a.enabled).length;
  const activeSignal = selectedSignal;
  const latestAnySignal = signals[0] ?? null;
  const isEmergency = tradingMode === 'EMERGENCY_STOP';

  const feedHealth = useMemo(() => computeFeedHealthMetrics(tickers), [tickers]);
  const prevPricesRef = useRef<Record<string, number>>({});
  const [tickDirs, setTickDirs] = useState<Record<string, 'UP' | 'DOWN' | 'FLAT'>>({});

  useEffect(() => {
    const nextDirs: Record<string, 'UP' | 'DOWN' | 'FLAT'> = {};
    let changed = false;
    for (const tk of tickers) {
      if (!(tk.lastPrice > 0)) continue;
      const key = `${tk.symbol}|${tk.marketType}|${tk.exchange}`;
      const prev = prevPricesRef.current[key];
      if (prev !== undefined && prev !== tk.lastPrice) {
        nextDirs[key] = tk.lastPrice > prev ? 'UP' : 'DOWN';
        changed = true;
      } else {
        nextDirs[key] = 'FLAT';
      }
      prevPricesRef.current[key] = tk.lastPrice;
    }
    if (changed) {
      setTickDirs(nextDirs);
    }
  }, [tickers]);

  return (
    <div className="space-y-6">
      {/* Global KPI Strip */}
      <section aria-label={t('cmd.ariaOverview')}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="min-w-0 rounded-xl border border-slate-800/90 bg-[#0E1522] p-4">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <p className="min-w-0 text-xs text-slate-400">
                {t('cmd.kpi.totalEquity', { mode: portfolio.mode })}
              </p>
              <span className="shrink-0 rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-cyan-300 whitespace-nowrap">
                {t('cmd.kpi.paperBadge')}
              </span>
            </div>
            <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-slate-50 sm:text-2xl">
              ${portfolio.totalEquityUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {t('cmd.kpi.available')}{' '}
              <span className="font-mono tabular-nums text-slate-200">
                ${portfolio.availableBalanceUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </span>
            </p>
          </div>

          <div className="rounded-xl border border-slate-800/90 bg-[#0E1522] p-4">
            <p className="text-xs text-slate-400">{t('cmd.kpi.pnlTitle')}</p>
            <p
              className={`mt-1.5 font-mono text-xl font-semibold tabular-nums sm:text-2xl ${
                portfolio.realizedPnlUsd + portfolio.unrealizedPnlUsd >= 0
                  ? 'text-emerald-400'
                  : 'text-rose-400'
              }`}
            >
              {portfolio.realizedPnlUsd + portfolio.unrealizedPnlUsd >= 0 ? '+' : ''}$
              {(portfolio.realizedPnlUsd + portfolio.unrealizedPnlUsd).toFixed(2)}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {t('cmd.kpi.drawdown')}{' '}
              <span className="font-mono tabular-nums text-amber-400">
                {portfolio.currentDrawdownPct.toFixed(2)}%
              </span>
            </p>
          </div>

          <div className="rounded-xl border border-slate-800/90 bg-[#0E1522] p-4">
            <p className="text-xs text-slate-400">{t('cmd.kpi.coreTitle')}</p>
            <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-cyan-400 sm:text-2xl">
              {onlineAgents}/{agents.length}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {t('cmd.kpi.openPos')}{' '}
              <span className="font-mono tabular-nums text-slate-200">{positions.length}</span>
              {' · '}
              Win Rate{' '}
              <span className="font-mono tabular-nums text-slate-200">
                {portfolio.winRatePct !== null ? `${portfolio.winRatePct}%` : t('cmd.kpi.none')}
              </span>
            </p>
          </div>

          <div className="rounded-xl border border-slate-800/90 bg-[#0E1522] p-4">
            <p className="truncate text-xs text-slate-400">{t('cmd.kpi.dataFeed')}</p>
            <p
              className={`mt-1.5 truncate font-display text-base font-semibold sm:text-xl ${
                liveFeedActive ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              {liveFeedActive ? t('cmd.kpi.liveExchange') : t('cmd.kpi.offline')}
            </p>
            <p className="mt-1 truncate font-mono text-[11px] tabular-nums text-slate-400">
              {feedHealth.realtimeWsCount > 0
                ? `${t(`feed.tier.${feedHealth.freshness}`)} · WS ${feedHealth.realtimeWsCount}/${feedHealth.liveCount} · ${t('feed.latencyLabel', { ms: feedHealth.medianLatencyMs })}`
                : `${t(`feed.tier.${feedHealth.freshness}`)} · UTC ${serverUtc ? serverUtc.slice(11, 19) : '--:--:--'}`}
            </p>
          </div>
        </div>
      </section>

      {/* Main Split: Interactive Smart 3D Workspace + Market Pulse */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-100 sm:text-lg">
                {t('cmd.room3d.title')}
              </h2>
              <p className="text-xs text-slate-400">
                {t('cmd.room3d.desc')}
              </p>
            </div>
          </div>
          <Workspace3D
            agents={agents}
            selectedTicker={selectedTicker}
            orderBook={orderBook}
            portfolio={portfolio}
            tradingMode={tradingMode}
            latestSignal={activeSignal}
            compact
            onExpandFull={() => onNavigate('workspace3d')}
          />
        </div>

        {/* Right Column: Full-Market Signal Pulse & Quick Multi-Agent Signal */}
        <div className="flex flex-col gap-4 lg:col-span-4">
          <div className="rounded-xl border border-slate-800/90 bg-[#0E1522] p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-sm font-semibold text-slate-100">
                {t('cmd.market.title')}
              </h2>
              <div className="flex items-center gap-2">
                {onSmartScan && (
                  <button
                    type="button"
                    disabled={pipelineLoading || tickers.length === 0 || isEmergency}
                    onClick={onSmartScan}
                    aria-label={t('cmd.market.scanAria')}
                    className="flex min-h-[34px] items-center gap-1 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-2.5 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50 whitespace-nowrap"
                  >
                    <Radar className="h-3.5 w-3.5" />
                    <span>{t('cmd.market.scanBtn')}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onNavigate('scanner')}
                  className="flex min-h-[34px] items-center gap-1 text-xs font-medium text-cyan-400 hover:text-cyan-300 whitespace-nowrap"
                >
                  <span>{t('cmd.market.scannerBtn')}</span>
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="mt-3 divide-y divide-slate-800/70">
              {smartOpportunities.length > 0 ? (
                smartOpportunities.slice(0, 5).map((opp) => {
                  const up = opp.change24hPct >= 0;
                  const isActive =
                    selectedTicker &&
                    selectedTicker.symbol === opp.symbol &&
                    selectedTicker.marketType === opp.marketType &&
                    selectedTicker.exchange === opp.exchange;
                  return (
                    <button
                      key={`${opp.symbol}-${opp.marketType}-${opp.exchange}`}
                      type="button"
                      onClick={() => {
                        onSelectSymbol(opp.symbol, opp.marketType, opp.exchange);
                        onNavigate('scanner');
                      }}
                      className={`flex min-h-[52px] w-full items-center justify-between rounded-lg px-2 py-2.5 text-left transition-colors ${
                        isActive ? 'bg-cyan-500/12' : 'hover:bg-slate-800/30'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-display text-sm font-semibold ${
                              isActive ? 'text-cyan-300' : 'text-slate-100'
                            }`}
                          >
                            {opp.symbol}
                          </span>
                          <span
                            className={`font-mono text-[11px] font-semibold ${
                              opp.state === 'APPROVED' && opp.direction !== 'NO_TRADE'
                                ? opp.direction === 'LONG'
                                  ? 'text-emerald-400'
                                  : 'text-rose-400'
                                : 'text-slate-400'
                            }`}
                          >
                            {opp.direction}
                          </span>
                          <span className="truncate text-[11px] text-slate-400">
                            {opp.exchange} · {opp.marketType}
                          </span>
                        </div>
                        <p className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-400">
                          {opp.state} · Conf {opp.confluenceScore}/100 · EV{' '}
                          <span className={opp.expectedValueR > 0 ? 'text-emerald-400' : 'text-slate-400'}>
                            {opp.expectedValueR >= 0 ? '+' : ''}
                            {opp.expectedValueR.toFixed(2)}R
                          </span>
                        </p>
                      </div>
                      <div className="shrink-0 pl-2 text-right">
                        <p className="font-mono text-sm font-semibold tabular-nums text-slate-100">
                          {formatAssetPrice(opp.lastPrice)}
                        </p>
                        <p
                          className={`flex items-center justify-end gap-0.5 font-mono text-xs tabular-nums ${
                            up ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                          {up ? '+' : ''}
                          {opp.change24hPct.toFixed(2)}%
                        </p>
                      </div>
                    </button>
                  );
                })
              ) : (
                pulseTickers.map((item) => {
                  const up = item.change24hPct >= 0;
                  const isActive = isSameTickerSelection(item, selectedTicker);
                  const pairKey = `${item.symbol}|${item.marketType}|${item.exchange}`;
                  const tDir = tickDirs[pairKey] ?? 'FLAT';
                  return (
                    <button
                      key={`${item.symbol}-${item.marketType}-${item.exchange}`}
                      type="button"
                      onClick={() => {
                        onSelectSymbol(item.symbol, item.marketType, item.exchange);
                        onNavigate('scanner');
                      }}
                      className={`flex min-h-[52px] w-full items-center justify-between rounded-lg px-2 py-2.5 text-left transition-colors ${
                        isActive ? 'bg-cyan-500/12' : 'hover:bg-slate-800/30'
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-display text-sm font-semibold ${
                              isActive ? 'text-cyan-300' : 'text-slate-100'
                            }`}
                          >
                            {item.symbol}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            {item.exchange} · {item.marketType}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          {item.regime} · RSI{' '}
                          <span className="font-mono tabular-nums">{item.rsi14 ?? '--'}</span>
                          {item.sourceLabel.includes('WS') ? ' · WS' : ''}
                        </p>
                      </div>
                      <div className="text-right">
                        <p
                          className={`font-mono text-sm font-semibold tabular-nums transition-colors duration-200 ${
                            tDir === 'UP'
                              ? 'text-emerald-300'
                              : tDir === 'DOWN'
                                ? 'text-rose-300'
                                : 'text-slate-100'
                          }`}
                        >
                          {formatAssetPrice(item.lastPrice)}
                        </p>
                        <p
                          className={`flex items-center justify-end gap-0.5 font-mono text-xs tabular-nums ${
                            up ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                          {up ? '+' : ''}
                          {item.change24hPct.toFixed(2)}%
                        </p>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Unified AI Analysis & 9-Gate Auto-Pilot Engine Card */}
          <div
            data-testid="unified-ai-autopilot-card"
            className="rounded-xl border border-slate-800/90 bg-[#0E1522] p-4"
          >
            <div className="space-y-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="font-display text-sm font-semibold text-slate-100">
                  {t('cmd.ai.title')} {selectedTicker ? `· ${selectedTicker.symbol}` : ''}
                </h2>
                {selectedTicker && (
                  <span className="shrink-0 font-mono text-[11px] text-slate-400">
                    {selectedTicker.exchange} · {selectedTicker.marketType}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {onSmartScan && (
                  <button
                    type="button"
                    disabled={pipelineLoading || tickers.length === 0 || isEmergency}
                    onClick={onSmartScan}
                    title={t('cmd.ai.scanTitle')}
                    className="flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-cyan-300 whitespace-nowrap hover:border-cyan-500/50 disabled:opacity-50"
                  >
                    <Radar className="h-3.5 w-3.5 shrink-0" />
                    <span>{t('cmd.ai.scanBtn')}</span>
                  </button>
                )}
                <button
                  type="button"
                  disabled={pipelineLoading || !selectedTicker || isEmergency}
                  onClick={() =>
                    selectedTicker &&
                    onRunPipeline(
                      selectedTicker.symbol,
                      selectedTicker.marketType,
                      selectedTicker.exchange,
                    )
                  }
                  className={`flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-emerald-500 px-3 py-1.5 text-xs font-bold text-slate-950 whitespace-nowrap hover:opacity-95 disabled:opacity-50 ${
                    onSmartScan ? '' : 'col-span-2'
                  }`}
                >
                  <Zap className="h-3.5 w-3.5 shrink-0" />
                  <span>{pipelineLoading ? t('cmd.ai.runningBtn') : t('cmd.ai.runBtn')}</span>
                </button>
              </div>
            </div>

            {activeSignal ? (
              <div className="mt-3 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-100">
                    {activeSignal.symbol} · {activeSignal.direction}
                  </span>
                  <span
                    className={`font-mono font-medium ${
                      activeSignal.riskCheck.approved ? 'text-emerald-400' : 'text-amber-400'
                    }`}
                  >
                    {activeSignal.state}
                  </span>
                </div>
                <p className="text-slate-400 leading-relaxed">{activeSignal.reasoningSummary}</p>
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[11px] tabular-nums text-slate-300">
                  <span>R:R {activeSignal.riskReward}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    EV{' '}
                    <strong
                      className={
                        (activeSignal.expectedValueR ?? 0) > 0
                          ? 'text-emerald-400'
                          : 'text-amber-400'
                      }
                    >
                      {(activeSignal.expectedValueR ?? 0) >= 0 ? '+' : ''}
                      {(activeSignal.expectedValueR ?? 0).toFixed(2)}R
                    </strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className={formatHtfLabel(activeSignal.htfAlignment, t).cls}>
                    {formatHtfLabel(activeSignal.htfAlignment, t).label}
                  </span>
                </div>
                {activeSignal.quantAlpha && (
                  <div className="rounded-lg border border-cyan-500/25 bg-cyan-500/5 px-2.5 py-1.5 font-mono text-[11px] tabular-nums text-cyan-200">
                    Adaptive Alpha v4 · {activeSignal.quantAlpha.regimeMode} ·{' '}
                    {activeSignal.quantAlpha.confluenceScore}/100 (
                    {activeSignal.quantAlpha.passedFactors}/{activeSignal.quantAlpha.totalFactors}{' '}
                    {t('cmd.ai.factorsUnit')} · {t('cmd.ai.riskLabel')}{' '}
                    {(activeSignal.recommendedRiskPct ?? 0.5).toFixed(2)}%)
                  </div>
                )}
                {activeSignal.quantIntel && (
                  <div className="space-y-1 rounded-lg border border-slate-800 bg-[#070B12] px-2.5 py-1.5 font-mono text-[11px] tabular-nums text-slate-300">
                    <div>
                      Hurst H={activeSignal.quantIntel.hurst.hurstExponent.toFixed(2)} · Squeeze{' '}
                      {activeSignal.quantIntel.microstructure.squeezeCompressionRatio.toFixed(2)}x ·
                      VWAP-Z {activeSignal.quantIntel.microstructure.vwapZScore >= 0 ? '+' : ''}
                      {activeSignal.quantIntel.microstructure.vwapZScore.toFixed(2)} · 1/4 Kelly{' '}
                      {activeSignal.quantIntel.kelly.volAdjustedRiskPct.toFixed(2)}%
                    </div>
                    {activeSignal.quantIntel.liquidationRadar && (
                      <div className="border-t border-slate-800/80 pt-1 text-[10px] text-amber-300">
                        {t('liqRadar.cmdLine', {
                          risk: activeSignal.quantIntel.liquidationRadar.stopHuntRiskScore,
                          longPx: activeSignal.quantIntel.liquidationRadar.nearestLongLiqPrice
                            ? formatAssetPrice(
                                activeSignal.quantIntel.liquidationRadar.nearestLongLiqPrice,
                              )
                            : '--',
                          shortPx: activeSignal.quantIntel.liquidationRadar.nearestShortLiqPrice
                            ? formatAssetPrice(
                                activeSignal.quantIntel.liquidationRadar.nearestShortLiqPrice,
                              )
                            : '--',
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-3 space-y-2 rounded-lg border border-dashed border-slate-800 bg-[#0A101B] p-3 text-xs text-slate-400">
                <p>
                  {selectedTicker
                    ? t('cmd.ai.emptyPair', {
                        symbol: selectedTicker.symbol,
                        exchange: selectedTicker.exchange,
                        marketType: selectedTicker.marketType,
                      })
                    : t('cmd.ai.emptyClean')}{' '}
                  {t('cmd.ai.emptyHint', {
                    run: t('cmd.ai.runBtn'),
                    scan: t('cmd.ai.scanBtn'),
                  })}
                </p>
                {latestAnySignal && (
                  <button
                    type="button"
                    onClick={() =>
                      onSelectSymbol(
                        latestAnySignal.symbol,
                        latestAnySignal.marketType,
                        latestAnySignal.exchange,
                      )
                    }
                    className="text-[11px] font-medium text-cyan-400 hover:text-cyan-300"
                  >
                    {t('cmd.ai.viewLatest', {
                      symbol: latestAnySignal.symbol,
                      exchange: latestAnySignal.exchange,
                    })}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Alpha Opportunity Radar — Top Ranked Multi-Timeframe Candidates */}
      {smartOpportunities.length > 0 && (
        <section
          aria-label={t('cmd.radar.aria')}
          className="rounded-xl border border-slate-800/90 bg-[#0E1522] p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
            <div className="flex items-center gap-2">
              <Radar className="h-4 w-4 text-cyan-400" />
              <h2 className="font-display text-sm font-semibold text-slate-100 sm:text-base">
                {t('cmd.radar.title', { count: smartOpportunities.length })}
              </h2>
            </div>
            <span className="text-xs text-slate-400">
              {t('cmd.radar.subtitle')}
            </span>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 pr-2 font-medium">#</th>
                  <th className="py-2 pr-3 font-medium">{t('cmd.radar.thPair')}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t('cmd.radar.thPrice')}</th>
                  <th className="py-2 pr-3 font-medium">{t('cmd.radar.thSignal')}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t('cmd.radar.thConfluence')}</th>
                  <th className="py-2 pr-3 font-medium">{t('cmd.radar.th4h')}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t('cmd.radar.thEv')}</th>
                  <th className="py-2 text-right font-medium">{t('cmd.radar.thAction')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono tabular-nums">
                {smartOpportunities.map((opp) => {
                  const htf = formatHtfLabel(opp.htfAlignment, t);
                  const isActive =
                    selectedTicker &&
                    selectedTicker.symbol === opp.symbol &&
                    selectedTicker.marketType === opp.marketType &&
                    selectedTicker.exchange === opp.exchange;
                  return (
                    <tr
                      key={`${opp.symbol}-${opp.marketType}-${opp.exchange}`}
                      className={isActive ? 'bg-cyan-500/10' : 'hover:bg-slate-800/30'}
                    >
                      <td className="py-2 pr-2 text-slate-400">{opp.rank}</td>
                      <td className="py-2 pr-3 font-sans">
                        <span className="font-semibold text-slate-100">{opp.symbol}</span>
                        <span className="ml-1.5 text-[11px] text-slate-400">
                          {opp.exchange} · {opp.marketType}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right text-slate-200">
                        {formatAssetPrice(opp.lastPrice)}
                      </td>
                      <td className="py-2 pr-3">
                        <span
                          className={
                            opp.state === 'APPROVED' && opp.direction !== 'NO_TRADE'
                              ? opp.direction === 'LONG'
                                ? 'font-semibold text-emerald-400'
                                : 'font-semibold text-rose-400'
                              : 'text-slate-400'
                          }
                        >
                          {opp.direction} · {opp.state}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right text-cyan-300">
                        {opp.confluenceScore}/100
                      </td>
                      <td className={`py-2 pr-3 font-sans text-[11px] font-medium ${htf.cls}`}>
                        {htf.label}
                      </td>
                      <td
                        className={`py-2 pr-3 text-right font-semibold ${
                          opp.expectedValueR > 0 ? 'text-emerald-400' : 'text-amber-400'
                        }`}
                      >
                        {opp.expectedValueR >= 0 ? '+' : ''}
                        {opp.expectedValueR.toFixed(2)}R
                      </td>
                      <td className="py-2 text-right font-sans">
                        <button
                          type="button"
                          onClick={() => onSelectSymbol(opp.symbol, opp.marketType, opp.exchange)}
                          className="text-xs font-semibold text-cyan-400 hover:text-cyan-300"
                        >
                          {t('cmd.radar.selectPairBtn')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Active Positions & Risk Guardrail Strip */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <ActivePositionsPanel
            positions={positions}
            title={t('cmd.positions.title', { count: positions.length })}
            compactHeaderAction={{
              label: t('cmd.positions.manageBtn'),
              onClick: () => onNavigate('portfolio'),
            }}
            onClosePosition={onClosePosition}
            onUpdateSlTp={onUpdateSlTp}
            onInspectSymbol={(sym, mkt, ex) => {
              onSelectSymbol(sym, mkt, ex);
              onNavigate('scanner');
            }}
            onGoToScanner={() => onNavigate('scanner')}
          />
        </div>

        <div className="rounded-xl border border-slate-800/90 bg-[#0E1522] p-4 lg:col-span-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <h2 className="font-display text-sm font-semibold text-slate-100">
              {t('cmd.guardrails.title')}
            </h2>
          </div>
          <ul className="mt-3 space-y-2 text-xs text-slate-400">
            <li className="flex items-start justify-between gap-2">
              <span>{t('cmd.guardrails.riskEngine')}</span>
              <span className="font-mono text-emerald-400">{t('cmd.guardrails.active')}</span>
            </li>
            <li className="flex items-start justify-between gap-2">
              <span>{t('cmd.guardrails.withdraw')}</span>
              <span className="font-mono text-emerald-400">{t('cmd.guardrails.blocked')}</span>
            </li>
            <li className="flex items-start justify-between gap-2">
              <span>{t('cmd.guardrails.martingale')}</span>
              <span className="font-mono text-rose-400">{t('cmd.guardrails.disabled')}</span>
            </li>
            <li className="flex items-start justify-between gap-2">
              <span>{t('cmd.guardrails.idempotency')}</span>
              <span className="font-mono text-emerald-400">{t('cmd.guardrails.enabled')}</span>
            </li>
          </ul>
          <button
            type="button"
            onClick={() => onNavigate('agents')}
            className="mt-4 flex min-h-[42px] w-full items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:border-cyan-500/50 hover:text-cyan-300"
          >
            <Cpu className="h-3.5 w-3.5" />
            <span>{t('cmd.guardrails.openAgentsBtn')}</span>
          </button>
        </div>
      </section>

      {/* Executive Company Introduction Board: Giáo Sư - Prof.TOAN */}
      <CompanyProfileBoard
        agents={agents}
        tradingMode={tradingMode}
        onNavigate={onNavigate}
      />
    </div>
  );
};
