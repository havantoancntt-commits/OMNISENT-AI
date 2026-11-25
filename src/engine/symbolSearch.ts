import type { MarketType } from './types.ts';

export interface MarketDirectoryEntry {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  exchange: 'Binance' | 'Bybit' | 'OKX' | 'Kraken' | 'Coinbase Advanced';
  exchangeId: 'binance' | 'bybit' | 'okx' | 'kraken' | 'coinbase';
  marketType: MarketType;
  nativeSymbol: string;
  lastPrice: number;
  bidPrice: number;
  askPrice: number;
  change24hPct: number;
  volume24hUsd: number;
  maxLeverage: number;
  high24h?: number;
  low24h?: number;
  fundingRatePct?: number | null;
  openInterestUsd?: number | null;
}

const COIN_ALIAS_MAP: Record<string, string[]> = {
  BITCOIN: ['BTC'],
  ETHEREUM: ['ETH'],
  SOLANA: ['SOL'],
  BINANCE: ['BNB'],
  RIPPLE: ['XRP'],
  CARDANO: ['ADA'],
  DOGECOIN: ['DOGE'],
  AVALANCHE: ['AVAX'],
  CHAINLINK: ['LINK'],
  POLKADOT: ['DOT'],
  LITECOIN: ['LTC'],
  TONCOIN: ['TON'],
  TELEGRAM: ['TON'],
  POLYGON: ['POL', 'MATIC'],
  BITTENSOR: ['TAO'],
  UNISWAP: ['UNI'],
  TRON: ['TRX'],
  COSMOS: ['ATOM'],
  ARBITRUM: ['ARB'],
  OPTIMISM: ['OP'],
  CELESTIA: ['TIA'],
  INJECTIVE: ['INJ'],
  FILECOIN: ['FIL'],
  WORLDCOIN: ['WLD'],
  ETHENA: ['ENA'],
  PENDLE: ['PENDLE'],
  FETCH: ['FET'],
  ARTIFICIAL: ['FET', 'TAO', 'RENDER'],
  RENDER: ['RENDER', 'RNDR'],
  SHIBA: ['SHIB'],
  PEPE: ['PEPE'],
  DOGWIFHAT: ['WIF'],
  BONK: ['BONK'],
  FLOKI: ['FLOKI'],
  APTOS: ['APT'],
  SUI: ['SUI'],
  HEDERA: ['HBAR'],
  STELLAR: ['XLM'],
  KASPA: ['KAS'],
  HYPERLIQUID: ['HYPE'],
  GOLD: ['PAXG', 'XAUT'],
  ONDO: ['ONDO'],
  AAVE: ['AAVE'],
  MAKER: ['MKR'],
  NEAR: ['NEAR'],
  ALGORAND: ['ALGO'],
  FANTOM: ['FTM', 'S'],
  SONIC: ['S'],
  SEI: ['SEI'],
  STARKNET: ['STRK'],
  ZKSYNC: ['ZK'],
  LAYERZERO: ['ZRO'],
  PYTH: ['PYTH'],
  JUPITER: ['JUP'],
  BITCOINCASH: ['BCH'],
  MONERO: ['XMR'],
  ETHEREUMCLASSIC: ['ETC'],
  INTERNETCOMPUTER: ['ICP'],
  VECHAIN: ['VET'],
  PUDGY: ['PENGU'],
  OFFICIALTRUMP: ['TRUMP'],
};

export interface ParsedSearchQuery {
  raw: string;
  normalizedBaseQuery: string;
  aliasBases: string[];
  marketTypeHint: MarketType | null;
  exchangeHint: string | null;
}

export function getSmartPriceDecimals(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 2;
  if (price < 0.0001) return 8;
  if (price < 0.01) return 6;
  if (price < 2) return 4;
  if (price < 100) return 3;
  return 2;
}

export function formatAssetPrice(price: number): string {
  if (!Number.isFinite(price) || price <= 0) return '--';
  const dec = getSmartPriceDecimals(price);
  if (price >= 1000) {
    return `$${price.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}`;
  }
  return `$${price.toFixed(dec)}`;
}

export function formatCompactUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '--';
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(2)}B`;
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`;
  return `$${usd.toFixed(0)}`;
}

export function parseMarketSearchQuery(rawQuery: string): ParsedSearchQuery {
  const trimmed = rawQuery.trim();
  const upper = trimmed.toUpperCase();
  const tokens = upper.split(/[\s,/_\-]+/).filter(Boolean);

  let marketTypeHint: MarketType | null = null;
  let exchangeHint: string | null = null;
  const symbolTokens: string[] = [];

  for (const tok of tokens) {
    if (tok === 'PERP' || tok === 'PERPETUAL' || tok === 'FUTURES' || tok === 'SWAP') {
      marketTypeHint = 'PERPETUAL';
      continue;
    }
    if (tok === 'SPOT') {
      marketTypeHint = 'SPOT';
      continue;
    }
    if (tok === 'BINANCE' || tok === 'BYBIT' || tok === 'OKX' || tok === 'KRAKEN' || tok === 'COINBASE') {
      exchangeHint = tok;
      continue;
    }
    if ((tok === 'USDT' || tok === 'USD' || tok === 'USDC') && symbolTokens.length > 0) {
      continue;
    }
    symbolTokens.push(tok);
  }

  let baseQuery = symbolTokens.join('');
  if (baseQuery.endsWith('USDT') && baseQuery.length > 4) {
    baseQuery = baseQuery.slice(0, -4);
  } else if (baseQuery.endsWith('USDC') && baseQuery.length > 4) {
    baseQuery = baseQuery.slice(0, -4);
  } else if (baseQuery.endsWith('USD') && baseQuery.length > 3 && !COIN_ALIAS_MAP[baseQuery]) {
    baseQuery = baseQuery.slice(0, -3);
  }

  const aliasSet = new Set<string>();
  const joinedAlpha = upper.replace(/[^A-Z]/g, '');
  for (const [aliasName, bases] of Object.entries(COIN_ALIAS_MAP)) {
    if (
      (baseQuery.length >= 2 && aliasName.startsWith(baseQuery)) ||
      (joinedAlpha.length >= 3 && aliasName.includes(joinedAlpha))
    ) {
      for (const b of bases) aliasSet.add(b);
    }
  }

  return {
    raw: trimmed,
    normalizedBaseQuery: baseQuery,
    aliasBases: Array.from(aliasSet),
    marketTypeHint,
    exchangeHint,
  };
}

export function normalizeSymbolInput(raw: string): string {
  const clean = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (!clean) return 'BTC/USDT';
  if (clean.includes('/')) return clean;
  if (clean.includes('-SWAP')) {
    const parts = clean.replace('-SWAP', '').split('-');
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  }
  if (clean.includes('-')) {
    const [b, q] = clean.split('-');
    if (b && q) return `${b}/${q}`;
  }
  if (clean.endsWith('USDT') && clean.length > 4) {
    return `${clean.slice(0, -4)}/USDT`;
  }
  if (clean.endsWith('USDC') && clean.length > 4) {
    return `${clean.slice(0, -4)}/USDC`;
  }
  if (clean.endsWith('USD') && clean.length > 3) {
    return `${clean.slice(0, -3)}/USD`;
  }
  return `${clean}/USDT`;
}

export function scoreDirectoryEntry(
  entry: MarketDirectoryEntry,
  parsed: ParsedSearchQuery,
): number {
  const base = entry.baseAsset.toUpperCase();
  const baseUnscaled = base.startsWith('1000') && base.length > 4 ? base.slice(4) : base;
  const sym = entry.symbol.toUpperCase();
  const q = parsed.normalizedBaseQuery;

  if (parsed.marketTypeHint && entry.marketType !== parsed.marketTypeHint) {
    return -1;
  }
  if (
    parsed.exchangeHint &&
    !entry.exchange.toUpperCase().includes(parsed.exchangeHint) &&
    entry.exchangeId.toUpperCase() !== parsed.exchangeHint
  ) {
    return -1;
  }

  let matchScore = 0;
  if (!q) {
    matchScore = 10;
  } else if (base === q || sym === parsed.raw.toUpperCase()) {
    matchScore = 1000;
  } else if (baseUnscaled === q) {
    matchScore = 910;
  } else if (parsed.aliasBases.includes(base) || parsed.aliasBases.includes(baseUnscaled)) {
    matchScore = 820;
  } else if (base.startsWith(q) || baseUnscaled.startsWith(q)) {
    matchScore = 640 - Math.min(80, (base.length - q.length) * 6);
  } else if (sym.startsWith(q)) {
    matchScore = 520;
  } else if (base.includes(q) || sym.includes(q)) {
    matchScore = 340;
  } else {
    return -1;
  }

  // Prefer high-liquidity contracts & PERPETUAL/Binance when tie-breaking
  const volBoost =
    entry.volume24hUsd > 0 ? Math.min(180, Math.log10(Math.max(1, entry.volume24hUsd)) * 18) : 0;
  const typeBoost = entry.marketType === 'PERPETUAL' ? 14 : 6;
  const exBoost =
    entry.exchangeId === 'binance'
      ? 12
      : entry.exchangeId === 'bybit'
        ? 9
        : entry.exchangeId === 'okx'
          ? 7
          : 4;

  return matchScore + volBoost + typeBoost + exBoost;
}

export function searchMarketDirectory(
  entries: MarketDirectoryEntry[],
  query: string,
  options?: {
    marketType?: MarketType | 'ALL';
    exchange?: string;
    limit?: number;
  },
): MarketDirectoryEntry[] {
  const parsed = parseMarketSearchQuery(query);
  const limit = options?.limit ?? 36;
  const mktFilter = options?.marketType ?? 'ALL';
  const exFilter = options?.exchange ?? 'ALL';

  const scored: Array<{ entry: MarketDirectoryEntry; score: number }> = [];
  for (const entry of entries) {
    if (mktFilter !== 'ALL' && entry.marketType !== mktFilter) continue;
    if (exFilter !== 'ALL' && entry.exchange !== exFilter) continue;
    if (!(entry.lastPrice > 0)) continue;

    const score = scoreDirectoryEntry(entry, parsed);
    if (score > 0) {
      scored.push({ entry, score });
    }
  }

  scored.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 5) return b.score - a.score;
    return b.entry.volume24hUsd - a.entry.volume24hUsd;
  });

  // Deduplicate identical symbol+marketType+exchange
  const seen = new Set<string>();
  const out: MarketDirectoryEntry[] = [];
  for (const item of scored) {
    const key = `${item.entry.symbol}|${item.entry.marketType}|${item.entry.exchangeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item.entry);
    if (out.length >= limit) break;
  }
  return out;
}
