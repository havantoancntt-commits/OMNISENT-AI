import type { MarketDirectoryEntry } from './symbolSearch.ts';
import type {
  BacktestResult,
  FullMarketOpportunity,
  MarketBreadthStats,
  MarketType,
  OrderSide,
  ScannerAssetUniverse,
  ScannerSetupArchetype,
  ScannerStrategyFocus,
  TradingSignal,
} from './types.ts';

const STABLECOIN_BASES = new Set([
  'USDT',
  'USDC',
  'FDUSD',
  'TUSD',
  'DAI',
  'USDE',
  'BUSD',
  'USDP',
  'PYUSD',
  'USD1',
  'RLUSD',
  'EURC',
  'EURI',
  'AEUR',
  'XUSD',
  'USDD',
  'FRAX',
  'CRVUSD',
  'GHO',
]);

const TRADFI_SYNTHETIC_PERP_BASES = new Set([
  'SPY',
  'QQQ',
  'TQQQ',
  'SQQQ',
  'DIA',
  'IWM',
  'SPX',
  'NDX',
  'DJI',
  'AAPL',
  'TSLA',
  'NVDA',
  'MSFT',
  'GOOGL',
  'GOOG',
  'AMZN',
  'META',
  'NFLX',
  'AVGO',
  'ORCL',
  'CRM',
  'COST',
  'QCOM',
  'MU',
  'GLW',
  'AMAT',
  'MRVL',
  'STRC',
  'COIN',
  'MSTR',
  'HOOD',
  'PLTR',
  'INTC',
  'AMD',
  'ARM',
  'TSM',
  'ASML',
  'EWY',
  'EWJ',
  'FXI',
  'TLT',
  'GLD',
  'SLV',
  'SAMSUNG',
  'SKHYNIX',
  'SKHY',
  'HYUNDAI',
  'ANTHROPIC',
  'OPENAI',
  'SPACEX',
  'STRIPE',
  'UNITREE',
  'ANT',
  'DRAM',
  'CL',
  'BZ',
  'NG',
  'XTI',
  'XBR',
  'XAU',
  'XAG',
  'USO',
  'UNG',
]);

export function isStablecoinBase(baseAsset: string): boolean {
  return STABLECOIN_BASES.has(baseAsset.trim().toUpperCase());
}

export function isTradFiSyntheticPerp(baseAsset: string): boolean {
  return TRADFI_SYNTHETIC_PERP_BASES.has(baseAsset.trim().toUpperCase());
}

export function computeDirectorySpreadBps(entry: MarketDirectoryEntry): number {
  if (!(entry.lastPrice > 0) || !(entry.askPrice >= entry.bidPrice) || !(entry.bidPrice > 0)) {
    return 0;
  }
  return Number((((entry.askPrice - entry.bidPrice) / entry.lastPrice) * 10_000).toFixed(2));
}

export function computeDirectoryVolatilityPct(entry: MarketDirectoryEntry): number {
  const high = entry.high24h ?? 0;
  const low = entry.low24h ?? 0;
  if (entry.lastPrice > 0 && high > low && low > 0) {
    return Number((((high - low) / entry.lastPrice) * 100).toFixed(2));
  }
  return Number((Math.abs(entry.change24hPct) * 1.45).toFixed(2));
}

export function computeDirectoryRangePositionPct(entry: MarketDirectoryEntry): number {
  const high = entry.high24h ?? 0;
  const low = entry.low24h ?? 0;
  if (high > low && entry.lastPrice > 0) {
    const pos = ((entry.lastPrice - low) / (high - low)) * 100;
    return Number(Math.max(0, Math.min(100, pos)).toFixed(1));
  }
  if (entry.change24hPct >= 5) return 82;
  if (entry.change24hPct <= -5) return 18;
  return Number(Math.max(10, Math.min(90, 50 + entry.change24hPct * 4)).toFixed(1));
}

export function computeDirectoryLiquidityScore(
  volume24hUsd: number,
  spreadBps: number,
): number {
  const volPts =
    volume24hUsd <= 0
      ? 0
      : Math.min(
          65,
          Math.max(8, Math.round((Math.log10(Math.max(10_000, volume24hUsd)) - 4) * 12.5)),
        );
  const spreadPts =
    spreadBps <= 0
      ? 22
      : spreadBps <= 1.5
        ? 35
        : spreadBps <= 4
          ? 30
          : spreadBps <= 10
            ? 23
            : spreadBps <= 25
              ? 14
              : 6;
  return Math.max(0, Math.min(100, volPts + spreadPts));
}

export function computeMarketBreadth(entries: MarketDirectoryEntry[]): MarketBreadthStats {
  const valid = entries.filter(
    (e) => e.lastPrice > 0 && e.volume24hUsd > 0 && !isStablecoinBase(e.baseAsset),
  );
  const uniqueSymbols = new Set<string>();
  const exchanges = new Set<string>();
  let advancersCount = 0;
  let declinersCount = 0;
  let totalVolume24hUsd = 0;
  let highLiquidityCount = 0;
  const vols: number[] = [];

  for (const e of valid) {
    uniqueSymbols.add(e.baseAsset.toUpperCase());
    exchanges.add(e.exchange);
    if (e.change24hPct > 0.15) advancersCount += 1;
    else if (e.change24hPct < -0.15) declinersCount += 1;
    totalVolume24hUsd += e.volume24hUsd;
    if (e.volume24hUsd >= 5_000_000) highLiquidityCount += 1;
    vols.push(computeDirectoryVolatilityPct(e));
  }

  vols.sort((a, b) => a - b);
  const medianVolatilityPct =
    vols.length > 0 ? Number(vols[Math.floor(vols.length / 2)].toFixed(2)) : 0;

  const totalDirectional = advancersCount + declinersCount;
  const breadthBullPct =
    totalDirectional > 0 ? Number(((advancersCount / totalDirectional) * 100).toFixed(1)) : 50;

  return {
    totalScannedPairs: valid.length,
    uniqueSymbolsCount: uniqueSymbols.size,
    exchangesCovered: Array.from(exchanges),
    advancersCount,
    declinersCount,
    breadthBullPct,
    totalVolume24hUsd: Math.round(totalVolume24hUsd),
    medianVolatilityPct,
    highLiquidityCount,
  };
}

export function classifySetupArchetype(
  entry: MarketDirectoryEntry,
  volatilityPct: number,
  rangePosPct: number,
): ScannerSetupArchetype {
  const funding = entry.fundingRatePct;
  const chg = entry.change24hPct;

  if (funding !== null && funding !== undefined) {
    if (funding <= -0.015 && chg >= -1.5) return 'SHORT_SQUEEZE';
    if (Math.abs(funding) >= 0.03) return 'FUNDING_EDGE';
  }
  if (chg >= 2.2 && rangePosPct >= 68 && volatilityPct >= 2.5) {
    return 'MOMENTUM_BREAKOUT';
  }
  if (chg <= -3.0 && rangePosPct <= 30) {
    return 'OVERSOLD_REBOUND';
  }
  return 'TREND_CONTINUATION';
}

export interface FullMarketPreScreenOptions {
  marketType?: MarketType | 'ALL';
  exchange?: string;
  minVolumeUsd?: number;
  maxSpreadBps?: number;
  strategyFocus?: ScannerStrategyFocus;
  assetUniverse?: ScannerAssetUniverse;
  dedupeBySymbol?: boolean;
  limit?: number;
}

export function preScreenMarketDirectory(
  entries: MarketDirectoryEntry[],
  options?: FullMarketPreScreenOptions,
): FullMarketOpportunity[] {
  const marketType = options?.marketType ?? 'ALL';
  const exchange = options?.exchange ?? 'ALL';
  const minVolumeUsd = Math.max(0, options?.minVolumeUsd ?? 1_000_000);
  const maxSpreadBps = options?.maxSpreadBps ?? 45;
  const strategyFocus = options?.strategyFocus ?? 'ALL';
  const assetUniverse = options?.assetUniverse ?? 'CRYPTO';
  const dedupeBySymbol = options?.dedupeBySymbol ?? true;
  const limit = Math.min(60, Math.max(1, options?.limit ?? 24));

  const scored: FullMarketOpportunity[] = [];

  for (const entry of entries) {
    if (!(entry.lastPrice > 0) || !(entry.volume24hUsd >= minVolumeUsd)) continue;
    if (isStablecoinBase(entry.baseAsset)) continue;
    if (assetUniverse === 'CRYPTO' && isTradFiSyntheticPerp(entry.baseAsset)) continue;
    if (marketType !== 'ALL' && entry.marketType !== marketType) continue;
    if (exchange !== 'ALL' && entry.exchange !== exchange) continue;

    const spreadBps = computeDirectorySpreadBps(entry);
    if (spreadBps > maxSpreadBps) continue;

    const volatilityPct = computeDirectoryVolatilityPct(entry);
    const rangePositionPct = computeDirectoryRangePositionPct(entry);
    const liquidityScore = computeDirectoryLiquidityScore(entry.volume24hUsd, spreadBps);
    const archetype = classifySetupArchetype(entry, volatilityPct, rangePositionPct);

    // 1) Liquidity & execution efficiency (0 - 28)
    const liqPts = (liquidityScore / 100) * 28;

    // 2) Sweet-spot volatility efficiency (2.5% - 14% 24h range) (0 - 22)
    let volPts = 0;
    if (volatilityPct >= 2.5 && volatilityPct <= 14) {
      volPts = 22;
    } else if (volatilityPct > 14 && volatilityPct <= 24) {
      volPts = 15;
    } else if (volatilityPct >= 1.2 && volatilityPct < 2.5) {
      volPts = 11;
    } else if (volatilityPct > 24 && volatilityPct <= 38) {
      volPts = 7;
    } else {
      volPts = 3;
    }

    // 3) Directional edge & structural price location (0 - 24)
    const chgAbs = Math.abs(entry.change24hPct);
    let edgePts = 8;
    if (entry.change24hPct >= 1.8 && entry.change24hPct <= 16 && rangePositionPct >= 62) {
      edgePts = 20 + (rangePositionPct >= 75 ? 4 : 0);
    } else if (entry.change24hPct <= -2.0 && entry.change24hPct >= -16 && rangePositionPct <= 34) {
      edgePts = 18 + (rangePositionPct <= 20 ? 4 : 0);
    } else if (chgAbs >= 1.0 && chgAbs <= 20) {
      edgePts = 13;
    }

    // 4) Funding & Positioning Edge (0 - 14)
    let fundingPts = 6;
    const funding = entry.fundingRatePct;
    if (funding !== null && funding !== undefined) {
      if (funding <= -0.015 && entry.change24hPct > -2) {
        fundingPts = 14; // Short squeeze fuel
      } else if (Math.abs(funding) <= 0.015) {
        fundingPts = 11; // Healthy non-crowded positioning
      } else if (funding >= 0.04 && entry.change24hPct > 0) {
        fundingPts = 3; // Crowded longs penalty
      }
    }

    // 5) Strategy focus alignment (0 - 12)
    let focusPts = 6;
    if (strategyFocus === 'HIGH_PROFIT_ALPHA') {
      focusPts =
        volatilityPct >= 3 && liquidityScore >= 65 && (rangePositionPct >= 65 || rangePositionPct <= 30)
          ? 12
          : 4;
    } else if (strategyFocus === 'MOMENTUM_BREAKOUT') {
      focusPts = archetype === 'MOMENTUM_BREAKOUT' ? 12 : entry.change24hPct > 1.5 ? 8 : 2;
    } else if (strategyFocus === 'MEAN_REVERSION') {
      focusPts = archetype === 'OVERSOLD_REBOUND' || rangePositionPct <= 28 || rangePositionPct >= 82 ? 12 : 3;
    } else if (strategyFocus === 'FUNDING_SQUEEZE') {
      focusPts = archetype === 'SHORT_SQUEEZE' || archetype === 'FUNDING_EDGE' ? 12 : 2;
    }

    const preScreenScore = Number(
      Math.max(1, Math.min(100, liqPts + volPts + edgePts + fundingPts + focusPts)).toFixed(1),
    );

    const estDirection: OrderSide | 'NO_TRADE' =
      archetype === 'MOMENTUM_BREAKOUT' || archetype === 'SHORT_SQUEEZE' || entry.change24hPct >= 1.5
        ? 'LONG'
        : entry.marketType !== 'SPOT' && entry.change24hPct <= -2.5 && rangePositionPct >= 35
          ? 'SHORT'
          : archetype === 'OVERSOLD_REBOUND'
            ? 'LONG'
            : 'NO_TRADE';

    scored.push({
      rank: 0,
      symbol: entry.symbol,
      baseAsset: entry.baseAsset,
      quoteAsset: entry.quoteAsset,
      exchange: entry.exchange,
      exchangeId: entry.exchangeId,
      marketType: entry.marketType,
      lastPrice: entry.lastPrice,
      bidPrice: entry.bidPrice,
      askPrice: entry.askPrice,
      change24hPct: entry.change24hPct,
      volume24hUsd: entry.volume24hUsd,
      spreadBps,
      volatility24hPct: volatilityPct,
      rangePositionPct,
      fundingRatePct: entry.fundingRatePct ?? null,
      openInterestUsd: entry.openInterestUsd ?? null,
      maxLeverage: entry.maxLeverage,
      archetype,
      preScreenScore,
      liquidityScore,
      deepVerified: false,
      direction: estDirection,
      signalState: 'PRE_SCREEN',
      confluenceScore: Math.round(preScreenScore * 0.78),
      htfAlignment: 'NEUTRAL',
      expectedValueR: 0,
      riskReward: 0,
      recommendedRiskPct: 0.5,
      entryPrice: entry.lastPrice,
      stopLoss: 0,
      takeProfit: 0,
      backtestWinRatePct: null,
      backtestProfitFactor: null,
      backtestReturnPct: null,
      backtestTradesCount: 0,
      compositeAlphaScore: preScreenScore,
      reasoningSummary: `Sơ lọc vi cấu trúc: ${archetype} · Vol 24h $${(entry.volume24hUsd / 1_000_000).toFixed(1)}M · Biên độ ${volatilityPct}% · Vị trí nến ngày ${rangePositionPct}%.`,
    });
  }

  scored.sort((a, b) => {
    if (Math.abs(b.preScreenScore - a.preScreenScore) > 0.4) {
      return b.preScreenScore - a.preScreenScore;
    }
    return b.volume24hUsd - a.volume24hUsd;
  });

  if (!dedupeBySymbol) {
    return scored.slice(0, limit).map((item, i) => ({ ...item, rank: i + 1 }));
  }

  const seenSymbols = new Set<string>();
  const deduped: FullMarketOpportunity[] = [];
  for (const item of scored) {
    const key = `${item.baseAsset.toUpperCase()}/${item.quoteAsset.toUpperCase()}`;
    if (seenSymbols.has(key)) continue;
    seenSymbols.add(key);
    deduped.push({ ...item, rank: deduped.length + 1 });
    if (deduped.length >= limit) break;
  }
  return deduped;
}

export function buildDeepVerifiedOpportunity(params: {
  stage1: FullMarketOpportunity;
  signal: TradingSignal;
  backtest: BacktestResult | null;
}): FullMarketOpportunity {
  const { stage1, signal, backtest } = params;
  const htfAlignment = signal.htfAlignment ?? 'NEUTRAL';
  const confluenceScore = signal.quantAlpha?.confluenceScore ?? signal.quantScore;
  const expectedValueR = signal.expectedValueR ?? 0;

  const btTrades = backtest?.totalTrades ?? 0;
  const btWin = btTrades > 0 && backtest ? backtest.winRatePct : null;
  const btPf = btTrades > 0 && backtest ? backtest.profitFactor : null;
  const btRet = btTrades > 0 && backtest ? backtest.totalReturnPct : null;

  const isApproved = signal.state === 'APPROVED' && signal.direction !== 'NO_TRADE';
  const hasActionableDir = signal.direction !== 'NO_TRADE';
  const htfAligned = htfAlignment === 'ALIGNED_BULL' || htfAlignment === 'ALIGNED_BEAR';
  const htfPts = htfAligned ? 28 : htfAlignment === 'COUNTER_TREND' ? -22 : 0;

  const btCredibility = btTrades >= 3 ? Math.min(1, btTrades / 5) : 0;
  const cappedPf = btPf !== null ? Math.min(btPf, 3.5) : 0;
  const btBonus =
    btTrades >= 3 && btWin !== null && btPf !== null
      ? btCredibility *
        ((btWin - 45) * 0.45 + cappedPf * 8 + Math.max(-10, Math.min(18, btRet ?? 0)))
      : 0;

  const compositeAlphaScore = Number(
    (
      (isApproved ? 1000 : hasActionableDir ? 320 : 0) +
      expectedValueR * 75 +
      confluenceScore * 1.65 +
      signal.confidenceScore * 1.45 +
      stage1.preScreenScore * 0.6 +
      htfPts +
      btBonus
    ).toFixed(1),
  );

  return {
    ...stage1,
    deepVerified: true,
    direction: signal.direction,
    signalState: signal.state,
    confluenceScore,
    htfAlignment,
    expectedValueR,
    riskReward: signal.riskReward,
    recommendedRiskPct: signal.recommendedRiskPct ?? 0.5,
    entryPrice: stage1.lastPrice,
    stopLoss: signal.stopLoss,
    takeProfit: signal.takeProfitLevels[1] ?? signal.takeProfitLevels[0] ?? 0,
    backtestWinRatePct: btWin,
    backtestProfitFactor: btPf,
    backtestReturnPct: btRet,
    backtestTradesCount: btTrades,
    compositeAlphaScore,
    reasoningSummary: signal.reasoningSummary,
  };
}

export function rankDeepOpportunities(
  items: FullMarketOpportunity[],
  directionFilter: OrderSide | 'ALL' = 'ALL',
): FullMarketOpportunity[] {
  const filtered =
    directionFilter === 'ALL'
      ? items
      : items.filter((item) => item.direction === directionFilter);

  const sorted = [...filtered].sort((a, b) => {
    const aApp = a.signalState === 'APPROVED' && a.direction !== 'NO_TRADE' ? 1 : 0;
    const bApp = b.signalState === 'APPROVED' && b.direction !== 'NO_TRADE' ? 1 : 0;
    if (aApp !== bApp) return bApp - aApp;
    if (b.compositeAlphaScore !== a.compositeAlphaScore) {
      return b.compositeAlphaScore - a.compositeAlphaScore;
    }
    if (b.expectedValueR !== a.expectedValueR) {
      return b.expectedValueR - a.expectedValueR;
    }
    return b.preScreenScore - a.preScreenScore;
  });

  return sorted.map((item, idx) => ({ ...item, rank: idx + 1 }));
}
