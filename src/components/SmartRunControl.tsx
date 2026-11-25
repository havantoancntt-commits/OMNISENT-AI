import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  Cpu,
  Play,
  Radar,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import { formatAssetPrice } from '../engine/symbolSearch';
import {
  dedupeTickersByPair,
  parsePairSelection,
  serializePairSelection,
} from '../engine/pairSelection';
import type { MarketTicker, MarketType, TradingMode } from '../engine/types';
import { useI18n } from '../i18n/I18nContext';

export type SmartRunMode = 'ANALYZE_SINGLE' | 'SMART_SCAN_BEST' | 'ANALYZE_AND_PAPER_EXECUTE';

export interface SmartRunSummary {
  chosenSymbol: string;
  chosenExchange?: string;
  direction: string;
  state: string;
  confidenceScore: number;
  scanCandidatesCount: number;
  autoExecuted: boolean;
  executionMessage: string;
  timestampUtc: string;
}

interface SmartRunControlProps {
  tickers: MarketTicker[];
  selectedTicker?: MarketTicker | null;
  selectedSymbol: string;
  selectedMarketType: MarketType;
  selectedExchange?: string;
  tradingMode: TradingMode;
  runMode: SmartRunMode;
  includeGemini: boolean;
  running: boolean;
  runStage: number; // 0 idle, 1..4 stages
  lastSummary: SmartRunSummary | null;
  onChangeRunMode: (mode: SmartRunMode) => void;
  onChangeTargetSymbol: (symbol: string, marketType: MarketType, exchange?: string) => void;
  onOpenGlobalSearch?: () => void;
  onToggleGemini: (val: boolean) => void;
  onExecuteRun: (overrideMode?: SmartRunMode) => void;
  onResetSession: () => Promise<void>;
}

const MODE_DEFS: Array<{
  id: SmartRunMode;
  shortTag: string;
  titleKey: 'smartRun.modeAnalyzeTitle' | 'smartRun.modeScanTitle' | 'smartRun.modeExecTitle';
  descKey: 'smartRun.modeAnalyzeDesc' | 'smartRun.modeScanDesc' | 'smartRun.modeExecDesc';
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: 'ANALYZE_SINGLE',
    shortTag: 'AI',
    titleKey: 'smartRun.modeAnalyzeTitle',
    descKey: 'smartRun.modeAnalyzeDesc',
    icon: Cpu,
  },
  {
    id: 'SMART_SCAN_BEST',
    shortTag: 'SCAN',
    titleKey: 'smartRun.modeScanTitle',
    descKey: 'smartRun.modeScanDesc',
    icon: Radar,
  },
  {
    id: 'ANALYZE_AND_PAPER_EXECUTE',
    shortTag: 'EXEC',
    titleKey: 'smartRun.modeExecTitle',
    descKey: 'smartRun.modeExecDesc',
    icon: ShieldCheck,
  },
];

export const SmartRunControl: React.FC<SmartRunControlProps> = ({
  tickers,
  selectedTicker = null,
  selectedSymbol,
  selectedMarketType,
  selectedExchange,
  tradingMode,
  runMode,
  includeGemini,
  running,
  runStage,
  lastSummary,
  onChangeRunMode,
  onChangeTargetSymbol,
  onOpenGlobalSearch,
  onToggleGemini,
  onExecuteRun,
  onResetSession,
}) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const modeOptions = MODE_DEFS.map((m) => ({
    ...m,
    title: t(m.titleKey),
    desc: t(m.descKey),
  }));
  const stages = [
    t('smartRun.stage1'),
    t('smartRun.stage2'),
    t('smartRun.stage3'),
    t('smartRun.stage4'),
  ];
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  const activeModeMeta = modeOptions.find((m) => m.id === runMode) ?? modeOptions[0];
  const uniqueTickers = dedupeTickersByPair(tickers);
  const activeSelectValue = selectedTicker
    ? serializePairSelection(selectedTicker)
    : serializePairSelection({
        symbol: selectedSymbol,
        marketType: selectedMarketType,
        exchange: selectedExchange ?? uniqueTickers[0]?.exchange ?? '',
      });

  const handleReset = async () => {
    setResetting(true);
    try {
      await onResetSession();
      setOpen(false);
    } finally {
      setResetting(false);
    }
  };

  return (
    <div ref={panelRef} className="relative flex items-center">
      {/* Split Action Control: [RUN Primary] + [Smart Config Dropdown] */}
      <div className="flex items-center overflow-hidden rounded-lg border border-cyan-400/50 bg-[#0B1424] shadow-lg">
        <button
          type="button"
          disabled={running || tickers.length === 0 || tradingMode === 'EMERGENCY_STOP'}
          onClick={() => onExecuteRun()}
          aria-label={t('smartRun.ariaExecute')}
          className="flex min-h-[38px] items-center gap-1.5 bg-gradient-to-r from-cyan-500 to-emerald-500 px-3 py-1.5 text-xs font-bold tracking-wide text-slate-950 transition-opacity hover:opacity-95 disabled:opacity-50 whitespace-nowrap"
        >
          {running ? (
            <>
              <Zap className="h-3.5 w-3.5 animate-spin" />
              <span>
                {runStage >= 1 && runStage <= 4
                  ? `${runStage}/4 ${stages[runStage - 1]}`
                  : t('smartRun.runningFallback')}
              </span>
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5 fill-slate-950" />
              <span>RUN</span>
              <span className="hidden rounded bg-slate-950/20 px-1.5 py-0.5 font-mono text-[10px] font-bold sm:inline">
                {activeModeMeta.shortTag}
              </span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={t('smartRun.ariaConfig')}
          className="flex min-h-[38px] items-center justify-center border-l border-slate-800 bg-[#0E182B] px-2 text-cyan-300 transition-colors hover:bg-slate-800"
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Responsive Smart Run Command Popover */}
      {open && (
        <div
          role="dialog"
          aria-label={t('smartRun.dialogAria')}
          className="fixed inset-x-3 top-14 z-50 rounded-2xl border border-slate-700/90 bg-[#0B111D] p-4 shadow-2xl sm:absolute sm:inset-x-auto sm:top-11 sm:right-0 sm:w-[400px]"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-cyan-400" />
              <h3 className="font-display text-sm font-semibold text-slate-100">
                Smart Run Command Engine
              </h3>
            </div>
            <span className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 font-mono text-[10px] text-cyan-300">
              {tradingMode}
            </span>
          </div>

          {/* 3 Intelligent Run Modes */}
          <div className="mt-3 space-y-2">
            {modeOptions.map((opt) => {
              const Icon = opt.icon;
              const selected = runMode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onChangeRunMode(opt.id)}
                  className={`flex w-full items-start gap-2.5 rounded-xl border p-2.5 text-left transition-colors ${
                    selected
                      ? 'border-cyan-500/60 bg-cyan-500/10'
                      : 'border-slate-800 bg-[#070B12] hover:border-slate-700'
                  }`}
                >
                  <Icon
                    className={`mt-0.5 h-4 w-4 shrink-0 ${
                      selected ? 'text-cyan-400' : 'text-slate-400'
                    }`}
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-100">{opt.title}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{opt.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Target Pair + Gemini Toggle */}
          <div className="mt-3 space-y-2.5 border-t border-slate-800 pt-3">
            {runMode !== 'SMART_SCAN_BEST' && (
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label
                    htmlFor="smart-run-symbol"
                    className="block text-[11px] font-medium text-slate-400"
                  >
                    {t('smartRun.targetPairLabel')}
                  </label>
                  {onOpenGlobalSearch && (
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onOpenGlobalSearch();
                      }}
                      className="flex items-center gap-1 text-[11px] font-semibold text-cyan-300 hover:text-cyan-200"
                    >
                      <Search className="h-3 w-3" />
                      <span>{t('smartRun.searchOtherCoin')}</span>
                    </button>
                  )}
                </div>
                <select
                  id="smart-run-symbol"
                  value={activeSelectValue}
                  onChange={(e) => {
                    const parsed = parsePairSelection(e.target.value);
                    if (parsed) {
                      onChangeTargetSymbol(parsed.symbol, parsed.marketType, parsed.exchange);
                    }
                  }}
                  className="min-h-[40px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-3 text-xs text-slate-100"
                >
                  {uniqueTickers.map((tk) => {
                    const val = serializePairSelection(tk);
                    return (
                      <option key={val} value={val}>
                        {tk.symbol} · {tk.marketType} · {tk.exchange} ({formatAssetPrice(tk.lastPrice)})
                      </option>
                    );
                  })}
                </select>
              </div>
            )}

            <label className="flex min-h-[36px] cursor-pointer items-center justify-between rounded-lg border border-slate-800 bg-[#070B12] px-3 py-2 text-xs text-slate-200">
              <span>{t('smartRun.geminiToggle')}</span>
              <input
                type="checkbox"
                checked={includeGemini}
                onChange={(e) => onToggleGemini(e.target.checked)}
                className="h-4 w-4 accent-cyan-500"
              />
            </label>
          </div>

          {/* 4-Stage Pipeline Indicator */}
          <div className="mt-3 grid grid-cols-4 gap-1.5">
            {stages.map((label, idx) => {
              const stepNum = idx + 1;
              const active = running && runStage === stepNum;
              const done = (!running && lastSummary) || runStage > stepNum;
              return (
                <div
                  key={label}
                  className={`rounded-md border px-1.5 py-1 text-center text-[10px] font-medium ${
                    active
                      ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200'
                      : done
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                        : 'border-slate-800 bg-[#070B12] text-slate-500'
                  }`}
                >
                  {stepNum}. {label}
                </div>
              );
            })}
          </div>

          {/* Last Run Summary */}
          {lastSummary && (
            <div className="mt-3 rounded-lg border border-slate-800 bg-[#070B12] p-2.5 text-[11px]">
              <div className="flex items-center justify-between font-mono">
                <span className="flex items-center gap-1 font-semibold text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {lastSummary.chosenSymbol}
                  {lastSummary.chosenExchange ? ` (${lastSummary.chosenExchange})` : ''} · {lastSummary.direction}
                </span>
                <span className="text-slate-400">
                  {lastSummary.state} ({lastSummary.confidenceScore}/100)
                </span>
              </div>
              <p className="mt-1 text-slate-300">{lastSummary.executionMessage}</p>
            </div>
          )}

          {/* Action Footer */}
          <div className="mt-3 flex items-center gap-2 border-t border-slate-800 pt-3">
            <button
              type="button"
              disabled={resetting || running}
              onClick={handleReset}
              className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs font-medium text-slate-300 hover:border-rose-500/50 hover:text-rose-300 disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>{resetting ? t('smartRun.resettingBtn') : t('smartRun.resetZeroBtn')}</span>
            </button>

            <button
              type="button"
              disabled={running || tickers.length === 0 || tradingMode === 'EMERGENCY_STOP'}
              onClick={() => {
                setOpen(false);
                onExecuteRun();
              }}
              className="flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-emerald-500 px-3 text-xs font-bold text-slate-950 hover:opacity-95 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5 fill-slate-950" />
              <span>{t('smartRun.executeNowBtn')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
