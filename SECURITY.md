# Security Architecture & Hardening Guide

## 1. Authentication & Role-Based Access Control (RBAC)

OMNISENT AI enforces hierarchical roles in `/server/security.ts`:

| Role | Capabilities |
|---|---|
| `PUBLIC_READ` | Health checks, public market tickers, candles, order book, portfolio/agent read views |
| `TRADER` | Order preview/submit (`PAPER`), close/edit positions, Smart Run, AI synthesis & copilot, auto-trade cycle/proposals |
| `RISK_OFFICER` | Risk Engine parameters, auto-execution config, execution reconciliation, trading mode transitions, emergency stop |
| `EXCHANGE_ADMIN` | Exchange credential verification, vault storage, disconnect |
| `SYSTEM_ADMIN` | Full access including session reset (`/api/session/reset`) and agent lifecycle control |

### Token Configuration & Operator Claim Flow
- **Environment Tokens**: Set `OMNISENT_ADMIN_TOKEN`, `OMNISENT_RISK_TOKEN`, `OMNISENT_EXCHANGE_TOKEN`, and/or `OMNISENT_TRADER_TOKEN` (verified with `crypto.timingSafeEqual`).
- **Interactive Claim Flow**: In local development without env tokens, `POST /api/auth/claim` allows claiming a first-run `SYSTEM_ADMIN` credential hashed with `scrypt` (`auth_credentials` table). Once claimed, `/api/auth/claim` permanently locks (`409 Conflict`) and mutating endpoints require authentication.
- **In-Memory Client Token Storage**: Browser sessions (`src/lib/apiClient.ts`) store bearer tokens strictly in JavaScript memory—never in `localStorage`, `sessionStorage`, or non-HttpOnly cookies.

## 2. Fail-Closed Production Startup

When `NODE_ENV=production` or `VERCEL_ENV=production` (unless `ALLOW_UNAUTH_DEV=1` is set intentionally for local debugging):
- `validateSecurityStartupConfig()` refuses to start if `OMNISENT_ADMIN_TOKEN` is missing or shorter than 16 characters.
- `cryptoVault.ts` refuses to operate without a persistent `VAULT_ENCRYPTION_KEY` (>= 16 characters).

## 3. Exchange API Vault & Zero-Withdrawal Guard

- Credentials are encrypted at rest with **AES-256-GCM** using HKDF/SHA-256 derived keys and verified authentication tags.
- `exchangeAuth.ts` enforces strict **Zero-Withdrawal Custody** across Binance, Bybit, OKX, Coinbase, Kraken, KuCoin, Gate.io, Bitget, MEXC, HTX, and Deribit. Any credential exhibiting withdrawal/transfer scopes is rejected.
- `redactSecrets()` masks Bearer tokens, query keys (`apiKey`, `secret`, `signature`, `passphrase`, `token`), Google API keys, and PostgreSQL/Redis connection credentials before logging or returning error text.

## 4. Transport, Origin & Abuse Protections

- Security response headers (`X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Content-Security-Policy`, and `Strict-Transport-Security` over HTTPS).
- Origin-validated CORS (`APP_URL`, `ALLOWED_ORIGIN`, same-host, and explicit `ALLOW_CLOUD_RUN_CORS=1` opt-in for strict prod).
- Global JSON body limit (`512kb`), request timeout (`REQUEST_TIMEOUT_MS`), WebSocket handshake token validation + `16kb` frame ceiling, and modular sliding-window rate limiting (`UpstashRedisRestRateLimitStore` with `InMemoryRateLimitStore` fallback).
- Sanitized error middleware stripping stack traces on malformed JSON or unhandled errors.

## 5. AI Safety & Grounding Defenses

- User prompts and market context passed to `server/geminiService.ts` are sanitized (`sanitizeUntrustedText`) and wrapped inside explicit `<UNTRUSTED_USER_QUESTION>` and `<UNTRUSTED_MARKET_DATA>` delimiters.
- Grounding URLs returned by external search tools pass `isSafeExternalGroundingUrl()` requiring strict `https:` protocol, no embedded credentials, and rejecting `localhost`, loopback (`127.0.0.1`, `::1`), link-local metadata (`169.254.169.254`), and private RFC1918/CGNAT ranges.
- AI invocations enforce concurrency (`AI_MAX_CONCURRENT`), hourly quota (`AI_MAX_CALLS_PER_HOUR`), and a 20-second timeout; outputs remain advisory and cannot bypass the deterministic Risk Engine.
