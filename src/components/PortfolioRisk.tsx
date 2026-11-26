import React, { useEffect, useState } from 'react';
import { GitBranch, OctagonAlert, Save, ShieldCheck } from 'lucide-react';
import type {
  AutoExecutionConfig,
  AutoExecutionEngineStatus,
  ClosePositionResponse,
  MarketType,
  OrderRecord,
  PnlHistoryPoint,
  PortfolioCorrelationGuard,
  PortfolioSummary,
  Position,
  RiskConfig,
  TradingMode,
} from '../engine/types';
import { formatSignedUsd } from '../engine/pnlHistory';
import { useI18n } from '../i18n/I18nContext';
import { ActivePositionsPanel } from './ActivePositionsPanel';
import { AutoTradePanel } from './AutoTradePanel';
import { PortfolioPnlD3Chart } from './PortfolioPnlD3Chart';

interface PortfolioRiskProps {
  portfolio: PortfolioSummary;
  positions: Position[];
  pnlHistory: PnlHistoryPoint[];
  orders: OrderRecord[];
  riskConfig: RiskConfig;
  correlationGuard?: PortfolioCorrelationGuard | null;
  tradingMode: TradingMode;
  onClosePosition: (id: string) => Promise<ClosePositionResponse | void> | void;
  onUpdateSlTp?: (id: string, stopLoss: number, takeProfit: number) => Promise<{ ok: boolean; error?: string }>;
  onInspectSymbol?: (symbol: string, marketType: MarketType, exchange?: string) => void;
  onSaveRiskConfig: (cfg: RiskConfig) => Promise<boolean | void>;
  onChangeMode: (mode: TradingMode) => Promise<void>;
  onEmergencyStop: () => Promise<void>;
  autoExecutionStatus?: AutoExecutionEngineStatus | null;
  onUpdateAutoConfig?: (partial: Partial<AutoExecutionConfig>) => Promise<{ ok: boolean; error?: string }>;
  onRunAutoCycle?: () => Promise<{ ok: boolean; error?: string }>;
  onApproveAutoProposal?: (id: string) => Promise<{ ok: boolean; error?: string }>;
  onRejectAutoProposal?: (id: string) => Promise<{ ok: boolean; error?: string }>;
}

export const PortfolioRisk: React.FC<PortfolioRiskProps> = ({
  portfolio,
  positions,
  pnlHistory,
  orders,
  riskConfig,
  correlationGuard = null,
  tradingMode,
  onClosePosition,
  onUpdateSlTp,
  onInspectSymbol,
  onSaveRiskConfig,
  onChangeMode,
  onEmergencyStop,
  autoExecutionStatus = null,
  onUpdateAutoConfig,
  onRunAutoCycle,
  onApproveAutoProposal,
  onRejectAutoProposal,
}) => {
  const { t } = useI18n();
  const [draft, setDraft] = useState<RiskConfig>(riskConfig);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    setDraft(riskConfig);
  }, [riskConfig]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedMsg(null);
    const saved = await onSaveRiskConfig(draft);
    setSaving(false);
    if (saved !== false) {
      setSavedMsg(t('port.riskSaved'));
    }
  };

  const modes: Array<{ id: TradingMode; label: string; desc: string }> = [
    { id: 'ANALYSIS_ONLY', label: t('port.mode.ANALYSIS_ONLY.title'), desc: t('port.mode.ANALYSIS_ONLY.desc') },
    { id: 'PAPER', label: t('port.mode.PAPER.title'), desc: t('port.mode.PAPER.desc') },
    { id: 'SEMI_AUTO', label: t('port.mode.SEMI_AUTO.title'), desc: t('port.mode.SEMI_AUTO.desc') },
    { id: 'FULL_AUTO', label: t('port.mode.FULL_AUTO.title'), desc: t('port.mode.FULL_AUTO.desc') },
  ];

  return (
    <div className="space-y-6">
      {/* Portfolio Metrics + Mode Controls */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-xl border border-slate-800/90 bg-[#0E1522] p-4 lg:col-span-7">
          <h2 className="font-display text-base font-semibold text-slate-100">
            {t('port.title', { mode: portfolio.mode })}
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 font-mono tabular-nums">
            <div>
              <p className="font-sans text-xs text-slate-400">{t('port.totalEquity')}</p>
              <p className="mt-1 text-xl font-semibold text-slate-50">
                ${portfolio.totalEquityUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </p>
            </div>
            <div>
              <p className="font-sans text-xs text-slate-400">{t('port.availableBal')}</p>
              <p className="mt-1 text-xl font-semibold text-slate-200">
                ${portfolio.availableBalanceUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </p>
            </div>
            <div>
              <p className="font-sans text-xs text-slate-400">{t('port.usedMargin')}</p>
              <p className="mt-1 text-xl font-semibold text-cyan-400">
                ${portfolio.usedMarginUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </p>
            </div>
            <div>
              <p className="font-sans text-xs text-slate-400">Realized PnL</p>
              <p
                className={`mt-1 text-base font-semibold ${
                  portfolio.realizedPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {formatSignedUsd(portfolio.realizedPnlUsd)}
              </p>
            </div>
            <div>
              <p className="font-sans text-xs text-slate-400">Unrealized PnL</p>
              <p
                className={`mt-1 text-base font-semibold ${
                  portfolio.unrealizedPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {formatSignedUsd(portfolio.unrealizedPnlUsd)}
              </p>
            </div>
            <div>
              <p className="font-sans text-xs text-slate-400">{t('port.drawdownFees')}</p>
              <p className="mt-1 text-base font-semibold text-amber-400">
                {portfolio.currentDrawdownPct}% · ${portfolio.totalFeesUsd.toFixed(2)}
              </p>
            </div>
          </div>
        </div>

        {/* Autonomous Trading Mode & Emergency Stop */}
        <div className="rounded-xl border border-slate-800/90 bg-[#0E1522] p-4 lg:col-span-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-slate-100">
              {t('port.modeTitle')}
            </h2>
            <span
              className={`font-mono text-xs font-semibold ${
                tradingMode === 'EMERGENCY_STOP' ? 'text-rose-400' : 'text-cyan-400'
              }`}
            >
              {tradingMode}
            </span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            {modes.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onChangeMode(m.id)}
                className={`min-h-[54px] rounded-lg border p-2.5 text-left transition-colors ${
                  tradingMode === m.id
                    ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200'
                    : 'border-slate-800 bg-[#0A101B] text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className="block text-xs font-semibold">{m.label}</span>
                <span className="mt-0.5 block text-[11px] opacity-80">{m.desc}</span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onEmergencyStop}
            className="mt-3 flex min-h-[46px] w-full items-center justify-center gap-2 rounded-lg border border-rose-500/50 bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500"
          >
            <OctagonAlert className="h-4 w-4" />
            <span>{t('port.emergencyBtn')}</span>
          </button>
        </div>
      </section>

      {/* Autonomous 9-Gate Auto-Execution Console */}
      {autoExecutionStatus &&
        onUpdateAutoConfig &&
        onRunAutoCycle &&
        onApproveAutoProposal &&
        onRejectAutoProposal && (
          <AutoTradePanel
            variant="full"
            status={autoExecutionStatus}
            onUpdateConfig={onUpdateAutoConfig}
            onRunCycle={onRunAutoCycle}
            onApproveProposal={onApproveAutoProposal}
            onRejectProposal={onRejectAutoProposal}
            openPositionsCount={positions.length}
          />
        )}

      {/* Real-Time D3.js Realized & Unrealized PnL Chart */}
      <PortfolioPnlD3Chart
        history={pnlHistory}
        currentRealizedUsd={portfolio.realizedPnlUsd}
        currentUnrealizedUsd={portfolio.unrealizedPnlUsd}
        currentEquityUsd={portfolio.totalEquityUsd}
        openPositionsCount={positions.length}
      />

      {/* Active Running Positions with Full Telemetry & SL/TP Controls */}
      <ActivePositionsPanel
        positions={positions}
        title={t('port.positionsTitle', { count: positions.length })}
        onClosePosition={onClosePosition}
        onUpdateSlTp={onUpdateSlTp}
        onInspectSymbol={onInspectSymbol}
      />

      {/* Cross-Asset Pearson Correlation Matrix & Concentration Guard */}
      <section className="rounded-xl border border-slate-800/90 bg-[#0E1522] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-cyan-400 shrink-0" />
            <div>
              <h2 className="font-display text-base font-semibold text-slate-100">
                {t('corr.title')}
              </h2>
              <p className="text-xs text-slate-400">{t('corr.subtitle')}</p>
            </div>
          </div>
          {correlationGuard && (
            <span
              className={`font-mono text-xs font-semibold ${
                correlationGuard.concentrationWarning === 'HIGH'
                  ? 'text-rose-400'
                  : correlationGuard.concentrationWarning === 'MODERATE'
                    ? 'text-amber-400'
                    : 'text-emerald-400'
              }`}
            >
              {t('corr.concentrationLabel')}: {correlationGuard.concentrationWarning}
            </span>
          )}
        </div>

        {correlationGuard && correlationGuard.pairs.length > 0 ? (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 font-mono tabular-nums">
              <div className="rounded-lg border border-slate-800 bg-[#070B12] px-3 py-2.5">
                <p className="font-sans text-[11px] text-slate-400">
                  {t('corr.diversificationLabel')}
                </p>
                <p className="mt-1 text-lg font-semibold text-cyan-300">
                  {correlationGuard.diversificationScore}/100
                </p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#070B12] px-3 py-2.5">
                <p className="font-sans text-[11px] text-slate-400">{t('corr.avgCorrLabel')}</p>
                <p className="mt-1 text-lg font-semibold text-slate-100">
                  {correlationGuard.averageAbsCorrelation.toFixed(3)}
                </p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#070B12] px-3 py-2.5">
                <p className="font-sans text-[11px] text-slate-400">{t('corr.netExposureLabel')}</p>
                <p className="mt-1 text-base font-semibold text-slate-100">
                  ${correlationGuard.netDirectionalExposureUsd.toLocaleString('en-US')} / $
                  {correlationGuard.grossExposureUsd.toLocaleString('en-US')}
                </p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#070B12] px-3 py-2.5">
                <p className="font-sans text-[11px] text-slate-400">
                  {t('corr.concentrationLabel')}
                </p>
                <p
                  className={`mt-1 text-base font-semibold ${
                    correlationGuard.concentrationWarning === 'HIGH'
                      ? 'text-rose-400'
                      : correlationGuard.concentrationWarning === 'MODERATE'
                        ? 'text-amber-400'
                        : 'text-emerald-400'
                  }`}
                >
                  {correlationGuard.concentrationWarning}
                </p>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2 pr-3 font-medium">{t('corr.pairCol')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('corr.rhoCol')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('corr.barsCol')}</th>
                    <th className="py-2 text-right font-medium">{t('corr.tierCol')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono tabular-nums">
                  {correlationGuard.pairs.map((p) => (
                    <tr key={`${p.symbolA}-${p.symbolB}`}>
                      <td className="py-2 pr-3 font-sans font-medium text-slate-100">
                        {p.symbolA} ↔ {p.symbolB}
                      </td>
                      <td
                        className={`py-2 pr-3 text-right font-semibold ${
                          Math.abs(p.correlation) >= 0.78
                            ? 'text-amber-400'
                            : p.correlation < 0
                              ? 'text-emerald-400'
                              : 'text-slate-200'
                        }`}
                      >
                        {p.correlation >= 0 ? '+' : ''}
                        {p.correlation.toFixed(3)}
                      </td>
                      <td className="py-2 pr-3 text-right text-slate-400">{p.overlapBars}</td>
                      <td
                        className={`py-2 text-right font-sans text-[11px] font-semibold ${
                          p.riskTier === 'HIGH_CONCENTRATION'
                            ? 'text-rose-400'
                            : p.riskTier === 'MODERATE'
                              ? 'text-amber-400'
                              : 'text-emerald-400'
                        }`}
                      >
                        {t(`corr.tier.${p.riskTier}`)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="py-6 text-center text-xs text-slate-400">{t('corr.empty')}</p>
        )}
      </section>

      {/* Deterministic Risk Config + Order Ledger */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <form
          onSubmit={handleSave}
          className="rounded-xl border border-slate-800/90 bg-[#0E1522] p-4 lg:col-span-5"
        >
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <h2 className="font-display text-base font-semibold text-slate-100">
              {t('port.riskTitle')}
            </h2>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="mb-1 block text-slate-400" htmlFor="rc-rtrade">
                {t('port.risk.perTrade')}
              </label>
              <input
                id="rc-rtrade"
                type="number"
                step={0.05}
                min={0.05}
                max={2}
                value={draft.riskPerTradePct}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (Number.isFinite(val)) setDraft({ ...draft, riskPerTradePct: val });
                }}
                className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-3 font-mono tabular-nums text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-slate-400" htmlFor="rc-maxr">
                {t('port.risk.maxTrade')}
              </label>
              <input
                id="rc-maxr"
                type="number"
                step={0.05}
                min={0.1}
                max={3}
                value={draft.maxRiskPerTradePct}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (Number.isFinite(val)) setDraft({ ...draft, maxRiskPerTradePct: val });
                }}
                className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-3 font-mono tabular-nums text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-slate-400" htmlFor="rc-daily">
                {t('port.risk.dailyLimit')}
              </label>
              <input
                id="rc-daily"
                type="number"
                step={0.1}
                min={0.5}
                max={10}
                value={draft.dailyLossLimitPct}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (Number.isFinite(val)) setDraft({ ...draft, dailyLossLimitPct: val });
                }}
                className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-3 font-mono tabular-nums text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-slate-400" htmlFor="rc-dd">
                {t('port.risk.maxDd')}
              </label>
              <input
                id="rc-dd"
                type="number"
                step={0.5}
                min={2}
                max={25}
                value={draft.maxDrawdownPct}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (Number.isFinite(val)) setDraft({ ...draft, maxDrawdownPct: val });
                }}
                className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-3 font-mono tabular-nums text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-slate-400" htmlFor="rc-lev">
                {t('port.risk.maxLev')}
              </label>
              <input
                id="rc-lev"
                type="number"
                min={1}
                max={10}
                value={draft.maxLeverage}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (Number.isFinite(val)) setDraft({ ...draft, maxLeverage: val });
                }}
                className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-3 font-mono tabular-nums text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-slate-400" htmlFor="rc-rr">
                {t('port.risk.minRr')}
              </label>
              <input
                id="rc-rr"
                type="number"
                step={0.1}
                min={1}
                max={5}
                value={draft.minRiskReward}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (Number.isFinite(val)) setDraft({ ...draft, minRiskReward: val });
                }}
                className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-3 font-mono tabular-nums text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-slate-400" htmlFor="rc-maxpos">
                {t('port.risk.maxPos')}
              </label>
              <input
                id="rc-maxpos"
                type="number"
                min={1}
                max={10}
                value={draft.maxOpenPositions}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (Number.isFinite(val)) setDraft({ ...draft, maxOpenPositions: val });
                }}
                className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-3 font-mono tabular-nums text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-slate-400" htmlFor="rc-asset-exp">
                {t('port.risk.maxExposure')}
              </label>
              <input
                id="rc-asset-exp"
                type="number"
                min={10}
                max={50}
                step={5}
                value={draft.maxSingleAssetExposurePct}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (Number.isFinite(val)) setDraft({ ...draft, maxSingleAssetExposurePct: val });
                }}
                className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#070B12] px-3 font-mono tabular-nums text-slate-100"
              />
            </div>
          </div>

          {savedMsg && <p className="mt-3 text-xs text-emerald-400">{savedMsg}</p>}

          <button
            type="submit"
            disabled={saving}
            className="mt-4 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-700"
          >
            <Save className="h-3.5 w-3.5" />
            <span>{saving ? t('port.risk.savingBtn') : t('port.risk.saveBtn')}</span>
          </button>
        </form>

        <div className="rounded-xl border border-slate-800/90 bg-[#0E1522] p-4 lg:col-span-7">
          <h2 className="mb-3 font-display text-base font-semibold text-slate-100">
            {t('port.ordersTitle', { count: orders.length })}
          </h2>
          {orders.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-400">
              {t('port.ordersEmpty')}
            </p>
          ) : (
            <div className="max-h-80 overflow-x-auto overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2 pr-3 font-medium">{t('port.thTime')}</th>
                    <th className="py-2 pr-3 font-medium">{t('port.thPairStrat')}</th>
                    <th className="py-2 pr-3 font-medium">{t('port.thOrderQty')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('port.thPriceLevels')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('port.thFeeSlip')}</th>
                    <th className="py-2 text-right font-medium">{t('port.thRiskStatus')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono tabular-nums">
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <td className="py-2.5 pr-3 text-slate-400 whitespace-nowrap">
                        {o.createdAtUtc.slice(11, 19)}
                      </td>
                      <td className="py-2.5 pr-3 font-sans">
                        <span className="font-semibold text-slate-100">{o.symbol}</span>
                        <span className="block text-[10px] text-slate-500">
                          {o.exchange} · {o.leverage}x · {o.strategyName}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        <span
                          className={`font-semibold ${
                            o.side === 'LONG' ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {o.side} · {o.orderType}
                        </span>
                        <span className="block text-[10px] text-slate-400">
                          {t('port.qtyPrefix')} {o.quantity}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-right whitespace-nowrap">
                        <span className="text-slate-100">${o.price}</span>
                        <span className="block text-[10px] text-slate-400">
                          SL {o.stopLoss} / TP {o.takeProfit}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-right text-slate-400 whitespace-nowrap">
                        ${o.feesUsd.toFixed(2)} / ${o.slippageUsd.toFixed(2)}
                      </td>
                      <td className="py-2.5 text-right whitespace-nowrap">
                        <span
                          className={`font-semibold ${
                            o.status === 'FILLED' ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {o.status}
                        </span>
                        <span className="block text-[10px] text-slate-400">
                          {o.riskDecision}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
