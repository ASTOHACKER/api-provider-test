import type { Context } from "hono"
import type { DB } from "../queries.js"
import { queries } from "../queries.js"

export interface UsageResult {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export async function checkQuota(db: DB, customerId: number): Promise<{
  ok: boolean
  reason?: string
}> {
  await queries.maybeResetPeriod(db, customerId)
  const q = await queries.getQuota(db, customerId)
  if (!q) return { ok: true }

  if (q.monthly_request_limit > 0 && q.requests_used >= q.monthly_request_limit) {
    return { ok: false, reason: "monthly request limit reached" }
  }
  if (q.monthly_token_limit > 0 && q.tokens_used >= q.monthly_token_limit) {
    return { ok: false, reason: "monthly token limit reached" }
  }
  return { ok: true }
}

export async function recordUsage(
  db: DB,
  ctx: {
    customer_id: number
    api_key_id: number
    provider_id: number
    model: string
    status: number
    latency_ms: number
    error: string | null
  },
  usage: UsageResult
) {
  const total = usage.total_tokens || usage.prompt_tokens + usage.completion_tokens
  await queries.incrementUsage(db, ctx.customer_id, 1, total)
  await queries.logUsage(db, {
    ...ctx,
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    total_tokens: total,
  })
  await queries.touchApiKey(db, ctx.api_key_id)
}

export function parseOpenAIUsage(body: unknown): UsageResult {
  const b = body as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }
  const u = b?.usage ?? {}
  return {
    prompt_tokens: u.prompt_tokens ?? 0,
    completion_tokens: u.completion_tokens ?? 0,
    total_tokens: u.total_tokens ?? 0,
  }
}

export function parseAnthropicUsage(body: unknown): UsageResult {
  const b = body as { usage?: { input_tokens?: number; output_tokens?: number } }
  const u = b?.usage ?? {}
  const prompt = u.input_tokens ?? 0
  const completion = u.output_tokens ?? 0
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion }
}

export function extractStreamUsage(
  chunks: string[],
  providerType: "openai" | "anthropic"
): UsageResult {
  const text = chunks.join("")
  if (providerType === "anthropic") {
    const m = text.match(/"input_tokens"\s*:\s*(\d+)/)
    const m2 = text.match(/"output_tokens"\s*:\s*(\d+)/)
    const prompt = m ? parseInt(m[1], 10) : 0
    const completion = m2 ? parseInt(m2[1], 10) : 0
    return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion }
  }
  const m = text.match(/"prompt_tokens"\s*:\s*(\d+)/)
  const m2 = text.match(/"completion_tokens"\s*:\s*(\d+)/)
  const prompt = m ? parseInt(m[1], 10) : 0
  const completion = m2 ? parseInt(m2[1], 10) : 0
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion }
}

export function setUsageContext(c: Context, data: Record<string, unknown>) {
  c.set("usageContext", { ...(c.get("usageContext") ?? {}), ...data })
}
