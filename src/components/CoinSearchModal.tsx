import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  Loader2,
  Search,
  Sparkles,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  formatAssetPrice,
  formatCompactUsd,
  type MarketDirectoryEntry,
} from '../engine/symbolSearch';
import type { MarketType } from '../engine/types';
import { useI18n } from '../i18n/I18nContext';

export interface CoinSearchModalProps {
  open: boolean;
  title?: string;
  selectedSymbol?: string;
  selectedMarketType?: MarketType;
  selectedExchange?: string;
  allowRunAi?: boolean;
  onClose: () => void;
  onSelectPair: (
    symbol: string,
    marketType: MarketType,
    exchange: string,
    options?: { runAi?: boolean },
  ) => Promise<void> | void;
}

const EXCHANGES = ['ALL', 'Binance', 'Bybit', 'OKX', 'Kraken', 'Coinbase Advanced'] as const;

export const CoinSearchModal: React.FC<CoinSearchModalProps> = ({
  open,
  title,
  selectedSymbol,
  selectedMarketType,
  selectedExchange,
  allowRunAi = true,
  onClose,
  onSelectPair,
}) => {
  const { t } = useI18n();
  const resolvedTitle = title ?? t('search.title');
  const [query, setQuery] = useState('');
  const [marketType, setMarketType] = useState<'ALL' | MarketType>('ALL');
  const [exchange, setExchange] = useState<string>('ALL');
  const [sort, setSort] = useState<'volume' | 'gainer' | 'loser'>('volume');
  const [results, setResults] = useState<MarketDirectoryEntry[]>([]);
  const [totalIndexed, setTotalIndexed] = useState(0);
  const [loading, setLoading] = useState(false);
  const [activatingKey, setActivatingKey] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus search input cleanly upon opening
  useEffect(() => {
    if (!open) return;
    setErrorMsg(null);
    setActiveIndex(0);
    const id = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 30);
    return () => window.clearTimeout(id);
  }, [open]);

  // Debounced live multi-exchange directory search
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);

    const timer = window.setTimeout(async () => {
      try {
        const effectiveSort = query.trim() ? 'relevance' : sort;
        const params = new URLSearchParams({
          q: query,
          marketType,
          exchange,
          sort: effectiveSort,
          limit: '32',
        });
        const res = await fetch(`/api/market/search?${params.toString()}`);
        if (!res.ok) throw new Error('Search request failed');
        const data = await res.json();
        if (!cancelled) {
          setResults(Array.isArray(data.results) ? data.results : []);
          setTotalIndexed(Number(data.totalIndexed) || 0);
          setActiveIndex(0);
        }
      } catch {
        if (!cancelled) {
          setResults([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, query.trim() ? 140 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query, marketType, exchange, sort]);

  // Global keyboard Escape handler inside modal
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const triggerPick = async (entry: MarketDirectoryEntry, runAi = false) => {
    const key = `${entry.symbol}|${entry.marketType}|${entry.exchangeId}`;
    setActivatingKey(key);
    setErrorMsg(null);
    try {
      await onSelectPair(entry.symbol, entry.marketType, entry.exchange, { runAi });
      onClose();
    } catch {
      setErrorMsg(t('search.errorActivate', { symbol: entry.symbol }));
    } finally {
      setActivatingKey(null);
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = results[activeIndex] ?? results[0];
      if (target) {
        triggerPick(target, false);
      }
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={resolvedTitle}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/75 p-3 pt-10 backdrop-blur-[2px] sm:p-6 sm:pt-16"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-700/90 bg-[#0B111D] shadow-2xl"
      >
        {/* Top Search Input Bar */}
        <div className="border-b border-slate-800 p-3.5 sm:p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Search className="h-4 w-4 shrink-0 text-cyan-400" />
              <h2 className="truncate font-display text-sm font-semibold text-slate-100">
                {resolvedTitle}
              </h2>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="hidden font-mono text-[11px] tabular-nums text-slate-400 sm:inline">
                {totalIndexed > 0
                  ? t('search.livePairsCount', { count: totalIndexed.toLocaleString('en-US') })
                  : t('search.syncingExchanges')}
              </span>
              <button
                type="button"
                onClick={onClose}
                aria-label={t('search.closeAria')}
                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder={t('search.inputPlaceholder')}
              aria-label={t('search.inputAria')}
              className="min-h-[46px] w-full rounded-xl border border-slate-700 bg-[#070B12] pr-16 pl-10 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  inputRef.current?.focus();
                }}
                aria-label={t('search.clearAria')}
                className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              >
                {t('search.clearBtn')}
              </button>
            )}
          </div>

          {/* Filter Strip: MarketType · Exchange · Discovery Sort */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {(['ALL', 'PERPETUAL', 'SPOT'] as const).map((mkt) => (
                <button
                  key={mkt}
                  type="button"
                  onClick={() => setMarketType(mkt)}
                  className={`min-h-[34px] rounded-lg border px-2.5 text-xs font-medium whitespace-nowrap ${
                    marketType === mkt
                      ? 'border-cyan-500/50 bg-cyan-500/20 text-cyan-300'
                      : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {mkt === 'ALL' ? t('search.filterAll') : mkt}
                </button>
              ))}

              <select
                value={exchange}
                onChange={(e) => setExchange(e.target.value)}
                aria-label={t('search.filterExchangeAria')}
                className="min-h-[34px] rounded-lg border border-slate-800 bg-[#070B12] px-2.5 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
              >
                {EXCHANGES.map((ex) => (
                  <option key={ex} value={ex}>
                    {ex === 'ALL' ? t('search.filterAllExchanges') : ex}
                  </option>
                ))}
              </select>
            </div>

            {!query.trim() && (
              <div className="flex items-center gap-1">
                {(
                  [
                    { id: 'volume', label: t('search.sortVolume') },
                    { id: 'gainer', label: t('search.sortGainer') },
                    { id: 'loser', label: t('search.sortLoser') },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSort(item.id)}
                    className={`min-h-[32px] rounded-md px-2 text-[11px] font-medium whitespace-nowrap ${
                      sort === item.id
                        ? 'bg-slate-800 text-cyan-300'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Results List */}
        <div className="min-h-[240px] flex-1 overflow-y-auto p-2 sm:p-3">
          {errorMsg && (
            <div className="mb-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-2.5 text-xs text-rose-300">
              {errorMsg}
            </div>
          )}

          {loading && results.length === 0 ? (
            <div className="flex h-48 items-center justify-center gap-2 text-xs text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
              <span>{t('search.loadingText')}</span>
            </div>
          ) : results.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center px-4 text-center">
              <p className="text-sm font-medium text-slate-300">
                {t('search.emptyTitle', { query })}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {t('search.emptyTip')}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {results.map((entry, idx) => {
                const rowKey = `${entry.symbol}|${entry.marketType}|${entry.exchangeId}`;
                const isActivating = activatingKey === rowKey;
                const isCurrent =
                  selectedSymbol === entry.symbol &&
                  selectedMarketType === entry.marketType &&
                  (!selectedExchange ||
                    selectedExchange.toUpperCase() === entry.exchange.toUpperCase());
                const up = entry.change24hPct >= 0;
                const highlighted = idx === activeIndex;

                return (
                  <div
                    key={rowKey}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`flex min-h-[60px] items-center justify-between gap-2 rounded-xl px-2 py-1.5 transition-colors ${
                      highlighted
                        ? 'bg-cyan-500/10'
                        : isCurrent
                          ? 'bg-slate-800/40'
                          : 'hover:bg-slate-800/30'
                    }`}
                  >
                    <button
                      type="button"
                      disabled={Boolean(activatingKey)}
                      onClick={() => triggerPick(entry, false)}
                      className="flex min-h-[48px] min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-2 py-1 text-left focus:outline-none disabled:opacity-60"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-display text-sm font-semibold text-slate-100">
                            {entry.symbol}
                          </span>
                          {isCurrent && (
                            <Check className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-slate-400">
                          {entry.exchange} · {entry.marketType}
                          {entry.marketType === 'PERPETUAL' ? ` ${entry.maxLeverage}x` : ''}
                          {' · '}Vol {formatCompactUsd(entry.volume24hUsd)}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <div className="text-right font-mono tabular-nums">
                          <p className="text-sm font-semibold text-slate-100">
                            {formatAssetPrice(entry.lastPrice)}
                          </p>
                          <p
                            className={`flex items-center justify-end gap-0.5 text-xs ${
                              up ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {up ? (
                              <TrendingUp className="h-3 w-3" />
                            ) : (
                              <TrendingDown className="h-3 w-3" />
                            )}
                            {up ? '+' : ''}
                            {entry.change24hPct.toFixed(2)}%
                          </p>
                        </div>

                        {!allowRunAi && (
                          <span className="flex min-h-[34px] items-center rounded-lg border border-slate-800 bg-slate-900 px-2 text-slate-300">
                            {isActivating ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" />
                            ) : (
                              <ArrowRight className="h-3.5 w-3.5" />
                            )}
                          </span>
                        )}
                      </div>
                    </button>

                    {allowRunAi && (
                      <button
                        type="button"
                        disabled={Boolean(activatingKey)}
                        onClick={() => triggerPick(entry, true)}
                        aria-label={t('search.ariaRunAiFor', { symbol: entry.symbol })}
                        className="flex min-h-[40px] shrink-0 items-center gap-1 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-2.5 text-[11px] font-semibold text-cyan-300 transition-colors hover:bg-cyan-500/25 disabled:opacity-50 whitespace-nowrap"
                      >
                        {isActivating ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5" />
                        )}
                        <span className="hidden sm:inline">RUN AI</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer Hint */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 bg-[#070B12] px-4 py-2 text-[11px] text-slate-400">
          <span>{t('search.footerSource')}</span>
          <span className="hidden font-mono sm:inline">{t('search.footerShortcut')}</span>
        </div>
      </div>
    </div>
  );
};
