# System Architecture

## 1. High-Level Topology

- **Client SPA & PWA (`src/`)**: React 19 + TypeScript + Tailwind CSS + Three.js 3D Trading Floor + D3.js Equity/PnL charts + VitePWA service worker (`vite-plugin-pwa`).
- **API & Telemetry Server (`server.ts`)**: Express + WebSocket (`ws`) server exposing market ingestion, deterministic quant/risk/execution endpoints, AI synthesis/copilot streaming, and SQLite persistence. Also wraps cleanly as a Vercel serverless handler (`api/index.ts`).
- **Execution Safety Boundary**:
  - Default boot and session reset mode is **`PAPER`**.
  - **`LiveExchangeExecutionAdapter`** (`server/executionAdapter.ts`) is locked fail-closed while `OMNISENT_LIVE_EXECUTION_ENABLED` is `"false"`.
  - **`PaperSimulatedExecutionAdapter`** routes all paper orders through `evaluateOrderRisk`, precision quantization (`src/engine/precision.ts`), and the 13-state order lifecycle machine (`src/engine/orderStateMachine.ts`).

## 2. Deterministic Risk Engine & Order Lifecycle

```
OrderRequest
  ├──> validateContractFilters (tickSize, stepSize, minQty, minNotionalUsd)
  ├──> evaluateOrderRisk (MODE != EMERGENCY_STOP/ANALYSIS_ONLY, LIVE_EXCHANGE, tickerTimestampUtc <= 30s, idempotencyKey, R:R, leverage, single-asset cap)
  └──> PaperSimulatedExecutionAdapter
        ├── CREATED -> VALIDATING -> RISK_REJECTED (vetoed orders logged atomically)
        └── CREATED -> VALIDATING -> SUBMITTED -> ACKNOWLEDGED -> FILLED
              └── Persists atomic SQLite transaction (orders + positions + portfolio_state + audit_logs + order_state_events)
```

## 3. Emergency-Stop Unlock Governance

Entering `EMERGENCY_STOP` persists `emergency_stop_state` in SQLite and immediately halts new executions and auto-trading cycles. Leaving `EMERGENCY_STOP` via `POST /api/mode` requires `{ confirmEmergencyReset: true, unlockReason: "<min 3 chars>" }` and records an immutable `EMERGENCY_STOP_UNLOCKED` audit event.

## 4. Real-Time Price Synchronization

1. **Primary Transport**: Server WebSocket (`/ws`) broadcasts `PRICE_TICK_UPDATE` and `TELEMETRY_UPDATE` frames carrying `stateRevision`, tickers, portfolio equity, and positions.
2. **Fast Bootstrap & Fallback Polling**: `GET /api/sync/bootstrap` delivers single-trip hydration with `wsSupported` and `feedAgeMs` diagnostics; serverless clients automatically fall back to adaptive HTTP polling + Direct OKX Public WebSocket (`wss://ws.okx.com:8443/ws/v5/public`) via `src/pwa/directPriceSync.ts`.
3. **5-State Feed Health Classification**: `resolveTickerFeedHealthState()` normalizes quotes into `LIVE`, `AGING`, `STALE`, `OFFLINE`, and `ERROR`.
