import React, { useEffect, useState } from 'react';
import {
  Activity,
  Bot,
  CheckCircle2,
  Clock,
  Pause,
  Play,
  RefreshCw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  XCircle,
  Zap,
} from 'lucide-react';
import { formatAssetPrice } from '../engine/symbolSearch';
import type {
  AutoExecutionConfig,
  AutoExecutionEngineStatus,
  AutoExecutionSubMode,
} from '../engine/types';
import { useI18n } from '../i18n/I18nContext';

interface AutoTradePanelProps {
  variant: 'compact' | 'full';
  status: AutoExecutionEngineStatus | null;
  onUpdateConfig: (partial: Partial<AutoExecutionConfig>) => Promise<{ ok: boolean; error?: string }>;
  onRunCycle: () => Promise<{ ok: boolean; error?: string }>;
  onApproveProposal: (id: string) => Promise<{ ok: boolean; error?: string }>;
  onRejectProposal: (id: string) => Promise<{ ok: boolean; error?: string }>;
  onOpenFullConfig?: () => void;
  openPositionsCount: number;
}

export const AutoTradePanel: React.FC<AutoTradePanelProps> = ({
  variant,
  status,
  onUpdateConfig,
  onRunCycle,
  onApproveProposal,
  onRejectProposal,
  onOpenFullConfig,
  openPositionsCount,
}) => {
  const { t } = useI18n();
  const [draft, setDraft] = useState<AutoExecutionConfig | null>(status?.config ?? null);
  const [saving, setSaving] = useState(false);
  const [runningCycle, setRunningCycle] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (status?.config) {
      setDraft(status.config);
    }
  }, [status?.config]);

  if (!status || !draft) {
    return null;
  }

  const isEmergency = status.tradingMode === 'EMERGENCY_STOP';
  const isArmed = status.engineRunning;
  const activeCooldownCount = Object.keys(status.symbolCooldowns).length;

  const badgeStateLabel = isEmergency
    ? t('auto.state.emergency')
    : isArmed && status.config.executionMode === 'FULL_AUTO'
      ? t('auto.state.fullAuto')
      : isArmed
        ? t('auto.state.semiAuto')
        : t('auto.state.standby');

  const badgeColorClass = isEmergency
    ? 'border-rose-500/40 bg-rose-500/15 text-rose-300'
    : isArmed && status.config.executionMode === 'FULL_AUTO'
      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
      : isArmed
        ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300'
        : 'border-slate-700 bg-slate-900 text-slate-300';

  const handleToggleArm = async (targetSubMode?: AutoExecutionSubMode) => {
    setFeedback(null);
    setSaving(true);
    const nextEnabled = targetSubMode ? true : !status.config.enabled;
    const nextMode = targetSubMode ?? status.config.executionMode;
    const res = await onUpdateConfig({ enabled: nextEnabled, executionMode: nextMode });
    setSaving(false);
    if (!res.ok) {
      setFeedback({ kind: 'err', text: res.error || t('auto.err.updateFailed') });
    }
  };

  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setSaving(true);
    const res = await onUpdateConfig(draft);
    setSaving(false);
    if (!res.ok) {
      setFeedback({ kind: 'err', text: res.error || t('auto.err.updateFailed') });
    } else {
      setFeedback({ kind: 'ok', text: t('auto.policySaved') });
    }
  };

  const handleRunCycle = async () => {
    setFeedback(null);
    setRunningCycle(true);
    const res = await onRunCycle();
    setRunningCycle(false);
    if (!res.ok) {
      setFeedback({ kind: 'err', text: res.error || t('auto.err.actionFailed') });
    }
  };

  const handleApprove = async (id: string) => {
    setFeedback(null);
    setProcessingId(id);
    const res = await onApproveProposal(id);
    setProcessingId(null);
    if (!res.ok) {
      setFeedback({ kind: 'err', text: res.error || t('auto.err.actionFailed') });
    }
  };

  const handleReject = async (id: string) => {
    setFeedback(null);
    setProcessingId(id);
    const res = await onRejectProposal(id);
    setProcessingId(null);
    if (!res.ok) {
      setFeedback({ kind: 'err', text: res.error || t('auto.err.actionFailed') });
    }
  };

  if (variant === 'compact') {
    return (
      <section
        aria-label={t('auto.compactTitle')}
        data-testid="auto-trade-compact"
        className="rounded-xl border border-slate-800/90 bg-[#0E1522] p-4"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Bot className="h-4 w-4 shrink-0 text-cyan-400" />
              <h2 className="font-display text-sm font-semibold text-slate-100 sm:text-base">
                {t('auto.compactTitle')}
              </h2>
              <span
                className={`rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold ${badgeColorClass}`}
              >
                {badgeStateLabel}
              </span>
              {status.pendingProposals.length > 0 && (
                <span className="rounded-md border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-300">
                  {t('auto.kpi.pendingCount', { count: status.pendingProposals.length })}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-300">{status.lastSummary}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] tabular-nums text-slate-400">
              <span>
                {t('auto.kpi.hourlyQuota')}: {status.tradesExecutedLastHour}/{status.config.maxTradesPerHour}
              </span>
              <span>
                {t('auto.kpi.slots')}: {openPositionsCount}/{status.config.targetActivePositions} (max{' '}
                {status.config.maxSimultaneousAutoPositions})
              </span>
              <span>
                Confluence ≥ {status.config.minConfluenceScore} · EV ≥ +{status.config.minExpectedValueR}R
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={saving || isEmergency}
              onClick={() => handleToggleArm(isArmed ? undefined : 'FULL_AUTO')}
              data-testid="auto-compact-toggle-btn"
              className={`flex min-h-[38px] items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors disabled:opacity-50 ${
                isArmed
                  ? 'border-amber-500/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'
                  : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
              }`}
            >
              {isArmed ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              <span>{isArmed ? t('auto.btn.pause') : t('auto.btn.armFull')}</span>
            </button>

            <button
              type="button"
              disabled={runningCycle || status.cycleInProgress || isEmergency}
              onClick={handleRunCycle}
              data-testid="auto-compact-cycle-btn"
              className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 text-xs font-semibold text-cyan-200 transition-colors hover:bg-cyan-500/25 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${runningCycle ? 'animate-spin' : ''}`} />
              <span>{runningCycle ? t('auto.btn.runningCycle') : t('auto.btn.runCycle')}</span>
            </button>

            {onOpenFullConfig && (
              <button
                type="button"
                onClick={onOpenFullConfig}
                data-testid="auto-compact-config-btn"
                className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-700 bg-[#070B12] px-3 text-xs font-medium text-slate-200 hover:border-cyan-500/40"
              >
                <SlidersHorizontal className="h-3.5 w-3.5 text-cyan-400" />
                <span>{t('auto.btn.configure')}</span>
              </button>
            )}
          </div>
        </div>

        {feedback && (
          <p
            className={`mt-2.5 rounded-lg border px-3 py-2 text-xs ${
              feedback.kind === 'err'
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
            }`}
          >
            {feedback.text}
          </p>
        )}

        {/* Inline 1-Click Pending SEMI_AUTO Proposals inside Command Center */}
        {status.pendingProposals.length > 0 && (
          <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-2">
            {status.pendingProposals.slice(0, 2).map((prop) => (
              <div
                key={prop.id}
                className="flex flex-col justify-between gap-2 rounded-lg border border-cyan-500/30 bg-[#070B12] p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 font-mono text-xs font-semibold">
                      <span className={prop.side === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}>
                        {prop.side}
                      </span>
                      <span className="text-slate-100">{prop.symbol}</span>
                      <span className="text-[11px] font-normal text-slate-400">
                        {prop.exchange} · {prop.leverage}x
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-[11px] tabular-nums text-slate-300">
                      Entry {formatAssetPrice(prop.entryPrice)} · SL {formatAssetPrice(prop.stopLoss)} · TP{' '}
                      {formatAssetPrice(prop.takeProfit)}
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] text-cyan-300">
                      {t('auto.proposals.metaRow', {
                        alpha: prop.compositeAlphaScore.toFixed(1),
                        ev: prop.expectedValueR.toFixed(2),
                        win: prop.winProbabilityPct.toFixed(0),
                        risk: prop.recommendedRiskPct.toFixed(2),
                        corr: prop.maxSameSideCorrelation.toFixed(2),
                      })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={processingId === prop.id}
                    onClick={() => handleApprove(prop.id)}
                    className="flex min-h-[34px] flex-1 items-center justify-center gap-1 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>
                      {processingId === prop.id
                        ? t('auto.proposals.approvingBtn')
                        : t('auto.proposals.approveBtn')}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={processingId === prop.id}
                    onClick={() => handleReject(prop.id)}
                    className="flex min-h-[34px] items-center justify-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-3 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    <span>{t('auto.proposals.rejectBtn')}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  }

  // FULL INSTITUTIONAL AUTO-EXECUTION DECK (Portfolio & Risk)
  return (
    <section
      aria-label={t('auto.title')}
      data-testid="auto-trade-full"
      className="rounded-xl border border-slate-800/90 bg-[#0E1522] p-4 sm:p-5"
    >
      {/* Header & Master Activation Controls */}
      <div className="flex flex-col gap-3 border-b border-slate-800/80 pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Bot className="h-5 w-5 text-cyan-400 shrink-0" />
            <h2 className="font-display text-base font-semibold text-slate-50 sm:text-lg">
              {t('auto.title')}
            </h2>
            <span
              className={`rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold ${badgeColorClass}`}
            >
              {badgeStateLabel}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-400">{t('auto.subtitle')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={saving || isEmergency}
            onClick={() => handleToggleArm('SEMI_AUTO')}
            data-testid="auto-arm-semi-btn"
            className={`flex min-h-[40px] items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors disabled:opacity-50 ${
              isArmed && status.config.executionMode === 'SEMI_AUTO'
                ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200'
                : 'border-slate-700 bg-[#070B12] text-slate-200 hover:border-cyan-500/50'
            }`}
          >
            <Zap className="h-3.5 w-3.5 text-cyan-400" />
            <span>{t('auto.btn.armSemi')}</span>
          </button>

          <button
            type="button"
            disabled={saving || isEmergency}
            onClick={() => handleToggleArm('FULL_AUTO')}
            data-testid="auto-arm-full-btn"
            className={`flex min-h-[40px] items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors disabled:opacity-50 ${
              isArmed && status.config.executionMode === 'FULL_AUTO'
                ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200'
                : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
            }`}
          >
            <Play className="h-3.5 w-3.5" />
            <span>{t('auto.btn.armFull')}</span>
          </button>

          {isArmed && (
            <button
              type="button"
              disabled={saving}
              onClick={() => handleToggleArm()}
              data-testid="auto-pause-btn"
              className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 text-xs font-semibold text-amber-200 hover:bg-amber-500/25"
            >
              <Pause className="h-3.5 w-3.5" />
              <span>{t('auto.btn.pause')}</span>
            </button>
          )}

          <button
            type="button"
            disabled={runningCycle || status.cycleInProgress || isEmergency}
            onClick={handleRunCycle}
            data-testid="auto-run-cycle-btn"
            className="flex min-h-[40px] items-center gap-1.5 rounded-lg bg-cyan-600 px-3.5 text-xs font-semibold text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${runningCycle ? 'animate-spin' : ''}`} />
            <span>{runningCycle ? t('auto.btn.runningCycle') : t('auto.btn.runCycle')}</span>
          </button>
        </div>
      </div>

      {/* Live Engine KPI Telemetry */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 font-mono tabular-nums">
        <div className="rounded-lg border border-slate-800 bg-[#070B12] px-3 py-2.5">
          <p className="font-sans text-[11px] text-slate-400">{t('auto.kpi.hourlyQuota')}</p>
          <p className="mt-1 text-base font-semibold text-cyan-300">
            {status.tradesExecutedLastHour} / {status.config.maxTradesPerHour}
          </p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-[#070B12] px-3 py-2.5">
          <p className="font-sans text-[11px] text-slate-400">{t('auto.kpi.slots')}</p>
          <p className="mt-1 text-base font-semibold text-slate-100">
            {openPositionsCount} / {status.config.targetActivePositions}{' '}
            <span className="text-xs font-normal text-slate-400">
              (max {status.config.maxSimultaneousAutoPositions})
            </span>
          </p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-[#070B12] px-3 py-2.5">
          <p className="font-sans text-[11px] text-slate-400">{t('auto.kpi.cooldowns')}</p>
          <p className="mt-1 text-base font-semibold text-amber-300">{activeCooldownCount}</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-[#070B12] px-3 py-2.5">
          <p className="font-sans text-[11px] text-slate-400">{t('auto.kpi.lastScan')}</p>
          <p className="mt-1 text-xs font-semibold text-emerald-400">
            {status.lastCycleAtUtc
              ? `${status.lastCycleAtUtc.slice(11, 19)} UTC (${status.lastScanDurationMs ?? 0}ms)`
              : 'Standby'}
          </p>
        </div>
      </div>

      <p className="mt-3 rounded-lg border border-slate-800 bg-[#070B12] px-3 py-2 text-xs text-slate-300">
        {status.lastSummary}
      </p>

      {feedback && (
        <p
          className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
            feedback.kind === 'err'
              ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
              : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
          }`}
        >
          {feedback.text}
        </p>
      )}

      {/* Policy Configuration & Quantitative Safeguard Toggles */}
      <form onSubmit={handleSavePolicy} className="mt-5 space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <button
            type="button"
            onClick={() => setDraft({ ...draft, executionMode: 'SEMI_AUTO' })}
            className={`rounded-xl border p-3 text-left transition-colors ${
              draft.executionMode === 'SEMI_AUTO'
                ? 'border-cyan-500/60 bg-cyan-500/10'
                : 'border-slate-800 bg-[#070B12] hover:border-slate-700'
            }`}
          >
            <p className="text-xs font-semibold text-slate-100">{t('auto.modeSemiTitle')}</p>
            <p className="mt-0.5 text-[11px] text-slate-400">{t('auto.modeSemiDesc')}</p>
          </button>
          <button
            type="button"
            onClick={() => setDraft({ ...draft, executionMode: 'FULL_AUTO' })}
            className={`rounded-xl border p-3 text-left transition-colors ${
              draft.executionMode === 'FULL_AUTO'
                ? 'border-emerald-500/60 bg-emerald-500/10'
                : 'border-slate-800 bg-[#070B12] hover:border-slate-700'
            }`}
          >
            <p className="text-xs font-semibold text-slate-100">{t('auto.modeFullTitle')}</p>
            <p className="mt-0.5 text-[11px] text-slate-400">{t('auto.modeFullDesc')}</p>
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="block text-[11px] text-slate-400">
              {t('auto.param.minConfluence')}
            </label>
            <input
              type="number"
              min={55}
              max={95}
              step={1}
              value={draft.minConfluenceScore}
              onChange={(e) =>
                setDraft({ ...draft, minConfluenceScore: Number(e.target.value) })
              }
              className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-2.5 font-mono text-xs text-slate-100"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-400">{t('auto.param.minEv')}</label>
            <input
              type="number"
              min={0.05}
              max={2.5}
              step={0.05}
              value={draft.minExpectedValueR}
              onChange={(e) =>
                setDraft({ ...draft, minExpectedValueR: Number(e.target.value) })
              }
              className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-2.5 font-mono text-xs text-slate-100"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-400">
              {t('auto.param.minWinProb')}
            </label>
            <input
              type="number"
              min={45}
              max={85}
              step={1}
              value={Math.round(draft.minWinProbability * 100)}
              onChange={(e) =>
                setDraft({ ...draft, minWinProbability: Number(e.target.value) / 100 })
              }
              className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-2.5 font-mono text-xs text-slate-100"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-400">{t('auto.param.minRr')}</label>
            <input
              type="number"
              min={1.5}
              max={5}
              step={0.1}
              value={draft.minRiskReward}
              onChange={(e) => setDraft({ ...draft, minRiskReward: Number(e.target.value) })}
              className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-2.5 font-mono text-xs text-slate-100"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-400">{t('auto.param.minVolM')}</label>
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              value={Math.round(draft.minVolume24hUsd / 1_000_000)}
              onChange={(e) =>
                setDraft({ ...draft, minVolume24hUsd: Number(e.target.value) * 1_000_000 })
              }
              className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-2.5 font-mono text-xs text-slate-100"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-400">
              {t('auto.param.intervalSec')}
            </label>
            <input
              type="number"
              min={15}
              max={300}
              step={5}
              value={draft.scanIntervalSeconds}
              onChange={(e) =>
                setDraft({ ...draft, scanIntervalSeconds: Number(e.target.value) })
              }
              className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-2.5 font-mono text-xs text-slate-100"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-400">
              {t('auto.param.cooldownMin')}
            </label>
            <input
              type="number"
              min={5}
              max={240}
              step={5}
              value={draft.cooldownMinutesPerSymbol}
              onChange={(e) =>
                setDraft({ ...draft, cooldownMinutesPerSymbol: Number(e.target.value) })
              }
              className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-2.5 font-mono text-xs text-slate-100"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-400">
              {t('auto.param.maxPerHour')}
            </label>
            <input
              type="number"
              min={1}
              max={12}
              step={1}
              value={draft.maxTradesPerHour}
              onChange={(e) =>
                setDraft({ ...draft, maxTradesPerHour: Number(e.target.value) })
              }
              className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-2.5 font-mono text-xs text-slate-100"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-400">{t('auto.param.maxSlots')}</label>
            <input
              type="number"
              min={1}
              max={6}
              step={1}
              value={draft.maxSimultaneousAutoPositions}
              onChange={(e) => {
                const nextMax = Math.max(1, Math.min(6, Number(e.target.value) || 1));
                setDraft({
                  ...draft,
                  maxSimultaneousAutoPositions: nextMax,
                  targetActivePositions: Math.min(draft.targetActivePositions, nextMax),
                });
              }}
              className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-2.5 font-mono text-xs text-slate-100"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-400">{t('auto.param.targetSlots')}</label>
            <input
              type="number"
              min={1}
              max={draft.maxSimultaneousAutoPositions}
              step={1}
              value={draft.targetActivePositions}
              data-testid="auto-target-slots-input"
              onChange={(e) =>
                setDraft({
                  ...draft,
                  targetActivePositions: Math.max(
                    1,
                    Math.min(draft.maxSimultaneousAutoPositions, Number(e.target.value) || 1),
                  ),
                })
              }
              className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-2.5 font-mono text-xs text-slate-100"
            />
          </div>
        </div>

        {/* Quantitative Safeguard Switches */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {[
            {
              key: 'requireHtfAlignment' as const,
              title: t('auto.guard.htfTitle'),
              desc: t('auto.guard.htfDesc'),
              fullWidth: false,
            },
            {
              key: 'avoidRandomWalkHurst' as const,
              title: t('auto.guard.hurstTitle'),
              desc: t('auto.guard.hurstDesc'),
              fullWidth: false,
            },
            {
              key: 'useKellyAdaptiveRisk' as const,
              title: t('auto.guard.kellyTitle'),
              desc: t('auto.guard.kellyDesc'),
              fullWidth: false,
            },
            {
              key: 'enforceCorrelationGuard' as const,
              title: t('auto.guard.corrTitle'),
              desc: t('auto.guard.corrDesc'),
              fullWidth: false,
            },
            {
              key: 'maintainActivePositions' as const,
              title: t('auto.guard.maintainTitle'),
              desc: t('auto.guard.maintainDesc'),
              fullWidth: true,
            },
          ].map((guard) => {
            const active = draft[guard.key];
            return (
              <label
                key={guard.key}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border border-slate-800 bg-[#070B12] p-3 hover:border-slate-700 ${
                  guard.fullWidth ? 'sm:col-span-2 border-cyan-500/30' : ''
                }`}
              >
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setDraft({ ...draft, [guard.key]: e.target.checked })}
                  className="mt-0.5 h-4 w-4 accent-cyan-500"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-slate-100">{guard.title}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">{guard.desc}</p>
                </div>
              </label>
            );
          })}
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            data-testid="auto-save-policy-btn"
            className="flex min-h-[42px] items-center gap-2 rounded-lg bg-cyan-600 px-4 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            <span>{saving ? t('auto.btn.savingPolicy') : t('auto.btn.savePolicy')}</span>
          </button>
        </div>
      </form>

      {/* Pending Proposal Queue & 9-Gate Activity Log */}
      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-[#070B12] p-3.5">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-cyan-400" />
            <h3 className="font-display text-sm font-semibold text-slate-100">
              {t('auto.proposals.title', { count: status.pendingProposals.length })}
            </h3>
          </div>
          {status.pendingProposals.length === 0 ? (
            <p className="py-5 text-center text-xs text-slate-500">{t('auto.proposals.empty')}</p>
          ) : (
            <div className="space-y-2.5">
              {status.pendingProposals.map((prop) => (
                <div
                  key={prop.id}
                  data-testid={`auto-proposal-${prop.id}`}
                  className="rounded-lg border border-slate-800 bg-[#0E1522] p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-mono text-xs font-semibold">
                      <span className={prop.side === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}>
                        {prop.side}
                      </span>
                      <span className="text-slate-100">{prop.symbol}</span>
                      <span className="text-[11px] font-normal text-slate-400">
                        {prop.exchange} · {prop.marketType} · {prop.leverage}x
                      </span>
                    </div>
                    <span className="font-mono text-[11px] text-amber-300">
                      {prop.htfAlignment}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-[11px] tabular-nums text-slate-300">
                    Entry {formatAssetPrice(prop.entryPrice)} · SL {formatAssetPrice(prop.stopLoss)} · TP{' '}
                    {formatAssetPrice(prop.takeProfit)}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-cyan-300">
                    {t('auto.proposals.metaRow', {
                      alpha: prop.compositeAlphaScore.toFixed(1),
                      ev: prop.expectedValueR.toFixed(2),
                      win: prop.winProbabilityPct.toFixed(0),
                      risk: prop.recommendedRiskPct.toFixed(2),
                      corr: prop.maxSameSideCorrelation.toFixed(2),
                    })}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">{prop.reasoningSummary}</p>
                  <div className="mt-2.5 flex items-center gap-2">
                    <button
                      type="button"
                      disabled={processingId === prop.id}
                      onClick={() => handleApprove(prop.id)}
                      className="flex min-h-[36px] flex-1 items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>
                        {processingId === prop.id
                          ? t('auto.proposals.approvingBtn')
                          : t('auto.proposals.approveBtn')}
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={processingId === prop.id}
                      onClick={() => handleReject(prop.id)}
                      className="flex min-h-[36px] items-center justify-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-3 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      <span>{t('auto.proposals.rejectBtn')}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#070B12] p-3.5">
          <div className="mb-3 flex items-center gap-2">
            <Activity className="h-4 w-4 text-cyan-400" />
            <h3 className="font-display text-sm font-semibold text-slate-100">
              {t('auto.activity.title', { count: status.recentActivity.length })}
            </h3>
          </div>
          {status.recentActivity.length === 0 ? (
            <p className="py-5 text-center text-xs text-slate-500">{t('auto.activity.empty')}</p>
          ) : (
            <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
              {status.recentActivity.map((act) => {
                const actionCls =
                  act.action === 'EXECUTED'
                    ? 'text-emerald-400'
                    : act.action === 'PROPOSED'
                      ? 'text-cyan-400'
                      : act.action === 'BLOCKED'
                        ? 'text-rose-400'
                        : 'text-amber-300';
                return (
                  <div
                    key={act.id}
                    className="rounded-lg border border-slate-800/80 bg-[#0E1522] px-3 py-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2 font-mono">
                      <span className="font-semibold text-slate-100">
                        {act.symbol} · {act.side}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {act.tier && (
                          <span
                            className={`rounded border px-1.5 py-0.5 text-[10px] ${
                              act.tier === 'CORE_9_GATE'
                                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                                : 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                            }`}
                          >
                            {act.tier === 'CORE_9_GATE' ? t('auto.tier.core') : t('auto.tier.tactical')}
                          </span>
                        )}
                        <span className={`text-[11px] font-semibold ${actionCls}`}>
                          {act.action}
                        </span>
                      </div>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-300">{act.reason}</p>
                    <p className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-slate-500">
                      <Clock className="h-3 w-3" />
                      <span>{act.timestampUtc.slice(11, 19)} UTC</span>
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
