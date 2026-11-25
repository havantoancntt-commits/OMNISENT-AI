import type { ExchangeAuthScheme, MarketType } from './types.ts';

export interface ExchangeSpec {
  id: string;
  name: string;
  tierLabel: string;
  authScheme: ExchangeAuthScheme;
  authLabel: string;
  requiresPassphrase: boolean;
  supportsTestnet: boolean;
  supportedMarkets: MarketType[];
  mainnetProbeLabel: string;
  testnetProbeLabel?: string;
  permissionChecklist: string[];
  ipWhitelistTip: string;
}

export const EXCHANGE_SPECS: Record<string, ExchangeSpec> = {
  binance: {
    id: 'binance',
    name: 'Binance',
    tierLabel: 'Top 1 Thanh khoản Toàn cầu',
    authScheme: 'HMAC_SHA256',
    authLabel: 'HMAC-SHA256 Query Signature',
    requiresPassphrase: false,
    supportsTestnet: true,
    supportedMarkets: ['SPOT', 'FUTURES', 'PERPETUAL', 'MARGIN'],
    mainnetProbeLabel: 'api.binance.com/api/v3/account',
    testnetProbeLabel: 'testnet.binance.vision/api/v3/account',
    permissionChecklist: [
      'Enable Reading (Bắt buộc)',
      'Enable Spot & Margin Trading / Enable Futures (Theo nhu cầu)',
      'KHÔNG tích "Enable Withdrawals" (Hệ thống tự động chặn nếu phát hiện)',
    ],
    ipWhitelistTip: 'Khuyến nghị gắn IP máy chủ vào mục Restrict access to trusted IPs only.',
  },
  bybit: {
    id: 'bybit',
    name: 'Bybit',
    tierLabel: 'Top Derivatives V5 Unified',
    authScheme: 'HMAC_SHA256',
    authLabel: 'V5 HMAC-SHA256 (X-BAPI-SIGN)',
    requiresPassphrase: false,
    supportsTestnet: true,
    supportedMarkets: ['SPOT', 'FUTURES', 'PERPETUAL'],
    mainnetProbeLabel: 'api.bybit.com/v5/user/query-api',
    testnetProbeLabel: 'api-testnet.bybit.com/v5/user/query-api',
    permissionChecklist: [
      'System-generated API Keys -> Read-Write',
      'Bật Unified Trading (Spot / Contract Trade)',
      'Tắt hoàn toàn Assets -> Withdraw / Account Transfer',
    ],
    ipWhitelistTip: 'Chọn No IP restriction chỉ khi dùng Testnet; Mainnet nên khóa IP cố định.',
  },
  okx: {
    id: 'okx',
    name: 'OKX',
    tierLabel: 'Top Tier Unified Account V5',
    authScheme: 'HMAC_SHA256_PASSPHRASE',
    authLabel: 'HMAC-SHA256 + Base64 + Passphrase',
    requiresPassphrase: true,
    supportsTestnet: true,
    supportedMarkets: ['SPOT', 'FUTURES', 'PERPETUAL', 'MARGIN'],
    mainnetProbeLabel: 'www.okx.com/api/v5/account/config',
    testnetProbeLabel: 'www.okx.com/api/v5/account/config (Demo Header)',
    permissionChecklist: [
      'Cần đủ 3 thành phần: API Key + Secret Key + Passphrase',
      'Bật quyền Read và Trade (Spot/Futures)',
      'KHÔNG cấp quyền Withdraw',
    ],
    ipWhitelistTip: 'Chế độ Testnet sử dụng Demo Trading API Key với header x-simulated-trading: 1.',
  },
  coinbase: {
    id: 'coinbase',
    name: 'Coinbase Advanced',
    tierLabel: 'Sàn Niêm yết Mỹ (Institutional)',
    authScheme: 'ECDSA_OR_HMAC',
    authLabel: 'CDP ECDSA / Advanced Trade Sign',
    requiresPassphrase: false,
    supportsTestnet: false,
    supportedMarkets: ['SPOT', 'FUTURES'],
    mainnetProbeLabel: 'api.coinbase.com/api/v3/brokerage/accounts',
    permissionChecklist: [
      'Hỗ trợ API Key từ Coinbase Developer Platform (View + Trade)',
      'Không bật quyền Transfer / Withdraw trên API key',
    ],
    ipWhitelistTip: 'Khuyến nghị gắn IP Allowlist trong Coinbase API Management.',
  },
  kraken: {
    id: 'kraken',
    name: 'Kraken',
    tierLabel: 'Sàn Tier-1 Bảo mật Châu Âu/Mỹ',
    authScheme: 'HMAC_SHA512',
    authLabel: 'HMAC-SHA512 + SHA256 Nonce',
    requiresPassphrase: false,
    supportsTestnet: false,
    supportedMarkets: ['SPOT', 'FUTURES', 'MARGIN'],
    mainnetProbeLabel: 'api.kraken.com/0/private/Balance',
    permissionChecklist: [
      'Bật Query Funds, Query Open Orders & Trades',
      'Bật Create & Modify Orders nếu giao dịch tự động',
      'Tắt Withdraw Funds và Export Data không cần thiết',
    ],
    ipWhitelistTip: 'Kraken Private Key phải ở định dạng Base64 chuẩn do sàn cấp.',
  },
  bitget: {
    id: 'bitget',
    name: 'Bitget',
    tierLabel: 'Top Copy & Futures Liquidity',
    authScheme: 'HMAC_SHA256_PASSPHRASE',
    authLabel: 'V2 HMAC-SHA256 + Passphrase',
    requiresPassphrase: true,
    supportsTestnet: false,
    supportedMarkets: ['SPOT', 'FUTURES', 'PERPETUAL'],
    mainnetProbeLabel: 'api.bitget.com/api/v2/spot/account/info',
    permissionChecklist: [
      'Nhập đầy đủ Passphrase đã đặt khi tạo API',
      'Bật Read + Spot/Futures Trade',
      'Không bật Withdraw',
    ],
    ipWhitelistTip: 'Bitget yêu cầu liên kết ít nhất 1 IP nếu bật quyền Trade.',
  },
  kucoin: {
    id: 'kucoin',
    name: 'KuCoin',
    tierLabel: 'Top Altcoin Spot & Futures',
    authScheme: 'HMAC_SHA256_PASSPHRASE',
    authLabel: 'HMAC-SHA256 + Signed Passphrase',
    requiresPassphrase: true,
    supportsTestnet: false,
    supportedMarkets: ['SPOT', 'FUTURES', 'MARGIN'],
    mainnetProbeLabel: 'api.kucoin.com/api/v1/accounts',
    permissionChecklist: [
      'Yêu cầu API Passphrase (mã hóa bằng HMAC trước khi gửi)',
      'Bật General + Spot/Futures Trade, tắt Transfer/Withdraw',
    ],
    ipWhitelistTip: 'Khóa IP trên KuCoin để tăng hạn mức rate limit API.',
  },
  gateio: {
    id: 'gateio',
    name: 'Gate.io',
    tierLabel: 'Đa dạng Token & Perpetual',
    authScheme: 'HMAC_SHA512',
    authLabel: 'APIv4 HMAC-SHA512',
    requiresPassphrase: false,
    supportsTestnet: false,
    supportedMarkets: ['SPOT', 'FUTURES', 'PERPETUAL'],
    mainnetProbeLabel: 'api.gateio.ws/api/v4/spot/accounts',
    permissionChecklist: [
      'Chọn APIv4 Keys khi khởi tạo trên Gate.io',
      'Chỉ cấp quyền Spot Trade / Futures / Wallet Read-Only',
      'Không tích Withdraw',
    ],
    ipWhitelistTip: 'APIv4 trên Gate.io sử dụng chữ ký SHA-512.',
  },
  mexc: {
    id: 'mexc',
    name: 'MEXC',
    tierLabel: 'Phí Maker 0% · Tốc độ cao',
    authScheme: 'HMAC_SHA256',
    authLabel: 'HMAC-SHA256 Query Signature',
    requiresPassphrase: false,
    supportsTestnet: false,
    supportedMarkets: ['SPOT', 'FUTURES', 'PERPETUAL'],
    mainnetProbeLabel: 'api.mexc.com/api/v3/account',
    permissionChecklist: [
      'Bật Account View và Trade (Spot/Futures)',
      'Không cấp quyền Withdraw',
    ],
    ipWhitelistTip: 'Khuyến nghị gắn IP whitelist để tránh khóa tự động sau 90 ngày.',
  },
  htx: {
    id: 'htx',
    name: 'HTX',
    tierLabel: 'Thanh khoản Spot & Derivatives',
    authScheme: 'HMAC_SHA256',
    authLabel: 'HMAC-SHA256 URL-Canonical Sign',
    requiresPassphrase: false,
    supportsTestnet: false,
    supportedMarkets: ['SPOT', 'FUTURES'],
    mainnetProbeLabel: 'api.huobi.pro/v1/account/accounts',
    permissionChecklist: [
      'Access Key + Secret Key chuẩn HTX Global',
      'Chỉ bật Read-Only và Trade, tắt Withdraw',
    ],
    ipWhitelistTip: 'Mỗi Access Key trên HTX nên giới hạn tối đa 20 IP tin cậy.',
  },
  deribit: {
    id: 'deribit',
    name: 'Deribit',
    tierLabel: 'Top Options & BTC/ETH Perpetual',
    authScheme: 'CLIENT_SIGNATURE',
    authLabel: 'OAuth2 Client Credentials (v2)',
    requiresPassphrase: false,
    supportsTestnet: true,
    supportedMarkets: ['FUTURES', 'PERPETUAL'],
    mainnetProbeLabel: 'www.deribit.com/api/v2/public/auth',
    testnetProbeLabel: 'test.deribit.com/api/v2/public/auth',
    permissionChecklist: [
      'Dùng Client ID (API Key) + Client Secret',
      'Đặt scope Account: read, Trade: read_write, Wallet: none',
    ],
    ipWhitelistTip: 'Deribit hỗ trợ Testnet riêng tại test.deribit.com.',
  },
};

export function getExchangeSpec(exchangeId: string): ExchangeSpec {
  return (
    EXCHANGE_SPECS[exchangeId.toLowerCase()] ?? {
      id: exchangeId,
      name: exchangeId.toUpperCase(),
      tierLabel: 'Exchange Connector',
      authScheme: 'HMAC_SHA256',
      authLabel: 'HMAC-SHA256',
      requiresPassphrase: false,
      supportsTestnet: false,
      supportedMarkets: ['SPOT', 'PERPETUAL'],
      mainnetProbeLabel: 'Exchange Private REST',
      permissionChecklist: [
        'Bật quyền Read và Trade theo nhu cầu',
        'Không bật quyền Withdraw',
      ],
      ipWhitelistTip: 'Gắn IP whitelist để bảo vệ khóa API.',
    }
  );
}

const EXCHANGE_EN_META: Record<
  string,
  { tierLabel: string; permissionChecklist: string[]; ipWhitelistTip: string }
> = {
  binance: {
    tierLabel: '#1 Global Spot & Derivatives Liquidity',
    permissionChecklist: [
      'Enable Reading (Mandatory)',
      'Enable Spot & Margin Trading / Enable Futures as needed',
      'DO NOT check "Enable Withdrawals" (Auto-blocked by OMNISENT)',
    ],
    ipWhitelistTip: 'Bind server IPs under "Restrict access to trusted IPs only".',
  },
  bybit: {
    tierLabel: 'Top V5 Unified Derivatives Venue',
    permissionChecklist: [
      'System-generated API Keys -> Read-Write',
      'Enable Unified Trading (Spot / Contract Trade)',
      'Keep Assets -> Withdraw / Account Transfer disabled',
    ],
    ipWhitelistTip: 'Use "No IP restriction" for Testnet only; pin static IPs on Mainnet.',
  },
  okx: {
    tierLabel: 'Tier-1 Unified Account V5',
    permissionChecklist: [
      'Requires all 3 credentials: API Key + Secret Key + Passphrase',
      'Grant Read and Trade (Spot/Futures) scopes',
      'DO NOT enable Withdraw permissions',
    ],
    ipWhitelistTip: 'Testnet uses Demo Trading keys authenticated with x-simulated-trading: 1.',
  },
  coinbase: {
    tierLabel: 'US Listed Institutional Venue',
    permissionChecklist: [
      'Supports Coinbase Developer Platform keys (View + Trade)',
      'Keep Transfer / Withdraw permissions disabled',
    ],
    ipWhitelistTip: 'Pin trusted server IPs inside Coinbase API Management allowlist.',
  },
  kraken: {
    tierLabel: 'Tier-1 EU/US Regulated Security',
    permissionChecklist: [
      'Enable Query Funds, Query Open Orders & Trades',
      'Enable Create & Modify Orders for automated routing',
      'Keep Withdraw Funds disabled',
    ],
    ipWhitelistTip: 'Kraken Private Key must remain in standard Base64 format.',
  },
  bitget: {
    tierLabel: 'Top Copy & Futures Liquidity',
    permissionChecklist: [
      'Enter the exact API Passphrase created with the key',
      'Enable Read + Spot/Futures Trade',
      'Leave Withdraw unchecked',
    ],
    ipWhitelistTip: 'Bitget requires at least one whitelisted IP when Trade scope is active.',
  },
  kucoin: {
    tierLabel: 'Broad Altcoin Spot & Futures',
    permissionChecklist: [
      'Requires API Passphrase (HMAC-signed in headers)',
      'Enable General + Spot/Futures Trade; disable Transfer/Withdraw',
    ],
    ipWhitelistTip: 'Bind IP addresses on KuCoin to unlock higher API rate limits.',
  },
  gateio: {
    tierLabel: 'Broad Token & Perpetual Coverage',
    permissionChecklist: [
      'Generate APIv4 Keys in Gate.io settings',
      'Grant Spot Trade / Futures / Wallet Read-Only only',
      'Never enable Withdraw',
    ],
    ipWhitelistTip: 'Gate.io APIv4 signs payloads using HMAC-SHA512.',
  },
  mexc: {
    tierLabel: '0% Maker Fees · High Throughput',
    permissionChecklist: [
      'Enable Account View and Trade (Spot/Futures)',
      'Leave Withdraw disabled',
    ],
    ipWhitelistTip: 'Bind IP whitelist to prevent 90-day automatic key expiration.',
  },
  htx: {
    tierLabel: 'Spot & Derivatives Liquidity',
    permissionChecklist: [
      'Standard HTX Global Access Key + Secret Key',
      'Grant Read-Only and Trade only; keep Withdraw off',
    ],
    ipWhitelistTip: 'Restrict each HTX Access Key to trusted server IPs (max 20).',
  },
  deribit: {
    tierLabel: 'Premier BTC/ETH Options & Perps',
    permissionChecklist: [
      'Use Client ID (API Key) + Client Secret',
      'Set scopes: Account: read, Trade: read_write, Wallet: none',
    ],
    ipWhitelistTip: 'Deribit provides a dedicated Testnet environment at test.deribit.com.',
  },
};

export function getLocalizedExchangeSpec(
  exchangeId: string,
  locale: 'en' | 'vi' = 'vi',
): ExchangeSpec {
  const base = getExchangeSpec(exchangeId);
  if (locale !== 'en') return base;
  const enMeta = EXCHANGE_EN_META[exchangeId.toLowerCase()];
  if (!enMeta) {
    return {
      ...base,
      permissionChecklist: [
        'Enable Read and Trade permissions as required',
        'Keep Withdraw permission disabled',
      ],
      ipWhitelistTip: 'Bind an IP whitelist to harden API custody.',
    };
  }
  return {
    ...base,
    tierLabel: enMeta.tierLabel,
    permissionChecklist: enMeta.permissionChecklist,
    ipWhitelistTip: enMeta.ipWhitelistTip,
  };
}

