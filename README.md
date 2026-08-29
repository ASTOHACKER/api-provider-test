# API Gateway

A lightweight LLM API gateway / proxy that aggregates multiple providers (OpenAI, Anthropic, GLM-compatible) behind a single endpoint, with per-customer API keys, usage tracking, quota enforcement, and a live dashboard.

## Stack

- **Hono** — web framework
- **PostgreSQL** (via `postgres` driver) — storage (customers, keys, quotas, usage logs)
- **TypeScript** — strict, ESM
- **Vercel** — serverless deployment (`api/index.ts` adapter)

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
#   - set ADMIN_API_KEY (or leave default for dev)
#   - set DATABASE_URL (Postgres connection string, e.g. Neon)
#   - set OPENAI_API_KEY / ANTHROPIC_API_KEY / GLM_API_KEY as needed

# 3. Run in dev mode
npm run dev
```

Server starts on `http://0.0.0.0:8787`. The database schema is created automatically on first run (via migrations), and default providers are seeded from your env vars.

## Architecture

```
src/
├── index.ts              # entry point — mounts routes, starts server
├── db.ts                 # SQLite connection + migrations + query helpers
├── types.ts              # shared TypeScript types
├── lib/
│   ├── config.ts         # env loading + default provider config
│   ├── keys.ts           # API key generation
│   └── usage.ts          # quota checks, token parsing, usage recording
├── middleware/
│   ├── auth.ts           # verifies customer API keys
│   └── timing.ts         # response-time header
└── routes/
    ├── proxy.ts          # multi-provider forwarding (streaming + non-streaming)
    ├── admin.ts          # admin API for customers/keys/providers/stats
    └── dashboard.ts      # HTML dashboard
```

## How routing works

1. Client sends a request to `/v1/chat/completions` (OpenAI-compatible) or `/v1/messages` (Anthropic-compatible) with their **gateway API key** and a `model` field.
2. The gateway looks up which enabled provider serves that `model` (matched against each provider's `models` list).
3. It rewrites the auth header with the upstream provider's real API key and forwards the request.
4. Tokens are parsed from the response (or the final SSE chunk for streams) and recorded against the customer's quota.

## Admin API

All admin endpoints require `x-admin-key: <ADMIN_API_KEY>`.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/admin/customers?name=...&email=...&monthly_request_limit=...&monthly_token_limit=...` | Create a customer (auto-creates a quota row) |
| `GET`  | `/admin/customers` | List all customers |
| `POST` | `/admin/customers/:id/keys?name=...` | Generate a gateway API key for a customer |
| `PATCH`| `/admin/customers/:id/quota?monthly_request_limit=...&monthly_token_limit=...` | Update quotas |
| `GET`  | `/admin/customers/:id/usage` | Customer quota + recent usage |
| `GET`  | `/admin/providers` | List providers |
| `POST` | `/admin/providers?name=...&type=openai\|anthropic&base_url=...&api_key=...&models=a,b,c` | Add a provider |
| `PATCH`| `/admin/providers/:id` | Update a provider (`enabled`, `api_key`, `models`, etc.) |
| `GET`  | `/admin/stats` | 24h aggregate stats |

## Dashboard

Open `http://localhost:8787/dashboard` in a browser. It auto-refreshes every 15s and shows requests, tokens, errors, and breakdowns by customer and model.

## Quick start example

```bash
# 1. Create a customer
curl -X POST "http://localhost:8787/admin/customers?name=acme&monthly_request_limit=1000&monthly_token_limit=500000" \
  -H "x-admin-key: $ADMIN_API_KEY"

# 2. Generate an API key (replace :id with the customer id from step 1)
curl -X POST "http://localhost:8787/admin/customers/1/keys?name=prod" \
  -H "x-admin-key: $ADMIN_API_KEY"
# -> { "api_key": { "key": "gw_ab12cd34..." } }

# 3. Make a proxied request using the gateway key
curl http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer gw_ab12cd34..." \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}'
```

## Quotas

Each customer has a monthly request limit and token limit. The gateway checks the quota before forwarding; once exceeded it returns `429` with `quota_exceeded`. Quota periods reset automatically at the start of each calendar month.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start with hot reload (tsx watch) |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run the compiled build |
| `npm run typecheck` | Type-check without emitting |
