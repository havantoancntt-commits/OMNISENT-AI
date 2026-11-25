import React from 'react';
import type { EquityPoint } from '../engine/types';
import { useI18n } from '../i18n/I18nContext';

interface EquityChartProps {
  points: EquityPoint[];
  initialCapital: number;
}

export const EquityChart: React.FC<EquityChartProps> = ({ points, initialCapital }) => {
  const { t } = useI18n();
  if (points.length < 2) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-slate-800 bg-[#0A101B] text-xs text-slate-400">
        {t('equity.empty')}
      </div>
    );
  }

  const width = 720;
  const height = 220;
  const padX = 14;
  const padTop = 16;
  const padBot = 24;
  const w = width - padX * 2;
  const h = height - padTop - padBot;

  const eqs = points.map((p) => p.equityUsd);
  const minEq = Math.min(...eqs, initialCapital * 0.95);
  const maxEq = Math.max(...eqs, initialCapital * 1.05);
  const span = Math.max(1, maxEq - minEq);

  const eqPath = points
    .map((p, i) => {
      const x = padX + (i / (points.length - 1)) * w;
      const y = padTop + ((maxEq - p.equityUsd) / span) * h;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const areaPath = `${eqPath} L${(padX + w).toFixed(1)},${(padTop + h).toFixed(1)} L${padX.toFixed(1)},${(padTop + h).toFixed(1)} Z`;

  const maxDd = Math.max(5, ...points.map((p) => p.drawdownPct));
  const ddPath = points
    .map((p, i) => {
      const x = padX + (i / (points.length - 1)) * w;
      const y = padTop + h - (p.drawdownPct / maxDd) * (h * 0.35);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const baselineY = padTop + ((maxEq - initialCapital) / span) * h;
  const lastEquity = points[points.length - 1].equityUsd;
  const isGain = lastEquity >= initialCapital;

  return (
    <div className="w-full overflow-hidden rounded-xl border border-slate-800 bg-[#0A101B] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-medium text-slate-300">
          {t('equity.title', { capital: initialCapital.toLocaleString('en-US') })}
        </span>
        <span className={`font-mono tabular-nums ${isGain ? 'text-emerald-400' : 'text-rose-400'}`}>
          {t('equity.final', {
            equity: lastEquity.toLocaleString('en-US', { maximumFractionDigits: 2 }),
          })}
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-48 w-full" role="img" aria-label={t('equity.aria')}>
        <defs>
          <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={isGain ? '#10b981' : '#ef4444'} stopOpacity="0.28" />
            <stop offset="100%" stopColor={isGain ? '#10b981' : '#ef4444'} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line
          x1={padX}
          y1={baselineY}
          x2={padX + w}
          y2={baselineY}
          stroke="#334155"
          strokeDasharray="4 4"
          strokeWidth="1"
        />
        <path d={areaPath} fill="url(#eqFill)" />
        <path d={eqPath} fill="none" stroke={isGain ? '#10b981' : '#ef4444'} strokeWidth="2" />
        <path d={ddPath} fill="none" stroke="#f59e0b" strokeWidth="1.2" opacity="0.7" />
      </svg>
    </div>
  );
};
