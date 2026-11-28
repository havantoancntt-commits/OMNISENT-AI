# OMNISENT AI — Institutional Quantitative Research & Paper Trading Lab

> **SIMULATION NOTICE**: OMNISENT AI boots and resets in **`PAPER` simulation mode by default**. Live real-money exchange execution is explicitly disabled (`OMNISENT_LIVE_EXECUTION_ENABLED="false"`). Liquidation prices shown for leveraged positions are explicitly labeled isolated-margin estimates (`isEstimate: true`).

## Overview

OMNISENT AI is a quantitative multi-agent cryptocurrency research, market intelligence, backtesting, and deterministic paper-execution workstation. It combines:

- **19-Agent Adversarial Debate Core** + interactive **Three.js 3D Trading Floor**
- **Deterministic AI-Independent Risk Engine** (`src/engine/riskEngine.ts`) with fail-closed quote freshness (`tickerTimestampUtc`), R:R minimum checks, leverage caps, idempotency deduplication, and `EMERGENCY_STOP` lock governance
- **Full-Market Scanner & 2-Tier Alpha Radar** across Binance, Bybit, OKX, Kraken, Coinbase Advanced, and Gate.io
- **Quant Lab** with chronological Walk-Forward Optimization, multi-strategy benchmarking, and Monte Carlo stress simulation
- **13-State Order Lifecycle Machine** (`src/engine/orderStateMachine.ts`) + **Paper Simulated Execution Adapter** (`server/executionAdapter.ts`) with immutable `order_state_events`
- **Installable PWA** (`vite-plugin-pwa`) with single-trip bootstrap sync (`/api/sync/bootstrap`), WebSocket telemetry + OKX fallback stream, and secret-free local telemetry snapshots

## Quick Start

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:3000`.

## Verification Commands

```bash
# TypeScript type-check
npm run lint

# Run all 54 unit, database/audit, and security tests
npx tsx --test src/engine/engine.test.ts server/audit.test.ts server/security.test.ts

# Build Vite + PWA production bundle
npm run build
```

## Documentation Index

- [ARCHITECTURE.md](./ARCHITECTURE.md) — System boundaries, 13-state order machine, Risk Engine gate, and WebSocket/PWA sync
- [SECURITY.md](./SECURITY.md) — RBAC roles, fail-closed startup rules, vault encryption, SSRF/XSS/CORS, and prompt-injection fences
- [DATABASE.md](./DATABASE.md) — SQLite WAL concurrency, versioned migrations, and PostgreSQL/Redis migration paths
- [ENVIRONMENT.md](./ENVIRONMENT.md) — Full environment variable reference
- [DEPLOYMENT.md](./DEPLOYMENT.md) — Production, Vercel Serverless, and strict security checklists
- [TESTING.md](./TESTING.md) — Test suites, coverage scope, and honest execution matrix
- [AUDIT_REPORT.md](./AUDIT_REPORT.md) — Findings from the end-to-end engineering & security audit
- [REPAIR_REPORT.md](./REPAIR_REPORT.md) — Implemented remediations and verification results
