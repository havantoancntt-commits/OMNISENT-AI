import crypto from 'node:crypto';
import type express from 'express';
import type http from 'node:http';
import { isPersistentVaultKeyConfigured, isStrictProductionRuntime } from './cryptoVault.ts';

export type Role =
  | 'PUBLIC_READ'
  | 'TRADER'
  | 'RISK_OFFICER'
  | 'EXCHANGE_ADMIN'
  | 'SYSTEM_ADMIN';

export interface AuthContext {
  authenticated: boolean;
  role: Role;
  actor: string;
  method: 'ENV_TOKEN' | 'SESSION_TOKEN' | 'DEV_OPEN' | 'NONE';
}

export interface AuthenticatedRequest extends express.Request {
  requestId?: string;
  auth?: AuthContext;
}

const ROLE_CAPABILITIES: Record<Role, ReadonlySet<Role>> = {
  PUBLIC_READ: new Set<Role>(['PUBLIC_READ']),
  TRADER: new Set<Role>(['PUBLIC_READ', 'TRADER']),
  RISK_OFFICER: new Set<Role>(['PUBLIC_READ', 'TRADER', 'RISK_OFFICER']),
  EXCHANGE_ADMIN: new Set<Role>(['PUBLIC_READ', 'TRADER', 'EXCHANGE_ADMIN']),
  SYSTEM_ADMIN: new Set<Role>([
    'PUBLIC_READ',
    'TRADER',
    'RISK_OFFICER',
    'EXCHANGE_ADMIN',
    'SYSTEM_ADMIN',
  ]),
};

export function hasRequiredRole(actualRole: Role, requiredRole: Role): boolean {
  return ROLE_CAPABILITIES[actualRole]?.has(requiredRole) ?? false;
}

export function timingSafeTokenEqual(expected: string, supplied: string): boolean {
  if (!expected || !supplied) return false;
  const expectedBuf = Buffer.from(expected, 'utf8');
  const suppliedBuf = Buffer.from(supplied, 'utf8');
  if (expectedBuf.length !== suppliedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, suppliedBuf);
}

export function redactSecrets(input: string): string {
  if (!input) return '';
  return input
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]')
    .replace(/([?&](?:key|apiKey|api_key|token|secret|signature|Signature|passphrase|client_secret|password)=)[^&\s"']+/gi, '$1[REDACTED]')
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED_GOOGLE_KEY]')
    .replace(/\b(sk|pk)_(live|test)_[0-9A-Za-z]{12,}\b/g, '[REDACTED_SECRET_KEY]')
    .replace(/(postgres(?:ql)?|redis|rediss):\/\/[^:\s]+:[^@\s]+@/gi, '$1://[REDACTED]:[REDACTED]@');
}

export function hashPasswordScrypt(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPasswordScrypt(password: string, encodedHash: string): boolean {
  const parts = encodedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hexDigest] = parts;
  if (!salt || !hexDigest) return false;
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hexDigest, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

interface SessionRecord {
  tokenHash: string;
  role: Role;
  actor: string;
  expiresAtMs: number;
}

const activeSessions = new Map<string, SessionRecord>();
const SESSION_TTL_MS = 12 * 3600_000;

function sha256Hex(raw: string): string {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

export function issueInMemorySessionToken(actor: string, role: Role): {
  token: string;
  role: Role;
  actor: string;
  expiresAtUtc: string;
} {
  const token = `omn_${crypto.randomBytes(32).toString('base64url')}`;
  const tokenHash = sha256Hex(token);
  const expiresAtMs = Date.now() + SESSION_TTL_MS;
  activeSessions.set(tokenHash, {
    tokenHash,
    role,
    actor,
    expiresAtMs,
  });
  // Prune expired sessions
  if (activeSessions.size > 500) {
    const now = Date.now();
    for (const [k, rec] of activeSessions.entries()) {
      if (rec.expiresAtMs <= now) activeSessions.delete(k);
    }
  }
  return {
    token,
    role,
    actor,
    expiresAtUtc: new Date(expiresAtMs).toISOString(),
  };
}

export function revokeInMemorySessionToken(token: string): boolean {
  if (!token) return false;
  return activeSessions.delete(sha256Hex(token));
}

export function clearAllInMemorySessions(): void {
  activeSessions.clear();
}

export function getConfiguredEnvTokens(): Array<{ token: string; role: Role; actor: string }> {
  const entries: Array<{ token: string; role: Role; actor: string }> = [];
  const defs: Array<{ envKey: string; role: Role; actor: string }> = [
    { envKey: 'OMNISENT_ADMIN_TOKEN', role: 'SYSTEM_ADMIN', actor: 'ENV_SYSTEM_ADMIN' },
    { envKey: 'OMNISENT_RISK_TOKEN', role: 'RISK_OFFICER', actor: 'ENV_RISK_OFFICER' },
    { envKey: 'OMNISENT_EXCHANGE_TOKEN', role: 'EXCHANGE_ADMIN', actor: 'ENV_EXCHANGE_ADMIN' },
    { envKey: 'OMNISENT_TRADER_TOKEN', role: 'TRADER', actor: 'ENV_TRADER' },
  ];
  for (const def of defs) {
    const val = process.env[def.envKey]?.trim();
    if (val) {
      entries.push({ token: val, role: def.role, actor: def.actor });
    }
  }
  return entries;
}

export function isAuthEnforced(hasClaimedCredentialFn?: () => boolean): boolean {
  if (getConfiguredEnvTokens().length > 0) return true;
  if (hasClaimedCredentialFn?.()) return true;
  if (isStrictProductionRuntime() && process.env.ALLOW_UNAUTH_DEV !== '1') return true;
  return false;
}

export function extractBearerOrAdminToken(headers: http.IncomingHttpHeaders): string {
  const authHeader = typeof headers.authorization === 'string' ? headers.authorization : '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const headerToken =
    typeof headers['x-admin-token'] === 'string' ? headers['x-admin-token'].trim() : '';
  return bearerToken || headerToken;
}

export function resolveAuthFromHeaders(
  headers: http.IncomingHttpHeaders,
  hasClaimedCredentialFn?: () => boolean,
): AuthContext {
  const supplied = extractBearerOrAdminToken(headers);

  if (supplied) {
    for (const entry of getConfiguredEnvTokens()) {
      if (timingSafeTokenEqual(entry.token, supplied)) {
        return {
          authenticated: true,
          role: entry.role,
          actor: entry.actor,
          method: 'ENV_TOKEN',
        };
      }
    }
    const sess = activeSessions.get(sha256Hex(supplied));
    if (sess && sess.expiresAtMs > Date.now()) {
      return {
        authenticated: true,
        role: sess.role,
        actor: sess.actor,
        method: 'SESSION_TOKEN',
      };
    }
    return {
      authenticated: false,
      role: 'PUBLIC_READ',
      actor: 'ANONYMOUS',
      method: 'NONE',
    };
  }

  if (!isAuthEnforced(hasClaimedCredentialFn)) {
    return {
      authenticated: true,
      role: 'SYSTEM_ADMIN',
      actor: 'LOCAL_DEV_OPERATOR',
      method: 'DEV_OPEN',
    };
  }

  return {
    authenticated: false,
    role: 'PUBLIC_READ',
    actor: 'ANONYMOUS',
    method: 'NONE',
  };
}

export function requireRole(
  requiredRole: Role,
  hasClaimedCredentialFn?: () => boolean,
): express.RequestHandler {
  return (req, res, next) => {
    const auth = resolveAuthFromHeaders(req.headers, hasClaimedCredentialFn);
    (req as AuthenticatedRequest).auth = auth;

    if (!auth.authenticated) {
      res.status(401).json({
        error:
          'Yêu cầu xác thực điều hành (Authorization: Bearer <token> hoặc X-Admin-Token).',
        code: 'AUTH_REQUIRED',
      });
      return;
    }

    if (!hasRequiredRole(auth.role, requiredRole)) {
      res.status(403).json({
        error: `Vai trò ${auth.role} không đủ quyền thực hiện thao tác yêu cầu quyền ${requiredRole}.`,
        code: 'INSUFFICIENT_ROLE',
        requiredRole,
        actualRole: auth.role,
      });
      return;
    }

    next();
  };
}

export function validateSecurityStartupConfig(): {
  strictProduction: boolean;
  authEnforced: boolean;
  vaultConfigured: boolean;
  warnings: string[];
} {
  const strictProduction = isStrictProductionRuntime();
  const bypassDev = process.env.ALLOW_UNAUTH_DEV === '1';
  const adminToken = process.env.OMNISENT_ADMIN_TOKEN?.trim() ?? '';
  const vaultConfigured = isPersistentVaultKeyConfigured();
  const warnings: string[] = [];

  if (strictProduction && !bypassDev) {
    if (!adminToken || adminToken.length < 16) {
      throw new Error(
        '[SECURITY FAIL-CLOSED] Strict production startup requires OMNISENT_ADMIN_TOKEN (>= 16 chars) unless ALLOW_UNAUTH_DEV=1 is explicitly set for non-prod debugging.',
      );
    }
    if (!vaultConfigured) {
      throw new Error(
        '[SECURITY FAIL-CLOSED] Strict production startup requires VAULT_ENCRYPTION_KEY (>= 16 chars).',
      );
    }
  } else {
    if (!adminToken) {
      warnings.push(
        'OMNISENT_ADMIN_TOKEN not set; mutating routes are open in local dev unless claimed via /api/auth/claim.',
      );
    }
    if (!vaultConfigured) {
      warnings.push('VAULT_ENCRYPTION_KEY not set; ephemeral in-memory Vault key active.');
    }
  }

  return {
    strictProduction,
    authEnforced: Boolean(adminToken) || (strictProduction && !bypassDev),
    vaultConfigured,
    warnings,
  };
}

// --- CORS & Security Headers ---

export function buildAllowedOrigins(): Set<string> {
  const origins = new Set<string>([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ]);
  for (const raw of [process.env.APP_URL, process.env.ALLOWED_ORIGIN]) {
    if (!raw) continue;
    for (const part of raw.split(',')) {
      const trimmed = part.trim().replace(/\/+$/, '');
      if (trimmed && trimmed !== 'MY_APP_URL') {
        origins.add(trimmed);
      }
    }
  }
  return origins;
}

export function isOriginAllowed(origin: string, hostHeader?: string): boolean {
  const normalized = origin.trim().replace(/\/+$/, '');
  if (!normalized) return false;
  const allowed = buildAllowedOrigins();
  if (allowed.has(normalized)) return true;
  if (hostHeader && (normalized === `https://${hostHeader}` || normalized === `http://${hostHeader}`)) {
    return true;
  }
  const strictProd = isStrictProductionRuntime() && process.env.ALLOW_UNAUTH_DEV !== '1';
  const allowCloudRunWildcard = !strictProd || process.env.ALLOW_CLOUD_RUN_CORS === '1';
  if (allowCloudRunWildcard && /^https:\/\/[a-z0-9.-]+\.run\.app$/i.test(normalized)) {
    return true;
  }
  return false;
}

export function securityHeadersMiddleware(): express.RequestHandler {
  return (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('X-DNS-Prefetch-Control', 'off');

    const frameAncestors =
      isStrictProductionRuntime() && process.env.ALLOW_PREVIEW_FRAME !== '1'
        ? "'self'"
        : "'self' https://aistudio.google.com https://*.google.com";
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' data: blob: https:",
        "connect-src 'self' https: wss:",
        "worker-src 'self' blob:",
        `frame-ancestors ${frameAncestors}`,
      ].join('; '),
    );

    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    if (isHttps && isStrictProductionRuntime()) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  };
}

export function apiCorsMiddleware(): express.RequestHandler {
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      if (isOriginAllowed(origin, req.headers.host)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Token');
      } else {
        if (req.method === 'OPTIONS') {
          res.status(403).json({ error: 'CORS origin denied.' });
          return;
        }
      }
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}

// --- Request ID & Timeout Guard ---

export function requestContextMiddleware(defaultTimeoutMs = 25_000): express.RequestHandler {
  const configuredTimeout = Number(process.env.REQUEST_TIMEOUT_MS);
  const timeoutMs =
    Number.isFinite(configuredTimeout) && configuredTimeout >= 2000
      ? configuredTimeout
      : defaultTimeoutMs;

  return (req, res, next) => {
    const incomingId =
      typeof req.headers['x-request-id'] === 'string' && req.headers['x-request-id'].trim()
        ? req.headers['x-request-id'].trim().slice(0, 64)
        : crypto.randomUUID();
    (req as AuthenticatedRequest).requestId = incomingId;
    res.setHeader('X-Request-Id', incomingId);

    // Exclude SSE streams from short request timeout
    const isStreamRoute = req.path.includes('/copilot/stream');
    if (!isStreamRoute) {
      const timer = setTimeout(() => {
        if (!res.headersSent) {
          res.status(504).json({
            error: 'Yêu cầu vượt quá thời gian xử lý cho phép (504 Gateway Timeout).',
            requestId: incomingId,
          });
        }
      }, timeoutMs);
      timer.unref?.();
      res.once('finish', () => clearTimeout(timer));
      res.once('close', () => clearTimeout(timer));
    }

    next();
  };
}

// --- Modular Sliding-Window Rate Limiter (Upstash Redis REST + In-Memory Fallback) ---

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  retryAfterSec: number;
  backend: 'redis_rest' | 'in_memory';
}

export interface RateLimitStore {
  readonly backendName: 'redis_rest' | 'in_memory';
  consume(key: string, maxRequests: number, windowMs: number): Promise<RateLimitResult>;
}

export class InMemoryRateLimitStore implements RateLimitStore {
  public readonly backendName = 'in_memory' as const;
  private hits = new Map<string, number[]>();

  async consume(key: string, maxRequests: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const cutoff = now - windowMs;
    const prev = (this.hits.get(key) ?? []).filter((ts) => ts > cutoff);
    if (prev.length >= maxRequests) {
      const retryAfterSec = Math.max(1, Math.ceil((prev[0] + windowMs - now) / 1000));
      return { allowed: false, count: prev.length, retryAfterSec, backend: 'in_memory' };
    }
    prev.push(now);
    this.hits.set(key, prev);
    if (this.hits.size > 3000) {
      for (const [k, list] of this.hits.entries()) {
        const fresh = list.filter((ts) => ts > cutoff);
        if (fresh.length === 0) this.hits.delete(k);
        else this.hits.set(k, fresh);
      }
    }
    return { allowed: true, count: prev.length, retryAfterSec: 0, backend: 'in_memory' };
  }
}

export class UpstashRedisRestRateLimitStore implements RateLimitStore {
  public readonly backendName = 'redis_rest' as const;
  private fallback = new InMemoryRateLimitStore();

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async consume(key: string, maxRequests: number, windowMs: number): Promise<RateLimitResult> {
    const bucket = Math.floor(Date.now() / windowMs);
    const redisKey = `omnisent:rl:${key}:${bucket}`;
    const ttlSec = Math.max(1, Math.ceil(windowMs / 1000));
    try {
      const res = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/pipeline`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([
          ['INCR', redisKey],
          ['EXPIRE', redisKey, ttlSec],
        ]),
        signal: AbortSignal.timeout(1500),
      });
      if (!res.ok) {
        return this.fallback.consume(key, maxRequests, windowMs);
      }
      const data = (await res.json()) as Array<{ result?: number }>;
      const count = Number(data?.[0]?.result ?? 1);
      if (count > maxRequests) {
        return { allowed: false, count, retryAfterSec: ttlSec, backend: 'redis_rest' };
      }
      return { allowed: true, count, retryAfterSec: 0, backend: 'redis_rest' };
    } catch {
      return this.fallback.consume(key, maxRequests, windowMs);
    }
  }
}

export function resolveRateLimitStore(): {
  store: RateLimitStore;
  redisConfigured: boolean;
  modeLabel: string;
} {
  const restUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const restToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (restUrl && restToken) {
    return {
      store: new UpstashRedisRestRateLimitStore(restUrl, restToken),
      redisConfigured: true,
      modeLabel: 'UPSTASH_REDIS_REST',
    };
  }
  const redisUrl = process.env.REDIS_URL?.trim();
  if (redisUrl) {
    return {
      store: new InMemoryRateLimitStore(),
      redisConfigured: false,
      modeLabel: 'REDIS_URL_FALLBACK_IN_MEMORY',
    };
  }
  return {
    store: new InMemoryRateLimitStore(),
    redisConfigured: false,
    modeLabel: 'IN_MEMORY_SINGLE_INSTANCE',
  };
}

export function createRateLimiter(options: {
  maxRequests: number;
  windowMs: number;
  namespace?: string;
  store?: RateLimitStore;
}): express.RequestHandler {
  const store = options.store ?? resolveRateLimitStore().store;
  const ns = options.namespace ?? 'default';

  return (req, res, next) => {
    const clientIp = String(req.ip || req.socket?.remoteAddress || 'unknown');
    const key = `${ns}:${clientIp}`;
    void store
      .consume(key, options.maxRequests, options.windowMs)
      .then((result) => {
        if (!result.allowed) {
          res.setHeader('Retry-After', String(result.retryAfterSec));
          res.status(429).json({
            error: `Quá nhiều yêu cầu trong thời gian ngắn. Vui lòng thử lại sau ${result.retryAfterSec}s.`,
          });
          return;
        }
        next();
      })
      .catch(() => next());
  };
}

// --- Safe Global Error Handler ---

export function globalErrorMiddleware(): express.ErrorRequestHandler {
  return (err, req, res, _next) => {
    const requestId = (req as AuthenticatedRequest).requestId;
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({
        error: 'Payload JSON không hợp lệ.',
        requestId,
      });
      return;
    }
    const rawMsg = err instanceof Error ? err.message : String(err ?? 'Unknown error');
    console.error(`[HTTP ERROR] ${req.method} ${req.path} [${requestId ?? '-'}]: ${redactSecrets(rawMsg)}`);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Lỗi hệ thống nội bộ — vui lòng thử lại.',
        requestId,
      });
    }
  };
}
