import { Hono } from "hono"
import type { DB } from "../queries.js"
import { queries } from "../queries.js"
import { generateApiKey } from "../lib/keys.js"

function publicProvider(provider: any) {
  if (!provider) return provider
  const { api_key: _apiKey, api_key_encrypted: _encryptedKey, ...safe } = provider
  return { ...safe, has_api_key: Boolean(_apiKey) }
}

export function createAdminRoutes(getDb: () => DB, adminKey: string) {
  const app = new Hono()

  app.use("*", async (c, next) => {
    const provided =
      c.req.header("x-admin-key") || c.req.header("authorization")?.replace(/^Bearer\s+/i, "")
    if (provided !== adminKey) {
      return c.json({ error: "unauthorized" }, 401)
    }
    await next()
  })

  app.get("/health", (c) => c.json({ ok: true }))

  // --- Customers ---
  app.post("/customers", async (c) => {
    const db = getDb()
    const q = c.req.query()
    if (!q.name) return c.json({ error: "name required" }, 400)
    const reqLimit = q.monthly_request_limit ? parseInt(q.monthly_request_limit, 10) : 10000
    const tokLimit = q.monthly_token_limit ? parseInt(q.monthly_token_limit, 10) : 2000000
    const id = await queries.insertCustomer(db, q.name, q.email || null, reqLimit, tokLimit)
    const customer = await queries.getCustomer(db, id)
    return c.json({ customer }, 201)
  })

  app.get("/customers", async (c) => c.json({ customers: await queries.listCustomers(getDb()) }))

  app.post("/customers/:id/keys", async (c) => {
    const db = getDb()
    const customerId = parseInt(c.req.param("id"), 10)
    const name = c.req.query("name") || "default"
    const customer = await queries.getCustomer(db, customerId)
    if (!customer) return c.json({ error: "customer not found" }, 404)

    const key = generateApiKey()
    const id = await queries.insertApiKey(db, key, customerId, name)
    const row = await queries.getApiKeyById(db, id)
    return c.json({ api_key: row }, 201)
  })

  app.get("/customers/:id/usage", async (c) => {
    const db = getDb()
    const customerId = parseInt(c.req.param("id"), 10)
    const quota = await queries.getQuota(db, customerId)
    const recent = await queries.recentUsage(db, customerId)
    return c.json({ quota, recent })
  })

  app.patch("/customers/:id/quota", async (c) => {
    const db = getDb()
    const customerId = parseInt(c.req.param("id"), 10)
    const reqLimit = parseInt(c.req.query("monthly_request_limit") || "0", 10) || 10000
    const tokLimit = parseInt(c.req.query("monthly_token_limit") || "0", 10) || 2000000
    await queries.updateQuota(db, customerId, reqLimit, tokLimit)
    const quota = await queries.getQuota(db, customerId)
    return c.json({ quota })
  })

  // --- Providers ---
  app.get("/providers", async (c) => {
    const providers = await queries.listProviders(getDb())
    return c.json({ providers: providers.map(publicProvider) })
  })

  app.post("/providers", async (c) => {
    const db = getDb()
    const input = await providerInput(c)
    const name = typeof input.name === "string" ? input.name : ""
    const type = typeof input.type === "string" ? input.type : "openai"
    const baseUrl = typeof input.base_url === "string" ? input.base_url : ""
    const apiKey = typeof input.api_key === "string" ? input.api_key : ""
    const models = providerModels(input.models)
    if (!name || !baseUrl) return c.json({ error: "name and base_url required" }, 400)
    const id = await queries.insertProvider(db, {
      name,
      type,
      base_url: baseUrl,
      api_key: apiKey,
      models,
    })
    const provider = await queries.getProviderById(db, id)
    return c.json({ provider: publicProvider(provider) }, 201)
  })

  app.patch("/providers/:id", async (c) => {
    const db = getDb()
    const id = parseInt(c.req.param("id"), 10)
    const sets: Record<string, unknown> = {}
    const input = await providerInput(c)
    if (input.models !== undefined) sets.models = providerModels(input.models)
    if (input.enabled !== undefined) sets.enabled = input.enabled === true || input.enabled === "true"
    if (typeof input.name === "string" && input.name) sets.name = input.name
    if (typeof input.base_url === "string" && input.base_url) sets.base_url = input.base_url
    if (typeof input.api_key === "string") sets.api_key = input.api_key
    await queries.updateProvider(db, id, sets)
    const provider = await queries.getProviderById(db, id)
    return c.json({ provider: publicProvider(provider) })
  })

  // --- Stats ---
  app.get("/stats", async (c) => {
    const db = getDb()
    const totals = await queries.statsTotals(db)
    const byCustomer = await queries.statsByCustomer(db)
    const byModel = await queries.statsByModel(db)
    return c.json({ totals, by_customer: byCustomer, by_model: byModel })
  })

  return app
}

async function providerInput(c: import("hono").Context): Promise<Record<string, unknown>> {
  const query = c.req.query()
  if (!c.req.header("content-type")?.includes("application/json")) return query

  try {
    const body = await c.req.json<Record<string, unknown>>()
    return { ...query, ...body }
  } catch {
    return query
  }
}

function providerModels(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((model) => model.trim()).filter(Boolean)
  if (typeof value !== "string") return []
  return value.split(",").map((model) => model.trim()).filter(Boolean)
}
