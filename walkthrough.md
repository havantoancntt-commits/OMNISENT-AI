# OMNISENT AI — System-Wide Audit, Hardening & UX Upgrade Walkthrough

## Security Summary

### Reviewed Files
- `/.npmrc`, `/package.json`, `/package-lock.json`, `/vercel.json`, `/api/index.ts`, `/.env.example`
- `/server.ts`, `/server/db.ts`, `/server/cryptoVault.ts`, `/server/exchangeAuth.ts`, `/server/geminiService.ts`, `/server/wsSafety.ts`, `/server/audit.test.ts`
- `/src/engine/types.ts`, `/src/engine/riskEngine.ts`, `/src/engine/positionMetrics.ts`, `/src/engine/engine.test.ts`
- `/src/components/ActivePositionsPanel.tsx`, `/src/components/CommandCenter.tsx`, `/src/components/PortfolioRisk.tsx`, `/src/components/MarketScanner.tsx`, `/src/App.tsx`, `/src/i18n/translations.ts`

### Issues Resolved
1. **Atomic SQLite Concurrency, Startup Integrity & Race Elimination (`/server/db.ts`, `/server.ts`)**
   - Resolved double-close race conditions on `POST /api/positions/:id/close` and concurrent order mutations by introducing `runInTransaction()` (`BEGIN IMMEDIATE ... COMMIT / ROLLBACK`), `openPositionAtomically()`, and `closePositionAtomically()` (verifying `DELETE FROM positions` affects `changes === 1` before crediting realized PnL, margin, and audit logs).
   - Configured `PRAGMA busy_timeout = 5000`, `PRAGMA synchronous = NORMAL`, `PRAGMA foreign_keys = ON`, and added automatic startup integrity verification (`PRAGMA quick_check;`) with non-destructive `REINDEX; VACUUM;` self-repair when legacy index or freelist drift is detected.
   - Wrapped JSON state deserialization with `safeJsonParse()` fallbacks to prevent malformed database rows from crashing API responses.

2. **Security Vault Fail-Closed Key Enforcement (`/server/cryptoVault.ts`, `/.env.example`)**
   - Enforced fail-closed behavior in strict production environments (`NODE_ENV=production`, `VERCEL_ENV=production`, or `OMNISENT_STRICT_VAULT=1`): `encryptSecretPayload()` and `decryptSecretPayload()` refuse to operate without a persistent `VAULT_ENCRYPTION_KEY` (>= 16 characters), preventing ephemeral random key rotation from silently invalidating encrypted exchange credentials unless `ALLOW_EPHEMERAL_VAULT_KEY=1` is explicitly set.

3. **Exchange API Signing, Withdrawal Policy & Secret Redaction (`/server/exchangeAuth.ts`)**
   - Added monotonic microsecond nonces (`generateMonotonicNonce()`) and strict Base64 secret validation in `signKraken()`.
   - Expanded withdrawal-permission detection across KuCoin (`WITHDRAW`/`TRANSFER`), Gate.io (`spot/wallet`), Coinbase, Kraken, and HTX so credentials with withdrawal capabilities are rejected before storage or live routing.
   - Added `sanitizeExchangeErrorText()` to redact credential query parameters (`apiKey`, `secret`, `signature`, `passphrase`, `token`) from exchange error strings before logging or returning responses.

4. **Deterministic Stale-Feed Risk Veto (`/src/engine/types.ts`, `/src/engine/riskEngine.ts`, `/server.ts`)**
   - Propagated live `tickerTimestampUtc` into `evaluateOrderRisk()` and added a deterministic 30-second freshness gate: orders referencing market data older than 30,000 ms are vetoed fail-closed (`STALE_FEED`).
   - Hardened `FULL_AUTO` autonomous execution triggers in `/server.ts` to verify non-empty live ticker state prior to cycle evaluation.

5. **HTTP Transport Hardening, Rate Limiting & Admin Guard (`/server.ts`)**
   - Disabled `x-powered-by`, configured `trust proxy`, capped Express JSON payloads at 512 KB and WebSocket frames at 16 KB, and bounded query parameters on search/candle/audit endpoints.
   - Applied security headers (`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `X-DNS-Prefetch-Control: off`), strict origin allowlisting (`APP_URL`, `ALLOWED_ORIGIN`, same-host, and localhost dev origins), sliding-window API rate limiting (`createRateLimiter`), and timing-safe bearer protection (`requireAdminAuth`) on privileged mutation endpoints when `OMNISENT_ADMIN_TOKEN` is configured.

6. **AI Output Schema Validation & Error Scrubbing (`/server/geminiService.ts`)**
   - Added `parseValidatedSynthesisJson()` to strip Markdown code fences, enforce allowlisted `recommendedAction` enums (`LONG`, `SHORT`, `NO_TRADE`), clamp confidence bounds, and sanitize `keyRisks` string arrays before downstream consumption.
   - Added `redactErrorSecrets()` so upstream provider errors never leak API keys or authorization headers.

7. **Vercel Dependency Resolution & Smart Close-Position Confirmation UX (`/.npmrc`, `/package.json`, `/package-lock.json`, `/src/components/ActivePositionsPanel.tsx`)**
   - Aligned `@tailwindcss/vite` (`^4.3.5`), `tailwindcss` (`^4.3.5`), `@vitejs/plugin-react` (`^6.3.0`), `vite` (`^8.3.8`), and `tsx` (`^4.23.15`), added `/.npmrc` (`legacy-peer-deps=true`), and resynchronized `package-lock.json` to eliminate `ERESOLVE` peer dependency build failures on Vercel.
   - Upgraded `Đóng lệnh` in `ActivePositionsPanel.tsx` into an accessible Smart Close Confirmation Modal (`role="dialog"`, `aria-modal="true"`) displaying live Mark price, Entry-to-Mark delta, Gross PnL, 5 bps Market Close Fee, Estimated Net PnL, R-multiple, contextual loss warning / 1-click breakeven protection suggestion, Escape/backdrop dismissal, and a dismissible Post-Close Settlement Notification card backed by exact server settlement receipts (`ClosePositionReceipt`).

8. **PWA Installation Lifecycle & Fast Real-Time Data Synchronization (`/vite.config.ts`, `/vercel.json`, `/server.ts`, `/server/marketFeed.ts`, `/src/pwa/pwaHelpers.ts`, `/src/pwa/PWAContext.tsx`, `/src/components/PWAControls.tsx`, `/src/App.tsx`)**
   - Switched `VitePWA` to `registerType: 'autoUpdate'` (`skipWaiting: true`, `clientsClaim: true`), added strict `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate` headers across `/api/*` and `no-cache` for `/index.html` and `/manifest.webmanifest` in `/vercel.json` and `/server.ts`.
   - Implemented `GET /api/sync/bootstrap` single-trip fast sync with monotonic `stateRevision` diffing, 2-second adaptive serverless HTTP fallback polling when WebSocket upgrades are unavailable, `visibilitychange`/`focus`/`pageshow`/`online` resume recovery, `BroadcastChannel('omnisent-pwa-sync-v1')` cross-tab mutation sync, single-reload `controllerchange` guard, non-sensitive local telemetry snapshot hydration (`parseTelemetrySnapshot`), and 1-tap `Đồng bộ ngay` / `Sync Now` transport & latency telemetry controls.
   - Added cross-venue authentic OHLCV fallback (`OKX`, `Bybit`, `Coinbase`) in `marketFeed.ts` `getCandles()` plus prioritized live candidate fallback in `POST /api/run/smart` so Smart Run does not fail with `503` when one exchange REST endpoint is geo-restricted while live feeds are active.

### Safeguards Verified
- Independent deterministic Risk Engine vetoes AI/order requests missing SL/TP, exceeding leverage/exposure caps, or relying on stale market feeds (> 30s).
- Zero-Withdrawal policy rejects exchange credentials containing withdrawal or transfer scopes across supported venues.
- Atomic SQLite transactions (`BEGIN IMMEDIATE`) guarantee single-execution semantics on position closure and order settlement.
- Encrypted Vault operations fail closed in production if `VAULT_ENCRYPTION_KEY` is absent or below minimum length.
- Non-sensitive PWA hydration snapshots explicitly exclude API keys, secrets, and auth tokens; `/api/*` always stays `NetworkOnly` with `Cache-Control: no-store`.
- All user-visible error paths redact secrets, query tokens, and internal server details.

---

## PoC Verification

1. **Automated Pure Engine & Hardening Unit Tests (`src/engine/engine.test.ts`)**
   - Command: `npx --yes tsx --test src/engine/engine.test.ts`
   - Result: **37 / 37 passed (0 failed)** covering Quant indicators, Risk Engine exposure/stale-feed vetoes, Backtester causality, AES-256-GCM Vault tamper rejection & production fail-closed checks, Exchange Auth monotonic nonces/redaction/withdrawal rejection, Gemini JSON schema validation, Real-time Price Feed Guard, safe WebSocket disposal, and PWA telemetry snapshot & sync cooldown/reload guards.

2. **Automated SQLite Transaction & Express Security Integration Tests (`server/audit.test.ts`)**
   - Command: `npx --yes tsx --test server/audit.test.ts`
   - Result: **2 / 2 passed (0 failed)** verifying concurrent `closePositionAtomically()` double-close race prevention (exact single settlement receipt), HTTP security headers, `/api/health` diagnostics, `/api/sync/bootstrap` single-trip payload & `Cache-Control: no-store`, `POST /api/positions/:id/close` settlement payload accuracy, and optional `OMNISENT_ADMIN_TOKEN` bearer enforcement (`401` unauthorized vs `200` authorized).

3. **Production Build & TypeScript Verification**
   - Commands: `npm install --package-lock-only --no-audit --no-fund`, `npm run build`, and `tsc --noEmit`
   - Result: Clean Vite 8 + PWA service worker production build (`dist/`) and zero TypeScript errors.

4. **Live HTTP Health, Bootstrap Sync & Smart Run Verification**
   - Endpoints: `GET http://localhost:3000/api/health`, `GET http://localhost:3000/api/sync/bootstrap`, and `POST http://localhost:3000/api/run/smart`
   - Verified HTTP `200 OK` with `Cache-Control: no-store` headers, security headers, `stateRevision` tracking, live exchange tickers (`LIVE_EXCHANGE`), and successful `BTC/USDT` Smart Run signal generation.

5. **End-to-End Browser Verification (`playwright-cli`, Chromium)**
   - Verified desktop (`1440x900`) and mobile (`390x844`) layouts with **0 browser console errors / 0 warnings**.
   - Verified `Đóng lệnh` opens `[data-testid="close-position-modal"]` with live streaming telemetry and `Xác nhận đóng lệnh` settles positions atomically with `[data-testid="settlement-notice-banner"]`.
   - Verified PWA sidebar card (`Đồng bộ ngay` / latency readout), `PWAInstallModal` diagnostics (`192 / 512 · Maskable`, `SW ĐÃ SẴN SÀNG`, `WS Real-Time`), mobile drawer (`pwa-drawer-card` + `pwa-sync-now-drawer`), and mobile Smart Run completion with zero stale/exchange-data error banner.
