import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import {
  computePnlDomain,
  filterPnlHistoryByWindow,
  formatSignedUsd,
  summarizePnlSeries,
  type PnlSeriesVisibility,
} from '../engine/pnlHistory';
import type { PnlHistoryPoint, PnlTimeWindow } from '../engine/types';
import { useI18n } from '../i18n/I18nContext';

interface PortfolioPnlD3ChartProps {
  history: PnlHistoryPoint[];
  currentRealizedUsd: number;
  currentUnrealizedUsd: number;
  currentEquityUsd: number;
  openPositionsCount: number;
}

export const PortfolioPnlD3Chart: React.FC<PortfolioPnlD3ChartProps> = ({
  history,
  currentRealizedUsd,
  currentUnrealizedUsd,
  currentEquityUsd,
  openPositionsCount,
}) => {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const timeWindows: Array<{ id: PnlTimeWindow; label: string }> = [
    { id: '15m', label: '15m' },
    { id: '1h', label: '1h' },
    { id: '6h', label: '6h' },
    { id: '24h', label: '24h' },
    { id: 'ALL', label: t('d3.winAll') },
  ];

  const [width, setWidth] = useState(760);
  const [timeWindow, setTimeWindow] = useState<PnlTimeWindow>('1h');
  const [visibility, setVisibility] = useState<PnlSeriesVisibility>({
    realized: true,
    unrealized: true,
    net: true,
  });
  const [hoveredPoint, setHoveredPoint] = useState<PnlHistoryPoint | null>(null);

  // Measure container width responsively across Desktop & Mobile
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateWidth = () => {
      const next = Math.max(280, Math.floor(el.getBoundingClientRect().width));
      setWidth(next);
    };
    updateWidth();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => updateWidth());
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  // Ensure live fallback point if parent portfolio updated ahead of history sync
  const effectiveHistory = useMemo(() => {
    if (history.length > 0) return history;
    const nowMs = Date.now();
    return [
      {
        timestampMs: nowMs,
        timestampUtc: new Date(nowMs).toISOString(),
        realizedPnlUsd: currentRealizedUsd,
        unrealizedPnlUsd: currentUnrealizedUsd,
        netPnlUsd: Number((currentRealizedUsd + currentUnrealizedUsd).toFixed(2)),
        totalEquityUsd: currentEquityUsd,
        openPositionsCount,
        eventTag: 'LIVE_ANCHOR',
      },
    ];
  }, [history, currentRealizedUsd, currentUnrealizedUsd, currentEquityUsd, openPositionsCount]);

  const visiblePoints = useMemo(
    () => filterPnlHistoryByWindow(effectiveHistory, timeWindow),
    [effectiveHistory, timeWindow],
  );

  const summary = useMemo(() => summarizePnlSeries(visiblePoints), [visiblePoints]);

  const activePoint = hoveredPoint ?? visiblePoints[visiblePoints.length - 1] ?? null;

  // Clear stale hover if window changes
  useEffect(() => {
    setHoveredPoint(null);
  }, [timeWindow]);

  // Render crisp D3.js SVG paths, scales, axes, gradients, and interactive bisector
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || visiblePoints.length === 0) return;

    const isCompact = width < 520;
    const height = isCompact ? 224 : 264;
    const margin = {
      top: 16,
      right: isCompact ? 12 : 18,
      bottom: 28,
      left: isCompact ? 54 : 66,
    };
    const innerW = Math.max(120, width - margin.left - margin.right);
    const innerH = Math.max(100, height - margin.top - margin.bottom);

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${width} ${height}`).attr('height', height);

    const defs = svg.append('defs');

    const realizedGrad = defs
      .append('linearGradient')
      .attr('id', 'd3-realized-area')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    realizedGrad.append('stop').attr('offset', '0%').attr('stop-color', '#10b981').attr('stop-opacity', 0.22);
    realizedGrad.append('stop').attr('offset', '100%').attr('stop-color', '#10b981').attr('stop-opacity', 0.01);

    const unrealizedGrad = defs
      .append('linearGradient')
      .attr('id', 'd3-unrealized-area')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    unrealizedGrad.append('stop').attr('offset', '0%').attr('stop-color', '#38bdf8').attr('stop-opacity', 0.2);
    unrealizedGrad.append('stop').attr('offset', '100%').attr('stop-color', '#38bdf8').attr('stop-opacity', 0.01);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const minTs = visiblePoints[0].timestampMs;
    const maxTs = visiblePoints[visiblePoints.length - 1].timestampMs;
    const xDomain: [Date, Date] =
      maxTs > minTs
        ? [new Date(minTs), new Date(maxTs)]
        : [new Date(minTs - 60_000), new Date(minTs + 60_000)];

    const yDomain = computePnlDomain(visiblePoints, visibility);

    const xScale = d3.scaleTime().domain(xDomain).range([0, innerW]);
    const yScale = d3.scaleLinear().domain(yDomain).nice(5).range([innerH, 0]);

    // Horizontal Gridlines
    const yTicks = yScale.ticks(5);
    g.append('g')
      .attr('class', 'grid-lines')
      .selectAll('line')
      .data(yTicks)
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d))
      .attr('stroke', '#1e293b')
      .attr('stroke-width', 1);

    // Highlighted $0.00 Zero Baseline
    const zeroY = yScale(0);
    if (zeroY >= 0 && zeroY <= innerH) {
      g.append('line')
        .attr('x1', 0)
        .attr('x2', innerW)
        .attr('y1', zeroY)
        .attr('y2', zeroY)
        .attr('stroke', '#475569')
        .attr('stroke-width', 1.25)
        .attr('stroke-dasharray', '4 4');
    }

    // Y Axis
    const yAxis = d3
      .axisLeft(yScale)
      .ticks(5)
      .tickSize(0)
      .tickPadding(8)
      .tickFormat((d) => {
        const num = Number(d);
        const abs = Math.abs(num);
        const formatted =
          abs >= 1000
            ? `$${(abs / 1000).toFixed(1)}k`
            : `$${abs.toFixed(abs < 10 && abs !== 0 ? 1 : 0)}`;
        if (num > 0) return `+${formatted}`;
        if (num < 0) return `-${formatted}`;
        return '$0';
      });

    const yAxisG = g.append('g').call(yAxis);
    yAxisG.select('.domain').remove();
    yAxisG
      .selectAll('text')
      .attr('fill', '#94a3b8')
      .attr('font-size', isCompact ? '10px' : '11px')
      .style('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .style('font-variant-numeric', 'tabular-nums');

    // X Axis (include seconds automatically whenever visible time span is under 20 minutes)
    const spanMs = Math.max(0, maxTs - minTs);
    const useSeconds = timeWindow === '15m' || spanMs < 20 * 60_000;
    const xTickCount = isCompact ? 4 : 5;
    const xAxis = d3
      .axisBottom(xScale)
      .ticks(xTickCount)
      .tickSize(0)
      .tickPadding(8)
      .tickFormat((d) => {
        const dt = d instanceof Date ? d : new Date(Number(d));
        const hh = String(dt.getHours()).padStart(2, '0');
        const mm = String(dt.getMinutes()).padStart(2, '0');
        const ss = String(dt.getSeconds()).padStart(2, '0');
        return useSeconds ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`;
      });

    const xAxisG = g
      .append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(xAxis);
    xAxisG.select('.domain').attr('stroke', '#1e293b');
    xAxisG
      .selectAll('text')
      .attr('fill', '#94a3b8')
      .attr('font-size', isCompact ? '10px' : '11px')
      .style('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .style('font-variant-numeric', 'tabular-nums');

    // Clip path so curves never bleed outside chart plot region
    defs
      .append('clipPath')
      .attr('id', 'd3-pnl-clip')
      .append('rect')
      .attr('width', innerW)
      .attr('height', innerH);

    const plotArea = g.append('g').attr('clip-path', 'url(#d3-pnl-clip)');

    // Series 1: Realized PnL (Step-after area + crisp emerald line)
    if (visibility.realized) {
      const realizedArea = d3
        .area<PnlHistoryPoint>()
        .x((d) => xScale(new Date(d.timestampMs)))
        .y0(() => yScale(0))
        .y1((d) => yScale(d.realizedPnlUsd))
        .curve(d3.curveStepAfter);

      const realizedLine = d3
        .line<PnlHistoryPoint>()
        .x((d) => xScale(new Date(d.timestampMs)))
        .y((d) => yScale(d.realizedPnlUsd))
        .curve(d3.curveStepAfter);

      plotArea
        .append('path')
        .datum(visiblePoints)
        .attr('fill', 'url(#d3-realized-area)')
        .attr('d', realizedArea);

      plotArea
        .append('path')
        .datum(visiblePoints)
        .attr('fill', 'none')
        .attr('stroke', '#10b981')
        .attr('stroke-width', 2.25)
        .attr('d', realizedLine);
    }

    // Series 2: Unrealized PnL (Smooth monotone curve + sky gradient)
    if (visibility.unrealized) {
      const unrealizedArea = d3
        .area<PnlHistoryPoint>()
        .x((d) => xScale(new Date(d.timestampMs)))
        .y0(() => yScale(0))
        .y1((d) => yScale(d.unrealizedPnlUsd))
        .curve(d3.curveMonotoneX);

      const unrealizedLine = d3
        .line<PnlHistoryPoint>()
        .x((d) => xScale(new Date(d.timestampMs)))
        .y((d) => yScale(d.unrealizedPnlUsd))
        .curve(d3.curveMonotoneX);

      plotArea
        .append('path')
        .datum(visiblePoints)
        .attr('fill', 'url(#d3-unrealized-area)')
        .attr('d', unrealizedArea);

      plotArea
        .append('path')
        .datum(visiblePoints)
        .attr('fill', 'none')
        .attr('stroke', '#38bdf8')
        .attr('stroke-width', 2.1)
        .attr('d', unrealizedLine);
    }

    // Series 3: Net Total PnL (Realized + Unrealized dashed line)
    if (visibility.net) {
      const netLine = d3
        .line<PnlHistoryPoint>()
        .x((d) => xScale(new Date(d.timestampMs)))
        .y((d) => yScale(d.netPnlUsd))
        .curve(d3.curveMonotoneX);

      plotArea
        .append('path')
        .datum(visiblePoints)
        .attr('fill', 'none')
        .attr('stroke', '#e2e8f0')
        .attr('stroke-width', 1.4)
        .attr('stroke-dasharray', '4 3')
        .attr('stroke-opacity', 0.85)
        .attr('d', netLine);
    }

    // Latest Endpoint Markers
    const lastPt = visiblePoints[visiblePoints.length - 1];
    const lastX = xScale(new Date(lastPt.timestampMs));
    if (visibility.realized) {
      plotArea
        .append('circle')
        .attr('cx', lastX)
        .attr('cy', yScale(lastPt.realizedPnlUsd))
        .attr('r', 3.5)
        .attr('fill', '#10b981')
        .attr('stroke', '#0E1522')
        .attr('stroke-width', 1.5);
    }
    if (visibility.unrealized) {
      plotArea
        .append('circle')
        .attr('cx', lastX)
        .attr('cy', yScale(lastPt.unrealizedPnlUsd))
        .attr('r', 3.5)
        .attr('fill', '#38bdf8')
        .attr('stroke', '#0E1522')
        .attr('stroke-width', 1.5);
    }
    if (visibility.net) {
      plotArea
        .append('circle')
        .attr('cx', lastX)
        .attr('cy', yScale(lastPt.netPnlUsd))
        .attr('r', 3)
        .attr('fill', '#e2e8f0')
        .attr('stroke', '#0E1522')
        .attr('stroke-width', 1.5);
    }

    // Interactive Crosshair Layer
    const crosshairG = g.append('g').attr('class', 'crosshair-layer').style('display', 'none');
    const vLine = crosshairG
      .append('line')
      .attr('y1', 0)
      .attr('y2', innerH)
      .attr('stroke', '#94a3b8')
      .attr('stroke-opacity', 0.75)
      .attr('stroke-width', 1.25)
      .attr('stroke-dasharray', '3 3');

    const dotRealized = crosshairG
      .append('circle')
      .attr('r', 4.5)
      .attr('fill', '#10b981')
      .attr('stroke', '#0B111D')
      .attr('stroke-width', 2);

    const dotUnrealized = crosshairG
      .append('circle')
      .attr('r', 4.5)
      .attr('fill', '#38bdf8')
      .attr('stroke', '#0B111D')
      .attr('stroke-width', 2);

    const dotNet = crosshairG
      .append('circle')
      .attr('r', 4)
      .attr('fill', '#e2e8f0')
      .attr('stroke', '#0B111D')
      .attr('stroke-width', 2);

    const bisectTs = d3.bisector<PnlHistoryPoint, number>((d) => d.timestampMs).center;

    const updateCrosshair = (clientX: number) => {
      const rect = svgEl.getBoundingClientRect();
      const relX = clientX - rect.left - margin.left;
      const clampedX = Math.max(0, Math.min(innerW, relX));
      const targetTs = xScale.invert(clampedX).getTime();
      const idx = bisectTs(visiblePoints, targetTs);
      const pt = visiblePoints[Math.max(0, Math.min(visiblePoints.length - 1, idx))];
      if (!pt) return;

      const cx = xScale(new Date(pt.timestampMs));
      crosshairG.style('display', 'inline');
      vLine.attr('x1', cx).attr('x2', cx);

      dotRealized
        .style('display', visibility.realized ? 'inline' : 'none')
        .attr('cx', cx)
        .attr('cy', yScale(pt.realizedPnlUsd));

      dotUnrealized
        .style('display', visibility.unrealized ? 'inline' : 'none')
        .attr('cx', cx)
        .attr('cy', yScale(pt.unrealizedPnlUsd));

      dotNet
        .style('display', visibility.net ? 'inline' : 'none')
        .attr('cx', cx)
        .attr('cy', yScale(pt.netPnlUsd));

      setHoveredPoint(pt);
    };

    g.append('rect')
      .attr('width', innerW)
      .attr('height', innerH)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair')
      .on('mousemove', (event: MouseEvent) => updateCrosshair(event.clientX))
      .on('touchstart', (event: TouchEvent) => {
        if (event.touches[0]) updateCrosshair(event.touches[0].clientX);
      })
      .on('touchmove', (event: TouchEvent) => {
        if (event.touches[0]) updateCrosshair(event.touches[0].clientX);
      })
      .on('mouseleave', () => {
        crosshairG.style('display', 'none');
        setHoveredPoint(null);
      });
  }, [visiblePoints, width, visibility, timeWindow]);

  const toggleSeries = (key: keyof PnlSeriesVisibility) => {
    setVisibility((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (!next.realized && !next.unrealized && !next.net) {
        return prev;
      }
      return next;
    });
  };

  const displayRealized = activePoint ? activePoint.realizedPnlUsd : summary.currentRealizedUsd;
  const displayUnrealized = activePoint ? activePoint.unrealizedPnlUsd : summary.currentUnrealizedUsd;
  const displayNet = activePoint ? activePoint.netPnlUsd : summary.currentNetUsd;
  const displayEquity = activePoint ? activePoint.totalEquityUsd : currentEquityUsd;

  const isBaselineOnly =
    effectiveHistory.length <= 1 &&
    summary.currentRealizedUsd === 0 &&
    summary.currentUnrealizedUsd === 0;

  return (
    <section
      aria-label={t('d3.aria')}
      className="rounded-xl border border-slate-800/90 bg-[#0E1522] p-4 sm:p-5"
    >
      {/* Header & Controls */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span>{t('d3.eyebrow')}</span>
            <span aria-hidden="true">·</span>
            <span>D3.js Multi-Series</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-slate-300">
              {t('d3.pointsCount', { count: visiblePoints.length })}
            </span>
          </div>
          <h2 className="mt-1 font-display text-base font-semibold text-slate-50 sm:text-lg">
            {t('d3.title')}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Interactive Series Toggles */}
          <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-[#070B12] p-1">
            <button
              type="button"
              onClick={() => toggleSeries('realized')}
              aria-pressed={visibility.realized}
              className={`flex min-h-[34px] items-center gap-1.5 rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors ${
                visibility.realized
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" />
              <span>Realized</span>
            </button>
            <button
              type="button"
              onClick={() => toggleSeries('unrealized')}
              aria-pressed={visibility.unrealized}
              className={`flex min-h-[34px] items-center gap-1.5 rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors ${
                visibility.unrealized
                  ? 'bg-sky-500/15 text-sky-300'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-sky-400" aria-hidden="true" />
              <span>Unrealized</span>
            </button>
            <button
              type="button"
              onClick={() => toggleSeries('net')}
              aria-pressed={visibility.net}
              className={`flex min-h-[34px] items-center gap-1.5 rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors ${
                visibility.net
                  ? 'bg-slate-700/60 text-slate-100'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <span className="h-0.5 w-2.5 bg-slate-200" aria-hidden="true" />
              <span>Net PnL</span>
            </button>
          </div>

          {/* Timeframe Selector */}
          <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-[#070B12] p-1">
            {timeWindows.map((win) => (
              <button
                key={win.id}
                type="button"
                onClick={() => setTimeWindow(win.id)}
                className={`min-h-[34px] rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors ${
                  timeWindow === win.id
                    ? 'bg-cyan-500/20 text-cyan-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {win.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Interactive Crosshair / Live Readout Strip */}
      <div className="mt-4 grid grid-cols-2 gap-3 border-y border-slate-800/80 py-3 font-mono tabular-nums sm:grid-cols-4">
        <div>
          <p className="font-sans text-[11px] text-slate-400">
            Realized PnL {hoveredPoint ? t('d3.realizedAtHover') : t('d3.realizedCurrent')}
          </p>
          <p
            className={`mt-0.5 text-sm font-semibold sm:text-base ${
              displayRealized >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {formatSignedUsd(displayRealized)}
          </p>
        </div>

        <div>
          <p className="font-sans text-[11px] text-slate-400">Unrealized PnL (Mark-to-Market)</p>
          <p
            className={`mt-0.5 text-sm font-semibold sm:text-base ${
              displayUnrealized > 0
                ? 'text-sky-400'
                : displayUnrealized < 0
                  ? 'text-rose-400'
                  : 'text-slate-200'
            }`}
          >
            {formatSignedUsd(displayUnrealized)}
          </p>
        </div>

        <div>
          <p className="font-sans text-[11px] text-slate-400">Net PnL · Equity</p>
          <p
            className={`mt-0.5 text-sm font-semibold sm:text-base ${
              displayNet >= 0 ? 'text-slate-100' : 'text-rose-400'
            }`}
          >
            {formatSignedUsd(displayNet)}
          </p>
          <p className="text-[11px] text-slate-400">
            ${displayEquity.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </p>
        </div>

        <div>
          <p className="font-sans text-[11px] text-slate-400">
            {t('d3.rangeNet', { window: timeWindow })}
          </p>
          <p className="mt-0.5 text-xs font-semibold text-slate-200 sm:text-sm">
            {formatSignedUsd(summary.lowNetUsd)} / {formatSignedUsd(summary.highNetUsd)}
          </p>
          <p className="text-[11px] text-slate-400">
            {activePoint
              ? `${activePoint.timestampUtc.slice(11, 19)} UTC`
              : '--:--:-- UTC'}
          </p>
        </div>
      </div>

      {/* D3.js SVG Canvas */}
      <div ref={containerRef} className="mt-3 w-full overflow-hidden">
        <svg
          ref={svgRef}
          data-testid="portfolio-pnl-d3-chart"
          role="img"
          aria-label={t('d3.svgAria')}
          className="block w-full select-none"
        />
      </div>

      {/* Contextual Footer Explanation */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
        <span>
          {isBaselineOnly ? t('d3.footerBaseline') : t('d3.footerInteractive')}
        </span>
        <span className="font-mono tabular-nums text-slate-500">
          {t('d3.footerOpenPos', { count: openPositionsCount })}
        </span>
      </div>
    </section>
  );
};
