import postgres from "postgres"
import type { ApiKey, Customer, Provider, Quota, ProviderConfig } from "./types.js"
import { encryptCredential } from "./lib/credentials.js"

let sql: ReturnType<typeof postgres> | null = null

export type DB = ReturnType<typeof postgres>

export function getDb(): DB {
  if (sql) return sql
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error("DATABASE_URL is not set (expected a Postgres/Neon connection string)")
  }
  sql = postgres(url, { prepare: false, max: 5 })
  return sql
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'default',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);

CREATE TABLE IF NOT EXISTS quotas (
  customer_id INTEGER PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  monthly_request_limit INTEGER NOT NULL DEFAULT 10000,
  monthly_token_limit INTEGER NOT NULL DEFAULT 2000000,
  period_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  requests_used INTEGER NOT NULL DEFAULT 0,
  tokens_used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS providers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK(type IN ('openai','anthropic','google')),
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL DEFAULT '',
  api_key_encrypted TEXT NOT NULL DEFAULT '',
  models TEXT NOT NULL DEFAULT '[]',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage_logs (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  api_key_id INTEGER NOT NULL,
  provider_id INTEGER NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  status INTEGER NOT NULL DEFAULT 200,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usage_customer ON usage_logs(customer_id);
CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_provider ON usage_logs(provider_id);
`

export async function migrate(db: ReturnType<typeof postgres>) {
  await db.unsafe(SCHEMA)
  await db.unsafe(`ALTER TABLE providers DROP CONSTRAINT IF EXISTS providers_type_check`)
  await db.unsafe(`ALTER TABLE providers ADD CONSTRAINT providers_type_check CHECK(type IN ('openai','anthropic','google'))`)
  await db`ALTER TABLE providers ADD COLUMN IF NOT EXISTS api_key_encrypted TEXT NOT NULL DEFAULT ''`

  const providers = await db<{ id: number; api_key: string; api_key_encrypted: string }[]>`
    SELECT id, api_key, api_key_encrypted FROM providers
  `
  for (const provider of providers) {
    if (!provider.api_key || provider.api_key_encrypted) continue
    await db`
      UPDATE providers
      SET api_key = '', api_key_encrypted = ${encryptCredential(provider.api_key)}
      WHERE id = ${provider.id}
    `
  }
}

export async function seedProviders(db: ReturnType<typeof postgres>, configs: ProviderConfig[]) {
  const existing = await db<{ c: number }[]>`SELECT COUNT(*)::int AS c FROM providers`
  if (existing[0]?.c > 0) return
  for (const c of configs) {
    await db`
      INSERT INTO providers (name, type, base_url, api_key, api_key_encrypted, models, enabled)
      VALUES (${c.name}, ${c.type}, ${c.base_url}, '', ${c.api_key ? encryptCredential(c.api_key) : ''}, ${JSON.stringify(c.models)}, TRUE)
    `
  }
}

export type { ApiKey, Customer, Provider, Quota }
