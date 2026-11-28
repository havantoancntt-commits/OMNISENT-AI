# Testing & Verification Matrix

## 1. Automated Test Suites

Run the full suite using Node's built-in test runner via `tsx`:

```bash
npx tsx --test src/engine/engine.test.ts server/audit.test.ts server/security.test.ts
```

### Suite Coverage
1. **`src/engine/engine.test.ts` (43 tests)**:
   - Technical indicators, Data Integrity checks, deterministic Risk Engine vetoes (including `requireFreshTimestamp` and `tickerTimestampUtc <= 0` fail-closed checks), Backtester causality, Walk-Forward Optimization, Full-Market 2-tier Screener & Ranker, Quant Intelligence (Hurst, Kelly, Correlation Guard), Precision & Contract Filters (`roundToTick`, `roundToStep`, unified fees, isolated liquidation estimates), 13-State Order Lifecycle Machine, 5-state Feed Health classification, i18n key parity (`vi`/`en`), PWA helpers & direct price sync, and UTC daily/weekly PnL baseline calculations.
2. **`server/audit.test.ts` (3 tests)**:
   - SQLite `BEGIN IMMEDIATE` atomic position closing & double-close prevention, HTTP security headers & `/api/sync/bootstrap` `Cache-Control: no-store`, `OMNISENT_ADMIN_TOKEN` guard, and `openDatabaseWithRecovery()` corruption quarantine.
3. **`server/security.test.ts` (8 tests)**:
   - `redactSecrets()`, `validateSecurityStartupConfig()` fail-closed production enforcement, 5-role RBAC matrix (`PUBLIC_READ` / `TRADER` / `RISK_OFFICER` / `EXCHANGE_ADMIN` / `SYSTEM_ADMIN`), `/api/auth/claim` + `/api/auth/login` + `/api/auth/logout` scrypt sessions, SSRF/XSS URL validation (`isSafeExternalGroundingUrl`), prompt-injection delimiter scrubbing (`sanitizeUntrustedText`), untrusted CORS preflight denial (`403`), malformed JSON clean `400` response, invalid candle interval rejection (`400`), Emergency Stop unlock governance (`confirmEmergencyReset` + `unlockReason`), and execution reconciliation parity (`/api/execution/reconcile`).

## 2. Verification Honesty Policy

| Target Component | Status | Notes |
|---|---|---|
| Pure Engine + Precision + Risk + Order Machine | **PASS** | Automated in `src/engine/engine.test.ts` |
| SQLite WAL Transactions & Corruption Recovery | **PASS** | Automated in `server/audit.test.ts` |
| RBAC, Auth, Vault, SSRF, CORS, Emergency Unlock | **PASS** | Automated in `server/security.test.ts` |
| TypeScript (`tsc --noEmit`) & Vite PWA Build | **PASS** | Zero errors; `dist/` + `sw.js` generated |
| Live External PostgreSQL (`DATABASE_URL`) | **BLOCKED** | External PostgreSQL server not provisioned in sandbox |
| Live External Redis (`UPSTASH_REDIS_REST_URL`) | **BLOCKED** | External Redis server not provisioned in sandbox |
