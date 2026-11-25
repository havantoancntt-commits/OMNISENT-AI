import crypto from 'node:crypto';
import { getExchangeSpec } from '../src/engine/exchangeCatalog.ts';
import type { ExchangeEnvironment, ExchangeVerificationStatus } from '../src/engine/types.ts';

export type ExchangeVerifyOutcome =
  | 'VERIFIED'
  | 'AUTH_FAILED'
  | 'WITHDRAWAL_DETECTED'
  | 'REGION_OR_NETWORK_RESTRICTED';

export interface ExchangeVerifyResult {
  ok: boolean;
  exchangeId: string;
  environment: ExchangeEnvironment;
  outcome: ExchangeVerifyOutcome;
  verificationStatus: ExchangeVerificationStatus;
  latencyMs: number;
  httpStatus: number | null;
  message: string;
  detectedPermissions?: {
    read: boolean;
    spotTrade: boolean;
    futuresTrade: boolean;
  };
  detectedEquityUsd?: number | null;
}

const REQUEST_TIMEOUT_MS = 6500;

// --- Deterministic Signing Helpers (Pure Functions) ---

export function signBinanceQuery(queryString: string, apiSecret: string): string {
  return crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
}

export function signBybitV5(params: {
  timestampMs: string;
  apiKey: string;
  recvWindow: string;
  queryOrBody: string;
  apiSecret: string;
}): string {
  const prehash = `${params.timestampMs}${params.apiKey}${params.recvWindow}${params.queryOrBody}`;
  return crypto.createHmac('sha256', params.apiSecret).update(prehash).digest('hex');
}

export function signOkxV5(params: {
  timestampIso: string;
  method: 'GET' | 'POST';
  requestPath: string;
  body: string;
  apiSecret: string;
}): string {
  const prehash = `${params.timestampIso}${params.method}${params.requestPath}${params.body}`;
  return crypto.createHmac('sha256', params.apiSecret).update(prehash).digest('base64');
}

export function signBitgetV2(params: {
  timestampMs: string;
  method: 'GET' | 'POST';
  requestPath: string;
  queryString: string;
  body: string;
  apiSecret: string;
}): string {
  const qs = params.queryString ? `?${params.queryString}` : '';
  const prehash = `${params.timestampMs}${params.method}${params.requestPath}${qs}${params.body}`;
  return crypto.createHmac('sha256', params.apiSecret).update(prehash).digest('base64');
}

export function signKuCoin(params: {
  timestampMs: string;
  method: 'GET' | 'POST';
  endpoint: string;
  body: string;
  apiSecret: string;
  passphrase: string;
}): { signature: string; signedPassphrase: string } {
  const prehash = `${params.timestampMs}${params.method}${params.endpoint}${params.body}`;
  const signature = crypto.createHmac('sha256', params.apiSecret).update(prehash).digest('base64');
  const signedPassphrase = crypto
    .createHmac('sha256', params.apiSecret)
    .update(params.passphrase)
    .digest('base64');
  return { signature, signedPassphrase };
}

export function signGateIoV4(params: {
  method: 'GET' | 'POST';
  urlPath: string;
  queryString: string;
  body: string;
  timestampSec: string;
  apiSecret: string;
}): string {
  const hashedPayload = crypto.createHash('sha512').update(params.body).digest('hex');
  const prehash = `${params.method}\n${params.urlPath}\n${params.queryString}\n${hashedPayload}\n${params.timestampSec}`;
  return crypto.createHmac('sha512', params.apiSecret).update(prehash).digest('hex');
}

export function signKraken(params: {
  urlPath: string;
  nonce: string;
  postData: string;
  base64Secret: string;
}): string {
  const sha256Digest = crypto
    .createHash('sha256')
    .update(`${params.nonce}${params.postData}`)
    .digest();
  const secretBuf = Buffer.from(params.base64Secret, 'base64');
  return crypto
    .createHmac('sha512', secretBuf)
    .update(Buffer.concat([Buffer.from(params.urlPath, 'utf8'), sha256Digest]))
    .digest('base64');
}

export function signHtx(params: {
  method: 'GET' | 'POST';
  host: string;
  path: string;
  sortedQueryString: string;
  apiSecret: string;
}): string {
  const canonical = `${params.method}\n${params.host}\n${params.path}\n${params.sortedQueryString}`;
  return crypto.createHmac('sha256', params.apiSecret).update(canonical).digest('base64');
}

export function buildCoinbaseAuthHeaders(params: {
  apiKey: string;
  apiSecret: string;
  method: 'GET' | 'POST';
  host: string;
  requestPath: string;
}): Record<string, string> {
  const cleanSecret = params.apiSecret.replace(/\\n/g, '\n').trim();
  if (cleanSecret.includes('BEGIN ') && cleanSecret.includes('PRIVATE KEY')) {
    const header = {
      alg: 'ES256',
      kid: params.apiKey,
      nonce: crypto.randomBytes(16).toString('hex'),
    };
    const nowSec = Math.floor(Date.now() / 1000);
    const claims = {
      sub: params.apiKey,
      iss: 'cdp',
      nbf: nowSec,
      exp: nowSec + 120,
      uri: `${params.method} ${params.host}${params.requestPath}`,
    };
    const encodeB64Url = (obj: unknown) =>
      Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
    const signingInput = `${encodeB64Url(header)}.${encodeB64Url(claims)}`;
    const sig = crypto
      .sign('sha256', Buffer.from(signingInput, 'utf8'), {
        key: cleanSecret,
        dsaEncoding: 'ieee-p1363',
      })
      .toString('base64url');
    return {
      Authorization: `Bearer ${signingInput}.${sig}`,
    };
  }

  // Legacy Coinbase Advanced HMAC-SHA256 signature headers
  const timestampSec = Math.floor(Date.now() / 1000).toString();
  const message = `${timestampSec}${params.method}${params.requestPath}`;
  const sign = crypto.createHmac('sha256', cleanSecret).update(message).digest('hex');
  return {
    'CB-ACCESS-KEY': params.apiKey,
    'CB-ACCESS-SIGN': sign,
    'CB-ACCESS-TIMESTAMP': timestampSec,
  };
}

// --- Withdrawal Permission Guard ---

export interface WithdrawalDetectionResult {
  hasWithdrawal: boolean;
  reason?: string;
  detectedPermissions?: {
    read: boolean;
    spotTrade: boolean;
    futuresTrade: boolean;
  };
}

export function detectWithdrawalPermission(
  exchangeId: string,
  payload: unknown,
): WithdrawalDetectionResult {
  if (!payload || typeof payload !== 'object') {
    return { hasWithdrawal: false };
  }

  const id = exchangeId.toLowerCase();
  const obj = payload as Record<string, unknown>;

  if (id === 'binance' || id === 'mexc') {
    const canWithdraw = obj.canWithdraw === true || obj.enableWithdrawals === true;
    const canTrade = obj.canTrade === true || obj.enableSpotAndMarginTrading === true;
    const permArr = Array.isArray(obj.permissions)
      ? obj.permissions.map((p) => String(p).toUpperCase())
      : [];
    const futuresPerm = obj.enableFutures === true || permArr.includes('FUTURES');
    if (canWithdraw) {
      return {
        hasWithdrawal: true,
        reason: `${exchangeId.toUpperCase()} API Key đang bật quyền rút tiền (canWithdraw/enableWithdrawals = true).`,
      };
    }
    return {
      hasWithdrawal: false,
      detectedPermissions: {
        read: true,
        spotTrade: canTrade,
        futuresTrade: futuresPerm,
      },
    };
  }

  if (id === 'bybit') {
    const result = (obj.result ?? obj) as Record<string, unknown>;
    const perms = (result.permissions ?? {}) as Record<string, unknown>;
    const walletPerms = Array.isArray(perms.Wallet)
      ? perms.Wallet.map((p) => String(p).toLowerCase())
      : [];
    if (walletPerms.some((p) => p.includes('withdraw'))) {
      return {
        hasWithdrawal: true,
        reason: 'Bybit API Key đang bật quyền Wallet -> Withdraw.',
      };
    }
    const spotPerms = Array.isArray(perms.Spot) ? perms.Spot : [];
    const contractPerms = Array.isArray(perms.ContractTrade) ? perms.ContractTrade : [];
    const readOnly = result.readOnly === 1 || result.readOnly === true;
    return {
      hasWithdrawal: false,
      detectedPermissions: {
        read: true,
        spotTrade: !readOnly && spotPerms.length > 0,
        futuresTrade: !readOnly && contractPerms.length > 0,
      },
    };
  }

  if (id === 'okx') {
    const dataArr = Array.isArray(obj.data) ? obj.data : [];
    const first = (dataArr[0] ?? obj) as Record<string, unknown>;
    const permRaw = typeof first.perm === 'string' ? first.perm : '';
    const tokens = permRaw
      .toLowerCase()
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (tokens.some((t) => t.includes('withdraw'))) {
      return {
        hasWithdrawal: true,
        reason: `OKX API Key có quyền "${permRaw}" chứa Withdraw.`,
      };
    }
    const hasTrade = tokens.includes('trade');
    return {
      hasWithdrawal: false,
      detectedPermissions: {
        read: true,
        spotTrade: hasTrade,
        futuresTrade: hasTrade,
      },
    };
  }

  if (id === 'bitget') {
    const data = (obj.data ?? obj) as Record<string, unknown>;
    const auths = Array.isArray(data.authorities)
      ? data.authorities.map((a) => String(a).toLowerCase())
      : [];
    if (auths.some((a) => a.includes('withdraw'))) {
      return {
        hasWithdrawal: true,
        reason: 'Bitget API Key có quyền withdraw trong danh sách authorities.',
      };
    }
    const isReadOnly = auths.length > 0 && auths.every((a) => a.includes('read'));
    return {
      hasWithdrawal: false,
      detectedPermissions: {
        read: true,
        spotTrade: !isReadOnly && (auths.some((a) => a.includes('spot')) || auths.some((a) => a.includes('trade'))),
        futuresTrade: !isReadOnly && (auths.some((a) => a.includes('future')) || auths.some((a) => a.includes('trade'))),
      },
    };
  }

  if (id === 'deribit') {
    const result = (obj.result ?? obj) as Record<string, unknown>;
    const scope = typeof result.scope === 'string' ? result.scope.toLowerCase() : '';
    if (scope.includes('wallet:read_write') || scope.includes('wallet:write') || scope.includes('withdraw')) {
      return {
        hasWithdrawal: true,
        reason: `Deribit OAuth2 scope (${scope}) có quyền ghi/rút Wallet.`,
      };
    }
    const hasTrade = scope.includes('trade:read_write');
    return {
      hasWithdrawal: false,
      detectedPermissions: {
        read: true,
        spotTrade: false,
        futuresTrade: hasTrade,
      },
    };
  }

  if (obj.canWithdraw === true || obj.enableWithdrawals === true) {
    return {
      hasWithdrawal: true,
      reason: `${exchangeId.toUpperCase()} báo quyền rút tiền đang bật.`,
    };
  }

  return { hasWithdrawal: false };
}

// --- Live HTTP Helpers ---

interface RawHttpResult {
  status: number | null;
  text: string;
  json: Record<string, unknown> | null;
  networkError?: string;
  latencyMs: number;
}

async function fetchWithTiming(url: string, init: RequestInit): Promise<RawHttpResult> {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        json = parsed as Record<string, unknown>;
      }
    } catch {
      json = null;
    }
    return {
      status: res.status,
      text,
      json,
      latencyMs: Math.max(1, Date.now() - started),
    };
  } catch (err) {
    return {
      status: null,
      text: '',
      json: null,
      networkError: err instanceof Error ? err.message : 'Network error',
      latencyMs: Math.max(1, Date.now() - started),
    };
  }
}

function classifyRestrictionOrAuthError(
  exchangeId: string,
  environment: ExchangeEnvironment,
  resp: RawHttpResult,
  fallbackAuthMessage?: string,
): ExchangeVerifyResult {
  const verificationStatus: ExchangeVerificationStatus =
    environment === 'TESTNET' ? 'AUTH_FAILED' : 'AUTH_FAILED';

  if (resp.networkError) {
    return {
      ok: false,
      exchangeId,
      environment,
      outcome: 'REGION_OR_NETWORK_RESTRICTED',
      verificationStatus: 'VAULT_STORED_UNVERIFIED',
      latencyMs: resp.latencyMs,
      httpStatus: null,
      message: `Không thể kết nối tới máy chủ ${exchangeId} (${resp.networkError}).`,
    };
  }

  const status = resp.status ?? 0;
  if (status === 451) {
    return {
      ok: false,
      exchangeId,
      environment,
      outcome: 'REGION_OR_NETWORK_RESTRICTED',
      verificationStatus: 'VAULT_STORED_UNVERIFIED',
      latencyMs: resp.latencyMs,
      httpStatus: 451,
      message: `Sàn ${exchangeId} trả về HTTP 451 (hạn chế vùng IP máy chủ hiện tại).`,
    };
  }

  if (status === 403 && !resp.json) {
    return {
      ok: false,
      exchangeId,
      environment,
      outcome: 'REGION_OR_NETWORK_RESTRICTED',
      verificationStatus: 'VAULT_STORED_UNVERIFIED',
      latencyMs: resp.latencyMs,
      httpStatus: 403,
      message: `CloudFront/WAF của ${exchangeId} chặn truy cập từ vùng IP máy chủ (HTTP 403).`,
    };
  }

  if (status >= 500 || status === 429) {
    return {
      ok: false,
      exchangeId,
      environment,
      outcome: 'REGION_OR_NETWORK_RESTRICTED',
      verificationStatus: 'VAULT_STORED_UNVERIFIED',
      latencyMs: resp.latencyMs,
      httpStatus: status,
      message: `Máy chủ ${exchangeId} tạm thời quá tải hoặc bảo trì (HTTP ${status}).`,
    };
  }

  const msg =
    fallbackAuthMessage ||
    (resp.json &&
      String(
        resp.json.msg ??
          resp.json.message ??
          resp.json.retMsg ??
          resp.json.error_description ??
          (Array.isArray(resp.json.error) ? resp.json.error.join(', ') : resp.json.error) ??
          '',
      )) ||
    `HTTP ${status}`;

  return {
    ok: false,
    exchangeId,
    environment,
    outcome: 'AUTH_FAILED',
    verificationStatus,
    latencyMs: resp.latencyMs,
    httpStatus: status || null,
    message: `Xác thực ${exchangeId} thất bại: ${msg}`,
  };
}

function buildSuccessResult(params: {
  exchangeId: string;
  environment: ExchangeEnvironment;
  latencyMs: number;
  httpStatus: number;
  rawPayload: unknown;
  message: string;
  detectedEquityUsd?: number | null;
}): ExchangeVerifyResult {
  const withdrawalCheck = detectWithdrawalPermission(params.exchangeId, params.rawPayload);
  if (withdrawalCheck.hasWithdrawal) {
    return {
      ok: false,
      exchangeId: params.exchangeId,
      environment: params.environment,
      outcome: 'WITHDRAWAL_DETECTED',
      verificationStatus: 'AUTH_FAILED',
      latencyMs: params.latencyMs,
      httpStatus: params.httpStatus,
      message:
        withdrawalCheck.reason ||
        'Cybersecurity Policy: Phát hiện API Key có quyền rút tiền. Từ chối kết nối.',
    };
  }

  return {
    ok: true,
    exchangeId: params.exchangeId,
    environment: params.environment,
    outcome: 'VERIFIED',
    verificationStatus:
      params.environment === 'TESTNET' ? 'VERIFIED_TESTNET' : 'VERIFIED_LIVE',
    latencyMs: params.latencyMs,
    httpStatus: params.httpStatus,
    message: params.message,
    detectedPermissions: withdrawalCheck.detectedPermissions,
    detectedEquityUsd: params.detectedEquityUsd ?? null,
  };
}

// --- Official Private Endpoint Verifier for Top 11 Exchanges ---

export async function verifyExchangeCredentials(input: {
  exchangeId: string;
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
  environment?: ExchangeEnvironment;
}): Promise<ExchangeVerifyResult> {
  const exchangeId = input.exchangeId.trim().toLowerCase();
  const apiKey = input.apiKey.trim();
  const apiSecret = input.apiSecret.trim();
  const passphrase = input.passphrase?.trim() ?? '';
  const spec = getExchangeSpec(exchangeId);
  const environment: ExchangeEnvironment =
    input.environment === 'TESTNET' && spec.supportsTestnet ? 'TESTNET' : 'MAINNET';

  if (spec.requiresPassphrase && passphrase.length === 0) {
    return {
      ok: false,
      exchangeId,
      environment,
      outcome: 'AUTH_FAILED',
      verificationStatus: 'AUTH_FAILED',
      latencyMs: 1,
      httpStatus: null,
      message: `${spec.name} bắt buộc phải nhập Passphrase khi kết nối API Key.`,
    };
  }

  switch (exchangeId) {
    case 'binance': {
      const host =
        environment === 'TESTNET' ? 'https://testnet.binance.vision' : 'https://api.binance.com';
      const ts = Date.now();
      const qs = `timestamp=${ts}&recvWindow=5000`;
      const sig = signBinanceQuery(qs, apiSecret);
      const resp = await fetchWithTiming(`${host}/api/v3/account?${qs}&signature=${sig}`, {
        method: 'GET',
        headers: { 'X-MBX-APIKEY': apiKey },
      });
      if (resp.status === 200 && resp.json && Array.isArray(resp.json.balances)) {
        const usdtBal = (resp.json.balances as Array<Record<string, unknown>>).find(
          (b) => String(b.asset) === 'USDT',
        );
        const usdtTotal = usdtBal
          ? Number(usdtBal.free ?? 0) + Number(usdtBal.locked ?? 0)
          : null;
        return buildSuccessResult({
          exchangeId,
          environment,
          latencyMs: resp.latencyMs,
          httpStatus: 200,
          rawPayload: resp.json,
          detectedEquityUsd: usdtTotal !== null && Number.isFinite(usdtTotal) ? Number(usdtTotal.toFixed(2)) : null,
          message: `Xác thực Binance ${environment} thành công (${resp.latencyMs}ms).`,
        });
      }
      return classifyRestrictionOrAuthError(exchangeId, environment, resp);
    }

    case 'bybit': {
      const host =
        environment === 'TESTNET' ? 'https://api-testnet.bybit.com' : 'https://api.bybit.com';
      const timestampMs = Date.now().toString();
      const recvWindow = '5000';
      const sign = signBybitV5({
        timestampMs,
        apiKey,
        recvWindow,
        queryOrBody: '',
        apiSecret,
      });
      const resp = await fetchWithTiming(`${host}/v5/user/query-api`, {
        method: 'GET',
        headers: {
          'X-BAPI-API-KEY': apiKey,
          'X-BAPI-TIMESTAMP': timestampMs,
          'X-BAPI-RECV-WINDOW': recvWindow,
          'X-BAPI-SIGN': sign,
        },
      });
      if (resp.status === 200 && resp.json && resp.json.retCode === 0) {
        return buildSuccessResult({
          exchangeId,
          environment,
          latencyMs: resp.latencyMs,
          httpStatus: 200,
          rawPayload: resp.json,
          message: `Xác thực Bybit V5 ${environment} thành công (${resp.latencyMs}ms).`,
        });
      }
      return classifyRestrictionOrAuthError(
        exchangeId,
        environment,
        resp,
        resp.json ? `retCode=${String(resp.json.retCode)} (${String(resp.json.retMsg ?? '')})` : undefined,
      );
    }

    case 'okx': {
      const timestampIso = new Date().toISOString();
      const requestPath = '/api/v5/account/config';
      const sign = signOkxV5({
        timestampIso,
        method: 'GET',
        requestPath,
        body: '',
        apiSecret,
      });
      const headers: Record<string, string> = {
        'OK-ACCESS-KEY': apiKey,
        'OK-ACCESS-SIGN': sign,
        'OK-ACCESS-TIMESTAMP': timestampIso,
        'OK-ACCESS-PASSPHRASE': passphrase,
      };
      if (environment === 'TESTNET') {
        headers['x-simulated-trading'] = '1';
      }
      const resp = await fetchWithTiming(`https://www.okx.com${requestPath}`, {
        method: 'GET',
        headers,
      });
      if (resp.status === 200 && resp.json && String(resp.json.code) === '0') {
        return buildSuccessResult({
          exchangeId,
          environment,
          latencyMs: resp.latencyMs,
          httpStatus: 200,
          rawPayload: resp.json,
          message: `Xác thực OKX V5 ${environment} thành công (${resp.latencyMs}ms).`,
        });
      }
      return classifyRestrictionOrAuthError(
        exchangeId,
        environment,
        resp,
        resp.json ? `code=${String(resp.json.code)} (${String(resp.json.msg ?? '')})` : undefined,
      );
    }

    case 'coinbase': {
      const host = 'api.coinbase.com';
      const requestPath = '/api/v3/brokerage/accounts';
      let headers: Record<string, string>;
      try {
        headers = buildCoinbaseAuthHeaders({
          apiKey,
          apiSecret,
          method: 'GET',
          host,
          requestPath,
        });
      } catch (err) {
        return {
          ok: false,
          exchangeId,
          environment,
          outcome: 'AUTH_FAILED',
          verificationStatus: 'AUTH_FAILED',
          latencyMs: 1,
          httpStatus: null,
          message: `Định dạng khóa ECDSA/HMAC của Coinbase không hợp lệ: ${
            err instanceof Error ? err.message : 'Invalid key'
          }`,
        };
      }
      const resp = await fetchWithTiming(`https://${host}${requestPath}`, {
        method: 'GET',
        headers,
      });
      if (resp.status === 200 && resp.json && Array.isArray(resp.json.accounts)) {
        return buildSuccessResult({
          exchangeId,
          environment,
          latencyMs: resp.latencyMs,
          httpStatus: 200,
          rawPayload: resp.json,
          message: `Xác thực Coinbase Advanced thành công (${resp.latencyMs}ms).`,
        });
      }
      return classifyRestrictionOrAuthError(exchangeId, environment, resp);
    }

    case 'kraken': {
      const urlPath = '/0/private/Balance';
      const nonce = Date.now().toString();
      const postData = `nonce=${nonce}`;
      const apiSign = signKraken({
        urlPath,
        nonce,
        postData,
        base64Secret: apiSecret,
      });
      const resp = await fetchWithTiming(`https://api.kraken.com${urlPath}`, {
        method: 'POST',
        headers: {
          'API-Key': apiKey,
          'API-Sign': apiSign,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: postData,
      });
      if (
        resp.status === 200 &&
        resp.json &&
        Array.isArray(resp.json.error) &&
        resp.json.error.length === 0
      ) {
        return buildSuccessResult({
          exchangeId,
          environment,
          latencyMs: resp.latencyMs,
          httpStatus: 200,
          rawPayload: resp.json,
          message: `Xác thực Kraken HMAC-SHA512 thành công (${resp.latencyMs}ms).`,
        });
      }
      return classifyRestrictionOrAuthError(exchangeId, environment, resp);
    }

    case 'bitget': {
      const timestampMs = Date.now().toString();
      const requestPath = '/api/v2/spot/account/info';
      const sign = signBitgetV2({
        timestampMs,
        method: 'GET',
        requestPath,
        queryString: '',
        body: '',
        apiSecret,
      });
      const resp = await fetchWithTiming(`https://api.bitget.com${requestPath}`, {
        method: 'GET',
        headers: {
          'ACCESS-KEY': apiKey,
          'ACCESS-SIGN': sign,
          'ACCESS-TIMESTAMP': timestampMs,
          'ACCESS-PASSPHRASE': passphrase,
          'Content-Type': 'application/json',
        },
      });
      if (resp.status === 200 && resp.json && String(resp.json.code) === '00000') {
        return buildSuccessResult({
          exchangeId,
          environment,
          latencyMs: resp.latencyMs,
          httpStatus: 200,
          rawPayload: resp.json,
          message: `Xác thực Bitget V2 thành công (${resp.latencyMs}ms).`,
        });
      }
      return classifyRestrictionOrAuthError(
        exchangeId,
        environment,
        resp,
        resp.json ? `code=${String(resp.json.code)} (${String(resp.json.msg ?? '')})` : undefined,
      );
    }

    case 'kucoin': {
      const timestampMs = Date.now().toString();
      const endpoint = '/api/v1/accounts';
      const { signature, signedPassphrase } = signKuCoin({
        timestampMs,
        method: 'GET',
        endpoint,
        body: '',
        apiSecret,
        passphrase,
      });
      const resp = await fetchWithTiming(`https://api.kucoin.com${endpoint}`, {
        method: 'GET',
        headers: {
          'KC-API-KEY': apiKey,
          'KC-API-SIGN': signature,
          'KC-API-TIMESTAMP': timestampMs,
          'KC-API-PASSPHRASE': signedPassphrase,
          'KC-API-KEY-VERSION': '2',
        },
      });
      if (resp.status === 200 && resp.json && String(resp.json.code) === '200000') {
        return buildSuccessResult({
          exchangeId,
          environment,
          latencyMs: resp.latencyMs,
          httpStatus: 200,
          rawPayload: resp.json,
          message: `Xác thực KuCoin thành công (${resp.latencyMs}ms).`,
        });
      }
      return classifyRestrictionOrAuthError(
        exchangeId,
        environment,
        resp,
        resp.json ? `code=${String(resp.json.code)} (${String(resp.json.msg ?? '')})` : undefined,
      );
    }

    case 'gateio': {
      const urlPath = '/api/v4/spot/accounts';
      const timestampSec = Math.floor(Date.now() / 1000).toString();
      const sign = signGateIoV4({
        method: 'GET',
        urlPath,
        queryString: '',
        body: '',
        timestampSec,
        apiSecret,
      });
      const resp = await fetchWithTiming(`https://api.gateio.ws${urlPath}`, {
        method: 'GET',
        headers: {
          KEY: apiKey,
          Timestamp: timestampSec,
          SIGN: sign,
          Accept: 'application/json',
        },
      });
      if (resp.status === 200 && Array.isArray(resp.json)) {
        return buildSuccessResult({
          exchangeId,
          environment,
          latencyMs: resp.latencyMs,
          httpStatus: 200,
          rawPayload: resp.json,
          message: `Xác thực Gate.io APIv4 thành công (${resp.latencyMs}ms).`,
        });
      }
      // Note: Gate.io returns JSON array on 200; fetchWithTiming returns typeof === 'object' for arrays too
      if (resp.status === 200 && resp.json && !('label' in resp.json)) {
        return buildSuccessResult({
          exchangeId,
          environment,
          latencyMs: resp.latencyMs,
          httpStatus: 200,
          rawPayload: resp.json,
          message: `Xác thực Gate.io APIv4 thành công (${resp.latencyMs}ms).`,
        });
      }
      return classifyRestrictionOrAuthError(
        exchangeId,
        environment,
        resp,
        resp.json ? `${String(resp.json.label ?? '')} ${String(resp.json.message ?? '')}`.trim() : undefined,
      );
    }

    case 'mexc': {
      const ts = Date.now();
      const qs = `timestamp=${ts}&recvWindow=5000`;
      const sig = signBinanceQuery(qs, apiSecret);
      const resp = await fetchWithTiming(`https://api.mexc.com/api/v3/account?${qs}&signature=${sig}`, {
        method: 'GET',
        headers: { 'X-MEXC-APIKEY': apiKey },
      });
      if (resp.status === 200 && resp.json && Array.isArray(resp.json.balances)) {
        return buildSuccessResult({
          exchangeId,
          environment,
          latencyMs: resp.latencyMs,
          httpStatus: 200,
          rawPayload: resp.json,
          message: `Xác thực MEXC thành công (${resp.latencyMs}ms).`,
        });
      }
      return classifyRestrictionOrAuthError(exchangeId, environment, resp);
    }

    case 'htx': {
      const host = 'api.huobi.pro';
      const path = '/v1/account/accounts';
      const timestampIso = new Date().toISOString().slice(0, 19);
      const params: Array<[string, string]> = [
        ['AccessKeyId', apiKey],
        ['SignatureMethod', 'HmacSHA256'],
        ['SignatureVersion', '2'],
        ['Timestamp', timestampIso],
      ];
      params.sort((a, b) => a[0].localeCompare(b[0]));
      const sortedQueryString = params
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
      const signature = signHtx({
        method: 'GET',
        host,
        path,
        sortedQueryString,
        apiSecret,
      });
      const resp = await fetchWithTiming(
        `https://${host}${path}?${sortedQueryString}&Signature=${encodeURIComponent(signature)}`,
        { method: 'GET' },
      );
      if (resp.status === 200 && resp.json && String(resp.json.status) === 'ok') {
        return buildSuccessResult({
          exchangeId,
          environment,
          latencyMs: resp.latencyMs,
          httpStatus: 200,
          rawPayload: resp.json,
          message: `Xác thực HTX thành công (${resp.latencyMs}ms).`,
        });
      }
      return classifyRestrictionOrAuthError(
        exchangeId,
        environment,
        resp,
        resp.json ? String(resp.json['err-msg'] ?? resp.json['err-code'] ?? '') : undefined,
      );
    }

    case 'deribit': {
      const host =
        environment === 'TESTNET' ? 'https://test.deribit.com' : 'https://www.deribit.com';
      const url = new URL(`${host}/api/v2/public/auth`);
      url.searchParams.set('grant_type', 'client_credentials');
      url.searchParams.set('client_id', apiKey);
      url.searchParams.set('client_secret', apiSecret);
      const resp = await fetchWithTiming(url.toString(), { method: 'GET' });
      if (resp.status === 200 && resp.json && resp.json.result && !resp.json.error) {
        return buildSuccessResult({
          exchangeId,
          environment,
          latencyMs: resp.latencyMs,
          httpStatus: 200,
          rawPayload: resp.json,
          message: `Xác thực Deribit ${environment} thành công (${resp.latencyMs}ms).`,
        });
      }
      const errObj = resp.json?.error as Record<string, unknown> | undefined;
      return classifyRestrictionOrAuthError(
        exchangeId,
        environment,
        resp,
        errObj ? `${String(errObj.code ?? '')}: ${String(errObj.message ?? '')}` : undefined,
      );
    }

    default:
      return {
        ok: false,
        exchangeId,
        environment,
        outcome: 'AUTH_FAILED',
        verificationStatus: 'AUTH_FAILED',
        latencyMs: 1,
        httpStatus: null,
        message: `Sàn "${exchangeId}" chưa được hỗ trợ xác thực API.`,
      };
  }
}
