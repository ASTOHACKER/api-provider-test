import { serve } from "@hono/node-server"
import { createApp } from "./app.js"
import { loadConfig } from "./lib/config.js"
import { getDb, migrate, seedProviders } from "./db.js"
import { defaultProviders } from "./lib/config.js"

const config = loadConfig()

const db = getDb()
await migrate(db)
await seedProviders(db, defaultProviders())

const app = createApp()

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`API Gateway listening on http://${info.address}:${info.port}`)
  console.log(`Dashboard:  http://${info.address}:${info.port}/dashboard`)
})

export {}
