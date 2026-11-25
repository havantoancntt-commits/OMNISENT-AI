import React from 'react';
import { ShieldCheck, Target } from 'lucide-react';
import { formatAssetPrice } from '../engine/symbolSearch';
import type { LiquidationRadarSnapshot, MarketType, OrderSide } from '../engine/types';
import { useI18n } from '../i18n/I18nContext';

interface LiquidationRadarPanelProps {
  radar: LiquidationRadarSnapshot;
  selectedSide: OrderSide;
  marketType: MarketType;
  onApplyZeroStopHunt: (side: OrderSide) => void;
}

export const LiquidationRadarPanel: React.FC<LiquidationRadarPanelProps> = ({
  radar,
  selectedSide,
  marketType,
  onApplyZeroStopHunt,
}) => {
  const { t } = useI18n();
  const effectiveSide: OrderSide = marketType === 'SPOT' ? 'LONG' : selectedSide;
  const recSl =
    effectiveSide === 'LONG' ? radar.recommendedLongSl : radar.recommendedShortSl;
  const recTp =
    effectiveSide === 'LONG' ? radar.recommendedLongTp : radar.recommendedShortTp;
  const adjusted =
    effectiveSide === 'LONG'
      ? radar.longClusterAdjustmentApplied
      : radar.shortClusterAdjustmentApplied;

  // Build visible horizontal price spectrum (+/- 6% around mark price)
  const minBound = radar.markPrice * 0.91;
  const maxBound = radar.markPrice * 1.09;
  const toTrackPct = (price: number): number => {
    const clamped = Math.max(minBound, Math.min(maxBound, price));
    return ((clamped - minBound) / Math.max(1e-12, maxBound - minBound)) * 100;
  };

  const markPos = toTrackPct(radar.markPrice);
  const slPos = toTrackPct(recSl);
  const tpPos = toTrackPct(recTp);

  const visibleClusters = radar.clusters
    .filter((c) => Math.abs(c.distancePct) <= 10.5)
    .sort((a, b) => b.intensityScore - a.intensityScore)
    .slice(0, 6);

  const riskColor =
    radar.stopHuntRiskScore >= 72
      ? 'text-rose-400'
      : radar.stopHuntRiskScore >= 48
        ? 'text-amber-300'
        : 'text-emerald-400';

  const biasColor =
    radar.fundingCrowdBias === 'CROWDED_LONGS'
      ? 'text-amber-300'
      : radar.fundingCrowdBias === 'CROWDED_SHORTS'
        ? 'text-cyan-300'
        : 'text-slate-200';

  return (
    <div
      className="rounded-xl border border-slate-800/90 bg-[#0E1522] p-4"
      data-testid="liquidation-radar-panel"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-sm font-semibold text-slate-100">
              {t('liqRadar.title')}
            </h3>
            {adjusted && (
              <span className="inline-flex items-center gap-1 rounded border border-emerald-500/35 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-emerald-300">
                <ShieldCheck className="h-3 w-3" />
                {t('liqRadar.appliedBadge')}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-400">{t('liqRadar.subtitle')}</p>
        </div>

        <button
          type="button"
          data-testid="apply-zero-stop-hunt-btn"
          onClick={() => onApplyZeroStopHunt(effectiveSide)}
          className="inline-flex min-h-[36px] shrink-0 items-center justify-center gap-1.5 rounded-lg border border-cyan-500/45 bg-cyan-500/15 px-3 text-xs font-semibold text-cyan-200 transition-colors hover:bg-cyan-500/25 whitespace-nowrap"
        >
          <Target className="h-3.5 w-3.5 text-cyan-300" />
          <span>{t('liqRadar.applyBtn', { side: effectiveSide })}</span>
        </button>
      </div>

      {/* 4-Column Quant Telemetry Strip */}
      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-800/80 pt-3 text-xs sm:grid-cols-4">
        <div>
          <p className="text-slate-400">{t('liqRadar.hazardScore')}</p>
          <p className={`font-mono text-sm font-semibold tabular-nums ${riskColor}`}>
            {radar.stopHuntRiskScore} / 100
          </p>
          <p className="mt-0.5 text-[10px] text-slate-400">
            {t(`liqRadar.sweep.${radar.dominantSweepDirection}`)}
          </p>
        </div>

        <div>
          <p className="text-slate-400">{t('liqRadar.crowdBias')}</p>
          <p className={`font-mono text-sm font-semibold tabular-nums ${biasColor}`}>
            {t(`liqRadar.bias.${radar.fundingCrowdBias}`)}
          </p>
          <p className="mt-0.5 font-mono text-[10px] tabular-nums text-slate-400">
            OI ${radar.openInterestUsdM}M ·{' '}
            {radar.fundingRatePct !== null ? `${radar.fundingRatePct.toFixed(4)}%` : 'SPOT'}
          </p>
        </div>

        <div>
          <p className="text-slate-400">{t('liqRadar.nearestLongLiq')}</p>
          <p className="font-mono text-sm font-semibold tabular-nums text-amber-300">
            {radar.nearestLongLiqPrice ? formatAssetPrice(radar.nearestLongLiqPrice) : '--'}
          </p>
          <p className="mt-0.5 font-mono text-[10px] tabular-nums text-slate-400">
            {t('liqRadar.safeSlTag', { side: effectiveSide })}: {formatAssetPrice(recSl)}
          </p>
        </div>

        <div>
          <p className="text-slate-400">{t('liqRadar.nearestShortLiq')}</p>
          <p className="font-mono text-sm font-semibold tabular-nums text-purple-300">
            {radar.nearestShortLiqPrice ? formatAssetPrice(radar.nearestShortLiqPrice) : '--'}
          </p>
          <p className="mt-0.5 font-mono text-[10px] tabular-nums text-slate-400">
            {t('liqRadar.frontRunTpTag', { side: effectiveSide })}: {formatAssetPrice(recTp)}
          </p>
        </div>
      </div>

      {/* Horizontal Price Spectrum Track */}
      <div className="mt-3 rounded-lg border border-slate-800/80 bg-[#070B12] p-3">
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span>{t('liqRadar.spectrumLabel')}</span>
          <span className="font-mono tabular-nums text-cyan-300">
            {t('liqRadar.markTag')} {formatAssetPrice(radar.markPrice)}
          </span>
        </div>

        <div className="relative mt-2.5 h-8 w-full overflow-hidden rounded bg-[#0C1322] border border-slate-800/70">
          {/* Cluster bars */}
          {radar.clusters.map((cluster) => {
            const left = toTrackPct(cluster.bandLow);
            const right = toTrackPct(cluster.bandHigh);
            const w = Math.max(1.2, right - left);
            const bg =
              cluster.side === 'LONG_LIQ'
                ? 'bg-amber-400/65 border border-amber-300/60'
                : 'bg-purple-400/65 border border-purple-300/60';
            const heightPct = Math.max(30, Math.min(88, cluster.intensityScore));
            return (
              <div
                key={cluster.id}
                title={`${cluster.side} ${cluster.leverageTier}: ${formatAssetPrice(cluster.priceLevel)} (~$${cluster.estimatedUsdM}M)`}
                className={`absolute bottom-0 rounded-t-sm ${bg}`}
                style={{
                  left: `${Math.max(0, Math.min(98.8, left))}%`,
                  width: `${Math.min(100 - left, w)}%`,
                  height: `${heightPct}%`,
                }}
              />
            );
          })}

          {/* Safe Zero-Stop-Hunt SL Marker */}
          <div
            className="absolute inset-y-0 w-0.5 bg-rose-400"
            style={{ left: `${slPos}%` }}
            title={`Safe SL: ${formatAssetPrice(recSl)}`}
          />

          {/* Live Mark Cursor */}
          <div
            className="absolute inset-y-0 w-0.5 bg-cyan-300"
            style={{ left: `${markPos}%` }}
            title={`Mark: ${formatAssetPrice(radar.markPrice)}`}
          />

          {/* Front-Run TP Marker */}
          <div
            className="absolute inset-y-0 w-0.5 bg-emerald-400"
            style={{ left: `${tpPos}%` }}
            title={`Target TP: ${formatAssetPrice(recTp)}`}
          />
        </div>

        <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] tabular-nums text-slate-400">
          <span>-9% ({formatAssetPrice(minBound)})</span>
          <span className="text-rose-400">SL {formatAssetPrice(recSl)}</span>
          <span className="text-emerald-400">TP {formatAssetPrice(recTp)}</span>
          <span>+9% ({formatAssetPrice(maxBound)})</span>
        </div>
      </div>

      {/* Compact Top Clusters Table */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left font-mono text-[11px] tabular-nums">
          <thead>
            <tr className="border-b border-slate-800/80 text-slate-500">
              <th className="py-1.5 font-medium">{t('liqRadar.colSide')}</th>
              <th className="py-1.5 font-medium">{t('liqRadar.colPrice')}</th>
              <th className="py-1.5 text-right font-medium">{t('liqRadar.colEstUsd')}</th>
              <th className="py-1.5 text-right font-medium">{t('liqRadar.colIntensity')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50 text-slate-300">
            {visibleClusters.map((c) => (
              <tr key={c.id}>
                <td className="py-1.5">
                  <span
                    className={
                      c.side === 'LONG_LIQ' ? 'text-amber-300' : 'text-purple-300'
                    }
                  >
                    {t(`liqRadar.side.${c.side}`)} · {c.leverageTier}
                  </span>
                </td>
                <td className="py-1.5">
                  {formatAssetPrice(c.priceLevel)}{' '}
                  <span className="text-slate-500">
                    ({c.distancePct >= 0 ? '+' : ''}
                    {c.distancePct.toFixed(2)}%)
                  </span>
                </td>
                <td className="py-1.5 text-right">${c.estimatedUsdM.toFixed(2)}M</td>
                <td className="py-1.5 text-right">
                  <span className="text-slate-200">{c.intensityScore}/100</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
