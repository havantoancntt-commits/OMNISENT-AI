import type { PnlHistoryPoint, PnlTimeWindow } from './types';

export interface PnlSeriesVisibility {
  realized: boolean;
  unrealized: boolean;
  net: boolean;
}

export interface PnlSeriesSummary {
  count: number;
  currentRealizedUsd: number;
  currentUnrealizedUsd: number;
  currentNetUsd: number;
  highNetUsd: number;
  lowNetUsd: number;
  peakRealizedUsd: number;
  peakUnrealizedUsd: number;
  minUnrealizedUsd: number;
}

const WINDOW_MS_MAP: Record<Exclude<PnlTimeWindow, 'ALL'>, number> = {
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  '24h': 24 * 60 * 60_000,
};

export function filterPnlHistoryByWindow(
  points: PnlHistoryPoint[],
  window: PnlTimeWindow,
  nowMs = Date.now(),
): PnlHistoryPoint[] {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.timestampMs - b.timestampMs);
  if (window === 'ALL') return sorted;

  const cutoff = nowMs - WINDOW_MS_MAP[window];
  const filtered = sorted.filter((p) => p.timestampMs >= cutoff);
  if (filtered.length >= 2) return filtered;
  if (filtered.length === 1) {
    // Include one prior anchor point if available so a visible line segment forms cleanly
    const firstIdx = sorted.indexOf(filtered[0]);
    if (firstIdx > 0) {
      return [sorted[firstIdx - 1], ...filtered];
    }
    return filtered;
  }
  return sorted.slice(-Math.min(2, sorted.length));
}

export function appendPnlPoint(
  history: PnlHistoryPoint[],
  nextPoint: PnlHistoryPoint,
  maxPoints = 360,
): PnlHistoryPoint[] {
  if (history.length === 0) return [nextPoint];
  const last = history[history.length - 1];

  // Replace if within 1500ms of the previous point to prevent tight cluster jitter
  if (Math.abs(nextPoint.timestampMs - last.timestampMs) < 1500) {
    const merged = [...history.slice(0, -1), nextPoint];
    return merged.slice(-maxPoints);
  }

  const next = [...history, nextPoint];
  if (next.length > maxPoints) {
    return next.slice(next.length - maxPoints);
  }
  return next;
}

export function computePnlDomain(
  points: PnlHistoryPoint[],
  visibility: PnlSeriesVisibility,
): [number, number] {
  const values: number[] = [0];
  for (const p of points) {
    if (visibility.realized) values.push(p.realizedPnlUsd);
    if (visibility.unrealized) values.push(p.unrealizedPnlUsd);
    if (visibility.net) values.push(p.netPnlUsd);
  }

  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const rawSpan = maxVal - minVal;

  if (rawSpan < 1e-6) {
    return [-25, 25];
  }

  const pad = Math.max(2, rawSpan * 0.16);
  const lower = Math.min(0, minVal) - pad;
  const upper = Math.max(0, maxVal) + pad;
  return [Number(lower.toFixed(2)), Number(upper.toFixed(2))];
}

export function summarizePnlSeries(points: PnlHistoryPoint[]): PnlSeriesSummary {
  if (points.length === 0) {
    return {
      count: 0,
      currentRealizedUsd: 0,
      currentUnrealizedUsd: 0,
      currentNetUsd: 0,
      highNetUsd: 0,
      lowNetUsd: 0,
      peakRealizedUsd: 0,
      peakUnrealizedUsd: 0,
      minUnrealizedUsd: 0,
    };
  }

  const latest = points[points.length - 1];
  let highNet = latest.netPnlUsd;
  let lowNet = latest.netPnlUsd;
  let peakRealized = latest.realizedPnlUsd;
  let peakUnrealized = latest.unrealizedPnlUsd;
  let minUnrealized = latest.unrealizedPnlUsd;

  for (const p of points) {
    if (p.netPnlUsd > highNet) highNet = p.netPnlUsd;
    if (p.netPnlUsd < lowNet) lowNet = p.netPnlUsd;
    if (p.realizedPnlUsd > peakRealized) peakRealized = p.realizedPnlUsd;
    if (p.unrealizedPnlUsd > peakUnrealized) peakUnrealized = p.unrealizedPnlUsd;
    if (p.unrealizedPnlUsd < minUnrealized) minUnrealized = p.unrealizedPnlUsd;
  }

  return {
    count: points.length,
    currentRealizedUsd: latest.realizedPnlUsd,
    currentUnrealizedUsd: latest.unrealizedPnlUsd,
    currentNetUsd: latest.netPnlUsd,
    highNetUsd: highNet,
    lowNetUsd: lowNet,
    peakRealizedUsd: peakRealized,
    peakUnrealizedUsd: peakUnrealized,
    minUnrealizedUsd: minUnrealized,
  };
}

export function formatSignedUsd(value: number, decimals = 2): string {
  const absFormatted = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  if (value > 0) return `+$${absFormatted}`;
  if (value < 0) return `-$${absFormatted}`;
  return `$${absFormatted}`;
}
