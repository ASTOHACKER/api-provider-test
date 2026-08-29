import type { Context, Next } from "hono"

type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()

export function createRateLimitMiddleware(limit = 60, windowMs = 60_000) {
  return async (c: Context, next: Next) => {
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
    const key = forwarded || c.req.header("x-real-ip") || "unknown"
    const now = Date.now()
    const bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs })
      await next()
      return
    }
    if (bucket.count >= limit) {
      c.header("retry-after", String(Math.ceil((bucket.resetAt - now) / 1000)))
      return c.json({ error: { message: "rate limit exceeded", type: "rate_limit_error" } }, 429)
    }
    bucket.count += 1
    await next()
  }
}
