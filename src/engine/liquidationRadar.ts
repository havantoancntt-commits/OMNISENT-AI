import { calculateATR } from './indicators.ts';
import { getSmartPriceDecimals } from './symbolSearch.ts';
import type {
  Candle,
  LiquidationClusterZone,
  LiquidationRadarSnapshot,
  MarketTicker,
  OrderBookSnapshot,
  OrderSide,
  RiskConfig,
} from './types.ts';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function roundSmart(price: number, refPrice: number): number {
  const baseDec = getSmartPriceDecimals(refPrice);
  const dec = refPrice < 0.05 ? baseDec + 2 : baseDec;
  const minPx = Math.pow(10, -dec);
  if (!Number.isFinite(price) || price <= 0) return minPx;
  return Number(Math.max(minPx, price).toFixed(dec));
}

function computeDistancePct(level: number, mark: number): number {
  if (!(mark > 0)) return 0;
  return Number((((level - mark) / mark) * 100).toFixed(2));
}

/**
 * Estimates multi-tier liquidation clusters (100x, 50x, 25x, 10x), structural swing liquidity pools,
 * and resting L2 Order Book walls from verified OHLCV, Open Interest, Funding Rate, and Depth.
 * Simultaneously computes Zero-Stop-Hunt SL and Front-Run TP recommendations for LONG & SHORT.
 */
export function computeLiquidationRadar(params: {
  candles: Candle[];
  orderBook?: OrderBookSnapshot | null;
  ticker?: MarketTicker | null;
  atr14?: number;
  riskConfig?: RiskConfig;
}): LiquidationRadarSnapshot {
  const candles = params.candles ?? [];
  const lastCandleClose = candles[candles.length - 1]?.close ?? 0;
  const markPrice =
    params.ticker?.lastPrice && params.ticker.lastPrice > 0
      ? params.ticker.lastPrice
      : lastCandleClose > 0
        ? lastCandleClose
        : 100;

  let atr = params.atr14 && params.atr14 > 0 ? params.atr14 : 0;
  if (!(atr > 0) && candles.length >= 15) {
    const atrSeries = calculateATR(candles, 14);
    atr = atrSeries[atrSeries.length - 1] ?? 0;
  }
  if (!(atr > 0)) {
    atr = markPrice * 0.015;
  }
  atr = Math.max(atr, markPrice * 0.004);

  const fundingRatePct = params.ticker?.fundingRatePct ?? null;
  const vol24hUsd = params.ticker?.volume24hUsd && params.ticker.volume24hUsd > 0 ? params.ticker.volume24hUsd : 50_000_000;
  const openInterestUsd =
    params.ticker?.openInterestUsd && params.ticker.openInterestUsd > 0
      ? params.ticker.openInterestUsd
      : vol24hUsd * 0.22;
  const openInterestUsdM = Number((openInterestUsd / 1_000_000).toFixed(1));

  const fundingCrowdBias: LiquidationRadarSnapshot['fundingCrowdBias'] =
    fundingRatePct !== null && fundingRatePct >= 0.015
      ? 'CROWDED_LONGS'
      : fundingRatePct !== null && fundingRatePct <= -0.015
        ? 'CROWDED_SHORTS'
        : 'BALANCED';

  const longBiasFactor =
    fundingCrowdBias === 'CROWDED_LONGS' ? 1.28 : fundingCrowdBias === 'CROWDED_SHORTS' ? 0.78 : 1.0;
  const shortBiasFactor =
    fundingCrowdBias === 'CROWDED_SHORTS' ? 1.28 : fundingCrowdBias === 'CROWDED_LONGS' ? 0.78 : 1.0;

  // Recent 24-bar anchor close reflects where active leveraged entrants clustered
  const recentAnchor =
    candles.length >= 24
      ? candles.slice(-24).reduce((acc, c) => acc + c.close, 0) / 24
      : markPrice;
  const anchorBlend = markPrice * 0.65 + recentAnchor * 0.35;

  const clusters: LiquidationClusterZone[] = [];

  // 1. Multi-tier leverage bands (100x ~ 0.95%, 50x ~ 1.95%, 25x ~ 3.9%, 10x ~ 9.5%)
  const tierDefs: Array<{
    tier: LiquidationClusterZone['leverageTier'];
    pctOffset: number;
    oiShare: number;
    baseIntensity: number;
  }> = [
    { tier: '100X', pctOffset: 0.0095, oiShare: 0.045, baseIntensity: 78 },
    { tier: '50X', pctOffset: 0.0195, oiShare: 0.085, baseIntensity: 88 },
    { tier: '25X', pctOffset: 0.039, oiShare: 0.145, baseIntensity: 74 },
    { tier: '10X', pctOffset: 0.095, oiShare: 0.21, baseIntensity: 56 },
  ];

  const bandHalfAtr = atr * 0.22;

  for (const def of tierDefs) {
    // Downside Long Liquidation band strictly below markPrice
    const rawLongLevel = Math.min(markPrice * (1 - def.pctOffset * 0.55), anchorBlend * (1 - def.pctOffset));
    const longLevel = roundSmart(rawLongLevel, markPrice);
    const longEstM = Number(((openInterestUsdM * def.oiShare * longBiasFactor) || 1.2).toFixed(2));
    const longIntensity = Math.round(clamp(def.baseIntensity * longBiasFactor, 18, 99));

    clusters.push({
      id: `LIQ-LONG-${def.tier}`,
      side: 'LONG_LIQ',
      leverageTier: def.tier,
      source: 'LEVERAGE_BAND',
      priceLevel: longLevel,
      bandLow: roundSmart(longLevel - Math.max(bandHalfAtr, longLevel * 0.0018), markPrice),
      bandHigh: roundSmart(Math.min(markPrice * 0.9985, longLevel + Math.max(bandHalfAtr, longLevel * 0.0018)), markPrice),
      distancePct: computeDistancePct(longLevel, markPrice),
      estimatedUsdM: longEstM,
      intensityScore: longIntensity,
    });

    // Upside Short Liquidation band strictly above markPrice
    const rawShortLevel = Math.max(markPrice * (1 + def.pctOffset * 0.55), anchorBlend * (1 + def.pctOffset));
    const shortLevel = roundSmart(rawShortLevel, markPrice);
    const shortEstM = Number(((openInterestUsdM * def.oiShare * shortBiasFactor) || 1.2).toFixed(2));
    const shortIntensity = Math.round(clamp(def.baseIntensity * shortBiasFactor, 18, 99));

    clusters.push({
      id: `LIQ-SHORT-${def.tier}`,
      side: 'SHORT_LIQ',
      leverageTier: def.tier,
      source: 'LEVERAGE_BAND',
      priceLevel: shortLevel,
      bandLow: roundSmart(Math.max(markPrice * 1.0015, shortLevel - Math.max(bandHalfAtr, shortLevel * 0.0018)), markPrice),
      bandHigh: roundSmart(shortLevel + Math.max(bandHalfAtr, shortLevel * 0.0018), markPrice),
      distancePct: computeDistancePct(shortLevel, markPrice),
      estimatedUsdM: shortEstM,
      intensityScore: shortIntensity,
    });
  }

  // 2. Structural Swing High / Swing Low Liquidity Pools over last 48 bars
  const swingLookback = candles.slice(-48, -1);
  if (swingLookback.length >= 6) {
    const belowSwings = swingLookback
      .filter((c) => c.low < markPrice * 0.996 && c.low > markPrice * 0.85)
      .sort((a, b) => b.volume - a.volume || a.low - b.low);
    const keyLowCandle = belowSwings[0] ?? swingLookback.reduce((m, c) => (c.low < m.low ? c : m), swingLookback[0]);
    if (keyLowCandle && keyLowCandle.low < markPrice * 0.997) {
      const lvl = roundSmart(keyLowCandle.low, markPrice);
      clusters.push({
        id: 'LIQ-LONG-SWING',
        side: 'LONG_LIQ',
        leverageTier: 'SWING',
        source: 'SWING_POOL',
        priceLevel: lvl,
        bandLow: roundSmart(lvl - atr * 0.2, markPrice),
        bandHigh: roundSmart(Math.min(markPrice * 0.9985, lvl + atr * 0.16), markPrice),
        distancePct: computeDistancePct(lvl, markPrice),
        estimatedUsdM: Number(Math.max(1.5, openInterestUsdM * 0.095 * longBiasFactor).toFixed(2)),
        intensityScore: Math.round(clamp(82 * longBiasFactor, 30, 98)),
      });
    }

    const aboveSwings = swingLookback
      .filter((c) => c.high > markPrice * 1.004 && c.high < markPrice * 1.15)
      .sort((a, b) => b.volume - a.volume || b.high - a.high);
    const keyHighCandle = aboveSwings[0] ?? swingLookback.reduce((m, c) => (c.high > m.high ? c : m), swingLookback[0]);
    if (keyHighCandle && keyHighCandle.high > markPrice * 1.003) {
      const lvl = roundSmart(keyHighCandle.high, markPrice);
      clusters.push({
        id: 'LIQ-SHORT-SWING',
        side: 'SHORT_LIQ',
        leverageTier: 'SWING',
        source: 'SWING_POOL',
        priceLevel: lvl,
        bandLow: roundSmart(Math.max(markPrice * 1.0015, lvl - atr * 0.16), markPrice),
        bandHigh: roundSmart(lvl + atr * 0.2, markPrice),
        distancePct: computeDistancePct(lvl, markPrice),
        estimatedUsdM: Number(Math.max(1.5, openInterestUsdM * 0.095 * shortBiasFactor).toFixed(2)),
        intensityScore: Math.round(clamp(82 * shortBiasFactor, 30, 98)),
      });
    }
  }

  // 3. Dominant Resting L2 Order Book Walls
  let strongestLongWallPrice: number | null = null;
  let strongestShortWallPrice: number | null = null;

  if (params.orderBook && params.orderBook.bids.length > 0) {
    const bidsBelow = params.orderBook.bids.filter((b) => b.price > 0 && b.price < markPrice);
    if (bidsBelow.length > 0) {
      const bestBidWall = bidsBelow.reduce((best, cur) => (cur.totalUsd > best.totalUsd ? cur : best), bidsBelow[0]);
      strongestLongWallPrice = roundSmart(bestBidWall.price, markPrice);
      clusters.push({
        id: 'OB-WALL-BID',
        side: 'LONG_LIQ',
        leverageTier: 'WALL',
        source: 'OB_WALL',
        priceLevel: strongestLongWallPrice,
        bandLow: roundSmart(strongestLongWallPrice - atr * 0.12, markPrice),
        bandHigh: roundSmart(Math.min(markPrice * 0.999, strongestLongWallPrice + atr * 0.12), markPrice),
        distancePct: computeDistancePct(strongestLongWallPrice, markPrice),
        estimatedUsdM: Number(Math.max(0.05, bestBidWall.totalUsd / 1_000_000).toFixed(2)),
        intensityScore: Math.round(clamp(68 + (bestBidWall.totalUsd > 250_000 ? 18 : 8), 35, 95)),
      });
    }
  }

  if (params.orderBook && params.orderBook.asks.length > 0) {
    const asksAbove = params.orderBook.asks.filter((a) => a.price > markPrice);
    if (asksAbove.length > 0) {
      const bestAskWall = asksAbove.reduce((best, cur) => (cur.totalUsd > best.totalUsd ? cur : best), asksAbove[0]);
      strongestShortWallPrice = roundSmart(bestAskWall.price, markPrice);
      clusters.push({
        id: 'OB-WALL-ASK',
        side: 'SHORT_LIQ',
        leverageTier: 'WALL',
        source: 'OB_WALL',
        priceLevel: strongestShortWallPrice,
        bandLow: roundSmart(Math.max(markPrice * 1.001, strongestShortWallPrice - atr * 0.12), markPrice),
        bandHigh: roundSmart(strongestShortWallPrice + atr * 0.12, markPrice),
        distancePct: computeDistancePct(strongestShortWallPrice, markPrice),
        estimatedUsdM: Number(Math.max(0.05, bestAskWall.totalUsd / 1_000_000).toFixed(2)),
        intensityScore: Math.round(clamp(68 + (bestAskWall.totalUsd > 250_000 ? 18 : 8), 35, 95)),
      });
    }
  }

  clusters.sort((a, b) => a.priceLevel - b.priceLevel);

  const longPools = clusters
    .filter((c) => c.side === 'LONG_LIQ' && c.priceLevel < markPrice)
    .sort((a, b) => b.priceLevel - a.priceLevel); // closest below mark first
  const shortPools = clusters
    .filter((c) => c.side === 'SHORT_LIQ' && c.priceLevel > markPrice)
    .sort((a, b) => a.priceLevel - b.priceLevel); // closest above mark first

  // Prefer genuine leverage/swing clusters for nearest pool readout
  const primaryLongPool =
    longPools.find((c) => c.source !== 'OB_WALL' && c.intensityScore >= 65) ?? longPools[0] ?? null;
  const primaryShortPool =
    shortPools.find((c) => c.source !== 'OB_WALL' && c.intensityScore >= 65) ?? shortPools[0] ?? null;

  const nearestLongLiqPrice = primaryLongPool?.priceLevel ?? null;
  const nearestShortLiqPrice = primaryShortPool?.priceLevel ?? null;

  // Compute Stop-Hunt Risk Score (0-100) based on ATR proximity + crowding
  const longDistAtr = primaryLongPool ? (markPrice - primaryLongPool.priceLevel) / atr : 3.0;
  const shortDistAtr = primaryShortPool ? (primaryShortPool.priceLevel - markPrice) / atr : 3.0;
  const minDistAtr = Math.min(longDistAtr, shortDistAtr);
  const proximityScore = clamp((2.6 - minDistAtr) * 28, 12, 68);
  const crowdingBoost = fundingCrowdBias === 'BALANCED' ? 8 : 22;
  const stopHuntRiskScore = Math.round(clamp(proximityScore + crowdingBoost, 10, 96));

  const longMaxIntensity = longPools.reduce((m, c) => Math.max(m, c.intensityScore), 0);
  const shortMaxIntensity = shortPools.reduce((m, c) => Math.max(m, c.intensityScore), 0);
  const dominantSweepDirection: LiquidationRadarSnapshot['dominantSweepDirection'] =
    fundingCrowdBias === 'CROWDED_LONGS' || (longMaxIntensity - shortMaxIntensity >= 10 && longDistAtr <= shortDistAtr + 0.35)
      ? 'DOWNSIDE_LONG_SWEEP'
      : fundingCrowdBias === 'CROWDED_SHORTS' || (shortMaxIntensity - longMaxIntensity >= 10 && shortDistAtr <= longDistAtr + 0.35)
        ? 'UPSIDE_SHORT_SWEEP'
        : 'TWO_SIDED';

  // Compute baseline ATR SL/TP and optimize both LONG and SHORT directions through Zero-Stop-Hunt engine
  const minRr = Math.max(1.8, params.riskConfig?.minRiskReward ?? 1.8);
  const baseStopDist = Math.max(atr * 1.5, markPrice * 0.012);
  const baseTpDist = baseStopDist * minRr;

  const baseSnapshot: LiquidationRadarSnapshot = {
    markPrice: roundSmart(markPrice, markPrice),
    atr14: atr,
    fundingRatePct,
    openInterestUsdM,
    fundingCrowdBias,
    dominantSweepDirection,
    stopHuntRiskScore,
    nearestLongLiqPrice,
    nearestShortLiqPrice,
    strongestLongWallPrice,
    strongestShortWallPrice,
    recommendedLongSl: roundSmart(markPrice - baseStopDist, markPrice),
    recommendedLongTp: roundSmart(markPrice + baseTpDist, markPrice),
    recommendedShortSl: roundSmart(markPrice + baseStopDist, markPrice),
    recommendedShortTp: roundSmart(Math.max(markPrice * 0.25, markPrice - baseTpDist), markPrice),
    longSafetyBufferPct: Number(((baseStopDist / markPrice) * 100).toFixed(2)),
    shortSafetyBufferPct: Number(((baseStopDist / markPrice) * 100).toFixed(2)),
    longClusterAdjustmentApplied: false,
    shortClusterAdjustmentApplied: false,
    clusters,
  };

  const optLong = optimizeSlTpWithLiquidationRadar({
    side: 'LONG',
    entryPrice: markPrice,
    stopLoss: baseSnapshot.recommendedLongSl,
    takeProfit: baseSnapshot.recommendedLongTp,
    atr14: atr,
    minRiskReward: minRr,
    radar: baseSnapshot,
  });

  const optShort = optimizeSlTpWithLiquidationRadar({
    side: 'SHORT',
    entryPrice: markPrice,
    stopLoss: baseSnapshot.recommendedShortSl,
    takeProfit: baseSnapshot.recommendedShortTp,
    atr14: atr,
    minRiskReward: minRr,
    radar: baseSnapshot,
  });

  return {
    ...baseSnapshot,
    recommendedLongSl: optLong.stopLoss,
    recommendedLongTp: optLong.takeProfit,
    recommendedShortSl: optShort.stopLoss,
    recommendedShortTp: optShort.takeProfit,
    longSafetyBufferPct: Number((((markPrice - optLong.stopLoss) / markPrice) * 100).toFixed(2)),
    shortSafetyBufferPct: Number((((optShort.stopLoss - markPrice) / markPrice) * 100).toFixed(2)),
    longClusterAdjustmentApplied: optLong.slAdjusted || optLong.tpAdjusted,
    shortClusterAdjustmentApplied: optShort.slAdjusted || optShort.tpAdjusted,
  };
}

export interface ZeroStopHuntResult {
  stopLoss: number;
  takeProfit: number;
  slAdjusted: boolean;
  tpAdjusted: boolean;
  avoidedCluster: LiquidationClusterZone | null;
  frontRunWall: LiquidationClusterZone | null;
  note: string;
}

/**
 * Adjusts Stop Loss outside same-side stop-hunt liquidation sweeps and optionally front-runs
 * an opposing major liquidity wall on Take Profit, while strictly preserving:
 * 1) Valid directional geometry (SL < Entry < TP for LONG; TP < Entry < SL for SHORT)
 * 2) Minimum Risk/Reward >= minRiskReward so Risk Engine never rejects the setup.
 */
export function optimizeSlTpWithLiquidationRadar(params: {
  side: OrderSide;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  atr14: number;
  minRiskReward: number;
  radar: LiquidationRadarSnapshot;
}): ZeroStopHuntResult {
  const { side, entryPrice, radar } = params;
  const baseDec = getSmartPriceDecimals(entryPrice);
  const dec = entryPrice < 0.05 ? baseDec + 2 : baseDec;
  const minPx = Math.pow(10, -dec);
  const atr = Math.max(params.atr14 || radar.atr14 || entryPrice * 0.015, entryPrice * 0.004);
  const rawInputStop = Math.abs(entryPrice - params.stopLoss);
  const rawInputTp = Math.abs(params.takeProfit - entryPrice);
  const inputRr = rawInputStop > 1e-12 && rawInputTp > 1e-12 ? rawInputTp / rawInputStop : 1.8;
  const requiredRr = Math.max(1.55, params.minRiskReward, Math.min(2.4, inputRr));

  const baseStopDist = Math.max(rawInputStop, atr * 0.9, entryPrice * 0.006);
  const maxAllowedStopDist = Math.max(atr * 2.65, baseStopDist * 1.45);
  const baseTargetDist = Math.max(rawInputTp, baseStopDist * requiredRr);

  let nextStop = params.stopLoss;
  let nextTp = params.takeProfit;
  let slAdjusted = false;
  let tpAdjusted = false;
  let avoidedCluster: LiquidationClusterZone | null = null;
  let frontRunWall: LiquidationClusterZone | null = null;

  if (side === 'LONG') {
    const initialSl = Math.max(minPx, Math.min(entryPrice - minPx, params.stopLoss));
    nextStop = initialSl;

    // Look for intense LONG_LIQ / SWING_POOL clusters sitting near or slightly below our planned SL
    const hazardousClusters = radar.clusters
      .filter(
        (c) =>
          c.side === 'LONG_LIQ' &&
          c.source !== 'OB_WALL' &&
          c.intensityScore >= 60 &&
          c.priceLevel < entryPrice - atr * 0.25 &&
          c.bandHigh >= initialSl - atr * 0.45 &&
          c.bandLow >= entryPrice - maxAllowedStopDist,
      )
      .sort((a, b) => b.intensityScore - a.intensityScore || a.bandLow - b.bandLow);

    if (hazardousClusters.length > 0) {
      const targetCluster = hazardousClusters[0];
      const safeSlCandidate = Math.max(minPx, targetCluster.bandLow - atr * 0.25);
      if (safeSlCandidate < initialSl && entryPrice - safeSlCandidate <= maxAllowedStopDist) {
        nextStop = safeSlCandidate;
        slAdjusted = true;
        avoidedCluster = targetCluster;
      }
    }

    const finalStopDist = Math.max(minPx, entryPrice - nextStop);
    const minRequiredTp = entryPrice + finalStopDist * Math.max(requiredRr, 1.62);
    const initialTp = Math.max(params.takeProfit, entryPrice + baseTargetDist);
    nextTp = Math.max(initialTp, minRequiredTp);

    // Check if an opposing SHORT_LIQ or OB_WALL sits right near TP so we can front-run it
    const currentRewardDist = nextTp - entryPrice;
    const blockingWalls = radar.clusters
      .filter(
        (c) =>
          c.side === 'SHORT_LIQ' &&
          c.intensityScore >= 65 &&
          c.priceLevel > entryPrice + finalStopDist * requiredRr &&
          c.priceLevel >= entryPrice + currentRewardDist * 0.82 &&
          c.priceLevel <= entryPrice + currentRewardDist * 1.05,
      )
      .sort((a, b) => a.priceLevel - b.priceLevel);

    if (blockingWalls.length > 0) {
      const wall = blockingWalls[0];
      const frontRunCandidate = wall.bandLow - atr * 0.12;
      if (
        frontRunCandidate >= minRequiredTp &&
        frontRunCandidate < nextTp &&
        (frontRunCandidate - entryPrice) / finalStopDist >= requiredRr
      ) {
        nextTp = frontRunCandidate;
        tpAdjusted = true;
        frontRunWall = wall;
      }
    }
  } else {
    // SHORT side
    const initialSl = Math.max(entryPrice + minPx, params.stopLoss);
    nextStop = initialSl;

    const hazardousClusters = radar.clusters
      .filter(
        (c) =>
          c.side === 'SHORT_LIQ' &&
          c.source !== 'OB_WALL' &&
          c.intensityScore >= 60 &&
          c.priceLevel > entryPrice + atr * 0.25 &&
          c.bandLow <= initialSl + atr * 0.45 &&
          c.bandHigh <= entryPrice + maxAllowedStopDist,
      )
      .sort((a, b) => b.intensityScore - a.intensityScore || b.bandHigh - a.bandHigh);

    if (hazardousClusters.length > 0) {
      const targetCluster = hazardousClusters[0];
      const safeSlCandidate = targetCluster.bandHigh + atr * 0.25;
      if (safeSlCandidate > initialSl && safeSlCandidate - entryPrice <= maxAllowedStopDist) {
        nextStop = safeSlCandidate;
        slAdjusted = true;
        avoidedCluster = targetCluster;
      }
    }

    const finalStopDist = Math.max(minPx, nextStop - entryPrice);
    const minRequiredTp = Math.max(minPx, entryPrice - finalStopDist * Math.max(requiredRr, 1.62));
    const initialTp = Math.max(minPx, Math.min(params.takeProfit, entryPrice - baseTargetDist));
    nextTp = Math.max(minPx, Math.min(initialTp, minRequiredTp));

    const currentRewardDist = Math.max(minPx, entryPrice - nextTp);
    const blockingWalls = radar.clusters
      .filter(
        (c) =>
          c.side === 'LONG_LIQ' &&
          c.intensityScore >= 65 &&
          c.priceLevel < entryPrice - finalStopDist * requiredRr &&
          c.priceLevel <= entryPrice - currentRewardDist * 0.82 &&
          c.priceLevel >= entryPrice - currentRewardDist * 1.05,
      )
      .sort((a, b) => b.priceLevel - a.priceLevel);

    if (blockingWalls.length > 0) {
      const wall = blockingWalls[0];
      const frontRunCandidate = Math.max(minPx, wall.bandHigh + atr * 0.12);
      if (
        frontRunCandidate <= minRequiredTp &&
        frontRunCandidate > nextTp &&
        (entryPrice - frontRunCandidate) / finalStopDist >= requiredRr
      ) {
        nextTp = frontRunCandidate;
        tpAdjusted = true;
        frontRunWall = wall;
      }
    }
  }

  const finalSl = roundSmart(nextStop, entryPrice);
  const finalTp = roundSmart(nextTp, entryPrice);

  // Absolute final directional + post-rounding R:R guarantee
  const safeSl =
    side === 'LONG'
      ? Math.min(finalSl, roundSmart(entryPrice - minPx, entryPrice))
      : Math.max(finalSl, roundSmart(entryPrice + minPx, entryPrice));
  const roundedStopDist = Math.abs(entryPrice - safeSl);
  const minSafeTp =
    side === 'LONG'
      ? roundSmart(entryPrice + roundedStopDist * requiredRr + minPx, entryPrice)
      : roundSmart(Math.max(minPx, entryPrice - roundedStopDist * requiredRr - minPx), entryPrice);
  const safeTp =
    side === 'LONG'
      ? Math.max(finalTp, minSafeTp)
      : Math.max(minPx, Math.min(finalTp, minSafeTp));

  const notes: string[] = [];
  if (slAdjusted && avoidedCluster) {
    notes.push(`SL dời an toàn ngoài vùng quét ${avoidedCluster.leverageTier}`);
  }
  if (tpAdjusted && frontRunWall) {
    notes.push(`TP front-run tường thanh khoản ${frontRunWall.leverageTier}`);
  }

  return {
    stopLoss: safeSl,
    takeProfit: safeTp,
    slAdjusted,
    tpAdjusted,
    avoidedCluster,
    frontRunWall,
    note:
      notes.length > 0
        ? notes.join(' · ')
        : 'SL/TP nằm ngoài vùng thanh lý tập trung',
  };
}
