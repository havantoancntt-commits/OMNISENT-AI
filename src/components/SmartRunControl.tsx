import React, { useEffect, useRef, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  Pause,
  Play,
  Radar,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import type {
  AutoExecutionConfig,
  AutoExecutionEngineStatus,
  MarketTicker,
  MarketType,
  TradingMode,
} from '../engine/types';
import { useI18n } from '../i18n/I18nContext';

export type SmartRunMode = 'SMART_SCAN_BEST' | 'ANALYZE_AND_PAPER_EXECUTE';

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
  tradingMode: TradingMode;
  runMode: SmartRunMode;
  includeGemini: boolean;
  running: boolean;
  runStage: number; // 0 idle, 1..4 stages
  lastSummary: SmartRunSummary | null;
  onChangeRunMode: (mode: SmartRunMode) => void;
  onToggleGemini: (val: boolean) => void;
  onExecuteRun: (overrideMode?: SmartRunMode) => void;
  onResetSession: () => Promise<void>;
  autoExecutionStatus?: AutoExecutionEngineStatus | null;
  openPositionsCount?: number;
  onUpdateAutoConfig?: (
    partial: Partial<AutoExecutionConfig>,
  ) => Promise<{ ok: boolean; error?: string }>;
  onRunAutoCycle?: () => Promise<{ ok: boolean; error?: string }>;
  onApproveAutoProposal?: (id: string) => Promise<{ ok: boolean; error?: string }>;
  onRejectAutoProposal?: (id: string) => Promise<{ ok: boolean; error?: string }>;
  onOpenAutoConfig?: () => void;
}

const MODE_DEFS: Array<{
  id: SmartRunMode;
  shortTag: string;
  titleKey: 'smartRun.modeScanTitle' | 'smartRun.modeExecTitle';
  descKey: 'smartRun.modeScanDesc' | 'smartRun.modeExecDesc';
  icon: React.ComponentType<{ className?: string }>;
}> = [
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
  tradingMode,
  runMode,
  includeGemini,
  running,
  runStage,
  lastSummary,
  onChangeRunMode,
  onToggleGemini,
  onExecuteRun,
  onResetSession,
  autoExecutionStatus = null,
  openPositionsCount = 0,
  onUpdateAutoConfig,
  onRunAutoCycle,
  onApproveAutoProposal,
  onRejectAutoProposal,
  onOpenAutoConfig,
}) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoCycleBusy, setAutoCycleBusy] = useState(false);
  const [proposalBusyId, setProposalBusyId] = useState<string | null>(null);
  const [autoErr, setAutoErr] = useState<string | null>(null);

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
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  const activeModeMeta = modeOptions.find((m) => m.id === runMode) ?? modeOptions[0];

  const isEmergency = tradingMode === 'EMERGENCY_STOP';
  const isAutoArmed = Boolean(autoExecutionStatus?.engineRunning && !isEmergency);
  const autoMode = autoExecutionStatus?.config.executionMode ?? 'FULL_AUTO';
  const pendingProposals = autoExecutionStatus?.pendingProposals ?? [];

  const autoStateLabel = isEmergency
    ? t('auto.state.emergency')
    : isAutoArmed && autoMode === 'FULL_AUTO'
      ? t('auto.state.fullAuto')
      : isAutoArmed
        ? t('auto.state.semiAuto')
        : t('auto.state.standby');

  const autoBadgeClass = isEmergency
    ? 'border-rose-500/40 bg-rose-500/15 text-rose-300'
    : isAutoArmed && autoMode === 'FULL_AUTO'
      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
      : isAutoArmed
        ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300'
        : 'border-slate-700 bg-slate-900 text-slate-300';

  const handleReset = async () => {
    setResetting(true);
    try {
      await onResetSession();
      setOpen(false);
    } finally {
      setResetting(false);
    }
  };

  const handleSwitchAutoMode = async (mode: 'FULL_AUTO' | 'SEMI_AUTO') => {
    if (!onUpdateAutoConfig || !autoExecutionStatus) return;
    if (autoExecutionStatus.config.executionMode === mode && autoExecutionStatus.config.enabled) {
      return;
    }
    setAutoErr(null);
    setAutoBusy(true);
    const res = await onUpdateAutoConfig({
      enabled: true,
      executionMode: mode,
    });
    setAutoBusy(false);
    if (!res.ok) {
      setAutoErr(res.error || t('auto.err.updateFailed'));
    }
  };

  const handleToggleAuto = async () => {
    if (!onUpdateAutoConfig || !autoExecutionStatus) return;
    setAutoErr(null);
    setAutoBusy(true);
    const res = await onUpdateAutoConfig({
      enabled: !autoExecutionStatus.config.enabled,
    });
    setAutoBusy(false);
    if (!res.ok) {
      setAutoErr(res.error || t('auto.err.updateFailed'));
    }
  };

  const handleTriggerCycle = async () => {
    if (!onRunAutoCycle) return;
    setAutoErr(null);
    setAutoCycleBusy(true);
    const res = await onRunAutoCycle();
    setAutoCycleBusy(false);
    if (!res.ok) {
      setAutoErr(res.error || t('auto.err.actionFailed'));
    }
  };

  const handleProposalAction = async (id: string, kind: 'approve' | 'reject') => {
    const fn = kind === 'approve' ? onApproveAutoProposal : onRejectAutoProposal;
    if (!fn) return;
    setAutoErr(null);
    setProposalBusyId(id);
    const res = await fn(id);
    setProposalBusyId(null);
    if (!res.ok) {
      setAutoErr(res.error || t('auto.err.actionFailed'));
    }
  };

  return (
    <div ref={panelRef} className="relative flex items-center">
      {/* Unified Split Action Control: [RUN Primary] + [Synced Auto-Pilot Status & Config] */}
      <div className="flex items-center overflow-hidden rounded-lg border border-cyan-400/50 bg-[#0B1424] shadow-lg">
        <button
          type="button"
          disabled={running || tickers.length === 0 || isEmergency}
          onClick={() => onExecuteRun()}
          aria-label={t('smartRun.ariaExecute')}
          data-testid="smart-run-execute-btn"
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
          data-testid="smart-run-dropdown-btn"
          className="flex min-h-[38px] items-center gap-1.5 border-l border-slate-800 bg-[#0E182B] px-2.5 text-cyan-300 transition-colors hover:bg-slate-800 whitespace-nowrap"
        >
          {autoExecutionStatus && (
            <span
              data-testid="smart-run-auto-pill"
              className="flex items-center gap-1 font-mono text-[10px] font-semibold"
            >
              <span
                aria-hidden="true"
                className={`h-2 w-2 rounded-full ${
                  isEmergency
                    ? 'bg-rose-400'
                    : isAutoArmed
                      ? 'bg-emerald-400 animate-pulse'
                      : 'bg-slate-500'
                }`}
              />
              <span className={isAutoArmed ? 'text-emerald-300' : 'text-slate-400'}>
                {isAutoArmed ? t('smartRun.autoActiveBadge') : t('smartRun.autoStandbyBadge')}
              </span>
              {pendingProposals.length > 0 && (
                <span className="rounded bg-amber-500/20 px-1 text-[10px] font-bold text-amber-300">
                  {pendingProposals.length}
                </span>
              )}
            </span>
          )}
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Unified AI + 9-Gate Auto-Pilot Command Popover */}
      {open && (
        <div
          role="dialog"
          aria-label={t('smartRun.dialogAria')}
          data-testid="smart-run-unified-popover"
          className="fixed inset-x-3 top-14 z-50 max-h-[84dvh] overflow-y-auto rounded-2xl border border-slate-700/90 bg-[#0B111D] p-4 shadow-2xl sm:absolute sm:inset-x-auto sm:top-11 sm:right-0 sm:w-[420px]"
        >
          {/* Unified Header */}
          <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles className="h-4 w-4 shrink-0 text-cyan-400" />
              <h3 className="truncate font-display text-sm font-semibold text-slate-100">
                {t('smartRun.unifiedTitle')}
              </h3>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 font-mono text-[10px] text-cyan-300">
                {tradingMode}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t('app.drawer.closeAria')}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Section 1: Sole Unified 9-Gate Auto-Pilot Control Hub */}
          {autoExecutionStatus && (
            <div
              data-testid="smart-run-auto-section"
              className="mt-3 rounded-xl border border-slate-800 bg-[#070B12] p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Bot className="h-3.5 w-3.5 text-cyan-400" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                    {t('smartRun.autoSectionTitle')}
                  </span>
                </div>
                <span
                  data-testid="smart-run-auto-state-badge"
                  className={`rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${autoBadgeClass}`}
                >
                  {autoStateLabel}
                </span>
              </div>

              {/* 1-Tap Autonomy Mode Switcher (Full-Auto vs Semi-Auto) */}
              {onUpdateAutoConfig && (
                <div className="mt-2.5 grid grid-cols-2 gap-1 rounded-lg border border-slate-800 bg-[#0B111D] p-0.5">
                  <button
                    type="button"
                    disabled={autoBusy || isEmergency}
                    onClick={() => handleSwitchAutoMode('FULL_AUTO')}
                    data-testid="smart-run-mode-full-btn"
                    className={`min-h-[30px] rounded-md px-2 text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                      autoMode === 'FULL_AUTO' && autoExecutionStatus.config.enabled
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : 'text-slate-400 hover:text-slate-200 border border-transparent'
                    }`}
                  >
                    Full-Auto
                  </button>
                  <button
                    type="button"
                    disabled={autoBusy || isEmergency}
                    onClick={() => handleSwitchAutoMode('SEMI_AUTO')}
                    data-testid="smart-run-mode-semi-btn"
                    className={`min-h-[30px] rounded-md px-2 text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                      autoMode === 'SEMI_AUTO' && autoExecutionStatus.config.enabled
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                        : 'text-slate-400 hover:text-slate-200 border border-transparent'
                    }`}
                  >
                    Semi-Auto
                  </button>
                </div>
              )}

              <p className="mt-2 text-[11px] leading-relaxed text-slate-300">
                {autoExecutionStatus.lastSummary}
              </p>

              <div className="mt-2 grid grid-cols-3 gap-1.5 font-mono text-[10px] tabular-nums">
                <div className="rounded-lg border border-slate-800/80 bg-[#0B111D] px-2 py-1.5">
                  <p className="font-sans text-[9px] text-slate-500">{t('auto.kpi.hourlyQuota')}</p>
                  <p className="mt-0.5 font-semibold text-slate-200">
                    {autoExecutionStatus.tradesExecutedLastHour}/{autoExecutionStatus.config.maxTradesPerHour}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-800/80 bg-[#0B111D] px-2 py-1.5">
                  <p className="font-sans text-[9px] text-slate-500">{t('auto.kpi.slots')}</p>
                  <p className="mt-0.5 font-semibold text-cyan-300">
                    {openPositionsCount}/{autoExecutionStatus.config.targetActivePositions} (max{' '}
                    {autoExecutionStatus.config.maxSimultaneousAutoPositions})
                  </p>
                </div>
                <div className="rounded-lg border border-slate-800/80 bg-[#0B111D] px-2 py-1.5">
                  <p className="font-sans text-[9px] text-slate-500">Gate Alpha/EV</p>
                  <p className="mt-0.5 font-semibold text-emerald-300">
                    ≥{autoExecutionStatus.config.minConfluenceScore} · +{autoExecutionStatus.config.minExpectedValueR}R
                  </p>
                </div>
              </div>

              <div className="mt-2.5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                {onUpdateAutoConfig && (
                  <button
                    type="button"
                    disabled={autoBusy || isEmergency}
                    onClick={handleToggleAuto}
                    data-testid="smart-run-auto-toggle-btn"
                    className={`flex min-h-[36px] flex-1 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors disabled:opacity-50 whitespace-nowrap ${
                      autoExecutionStatus.config.enabled
                        ? 'border-amber-500/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'
                        : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25'
                    }`}
                  >
                    {autoExecutionStatus.config.enabled ? (
                      <>
                        <Pause className="h-3.5 w-3.5" />
                        <span>{t('auto.btn.pause')}</span>
                      </>
                    ) : (
                      <>
                        <Play className="h-3.5 w-3.5" />
                        <span>
                          {autoMode === 'FULL_AUTO'
                            ? t('auto.btn.armFull')
                            : t('auto.btn.armSemi')}
                        </span>
                      </>
                    )}
                  </button>
                )}

                {onRunAutoCycle && (
                  <button
                    type="button"
                    disabled={autoCycleBusy || isEmergency}
                    onClick={handleTriggerCycle}
                    data-testid="smart-run-auto-cycle-btn"
                    className="flex min-h-[36px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-2.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50 whitespace-nowrap"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${autoCycleBusy ? 'animate-spin' : ''}`}
                    />
                    <span>
                      {autoCycleBusy ? t('auto.btn.runningCycle') : t('auto.btn.runCycle')}
                    </span>
                  </button>
                )}

                {onOpenAutoConfig && (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onOpenAutoConfig();
                    }}
                    data-testid="smart-run-auto-config-btn"
                    className="col-span-2 flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2.5 text-xs font-medium text-slate-200 hover:border-cyan-500/40 hover:text-cyan-200 sm:col-span-1 sm:flex-none whitespace-nowrap"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    <span>{t('auto.btn.configure')}</span>
                  </button>
                )}
              </div>

              {autoErr && (
                <p className="mt-2 rounded border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-300">
                  {autoErr}
                </p>
              )}

              {/* Compact Pending Semi-Auto Proposals */}
              {pendingProposals.length > 0 && (
                <div className="mt-2.5 space-y-2 border-t border-slate-800/80 pt-2.5">
                  <p className="text-[11px] font-semibold text-amber-300">
                    {t('auto.proposals.title', { count: pendingProposals.length })}
                  </p>
                  {pendingProposals.slice(0, 3).map((prop) => {
                    const busyProp = proposalBusyId === prop.id;
                    return (
                      <div
                        key={prop.id}
                        className="rounded-lg border border-slate-800 bg-[#0B111D] p-2 text-[11px]"
                      >
                        <div className="flex items-center justify-between gap-2 font-mono">
                          <span className="font-semibold text-slate-100">
                            {prop.side} {prop.symbol} ({prop.leverage}x)
                          </span>
                          <span className="text-cyan-300">{prop.exchange}</span>
                        </div>
                        <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                          {t('auto.proposals.metaRow', {
                            alpha: prop.compositeAlphaScore.toFixed(1),
                            ev: prop.expectedValueR.toFixed(2),
                            win: prop.winProbabilityPct.toFixed(0),
                            risk: prop.recommendedRiskPct.toFixed(2),
                            corr: prop.maxSameSideCorrelation.toFixed(2),
                          })}
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            type="button"
                            disabled={busyProp}
                            onClick={() => handleProposalAction(prop.id, 'approve')}
                            className="flex min-h-[32px] flex-1 items-center justify-center gap-1 rounded bg-emerald-600 px-2 text-[11px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            <span>
                              {busyProp
                                ? t('auto.proposals.approvingBtn')
                                : t('auto.proposals.approveBtn')}
                            </span>
                          </button>
                          <button
                            type="button"
                            disabled={busyProp}
                            onClick={() => handleProposalAction(prop.id, 'reject')}
                            className="flex min-h-[32px] items-center justify-center gap-1 rounded border border-slate-700 bg-slate-900 px-2.5 text-[11px] text-slate-300 hover:border-rose-500/50 hover:text-rose-300 disabled:opacity-50"
                          >
                            <XCircle className="h-3 w-3" />
                            <span>{t('auto.proposals.rejectBtn')}</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Section 2: Manual Smart RUN (19 Agents) */}
          <div className="mt-3.5 border-t border-slate-800 pt-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {t('smartRun.manualSectionTitle')}
            </p>

            {/* 3 Intelligent Run Modes */}
            <div className="space-y-2">
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
                      <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">
                        {opt.desc}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Gemini Toggle */}
            <div className="mt-3 space-y-2.5 border-t border-slate-800 pt-3">
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
                    {lastSummary.chosenExchange ? ` (${lastSummary.chosenExchange})` : ''} ·{' '}
                    {lastSummary.direction}
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
                disabled={running || tickers.length === 0 || isEmergency}
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
        </div>
      )}
    </div>
  );
};

