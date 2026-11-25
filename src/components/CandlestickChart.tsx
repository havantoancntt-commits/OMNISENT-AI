import React from 'react';
import { getSmartPriceDecimals } from '../engine/symbolSearch';
import type { Candle, TechnicalIndicators } from '../engine/types';
import { useI18n } from '../i18n/I18nContext';

interface CandlestickChartProps {
  candles: Candle[];
  indicators: TechnicalIndicators | null;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  longLiqZone?: number | null;
  shortLiqZone?: number | null;
}

export const CandlestickChart: React.FC<CandlestickChartProps> = ({
  candles,
  indicators,
  entryPrice,
  stopLoss,
  takeProfit,
  longLiqZone,
  shortLiqZone,
}) => {
  const { t } = useI18n();
  const visible = candles.slice(-64);
  if (visible.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-slate-800 bg-[#0B111D] text-xs text-slate-400">
        {t('scanner.chart.loading')}
      </div>
    );
  }

  const width = 760;
  const height = 270;
  const padLeft = 12;
  const padRight = 76;
  const padTop = 14;
  const padBottom = 26;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const lows = visible.map((c) => c.low);
  const highs = visible.map((c) => c.high);
  if (stopLoss && stopLoss > 0) lows.push(stopLoss);
  if (takeProfit && takeProfit > 0) highs.push(takeProfit);
  if (entryPrice && entryPrice > 0) {
    lows.push(entryPrice);
    highs.push(entryPrice);
  }

  const rawMin = Math.min(...lows);
  const rawMax = Math.max(...highs);
  const rawSpan = Math.max(rawMax - rawMin, rawMax * 0.002);

  // Include nearby liquidation zones in Y-axis only if within +/- 45% of visible range so candles never squish
  const showLongLiq =
    Boolean(longLiqZone && longLiqZone > 0 && longLiqZone >= rawMin - rawSpan * 0.45 && longLiqZone <= rawMax + rawSpan * 0.2);
  const showShortLiq =
    Boolean(shortLiqZone && shortLiqZone > 0 && shortLiqZone <= rawMax + rawSpan * 0.45 && shortLiqZone >= rawMin - rawSpan * 0.2);
  if (showLongLiq && longLiqZone) lows.push(longLiqZone);
  if (showShortLiq && shortLiqZone) highs.push(shortLiqZone);

  const minPrice = Math.min(...lows);
  const maxPrice = Math.max(...highs);
  const span = Math.max(maxPrice - minPrice, maxPrice * 0.002);
  const yMin = minPrice - span * 0.08;
  const yMax = maxPrice + span * 0.08;

  const toY = (p: number) =>
    padTop + ((yMax - p) / Math.max(1e-12, yMax - yMin)) * chartH;

  const stepX = chartW / visible.length;
  const candleW = Math.max(3, Math.min(9, stepX * 0.62));

  const gridLevels = [0, 0.25, 0.5, 0.75, 1].map((f) => yMin + (yMax - yMin) * f);
  const gridDecimals = getSmartPriceDecimals((yMin + yMax) / 2);

  return (
    <div className="w-full overflow-hidden rounded-xl border border-slate-800 bg-[#0A101B] p-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-56 w-full sm:h-64"
        role="img"
        aria-label={t('scanner.chart.aria')}
      >
        {/* Horizontal Price Grid */}
        {gridLevels.map((lvl, idx) => {
          const y = toY(lvl);
          const label =
            lvl >= 1000
              ? lvl.toLocaleString('en-US', { maximumFractionDigits: 2 })
              : lvl.toFixed(gridDecimals);
          return (
            <g key={idx}>
              <line
                x1={padLeft}
                y1={y}
                x2={width - padRight}
                y2={y}
                stroke="#182235"
                strokeWidth="1"
              />
              <text
                x={width - padRight + 6}
                y={y + 4}
                fill="#94a3b8"
                fontSize="10"
                fontFamily="JetBrains Mono, monospace"
              >
                {label}
              </text>
            </g>
          );
        })}

        {/* Candlesticks */}
        {visible.map((c, idx) => {
          const cx = padLeft + idx * stepX + stepX / 2;
          const bull = c.close >= c.open;
          const color = bull ? '#10b981' : '#ef4444';
          const topY = toY(Math.max(c.open, c.close));
          const botY = toY(Math.min(c.open, c.close));
          const bodyH = Math.max(1.5, botY - topY);

          return (
            <g key={c.timestamp}>
              <line
                x1={cx}
                y1={toY(c.high)}
                x2={cx}
                y2={toY(c.low)}
                stroke={color}
                strokeWidth="1.2"
              />
              <rect
                x={cx - candleW / 2}
                y={topY}
                width={candleW}
                height={bodyH}
                fill={color}
                rx="0.5"
              />
            </g>
          );
        })}

        {/* Indicator Reference Lines */}
        {indicators && indicators.vwap > 0 && (
          <line
            x1={padLeft}
            y1={toY(indicators.vwap)}
            x2={width - padRight}
            y2={toY(indicators.vwap)}
            stroke="#38bdf8"
            strokeDasharray="4 4"
            strokeWidth="1"
            opacity="0.7"
          />
        )}

        {/* Liquidation Cluster Radar Overlay Lines */}
        {showLongLiq && longLiqZone && (
          <g>
            <line
              x1={padLeft}
              y1={toY(longLiqZone)}
              x2={width - padRight}
              y2={toY(longLiqZone)}
              stroke="#f59e0b"
              strokeWidth="1"
              strokeDasharray="6 4"
              opacity="0.82"
            />
            <rect x={width - padRight - 58} y={toY(longLiqZone) - 13} width="54" height="12" rx="2" fill="#070B12" opacity="0.9" />
            <text
              x={width - padRight - 54}
              y={toY(longLiqZone) - 4}
              fill="#fbbf24"
              fontSize="8.5"
              fontFamily="JetBrains Mono, monospace"
            >
              LONG LIQ
            </text>
          </g>
        )}
        {showShortLiq && shortLiqZone && (
          <g>
            <line
              x1={padLeft}
              y1={toY(shortLiqZone)}
              x2={width - padRight}
              y2={toY(shortLiqZone)}
              stroke="#a855f7"
              strokeWidth="1"
              strokeDasharray="6 4"
              opacity="0.82"
            />
            <rect x={width - padRight - 64} y={toY(shortLiqZone) - 13} width="60" height="12" rx="2" fill="#070B12" opacity="0.9" />
            <text
              x={width - padRight - 60}
              y={toY(shortLiqZone) - 4}
              fill="#c084fc"
              fontSize="8.5"
              fontFamily="JetBrains Mono, monospace"
            >
              SHORT LIQ
            </text>
          </g>
        )}

        {/* Order Overlay Lines: Entry / SL / TP */}
        {entryPrice && entryPrice > 0 && (
          <g>
            <line
              x1={padLeft}
              y1={toY(entryPrice)}
              x2={width - padRight}
              y2={toY(entryPrice)}
              stroke="#06b6d4"
              strokeWidth="1.2"
              strokeDasharray="3 3"
            />
            <rect x={padLeft + 4} y={toY(entryPrice) - 13} width="42" height="12" rx="2" fill="#070B12" opacity="0.88" />
            <text
              x={padLeft + 7}
              y={toY(entryPrice) - 4}
              fill="#22d3ee"
              fontSize="9"
              fontFamily="JetBrains Mono, monospace"
            >
              ENTRY
            </text>
          </g>
        )}
        {stopLoss && stopLoss > 0 && (
          <g>
            <line
              x1={padLeft}
              y1={toY(stopLoss)}
              x2={width - padRight}
              y2={toY(stopLoss)}
              stroke="#ef4444"
              strokeWidth="1.2"
              strokeDasharray="4 3"
            />
            <rect x={padLeft + 50} y={toY(stopLoss) - 13} width="22" height="12" rx="2" fill="#070B12" opacity="0.88" />
            <text
              x={padLeft + 54}
              y={toY(stopLoss) - 4}
              fill="#f87171"
              fontSize="9"
              fontFamily="JetBrains Mono, monospace"
            >
              SL
            </text>
          </g>
        )}
        {takeProfit && takeProfit > 0 && (
          <g>
            <line
              x1={padLeft}
              y1={toY(takeProfit)}
              x2={width - padRight}
              y2={toY(takeProfit)}
              stroke="#10b981"
              strokeWidth="1.2"
              strokeDasharray="4 3"
            />
            <rect x={padLeft + 76} y={toY(takeProfit) - 13} width="22" height="12" rx="2" fill="#070B12" opacity="0.88" />
            <text
              x={padLeft + 80}
              y={toY(takeProfit) - 4}
              fill="#34d399"
              fontSize="9"
              fontFamily="JetBrains Mono, monospace"
            >
              TP
            </text>
          </g>
        )}
      </svg>
    </div>
  );
};
