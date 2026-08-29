import type { Context, Next } from "hono"

export function createTimingMiddleware() {
  return async (c: Context, next: Next) => {
    const start = Date.now()
    await next()
    c.header("X-Response-Time", `${Date.now() - start}ms`)
    c.set("latencyMs", Date.now() - start)
  }
}

declare module "hono" {
  interface ContextVariableMap {
    latencyMs: number
  }
}
