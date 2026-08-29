import type { Context, Next } from "hono"
import type { DB } from "../queries.js"
import { queries } from "../queries.js"
import type { AuthContext } from "../types.js"

declare module "hono" {
  interface ContextVariableMap {
    auth: AuthContext
  }
}

export function createAuthMiddleware(getDb: () => DB) {
  return async (c: Context, next: Next) => {
    const auth = c.req.header("authorization") || c.req.header("x-api-key")
    if (!auth) return c.json({ error: "missing API key" }, 401)

    const key = auth.startsWith("Bearer ") ? auth.slice(7) : auth
    const row = await queries.getApiKey(getDb(), key)
    if (!row) return c.json({ error: "invalid or disabled API key" }, 401)

    c.set("auth", {
      customer: {
        id: row.customer_id,
        name: row.customer_name,
        email: null,
        enabled: row.customer_enabled,
        created_at: "",
      },
      apiKey: {
        id: row.id,
        key: row.key,
        customer_id: row.customer_id,
        name: row.name,
        enabled: row.enabled,
        created_at: "",
        last_used_at: row.last_used_at,
      },
    })
    await next()
  }
}
