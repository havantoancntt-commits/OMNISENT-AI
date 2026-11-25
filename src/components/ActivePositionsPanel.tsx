import React, { useEffect, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  Check,
  LineChart,
  Shield,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { computePositionTelemetry } from '../engine/positionMetrics';
import type { MarketType, Position } from '../engine/types';
import { useI18n } from '../i18n/I18nContext';

interface ActivePositionsPanelProps {
  positions: Position[];
  title?: string;
  compactHeaderAction?: {
    label: string;
    onClick: () => void;
  };
  onClosePosition: (id: string) => Promise<void> | void;
  onUpdateSlTp?: (
    id: string,
    stopLoss: number,
    takeProfit: number,
  ) => Promise<{ ok: boolean; error?: string }>;
  onInspectSymbol?: (symbol: string, marketType: MarketType, exchange?: string) => void;
  onGoToScanner?: () => void;
}

function formatPrice(value: number, decimals: number): string {
  if (!Number.isFinite(value) || value <= 0) return '--';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export const ActivePositionsPanel: React.FC<ActivePositionsPanelProps> = ({
  positions,
  title,
  compactHeaderAction,
  onClosePosition,
  onUpdateSlTp,
  onInspectSymbol,
  onGoToScanner,
}) => {
  const { t } = useI18n();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftSl, setDraftSl] = useState('');
  const [draftTp, setDraftTp] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Refresh elapsed open duration every 15s while trades are active
  useEffect(() => {
    if (positions.length === 0) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, [positions.length]);

  const totalNotional = positions.reduce(
    (sum, p) => sum + p.quantity * (p.markPrice > 0 ? p.markPrice : p.entryPrice),
    0,
  );
  const totalMargin = positions.reduce((sum, p) => sum + p.marginUsd, 0);
  const totalUnrealized = positions.reduce((sum, p) => sum + p.unrealizedPnlUsd, 0);

  const openEditor = (p: Position, decimals: number) => {
    if (editingId === p.id) {
      setEditingId(null);
      setEditError(null);
      return;
    }
    setEditingId(p.id);
    setDraftSl(p.stopLoss.toFixed(decimals));
    setDraftTp(p.takeProfit.toFixed(decimals));
    setEditError(null);
  };

  const handleSaveSlTp = async (p: Position) => {
    if (!onUpdateSlTp) return;
    setBusyId(p.id);
    setEditError(null);
    const res = await onUpdateSlTp(p.id, Number(draftSl), Number(draftTp));
    setBusyId(null);
    if (!res.ok) {
      setEditError(res.error || t('pos.err.updateSlTp'));
    } else {
      setEditingId(null);
    }
  };

  const handleMoveBreakeven = async (p: Position) => {
    if (!onUpdateSlTp) return;
    setBusyId(p.id);
    setEditError(null);
    const res = await onUpdateSlTp(p.id, p.entryPrice, p.takeProfit);
    setBusyId(null);
    if (!res.ok) {
      setEditingId(p.id);
      setDraftSl(String(p.stopLoss));
      setDraftTp(String(p.takeProfit));
      setEditError(res.error || t('pos.err.breakeven'));
    }
  };

  const handleClose = async (id: string) => {
    setBusyId(id);
    await onClosePosition(id);
    setBusyId(null);
  };

  const healthMeta = (
    state: ReturnType<typeof computePositionTelemetry>['healthState'],
  ) => {
    switch (state) {
      case 'NEAR_TP':
        return { label: t('pos.health.NEAR_TP'), cls: 'text-emerald-300' };
      case 'IN_PROFIT':
        return { label: t('pos.health.IN_PROFIT'), cls: 'text-emerald-400' };
      case 'NEAR_SL':
        return { label: t('pos.health.NEAR_SL'), cls: 'text-rose-400' };
      default:
        return { label: t('pos.health.MONITORING'), cls: 'text-cyan-300' };
    }
  };

  return (
    <section
      aria-label={t('pos.ariaSection')}
      className="rounded-xl border border-slate-800/90 bg-[#0E1522] p-4 sm:p-5"
    >
      {/* Header & Live Aggregate Telemetry */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-100">
            {title ?? t('pos.defaultTitle', { count: positions.length })}
          </h2>
          {positions.length > 0 ? (
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs tabular-nums text-slate-400">
              <span>
                {t('pos.notionalLabel')}{' '}
                <strong className="text-slate-200">
                  ${totalNotional.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {t('pos.marginLabel')}{' '}
                <strong className="text-slate-200">
                  ${totalMargin.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {t('pos.netPnlLabel')}{' '}
                <strong
                  className={
                    totalUnrealized >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }
                >
                  {totalUnrealized >= 0 ? '+' : ''}${totalUnrealized.toFixed(2)}
                </strong>
              </span>
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-slate-400">
              {t('pos.emptySubtitle')}
            </p>
          )}
        </div>

        {compactHeaderAction && (
          <button
            type="button"
            onClick={compactHeaderAction.onClick}
            className="flex min-h-[38px] shrink-0 items-center gap-1 text-xs font-medium text-cyan-400 whitespace-nowrap hover:text-cyan-300"
          >
            <span>{compactHeaderAction.label}</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {positions.length === 0 ? (
        <div className="mt-4 flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-800 py-8 px-4 text-center">
          <Activity className="mb-2 h-6 w-6 text-slate-500" />
          <p className="text-xs text-slate-300">
            {t('pos.emptyTitle')}
          </p>
          <p className="mt-1 max-w-md text-[11px] text-slate-500">
            {t('pos.emptyDesc')}
          </p>
          {onGoToScanner && (
            <button
              type="button"
              onClick={onGoToScanner}
              className="mt-3 flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-cyan-300 whitespace-nowrap hover:border-cyan-500/50"
            >
              <LineChart className="h-3.5 w-3.5" />
              <span>{t('pos.openScannerBtn')}</span>
            </button>
          )}
        </div>
      ) : (
        <div className="divide-y divide-slate-800/80">
          {positions.map((p) => {
            const tel = computePositionTelemetry(p, nowMs);
            const isLong = p.side === 'LONG';
            const pnlPositive = p.unrealizedPnlUsd >= 0;
            const health = healthMeta(tel.healthState);
            const isEditing = editingId === p.id;
            const isBusy = busyId === p.id;

            const fillLeft = Math.min(tel.entryTrackPct, tel.markTrackPct);
            const fillWidth = Math.max(1.5, Math.abs(tel.markTrackPct - tel.entryTrackPct));
            const inProfitZone =
              (isLong && p.markPrice >= p.entryPrice) ||
              (!isLong && p.markPrice <= p.entryPrice);

            return (
              <article key={p.id} className="py-4 first:pt-4 last:pb-1 space-y-3">
                {/* Row 1: Symbol, Side, Metadata & Live PnL / R-Multiple */}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <span
                        className={`inline-flex items-center gap-1 font-mono text-xs font-bold ${
                          isLong ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {isLong ? (
                          <TrendingUp className="h-3.5 w-3.5" />
                        ) : (
                          <TrendingDown className="h-3.5 w-3.5" />
                        )}
                        {p.side}
                      </span>
                      <span className="font-display text-base font-bold text-slate-50">
                        {p.symbol}
                      </span>
                      <span className="font-mono text-xs font-semibold text-cyan-300 tabular-nums">
                        {p.leverage}x
                      </span>
                      <span className="text-xs text-slate-400">
                        {p.exchange} · {p.marketType} · {p.mode}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-[11px] text-slate-400">
                      {t('pos.strategyLabel')} <span className="text-slate-300">{p.strategyName}</span>
                      {' · '}
                      {t('pos.openedAgo', {
                        duration: tel.heldDurationLabel,
                        time: p.openedAtUtc.slice(11, 19),
                      })}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 sm:text-right sm:block">
                    <p
                      className={`font-mono text-base font-bold tabular-nums sm:text-lg ${
                        pnlPositive ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {pnlPositive ? '+' : ''}${p.unrealizedPnlUsd.toFixed(2)}{' '}
                      <span className="text-xs font-semibold">
                        ({pnlPositive ? '+' : ''}{p.unrealizedPnlPct.toFixed(2)}% ROE)
                      </span>
                    </p>
                    <p className="mt-0.5 flex items-center gap-2 font-mono text-[11px] tabular-nums sm:justify-end">
                      <span className={tel.rMultiple >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
                        {tel.rMultiple >= 0 ? '+' : ''}{tel.rMultiple.toFixed(2)}R
                      </span>
                      <span className="text-slate-600" aria-hidden="true">·</span>
                      <span className={`font-sans font-medium ${health.cls}`}>
                        {health.label}
                      </span>
                    </p>
                  </div>
                </div>

                {/* Row 2: Live SL ↔ Entry ↔ Mark ↔ TP Trajectory Bar */}
                <div className="rounded-lg border border-slate-800/70 bg-[#090F1A] px-3 py-2.5">
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] tabular-nums">
                    <span
                      className={
                        (isLong && p.stopLoss > p.entryPrice) ||
                        (!isLong && p.stopLoss < p.entryPrice)
                          ? 'text-emerald-400'
                          : 'text-rose-400'
                      }
                    >
                      SL ${formatPrice(p.stopLoss, tel.priceDecimals)}{' '}
                      <span className="text-slate-400">
                        {(isLong && p.stopLoss > p.entryPrice * 1.003) ||
                        (!isLong && p.stopLoss < p.entryPrice * 0.997)
                          ? t('pos.traj.profitLocked')
                          : (isLong && p.stopLoss >= p.entryPrice) ||
                              (!isLong && p.stopLoss <= p.entryPrice)
                            ? t('pos.traj.breakeven')
                            : tel.slDistancePct >= 0
                              ? `(-${tel.slDistancePct}%)`
                              : t('pos.traj.slHit')}
                      </span>
                    </span>
                    <span className="text-slate-300">
                      Entry ${formatPrice(p.entryPrice, tel.priceDecimals)}
                      {' → '}
                      <strong className="text-cyan-300">
                        Mark ${formatPrice(p.markPrice, tel.priceDecimals)}
                      </strong>
                    </span>
                    <span className="text-emerald-400">
                      TP ${formatPrice(p.takeProfit, tel.priceDecimals)}{' '}
                      <span className="text-slate-500">(+{tel.tpDistancePct}%)</span>
                    </span>
                  </div>

                  <div
                    className="relative h-2 w-full overflow-hidden rounded-full bg-slate-800"
                    role="progressbar"
                    aria-label={t('pos.traj.ariaProgress', { symbol: p.symbol })}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(tel.markTrackPct)}
                  >
                    {/* Active delta segment from Entry to Mark */}
                    <div
                      className={`absolute top-0 bottom-0 transition-all duration-300 ${
                        inProfitZone ? 'bg-emerald-500/80' : 'bg-rose-500/80'
                      }`}
                      style={{ left: `${fillLeft}%`, width: `${fillWidth}%` }}
                    />
                    {/* Entry anchor tick */}
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-slate-300"
                      style={{ left: `${tel.entryTrackPct}%` }}
                      title={`Entry $${p.entryPrice}`}
                    />
                    {/* Live Mark marker */}
                    <div
                      className="absolute top-0 bottom-0 w-1.5 -translate-x-1/2 rounded-full bg-cyan-300 shadow"
                      style={{ left: `${tel.markTrackPct}%` }}
                      title={`Mark $${p.markPrice}`}
                    />
                  </div>
                </div>

                {/* Row 3: Full Institutional Telemetry Grid */}
                <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3 lg:grid-cols-6 font-mono tabular-nums">
                  <div>
                    <p className="font-sans text-[11px] text-slate-500">{t('pos.col.quantity')}</p>
                    <p className="mt-0.5 font-semibold text-slate-200">{p.quantity}</p>
                  </div>
                  <div>
                    <p className="font-sans text-[11px] text-slate-500">{t('pos.col.notional')}</p>
                    <p className="mt-0.5 font-semibold text-slate-200">
                      ${tel.notionalUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div>
                    <p className="font-sans text-[11px] text-slate-500">{t('pos.col.marginLiq')}</p>
                    <p className="mt-0.5 font-semibold text-slate-200">
                      ${p.marginUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}{' '}
                      <span className="text-[11px] font-normal text-amber-300 whitespace-nowrap">
                        {p.liquidationPrice
                          ? `· Liq $${formatPrice(p.liquidationPrice, tel.priceDecimals)}`
                          : p.marketType === 'SPOT'
                            ? '· Spot'
                            : `· ${t('pos.noLiq')}`}
                      </span>
                    </p>
                  </div>
                  <div>
                    <p className="font-sans text-[11px] text-slate-500">{t('pos.col.maxRisk')}</p>
                    <p className="mt-0.5 font-semibold text-rose-400">
                      -${tel.riskUsd.toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="font-sans text-[11px] text-slate-500">{t('pos.col.tpRr')}</p>
                    <p className="mt-0.5 font-semibold text-emerald-400 whitespace-nowrap">
                      +${tel.rewardUsd.toFixed(2)}{' '}
                      <span className="text-slate-400 font-normal">({tel.plannedRR}R)</span>
                    </p>
                  </div>
                  <div>
                    <p className="font-sans text-[11px] text-slate-500">{t('pos.col.liqBuffer')}</p>
                    <p className="mt-0.5 truncate text-slate-300">
                      {tel.liqDistancePct !== null ? `${tel.liqDistancePct}% · ` : ''}
                      {p.id.slice(0, 11)}
                    </p>
                  </div>
                </div>

                {/* Row 4: Smart Interactive Actions */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {onInspectSymbol && (
                    <button
                      type="button"
                      onClick={() => onInspectSymbol(p.symbol, p.marketType, p.exchange)}
                      className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 whitespace-nowrap shrink-0 hover:border-cyan-500/50 hover:text-cyan-300"
                    >
                      <LineChart className="h-3.5 w-3.5" />
                      <span>{t('pos.btn.viewChart')}</span>
                    </button>
                  )}

                  {onUpdateSlTp && (
                    <button
                      type="button"
                      disabled={!tel.canMoveBreakeven || isBusy}
                      onClick={() => handleMoveBreakeven(p)}
                      title={
                        tel.canMoveBreakeven
                          ? t('pos.btn.breakevenTipReady')
                          : t('pos.btn.breakevenTipWait')
                      }
                      className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-emerald-300 whitespace-nowrap shrink-0 hover:border-emerald-500/50 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Shield className="h-3.5 w-3.5" />
                      <span>{t('pos.btn.breakeven')}</span>
                    </button>
                  )}

                  {onUpdateSlTp && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => openEditor(p, tel.priceDecimals)}
                      className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 whitespace-nowrap shrink-0 hover:border-cyan-500/50 hover:text-cyan-300"
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      <span>{isEditing ? t('pos.btn.closeEdit') : t('pos.btn.editSlTp')}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleClose(p.id)}
                    className="ml-auto flex min-h-[38px] items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-1.5 text-xs font-semibold text-rose-200 whitespace-nowrap shrink-0 hover:bg-rose-500/25 disabled:opacity-50"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    <span>{isBusy ? t('pos.btn.closing') : t('pos.btn.closePosition')}</span>
                  </button>
                </div>

                {/* Inline SL / TP Editor */}
                {isEditing && onUpdateSlTp && (
                  <div className="rounded-lg border border-cyan-500/30 bg-[#080E18] p-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
                      <div>
                        <label
                          htmlFor={`sl-edit-${p.id}`}
                          className="mb-1 block text-[11px] text-slate-400"
                        >
                          {t('pos.editor.newSl')}
                        </label>
                        <input
                          id={`sl-edit-${p.id}`}
                          type="number"
                          step="any"
                          value={draftSl}
                          onChange={(e) => setDraftSl(e.target.value)}
                          className="min-h-[40px] w-full rounded-lg border border-slate-700 bg-[#070B12] px-3 font-mono text-xs tabular-nums text-slate-100 focus:border-cyan-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor={`tp-edit-${p.id}`}
                          className="mb-1 block text-[11px] text-slate-400"
                        >
                          {t('pos.editor.newTp')}
                        </label>
                        <input
                          id={`tp-edit-${p.id}`}
                          type="number"
                          step="any"
                          value={draftTp}
                          onChange={(e) => setDraftTp(e.target.value)}
                          className="min-h-[40px] w-full rounded-lg border border-slate-700 bg-[#070B12] px-3 font-mono text-xs tabular-nums text-slate-100 focus:border-cyan-500 focus:outline-none"
                        />
                      </div>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleSaveSlTp(p)}
                        className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg bg-cyan-600 px-4 text-xs font-semibold text-white whitespace-nowrap hover:bg-cyan-500 disabled:opacity-50"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>{t('pos.editor.saveBtn')}</span>
                      </button>
                    </div>
                    {editError && (
                      <p className="mt-2 text-xs text-rose-400">{editError}</p>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};
