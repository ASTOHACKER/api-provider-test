import { Hono } from "hono"
import type { DB } from "../queries.js"
import { queries } from "../queries.js"
import { generateApiKey } from "../lib/keys.js"

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
  app.get("/providers", async (c) => c.json({ providers: await queries.listProviders(getDb()) }))

  app.post("/providers", async (c) => {
    const db = getDb()
    const q = c.req.query()
    const models = q.models ? q.models.split(",").map((m) => m.trim()) : []
    const id = await queries.insertProvider(db, {
      name: q.name || "",
      type: q.type || "openai",
      base_url: q.base_url || "",
      api_key: q.api_key || "",
      models,
    })
    const provider = await queries.getProviderById(db, id)
    return c.json({ provider }, 201)
  })

  app.patch("/providers/:id", async (c) => {
    const db = getDb()
    const id = parseInt(c.req.param("id"), 10)
    const sets: Record<string, unknown> = {}
    const q = c.req.query()
    if (q.models) sets.models = q.models.split(",").map((m) => m.trim())
    if (q.enabled !== undefined) sets.enabled = q.enabled === "true"
    if (q.name) sets.name = q.name
    if (q.base_url) sets.base_url = q.base_url
    if (q.api_key !== undefined) sets.api_key = q.api_key
    await queries.updateProvider(db, id, sets)
    const provider = await queries.getProviderById(db, id)
    return c.json({ provider })
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
