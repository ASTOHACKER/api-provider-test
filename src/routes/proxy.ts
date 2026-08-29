import { Hono } from "hono"
import { stream } from "hono/streaming"
import type { DB } from "../queries.js"
import { queries } from "../queries.js"
import type { Provider, ProviderType, AuthContext } from "../types.js"
import { createAuthMiddleware } from "../middleware/auth.js"
import {
  checkQuota,
  recordUsage,
  parseOpenAIUsage,
  parseAnthropicUsage,
  extractStreamUsage,
  type UsageResult,
} from "../lib/usage.js"

type ProxyEnv = { Variables: { auth: AuthContext; latencyMs: number } }

function buildHeaders(provider: Provider, passthrough: Headers): Headers {
  const headers = new Headers()
  headers.set("content-type", "application/json")
  if (provider.type === "anthropic") {
    headers.set("x-api-key", provider.api_key)
    headers.set("anthropic-version", passthrough.get("anthropic-version") || "2023-06-01")
  } else {
    headers.set("authorization", `Bearer ${provider.api_key}`)
  }
  return headers
}

function upstreamUrl(provider: Provider, path: string): string {
  const base = provider.base_url.replace(/\/+$/, "")
  return `${base}${path}`
}

export function createProxyRoutes(getDb: () => DB) {
  const app = new Hono<ProxyEnv>()

  app.use("*", createAuthMiddleware(getDb))

  app.use("*", async (c, next) => {
    const auth = c.get("auth")
    const quota = await checkQuota(getDb(), auth.customer.id)
    if (!quota.ok) {
      return c.json({ error: { message: quota.reason, type: "quota_exceeded" } }, 429)
    }
    await next()
  })

  app.all("/chat/completions", (c) => forward(c, getDb(), "openai", "/chat/completions"))
  app.all("/completions", (c) => forward(c, getDb(), "openai", "/completions"))
  app.all("/embeddings", (c) => forward(c, getDb(), "openai", "/embeddings"))
  app.all("/responses", (c) => forward(c, getDb(), "openai", "/responses"))
  app.all("/messages", (c) => forward(c, getDb(), "anthropic", "/messages"))

  app.get("/models", async (c) => {
    const providers = await queries.listProviders(getDb())
    const models = providers
      .filter((p) => p.enabled)
      .flatMap((p) => JSON.parse(p.models || "[]").map((m: string) => ({ id: m, provider: p.name })))
    return c.json({ object: "list", data: models })
  })

  return app
}

async function forward(
  c: import("hono").Context,
  db: DB,
  expectedType: ProviderType,
  suffix: string
) {
  const auth = c.get("auth") as AuthContext
  const body = await c.req.text()
  let model = ""

  try {
    const parsed = JSON.parse(body)
    model = parsed.model || ""
  } catch {
    // non-JSON body (e.g. GET) — leave model empty
  }

  if (!model) {
    return c.json({ error: { message: "missing 'model' in request body", type: "invalid_request" } }, 400)
  }

  const provider =
    (await queries.getProviderForModel(db, model)) ||
    (await queries.listProviders(db)).find((p) => p.type === expectedType && p.enabled)

  if (!provider || !provider.enabled) {
    return c.json({ error: { message: `no provider available for model: ${model}`, type: "no_provider" } }, 404)
  }
  if (provider.type !== expectedType) {
    return c.json(
      {
        error: {
          message: `model '${model}' is served by provider type '${provider.type}', not '${expectedType}'`,
          type: "route_mismatch",
        },
      },
      400
    )
  }
  if (!provider.api_key) {
    return c.json(
      { error: { message: `provider '${provider.name}' has no API key configured`, type: "provider_misconfigured" } },
      500
    )
  }

  const isStream = (() => {
    try {
      return JSON.parse(body).stream === true
    } catch {
      return false
    }
  })()

  const upstream = upstreamUrl(provider, suffix)
  const headers = buildHeaders(provider, c.req.raw.headers)

  const start = Date.now()
  let upstreamRes: Response
  try {
    upstreamRes = await fetch(upstream, {
      method: c.req.method,
      headers,
      body: c.req.method === "GET" ? undefined : body,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await recordUsage(
      db,
      {
        customer_id: auth.customer.id,
        api_key_id: auth.apiKey.id,
        provider_id: provider.id,
        model,
        status: 502,
        latency_ms: Date.now() - start,
        error: msg,
      },
      { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    )
    return c.json({ error: { message: `upstream request failed: ${msg}`, type: "upstream_error" } }, 502)
  }

  if (!upstreamRes.ok || isStream) {
    return handleStreamOrError(c, db, upstreamRes, provider, auth, model, start, isStream)
  }

  const respBody = await upstreamRes.text()
  const usage: UsageResult =
    provider.type === "anthropic" ? parseAnthropicUsage(safeJson(respBody)) : parseOpenAIUsage(safeJson(respBody))

  await recordUsage(
    db,
    {
      customer_id: auth.customer.id,
      api_key_id: auth.apiKey.id,
      provider_id: provider.id,
      model,
      status: upstreamRes.status,
      latency_ms: Date.now() - start,
      error: null,
    },
    usage
  )

  return new Response(respBody, {
    status: upstreamRes.status,
    headers: responseHeaders(upstreamRes.headers),
  })
}

async function handleStreamOrError(
  c: import("hono").Context,
  db: DB,
  upstreamRes: Response,
  provider: Provider,
  auth: AuthContext,
  model: string,
  start: number,
  isStream: boolean
) {
  if (!upstreamRes.ok) {
    const errBody = await upstreamRes.text()
    await recordUsage(
      db,
      {
        customer_id: auth.customer.id,
        api_key_id: auth.apiKey.id,
        provider_id: provider.id,
        model,
        status: upstreamRes.status,
        latency_ms: Date.now() - start,
        error: errBody.slice(0, 500),
      },
      { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    )
    return new Response(errBody, { status: upstreamRes.status, headers: responseHeaders(upstreamRes.headers) })
  }

  if (!upstreamRes.body) {
    return new Response(null, { status: upstreamRes.status, headers: upstreamRes.headers })
  }

  const reader = upstreamRes.body.getReader()
  const collected: string[] = []

  c.header("content-type", upstreamRes.headers.get("content-type") || "text/event-stream")
  c.header("cache-control", "no-cache")
  c.header("connection", "keep-alive")

  return stream(c, async (writable) => {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          collected.push(new TextDecoder().decode(value))
          await writable.write(value)
        }
      }
    } finally {
      reader.releaseLock()
      const usage = extractStreamUsage(collected, provider.type)
      await recordUsage(
        db,
        {
          customer_id: auth.customer.id,
          api_key_id: auth.apiKey.id,
          provider_id: provider.id,
          model,
          status: 200,
          latency_ms: Date.now() - start,
          error: null,
        },
        usage
      )
    }
  })
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

function responseHeaders(headers: Headers): Headers {
  const copied = new Headers(headers)
  copied.delete("content-encoding")
  copied.delete("content-length")
  return copied
}
