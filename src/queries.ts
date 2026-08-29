import type { PostgresError } from "postgres"
import type { ApiKey, Customer, Provider, Quota } from "./types.js"
import type { DB } from "./db.js"

export type { DB } from "./db.js"

export const queries = {
  getApiKey: async (db: DB, key: string) =>
    (
      await db<(ApiKey & { customer_name: string; customer_enabled: boolean })[]>`
        SELECT ak.*, c.name AS customer_name, c.enabled AS customer_enabled
        FROM api_keys ak
        JOIN customers c ON c.id = ak.customer_id
        WHERE ak.key = ${key} AND ak.enabled = TRUE AND c.enabled = TRUE
        LIMIT 1
      `
    )[0],

  getCustomer: async (db: DB, id: number) =>
    (await db<Customer[]>`SELECT * FROM customers WHERE id = ${id} LIMIT 1`)[0],

  getQuota: async (db: DB, customerId: number) =>
    (await db<Quota[]>`SELECT * FROM quotas WHERE customer_id = ${customerId} LIMIT 1`)[0],

  upsertQuota: async (
    db: DB,
    q: { customer_id: number; monthly_request_limit: number; monthly_token_limit: number }
  ) =>
    await db`
      INSERT INTO quotas (customer_id, monthly_request_limit, monthly_token_limit)
      VALUES (${q.customer_id}, ${q.monthly_request_limit}, ${q.monthly_token_limit})
      ON CONFLICT(customer_id) DO NOTHING
    `,

  incrementUsage: async (db: DB, customerId: number, requests: number, tokens: number) =>
    await db`
      UPDATE quotas
      SET requests_used = requests_used + ${requests},
          tokens_used = tokens_used + ${tokens}
      WHERE customer_id = ${customerId}
    `,

  maybeResetPeriod: async (db: DB, customerId: number) => {
    const q = (
      await db<{ period_start: Date }[]>`SELECT period_start FROM quotas WHERE customer_id = ${customerId} LIMIT 1`
    )[0]
    if (!q) return
    const start = new Date(q.period_start)
    const now = new Date()
    if (start.getUTCFullYear() !== now.getUTCFullYear() || start.getUTCMonth() !== now.getUTCMonth()) {
      await db`
        UPDATE quotas SET period_start = now(), requests_used = 0, tokens_used = 0
        WHERE customer_id = ${customerId}
      `
    }
  },

  touchApiKey: async (db: DB, keyId: number) =>
    await db`UPDATE api_keys SET last_used_at = now() WHERE id = ${keyId}`,

  logUsage: async (
    db: DB,
    row: {
      customer_id: number
      api_key_id: number
      provider_id: number
      model: string
      prompt_tokens: number
      completion_tokens: number
      total_tokens: number
      status: number
      latency_ms: number
      error: string | null
    }
  ) =>
    await db`
      INSERT INTO usage_logs
      (customer_id, api_key_id, provider_id, model, prompt_tokens, completion_tokens,
       total_tokens, status, latency_ms, error)
      VALUES (${row.customer_id}, ${row.api_key_id}, ${row.provider_id}, ${row.model},
              ${row.prompt_tokens}, ${row.completion_tokens}, ${row.total_tokens},
              ${row.status}, ${row.latency_ms}, ${row.error})
    `,

  listProviders: async (db: DB) => (await db<Provider[]>`SELECT * FROM providers ORDER BY id`) as Provider[],

  getProviderForModel: async (db: DB, model: string) => {
    const providers = await db<Provider[]>`SELECT * FROM providers WHERE enabled = TRUE ORDER BY id`
    return providers.find((provider) => {
      try {
        return JSON.parse(provider.models || "[]").includes(model)
      } catch {
        return false
      }
    })
  },

  listCustomers: async (db: DB) => (await db<Customer[]>`SELECT * FROM customers ORDER BY id`) as Customer[],

  insertCustomer: async (db: DB, name: string, email: string | null, reqLimit: number, tokLimit: number) => {
    const res = await db<{ id: number }[]>`
      INSERT INTO customers (name, email) VALUES (${name}, ${email}) RETURNING id
    `
    const customerId = res[0].id
    await db`
      INSERT INTO quotas (customer_id, monthly_request_limit, monthly_token_limit)
      VALUES (${customerId}, ${reqLimit}, ${tokLimit})
      ON CONFLICT(customer_id) DO NOTHING
    `
    return customerId
  },

  insertApiKey: async (db: DB, key: string, customerId: number, name: string) => {
    const res = await db<{ id: number }[]>`
      INSERT INTO api_keys (key, customer_id, name) VALUES (${key}, ${customerId}, ${name}) RETURNING id
    `
    return res[0].id
  },

  getApiKeyById: async (db: DB, id: number) =>
    (await db<ApiKey[]>`SELECT * FROM api_keys WHERE id = ${id} LIMIT 1`)[0],

  updateQuota: async (db: DB, customerId: number, reqLimit: number, tokLimit: number) =>
    await db`
      INSERT INTO quotas (customer_id, monthly_request_limit, monthly_token_limit)
      VALUES (${customerId}, ${reqLimit}, ${tokLimit})
      ON CONFLICT(customer_id) DO UPDATE SET
        monthly_request_limit = EXCLUDED.monthly_request_limit,
        monthly_token_limit = EXCLUDED.monthly_token_limit
    `,

  insertProvider: async (db: DB, c: { name: string; type: string; base_url: string; api_key: string; models: string[] }) => {
    const res = await db<{ id: number }[]>`
      INSERT INTO providers (name, type, base_url, api_key, models)
      VALUES (${c.name}, ${c.type}, ${c.base_url}, ${c.api_key}, ${JSON.stringify(c.models)}) RETURNING id
    `
    return res[0].id
  },

  getProviderById: async (db: DB, id: number) =>
    (await db<Provider[]>`SELECT * FROM providers WHERE id = ${id} LIMIT 1`)[0],

  updateProvider: async (db: DB, id: number, sets: Record<string, unknown>) => {
    const keys = Object.keys(sets)
    if (keys.length === 0) return
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ")
    const values = keys.map((k) => (k === "models" ? JSON.stringify(sets[k]) : sets[k])) as any[]
    await db.unsafe(`UPDATE providers SET ${setClause} WHERE id = ${id}`, values)
  },

  recentUsage: async (db: DB, customerId: number) =>
    await db`
      SELECT * FROM usage_logs WHERE customer_id = ${customerId} ORDER BY id DESC LIMIT 50
    `,

  statsTotals: async (db: DB) =>
    (
      await db<Record<string, number>[]>`
        SELECT
          COUNT(*)::int AS total_requests,
          COALESCE(SUM(total_tokens),0)::int AS total_tokens,
          COALESCE(SUM(prompt_tokens),0)::int AS prompt_tokens,
          COALESCE(SUM(completion_tokens),0)::int AS completion_tokens,
          COALESCE(SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END),0)::int AS errors
        FROM usage_logs
        WHERE created_at >= now() - interval '24 hours'
      `
    )[0],

  statsByCustomer: async (db: DB) =>
    await db`
      SELECT c.name, COUNT(u.id)::int AS requests, COALESCE(SUM(u.total_tokens),0)::int AS tokens
      FROM usage_logs u
      JOIN customers c ON c.id = u.customer_id
      WHERE u.created_at >= now() - interval '24 hours'
      GROUP BY u.customer_id, c.name ORDER BY tokens DESC LIMIT 10
    `,

  statsByModel: async (db: DB) =>
    await db`
      SELECT model, COUNT(*)::int AS requests, COALESCE(SUM(total_tokens),0)::int AS tokens
      FROM usage_logs
      WHERE created_at >= now() - interval '24 hours'
      GROUP BY model ORDER BY tokens DESC LIMIT 10
    `,

  dashboardTotals: async (db: DB) =>
    (
      await db<Record<string, number>[]>`
        SELECT
          COUNT(*)::int AS total_requests,
          COALESCE(SUM(total_tokens),0)::int AS total_tokens,
          COALESCE(SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END),0)::int AS errors
        FROM usage_logs WHERE created_at >= now() - interval '24 hours'
      `
    )[0],
}

export type { PostgresError }
