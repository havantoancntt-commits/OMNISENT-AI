import React, { useEffect, useState } from 'react';
import { Award, CheckCircle2, FlaskConical, Layers, Play, Search, Sparkles } from 'lucide-react';
import { getStrategyCatalog } from '../engine/adaptiveConfluence';
import { formatAssetPrice } from '../engine/symbolSearch';
import {
  dedupeTickersByPair,
  findMatchingTicker,
  parsePairSelection,
  serializePairSelection,
} from '../engine/pairSelection';
import type {
  BacktestConfig,
  BacktestOptimizationResult,
  BacktestResult,
  BacktestStrategyId,
  MarketTicker,
  MarketType,
  StrategyBenchmarkResult,
} from '../engine/types';
import { useI18n } from '../i18n/I18nContext';
import { EquityChart } from './EquityChart';

interface QuantLabProps {
  tickers: MarketTicker[];
  selectedTicker?: MarketTicker | null;
  onSelectSymbol?: (symbol: string, marketType: MarketType, exchange?: string) => void;
  onSelectRemotePair?: (
    symbol: string,
    marketType: MarketType,
    exchange: string,
    options?: { runAi?: boolean },
  ) => Promise<void>;
  onOpenGlobalSearch?: () => void;
}

export const QuantLab: React.FC<QuantLabProps> = ({
  tickers,
  selectedTicker = null,
  onSelectSymbol,
  onSelectRemotePair,
  onOpenGlobalSearch,
}) => {
  const { locale, t } = useI18n();
  const uniquePairTickers = dedupeTickersByPair(tickers);
  const activeTicker = selectedTicker ?? uniquePairTickers[0] ?? null;

  const [symbol, setSymbol] = useState(activeTicker?.symbol || 'BTC/USDT');
  const [timeframe, setTimeframe] = useState('1h');
  const [marketType, setMarketType] = useState<MarketType>(
    activeTicker?.marketType || 'PERPETUAL',
  );
  const [exchange, setExchange] = useState<string>(activeTicker?.exchange || '');
  const [strategyId, setStrategyId] = useState<BacktestStrategyId>('ADAPTIVE_CONFLUENCE_ALPHA');
  const [initialCapitalUsd, setInitialCapitalUsd] = useState(10000);
  const [riskPerTradePct, setRiskPerTradePct] = useState(0.5);

  const [leverage, setLeverage] = useState(2);
  const [feeRateBps, setFeeRateBps] = useState(5);
  const [slippageBps, setSlippageBps] = useState(3);
  const [stopLossAtrMult, setStopLossAtrMult] = useState(1.65);
  const [takeProfitAtrMult, setTakeProfitAtrMult] = useState(2.75);
  const [useTrailingProfitLock, setUseTrailingProfitLock] = useState(true);
  const [monteCarloRuns, setMonteCarloRuns] = useState(100);

  const [loading, setLoading] = useState(false);
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);
  const [optimizeLoading, setOptimizeLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [benchmark, setBenchmark] = useState<StrategyBenchmarkResult | null>(null);
  const [optimization, setOptimization] = useState<BacktestOptimizationResult | null>(null);
  const [resultExchange, setResultExchange] = useState<string>('');

  const strategyCatalog = getStrategyCatalog(locale);
  const selectedStrategyMeta =
    strategyCatalog.find((s) => s.id === strategyId) ?? strategyCatalog[0];

  useEffect(() => {
    if (selectedTicker) {
      setSymbol(selectedTicker.symbol);
      setMarketType(selectedTicker.marketType);
      setExchange(selectedTicker.exchange);
      setError(null);
      const changedPair =
        result &&
        (result.config.symbol !== selectedTicker.symbol ||
          result.config.marketType !== selectedTicker.marketType ||
          (resultExchange &&
            resultExchange.toUpperCase() !== selectedTicker.exchange.toUpperCase()));
      if (changedPair) {
        setResult(null);
      }
      setBenchmark((prev) =>
        prev &&
        (prev.symbol !== selectedTicker.symbol ||
          prev.marketType !== selectedTicker.marketType ||
          (resultExchange &&
            resultExchange.toUpperCase() !== selectedTicker.exchange.toUpperCase()))
          ? null
          : prev,
      );
      setOptimization((prev) =>
        prev &&
        (prev.symbol !== selectedTicker.symbol ||
          prev.marketType !== selectedTicker.marketType ||
          (resultExchange &&
            resultExchange.toUpperCase() !== selectedTicker.exchange.toUpperCase()))
          ? null
          : prev,
      );
    }
  }, [selectedTicker?.symbol, selectedTicker?.marketType, selectedTicker?.exchange, resultExchange]);

  const handlePairSelectChange = (rawVal: string) => {
    const parsed = parsePairSelection(rawVal);
    if (!parsed) return;
    setSymbol(parsed.symbol);
    setMarketType(parsed.marketType);
    setExchange(parsed.exchange ?? '');
    setResult(null);
    setBenchmark(null);
    setOptimization(null);
    setError(null);
    onSelectSymbol?.(parsed.symbol, parsed.marketType, parsed.exchange);
  };

  const handleMarketTypeChange = async (nextMkt: MarketType) => {
    setMarketType(nextMkt);
    setResult(null);
    setBenchmark(null);
    setOptimization(null);
    setError(null);
    const localMatch = tickers.find(
      (t) => t.symbol.toUpperCase() === symbol.toUpperCase() && t.marketType === nextMkt,
    );
    if (localMatch) {
      setExchange(localMatch.exchange);
      onSelectSymbol?.(localMatch.symbol, localMatch.marketType, localMatch.exchange);
      return;
    }
    if (onSelectRemotePair) {
      try {
        await onSelectRemotePair(symbol, nextMkt, '');
      } catch {
        setError(t('quant.errSyncMarket', { symbol, marketType: nextMkt }));
      }
    } else {
      onSelectSymbol?.(symbol, nextMkt);
    }
  };

  const buildPayload = () => {
    const matchedTicker = findMatchingTicker(tickers, {
      symbol,
      marketType,
      exchange,
    });
    const liveFunding = marketType === 'SPOT' ? 0 : (matchedTicker?.fundingRatePct ?? 0);
    const resolvedExchange = matchedTicker?.exchange || exchange || '';
    const payload: Partial<BacktestConfig> & { exchange?: string } = {
      symbol,
      timeframe,
      marketType,
      exchange: resolvedExchange || undefined,
      strategyId,
      initialCapitalUsd,
      riskPerTradePct,
      leverage: marketType === 'SPOT' ? 1 : leverage,
      feeRateBps,
      slippageBps,
      fundingRatePer8hPct: liveFunding,
      stopLossAtrMult,
      takeProfitAtrMult: Math.max(stopLossAtrMult, takeProfitAtrMult),
      monteCarloRuns,
      useTrailingProfitLock,
    };
    return { payload, resolvedExchange };
  };

  const handleRunBacktest = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { payload, resolvedExchange } = buildPayload();
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t('quant.errBacktestFail'));
      } else {
        setResultExchange(resolvedExchange);
        setResult(data.result);
      }
    } catch {
      setError(t('quant.errBacktestNet'));
    } finally {
      setLoading(false);
    }
  };

  const handleRunBenchmark = async () => {
    setBenchmarkLoading(true);
    setError(null);
    try {
      const { payload, resolvedExchange } = buildPayload();
      const res = await fetch('/api/backtest/benchmark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t('quant.errBenchmarkFail'));
      } else {
        const bm: StrategyBenchmarkResult = data.benchmark;
        setResultExchange(resolvedExchange);
        setBenchmark(bm);
        const topEntry = bm.entries.find((item) => item.strategyId === strategyId) ?? bm.entries[0];
        if (topEntry) {
          setStrategyId(topEntry.strategyId);
          setResult(topEntry.result);
        }
      }
    } catch {
      setError(t('quant.errBenchmarkNet'));
    } finally {
      setBenchmarkLoading(false);
    }
  };

  const handleRunWalkForwardOptimize = async () => {
    setOptimizeLoading(true);
    setError(null);
    try {
      const { payload, resolvedExchange } = buildPayload();
      const res = await fetch('/api/backtest/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t('quant.errWfoFail'));
      } else {
        const opt: BacktestOptimizationResult = data.optimization;
        setResultExchange(resolvedExchange);
        setOptimization(opt);
        setStrategyId(opt.bestStrategyId);
        setStopLossAtrMult(opt.bestStopLossAtrMult);
        setTakeProfitAtrMult(opt.bestTakeProfitAtrMult);
        setUseTrailingProfitLock(opt.bestUseTrailingProfitLock);
        setResult(opt.fullHistoryResult);
      }
    } catch {
      setError(t('quant.errWfoNet'));
    } finally {
      setOptimizeLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Left: Strategy Builder & Simulation Controls */}
      <form
        onSubmit={handleRunBacktest}
        className="rounded-xl border border-slate-800/90 bg-[#0E1522] p-4 lg:col-span-4"
      >
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-cyan-400" />
          <h2 className="font-display text-base font-semibold text-slate-100">
            {t('quant.title')}
          </h2>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          {t('quant.subtitle')}
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="block text-xs text-slate-400" htmlFor="ql-symbol">
                {t('quant.pairLabel', { exchange: exchange || activeTicker?.exchange || 'Exchange' })}
              </label>
              {onOpenGlobalSearch && (
                <button
                  type="button"
                  onClick={onOpenGlobalSearch}
                  className="flex items-center gap-1 text-[11px] font-semibold text-cyan-300 hover:text-cyan-200 whitespace-nowrap"
                >
                  <Search className="h-3 w-3" />
                  <span>{t('quant.searchOther')}</span>
                </button>
              )}
            </div>
            <select
              id="ql-symbol"
              value={serializePairSelection({ symbol, marketType, exchange })}
              onChange={(e) => handlePairSelectChange(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-3 text-sm text-slate-100"
            >
              {uniquePairTickers.map((tkr) => {
                const val = serializePairSelection(tkr);
                return (
                  <option key={val} value={val}>
                    {tkr.symbol} · {tkr.marketType} · {tkr.exchange}
                  </option>
                );
              })}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400" htmlFor="ql-strategy">
              {t('quant.strategyLabel')}
            </label>
            <select
              id="ql-strategy"
              value={strategyId}
              onChange={(e) => setStrategyId(e.target.value as BacktestStrategyId)}
              className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-3 text-sm text-slate-100"
            >
              {strategyCatalog.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <p className="mt-1.5 rounded-lg border border-slate-800/80 bg-[#070B12] px-2.5 py-2 text-[11px] leading-relaxed text-slate-400">
              {selectedStrategyMeta.description}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400" htmlFor="ql-tf">
                {t('quant.timeframeLabel')}
              </label>
              <select
                id="ql-tf"
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value)}
                className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-3 text-sm text-slate-100"
              >
                <option value="15m">15m</option>
                <option value="1h">1h</option>
                <option value="4h">4h</option>
                <option value="1d">1d</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400" htmlFor="ql-mkt">
                {t('quant.marketLabel')}
              </label>
              <select
                id="ql-mkt"
                value={marketType}
                onChange={(e) => handleMarketTypeChange(e.target.value as MarketType)}
                className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-3 text-sm text-slate-100"
              >
                <option value="PERPETUAL">{t('quant.marketPerp')}</option>
                <option value="SPOT">{t('quant.marketSpot')}</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400" htmlFor="ql-cap">
                {t('quant.capitalLabel')}
              </label>
              <input
                id="ql-cap"
                type="number"
                min={500}
                value={initialCapitalUsd}
                onChange={(e) => setInitialCapitalUsd(Number(e.target.value))}
                className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-3 font-mono text-sm tabular-nums text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400" htmlFor="ql-risk">
                {t('quant.riskLabel')}
              </label>
              <input
                id="ql-risk"
                type="number"
                step={0.05}
                min={0.1}
                max={3}
                value={riskPerTradePct}
                onChange={(e) => setRiskPerTradePct(Number(e.target.value))}
                className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-3 font-mono text-sm tabular-nums text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="mb-1 block text-xs text-slate-400" htmlFor="ql-lev">
                {t('quant.leverageLabel')}
              </label>
              <input
                id="ql-lev"
                type="number"
                min={1}
                max={5}
                value={marketType === 'SPOT' ? 1 : leverage}
                disabled={marketType === 'SPOT'}
                onChange={(e) => setLeverage(Number(e.target.value))}
                className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-2.5 font-mono text-sm tabular-nums text-slate-100 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400" htmlFor="ql-fee">
                {t('quant.feeLabel')}
              </label>
              <input
                id="ql-fee"
                type="number"
                min={0}
                max={30}
                value={feeRateBps}
                onChange={(e) => setFeeRateBps(Number(e.target.value))}
                className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-2.5 font-mono text-sm tabular-nums text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400" htmlFor="ql-slip">
                {t('quant.slippageLabel')}
              </label>
              <input
                id="ql-slip"
                type="number"
                min={0}
                max={30}
                value={slippageBps}
                onChange={(e) => setSlippageBps(Number(e.target.value))}
                className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-2.5 font-mono text-sm tabular-nums text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400" htmlFor="ql-sl-atr">
                {t('quant.slAtrLabel')}
              </label>
              <input
                id="ql-sl-atr"
                type="number"
                step={0.05}
                min={0.6}
                max={4}
                value={stopLossAtrMult}
                onChange={(e) => setStopLossAtrMult(Number(e.target.value))}
                className="min-h-[42px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-3 font-mono text-sm tabular-nums text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400" htmlFor="ql-tp-atr">
                {t('quant.tpAtrLabel')}
              </label>
              <input
                id="ql-tp-atr"
                type="number"
                step={0.05}
                min={1}
                max={6}
                value={takeProfitAtrMult}
                onChange={(e) => setTakeProfitAtrMult(Number(e.target.value))}
                className="min-h-[42px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-3 font-mono text-sm tabular-nums text-slate-100"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400" htmlFor="ql-mc">
              {t('quant.mcRunsLabel')}
            </label>
            <input
              id="ql-mc"
              type="number"
              min={20}
              max={500}
              step={20}
              value={monteCarloRuns}
              onChange={(e) => setMonteCarloRuns(Number(e.target.value))}
              className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-3 font-mono text-sm tabular-nums text-slate-100"
            />
          </div>

          <label
            htmlFor="ql-trailing"
            className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-800 bg-[#070B12] p-2.5 text-xs"
          >
            <input
              id="ql-trailing"
              type="checkbox"
              checked={useTrailingProfitLock}
              onChange={(e) => setUseTrailingProfitLock(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-cyan-500"
            />
            <span>
              <span className="block font-medium text-slate-200">{t('quant.trailingLabel')}</span>
              <span className="mt-0.5 block text-[11px] text-slate-400">{t('quant.trailingDesc')}</span>
            </span>
          </label>
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-2.5 text-xs text-rose-300">
            {error}
          </p>
        )}

        <div className="mt-4 space-y-2">
          <button
            type="submit"
            disabled={loading || benchmarkLoading || optimizeLoading}
            className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            <span>{loading ? t('quant.runningBtn') : t('quant.runBtn')}</span>
          </button>
          <button
            type="button"
            disabled={loading || benchmarkLoading || optimizeLoading}
            onClick={handleRunBenchmark}
            className="flex min-h-[42px] w-full items-center justify-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
          >
            <Layers className="h-3.5 w-3.5" />
            <span>
              {benchmarkLoading ? t('quant.benchmarkRunning') : t('quant.benchmarkBtn')}
            </span>
          </button>
          <button
            type="button"
            disabled={loading || benchmarkLoading || optimizeLoading}
            onClick={handleRunWalkForwardOptimize}
            className="flex min-h-[42px] w-full items-center justify-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>
              {optimizeLoading ? t('quant.wfoRunning') : t('quant.wfoBtn')}
            </span>
          </button>
        </div>
      </form>

      {/* Right: Results, Walk-Forward Validation, Strategy Tournament, Equity Curve, Monte Carlo & Trade Ledger */}
      <div className="space-y-6 lg:col-span-8">
        {optimization && (
          <div className="rounded-xl border border-cyan-500/40 bg-[#0E1522] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-cyan-400" />
                <h3 className="font-display text-sm font-semibold text-slate-100">
                  {t('quant.wfoHeader', {
                    symbol: optimization.symbol,
                    tf: optimization.timeframe,
                  })}
                </h3>
              </div>
              <span className="font-mono text-[11px] tabular-nums text-emerald-400">
                {t('quant.wfoEvaluated', {
                  count: optimization.candidatesEvaluated,
                  isBars: optimization.inSampleBars,
                  oosBars: optimization.outOfSampleBars,
                })}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-slate-800 bg-[#070B12] p-3">
                <p className="text-[11px] text-slate-400">{t('quant.wfoWinnerLabel')}</p>
                <p className="mt-1 font-display text-xs font-semibold text-cyan-300">
                  {optimization.bestStrategyLabel}
                </p>
                <p className="mt-1 font-mono text-[11px] tabular-nums text-slate-300">
                  SL {optimization.bestStopLossAtrMult}x · TP {optimization.bestTakeProfitAtrMult}x ATR
                  {optimization.bestUseTrailingProfitLock ? t('quant.wfoTrailingTag') : ''}
                </p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#070B12] p-3 font-mono tabular-nums">
                <p className="font-sans text-[11px] text-slate-400">{t('quant.wfoInSampleLabel')}</p>
                <p className="mt-1 text-sm font-semibold text-slate-100">
                  Win {optimization.inSampleResult.winRatePct}% · PF {optimization.inSampleResult.profitFactor}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  Net {optimization.inSampleResult.netProfitUsd >= 0 ? '+' : ''}${optimization.inSampleResult.netProfitUsd.toFixed(2)} ({optimization.inSampleResult.totalTrades} {t('quant.wfoTradesSuffix')})
                </p>
              </div>
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 font-mono tabular-nums">
                <p className="font-sans text-[11px] text-emerald-300">{t('quant.wfoOutSampleLabel')}</p>
                <p className="mt-1 text-sm font-bold text-emerald-400">
                  Win {optimization.outOfSampleResult.winRatePct}% · PF {optimization.outOfSampleResult.profitFactor}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-300">
                  EV {optimization.outOfSampleResult.expectancyUsd >= 0 ? '+' : ''}${optimization.outOfSampleResult.expectancyUsd.toFixed(2)}{t('quant.wfoPerTrade')} · DD {optimization.outOfSampleResult.maxDrawdownPct}%
                </p>
              </div>
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-1.5 pr-3 font-medium">{t('quant.wfoThStrategy')}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t('quant.wfoThIsWin')}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t('quant.wfoThOosTrades')}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t('quant.wfoThOosWin')}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t('quant.wfoThOosPf')}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t('quant.wfoThOosEv')}</th>
                    <th className="py-1.5 text-right font-medium">{t('quant.wfoThApply')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono tabular-nums">
                  {optimization.topCandidates.map((cand, idx) => (
                    <tr
                      key={`${cand.strategyId}-${cand.stopLossAtrMult}-${cand.takeProfitAtrMult}-${cand.useTrailingProfitLock}`}
                      className={idx === 0 ? 'bg-cyan-500/10' : 'hover:bg-slate-800/30'}
                    >
                      <td className="py-1.5 pr-3 font-sans text-slate-200">
                        {cand.strategyLabel}{' '}
                        <span className="font-mono text-[11px] text-slate-400">
                          ({cand.stopLossAtrMult}/{cand.takeProfitAtrMult}x{cand.useTrailingProfitLock ? ' Trail' : ''})
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 text-right text-slate-300">
                        {cand.inSampleWinRatePct.toFixed(1)}%
                      </td>
                      <td className="py-1.5 pr-3 text-right text-slate-300">
                        {cand.outOfSampleTrades}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-semibold text-emerald-400">
                        {cand.outOfSampleWinRatePct.toFixed(1)}%
                      </td>
                      <td className="py-1.5 pr-3 text-right text-slate-200">
                        {cand.outOfSampleProfitFactor.toFixed(2)}
                      </td>
                      <td
                        className={`py-1.5 pr-3 text-right ${
                          cand.outOfSampleExpectancyUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {cand.outOfSampleExpectancyUsd >= 0 ? '+' : ''}$
                        {cand.outOfSampleExpectancyUsd.toFixed(2)}
                      </td>
                      <td className="py-1.5 text-right font-sans">
                        <button
                          type="button"
                          onClick={() => {
                            setStrategyId(cand.strategyId);
                            setStopLossAtrMult(cand.stopLossAtrMult);
                            setTakeProfitAtrMult(cand.takeProfitAtrMult);
                            setUseTrailingProfitLock(cand.useTrailingProfitLock);
                          }}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-cyan-300 hover:text-cyan-200 whitespace-nowrap"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          <span>{t('quant.selectBtn')}</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {benchmark && (
          <div className="rounded-xl border border-slate-800 bg-[#0E1522] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Award className="h-4 w-4 text-emerald-400" />
                <h3 className="font-display text-sm font-semibold text-slate-100">
                  {t('quant.bmTitle', {
                    symbol: benchmark.symbol,
                    tf: benchmark.timeframe,
                  })}
                </h3>
              </div>
              <span className="text-[11px] text-slate-400">
                {t('quant.bmHint')}
              </span>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2 pr-2 font-medium">#</th>
                    <th className="py-2 pr-3 font-medium">{t('quant.bmThStrategy')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('quant.bmThTrades')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('quant.bmThWinRate')}</th>
                    <th className="py-2 pr-3 text-right font-medium">PF</th>
                    <th className="py-2 pr-3 text-right font-medium">Sharpe</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('quant.bmThMaxDd')}</th>
                    <th className="py-2 text-right font-medium">{t('quant.bmThNetPnl')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono tabular-nums">
                  {benchmark.entries.map((entry) => {
                    const isSelected = strategyId === entry.strategyId;
                    return (
                      <tr
                        key={entry.strategyId}
                        onClick={() => {
                          setStrategyId(entry.strategyId);
                          setResult(entry.result);
                        }}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-cyan-500/12' : 'hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="py-2 pr-2 text-slate-400">{entry.rank}</td>
                        <td className="py-2 pr-3 font-sans">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setStrategyId(entry.strategyId);
                              setResult(entry.result);
                            }}
                            className="flex flex-wrap items-center gap-1.5 text-left"
                          >
                            <span
                              className={`font-medium ${
                                isSelected ? 'text-cyan-300' : 'text-slate-100'
                              }`}
                            >
                              {entry.strategyLabel}
                            </span>
                            {entry.isHighestWinRate && (
                              <span className="font-mono text-[10px] font-bold text-emerald-400">
                                {t('quant.bmTopWin')}
                              </span>
                            )}
                          </button>
                        </td>
                        <td className="py-2 pr-3 text-right text-slate-300">
                          {entry.result.totalTrades}
                        </td>
                        <td
                          className={`py-2 pr-3 text-right font-semibold ${
                            entry.isHighestWinRate ? 'text-emerald-400' : 'text-slate-200'
                          }`}
                        >
                          {entry.result.winRatePct.toFixed(1)}%
                        </td>
                        <td className="py-2 pr-3 text-right text-slate-300">
                          {entry.result.profitFactor.toFixed(2)}
                        </td>
                        <td className="py-2 pr-3 text-right text-cyan-400">
                          {entry.result.sharpeRatio.toFixed(2)}
                        </td>
                        <td className="py-2 pr-3 text-right text-amber-400">
                          {entry.result.maxDrawdownPct.toFixed(2)}%
                        </td>
                        <td
                          className={`py-2 text-right font-semibold ${
                            entry.result.netProfitUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {entry.result.netProfitUsd >= 0 ? '+' : ''}$
                          {entry.result.netProfitUsd.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <EquityChart
          points={result?.equityCurve ?? []}
          initialCapital={result?.config.initialCapitalUsd ?? initialCapitalUsd}
        />

        {result && (
          <>
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-200">
              {result.disclaimer} ({t('quant.sourceMeta', { source: result.dataSourceLabel, count: result.candleCount })})
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-slate-800 bg-[#0E1522] p-3.5">
                <p className="text-xs text-slate-400">Net Profit · Expectancy</p>
                <p
                  className={`mt-1 font-mono text-base font-semibold tabular-nums sm:text-lg ${
                    result.netProfitUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {result.netProfitUsd >= 0 ? '+' : ''}${result.netProfitUsd.toFixed(2)}
                </p>
                <p className="font-mono text-[11px] tabular-nums text-slate-400">
                  {result.totalReturnPct.toFixed(2)}% · EV{' '}
                  <span className={result.expectancyUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                    {result.expectancyUsd >= 0 ? '+' : ''}${result.expectancyUsd.toFixed(2)}
                  </span>
                </p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-[#0E1522] p-3.5">
                <p className="text-xs text-slate-400">Win Rate · Profit Factor</p>
                <p className="mt-1 font-mono text-base font-semibold tabular-nums text-slate-100 sm:text-lg">
                  {result.winRatePct}% · {result.profitFactor}
                </p>
                <p className="font-mono text-[11px] tabular-nums text-slate-400">
                  {t('quant.statTrades', { count: result.totalTrades })} · Avg +${result.averageWinUsd.toFixed(1)}/-${result.averageLossUsd.toFixed(1)}
                </p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-[#0E1522] p-3.5">
                <p className="text-xs text-slate-400">Sharpe · Sortino</p>
                <p className="mt-1 font-mono text-base font-semibold whitespace-nowrap tabular-nums text-cyan-400 sm:text-lg">
                  {result.sharpeRatio} · {result.sortinoRatio}
                </p>
                <p className="font-mono text-[11px] tabular-nums text-slate-400">
                  Max Streak Loss {result.maxConsecutiveLosses}
                </p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-[#0E1522] p-3.5">
                <p className="text-xs text-slate-400">Max Drawdown</p>
                <p className="mt-1 font-mono text-base font-semibold tabular-nums text-amber-400 sm:text-lg">
                  {result.maxDrawdownPct}%
                </p>
                <p className="font-mono text-[11px] tabular-nums text-slate-400">
                  {t('quant.statFees', { fees: result.totalFeesUsd.toFixed(1) })}
                </p>
              </div>
            </div>

            {/* Monte Carlo Percentiles */}
            <div className="rounded-xl border border-slate-800 bg-[#0E1522] p-4">
              <h3 className="font-display text-sm font-semibold text-slate-100">
                {t('quant.mcTitle', { runs: result.monteCarlo.runs })}
              </h3>
              <div className="mt-3 grid grid-cols-2 gap-3 font-mono text-xs tabular-nums sm:grid-cols-4">
                <div>
                  <span className="block text-slate-400">{t('quant.mcP5')}</span>
                  <span className="text-rose-400">${result.monteCarlo.p5FinalEquityUsd}</span>
                </div>
                <div>
                  <span className="block text-slate-400">{t('quant.mcP50')}</span>
                  <span className="text-slate-100">${result.monteCarlo.p50FinalEquityUsd}</span>
                </div>
                <div>
                  <span className="block text-slate-400">{t('quant.mcP95')}</span>
                  <span className="text-emerald-400">${result.monteCarlo.p95FinalEquityUsd}</span>
                </div>
                <div>
                  <span className="block text-slate-400">P95 Max DD</span>
                  <span className="text-amber-400">{result.monteCarlo.p95MaxDrawdownPct}%</span>
                </div>
              </div>
            </div>

            {/* Simulated Trade Ledger */}
            <div className="rounded-xl border border-slate-800 bg-[#0E1522] p-4">
              <h3 className="mb-3 font-display text-sm font-semibold text-slate-100">
                {t('quant.tradesTitle', { count: result.trades.length })}
              </h3>
              <div className="max-h-60 overflow-x-auto overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="py-2 pr-3 font-medium">#</th>
                      <th className="py-2 pr-3 font-medium">{t('quant.tradesThSide')}</th>
                      <th className="py-2 pr-3 text-right font-medium">Entry</th>
                      <th className="py-2 pr-3 text-right font-medium">Exit</th>
                      <th className="py-2 pr-3 font-medium">{t('quant.tradesThReason')}</th>
                      <th className="py-2 text-right font-medium">Net PnL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono tabular-nums">
                    {result.trades.map((t) => (
                      <tr key={t.id}>
                        <td className="py-2 pr-3 text-slate-400">{t.id}</td>
                        <td
                          className={`py-2 pr-3 font-semibold ${
                            t.side === 'LONG' ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {t.side}
                        </td>
                        <td className="py-2 pr-3 text-right text-slate-300">
                          {formatAssetPrice(t.entryPrice)}
                        </td>
                        <td className="py-2 pr-3 text-right text-slate-300">
                          {formatAssetPrice(t.exitPrice)}
                        </td>
                        <td className="py-2 pr-3 font-sans text-slate-400">
                          {t.exitReason === 'BREAKEVEN_TRAIL' ? (
                            <span className="text-cyan-300">BREAKEVEN_TRAIL (Protected)</span>
                          ) : (
                            t.exitReason
                          )}
                        </td>
                        <td
                          className={`py-2 text-right font-semibold ${
                            t.netPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {t.netPnlUsd >= 0 ? '+' : ''}${t.netPnlUsd.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
