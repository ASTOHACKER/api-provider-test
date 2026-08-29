import { Hono } from "hono"

export function createDocsRoutes() {
  const app = new Hono()
  app.get("/", (c) => c.html(`<!doctype html><meta charset="utf-8"><title>AI Gateway API</title>
<style>body{font:16px system-ui;max-width:860px;margin:40px auto;padding:0 20px;line-height:1.6}code,pre{background:#f3f4f6;padding:3px 6px;border-radius:4px}pre{padding:14px;overflow:auto}</style>
<h1>AI Gateway API</h1><p>OpenAI-compatible gateway with provider routing, quotas and streaming.</p>
<h2>Quick start</h2><pre>curl $BASE_URL/v1/chat/completions \\
  -H "Authorization: Bearer gw_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hello"}]}'</pre>
<h2>Endpoints</h2><ul><li><code>GET /v1/models</code></li><li><code>POST /v1/chat/completions</code></li><li><code>POST /v1/responses</code></li><li><code>POST /v1/embeddings</code></li><li><code>POST /v1/messages</code></li></ul>
<h2>Errors</h2><p>Authentication errors return 401, quota/rate limits return 429, unavailable providers return 502, and unsupported models return 404.</p>
<h2>Security</h2><p>Provider keys remain server-side. BYOK credentials must be encrypted at rest and are never returned by the API.</p>`))
  return app
}
