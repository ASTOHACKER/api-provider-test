import { Hono } from "hono"
import { logger } from "hono/logger"
import { getDb, migrate, seedProviders } from "./db.js"
import { loadConfig, defaultProviders } from "./lib/config.js"
import { createTimingMiddleware } from "./middleware/timing.js"
import { createProxyRoutes } from "./routes/proxy.js"
import { createAdminRoutes } from "./routes/admin.js"
import { createDashboardRoutes } from "./routes/dashboard.js"

let initPromise: Promise<void> | null = null

async function ensureInit() {
  if (!initPromise) {
    initPromise = (async () => {
      const db = getDb()
      await migrate(db)
      await seedProviders(db, defaultProviders())
    })().catch((err) => {
      initPromise = null
      throw err
    })
  }
  return initPromise
}

export function createApp() {
  const config = loadConfig()
  const app = new Hono()

  app.use("*", logger())
  app.use("*", createTimingMiddleware())
  app.use("*", async (c, next) => {
    await ensureInit()
    await next()
  })

  app.route("/v1", createProxyRoutes(() => getDb()))
  app.route("/admin", createAdminRoutes(() => getDb(), config.adminApiKey))
  app.route("/dashboard", createDashboardRoutes(() => getDb(), config.adminApiKey))

  app.get("/", (c) =>
    c.json({
      name: "api-gateway",
      version: "0.1.0",
      endpoints: {
        proxy: ["/v1/chat/completions", "/v1/completions", "/v1/embeddings", "/v1/responses", "/v1/messages", "/v1/models"],
        admin: ["/admin/customers", "/admin/providers", "/admin/stats", "/admin/health"],
        dashboard: "/dashboard",
      },
    })
  )

  return app
}
