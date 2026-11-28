# Environment Variables Reference

Copy `.env.example` to `.env` before starting the server.

| Variable | Default / Example | Required in Prod? | Purpose |
|---|---|---|---|
| `GEMINI_API_KEY` | `""` | Optional (for Gemini AI) | Enables live `@google/genai` synthesis & streaming copilot |
| `VAULT_ENCRYPTION_KEY` | `""` (>= 16 chars) | **Yes** | Master secret for AES-256-GCM exchange credential encryption |
| `OMNISENT_ADMIN_TOKEN` | `""` (>= 16 chars) | **Yes** | `SYSTEM_ADMIN` bearer token (`X-Admin-Token` / `Authorization: Bearer`) |
| `OMNISENT_RISK_TOKEN` | `""` | Optional | Scoped `RISK_OFFICER` bearer token |
| `OMNISENT_EXCHANGE_TOKEN` | `""` | Optional | Scoped `EXCHANGE_ADMIN` bearer token |
| `OMNISENT_TRADER_TOKEN` | `""` | Optional | Scoped `TRADER` bearer token |
| `ALLOW_UNAUTH_DEV` | `""` (`"1"` dev only) | No (keep unset in prod) | Explicitly disables fail-closed production startup checks for local debugging |
| `OMNISENT_LIVE_EXECUTION_ENABLED` | `"false"` | Safety Lock | Must remain `"false"` unless institutional custody/execution approval is enabled |
| `APP_URL` | `""` | Recommended | Primary public origin allowed by CORS |
| `ALLOWED_ORIGIN` | `""` | Optional | Comma-separated additional allowed CORS origins |
| `ALLOW_CLOUD_RUN_CORS` | `"0"` | Optional | Set `"1"` if deployed behind dynamic Cloud Run preview URLs |
| `DATABASE_URL` | `""` | Optional | PostgreSQL connection URL for multi-instance environments |
| `OMNISENT_DATA_DIR` | `".data"` | Optional | Override SQLite WAL database directory |
| `REDIS_URL` | `""` | Optional | External Redis connection string |
| `UPSTASH_REDIS_REST_URL` | `""` | Optional | Upstash Redis REST URL for distributed sliding-window rate limiting |
| `UPSTASH_REDIS_REST_TOKEN` | `""` | Optional | Upstash Redis REST bearer token |
| `AI_MAX_CALLS_PER_HOUR` | `"120"` | Optional | Hourly ceiling on Gemini AI calls |
| `AI_MAX_CONCURRENT` | `"3"` | Optional | Concurrent Gemini AI request cap |
| `REQUEST_TIMEOUT_MS` | `"25000"` | Optional | HTTP request timeout ceiling (excluding SSE copilot stream) |
