# Deployment Guide

## 1. Local & Container Node.js Deployment

1. Install dependencies: `npm ci`
2. Configure environment: set `VAULT_ENCRYPTION_KEY`, `OMNISENT_ADMIN_TOKEN`, `ALLOWED_ORIGIN` (if browser runs on another origin), and `OMNISENT_LIVE_EXECUTION_ENABLED="false"`.
3. Build client assets & PWA service worker: `npm run build`
4. Start server on port `3000`: `npm run start` (or `npx tsx server.ts` depending on Node TS loader).

## 2. Vercel Serverless Deployment

- `vercel.json` routes `/api/(.*)` to `/api/index` (`maxDuration: 30`) and serves SPA static routes from `dist/`.
-Strict `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate` headers prevent stale API or manifest responses.
- Because serverless instances do not sustain inbound WebSockets (`wsSupported: false`), the PWA automatically switches to fast `GET /api/sync/bootstrap` polling paired with Direct OKX Public WebSocket market ticks.
- **Required Cloud Dependencies for Multi-Instance Serverless**: Provision managed PostgreSQL (`DATABASE_URL` + apply `server/migrations/postgres/001_initial.sql`) and Upstash Redis (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) before scaling horizontally across stateless lambdas.

## 3. Pre-Production Security Checklist

- [ ] `OMNISENT_ADMIN_TOKEN` (>= 16 chars) and `VAULT_ENCRYPTION_KEY` (>= 16 chars) configured
- [ ] `ALLOW_UNAUTH_DEV` is **unset / empty**
- [ ] `OMNISENT_LIVE_EXECUTION_ENABLED` is `"false"`
- [ ] `npm run lint`, test suites (`54/54`), and `npm run build` pass in CI
- [ ] HTTPS enforced with valid `APP_URL` / `ALLOWED_ORIGIN`
