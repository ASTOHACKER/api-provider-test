import { Hono } from "hono"
import type { DB } from "../queries.js"
import { queries } from "../queries.js"

export function createDashboardRoutes(getDb: () => DB, adminKey: string) {
  const app = new Hono()

  app.get("/", (c) => c.html(renderPage(adminKey)))

  app.get("/data", async (c) => {
    const provided = c.req.query("key")
    if (provided !== adminKey) return c.json({ error: "unauthorized" }, 401)
    const db = getDb()

    const totals = await queries.dashboardTotals(db)
    const byCustomer = await queries.statsByCustomer(db)
    const byModel = await queries.statsByModel(db)
    return c.json({ totals, by_customer: byCustomer, by_model: byModel })
  })

  return app
}

function renderPage(adminKey: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>API Gateway Dashboard</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; background: #0f1117; color: #e6e6e6; }
  .wrap { max-width: 960px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 1.4rem; }
  .cards { display: grid; grid-template-columns: repeat(3,1fr); gap: 12px; margin: 20px 0; }
  .card { background: #1a1d27; border: 1px solid #2a2d3a; border-radius: 10px; padding: 16px; }
  .card .label { color: #8b8fa3; font-size: .8rem; text-transform: uppercase; }
  .card .value { font-size: 1.6rem; font-weight: 700; margin-top: 4px; }
  .card .value.err { color: #ff6b6b; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #2a2d3a; font-size: .9rem; }
  th { color: #8b8fa3; font-weight: 600; }
  .section-title { margin-top: 24px; font-size: 1.1rem; }
  .muted { color: #8b8fa3; }
</style>
</head>
<body>
<div class="wrap">
  <h1>API Gateway <span class="muted">— 24h overview</span></h1>
  <div class="cards">
    <div class="card"><div class="label">Requests</div><div class="value" id="reqs">—</div></div>
    <div class="card"><div class="label">Tokens</div><div class="value" id="tokens">—</div></div>
    <div class="card"><div class="label">Errors</div><div class="value err" id="errors">—</div></div>
  </div>
  <div class="section-title">By Customer</div>
  <table><thead><tr><th>Customer</th><th>Requests</th><th>Tokens</th></tr></thead><tbody id="t-cust"></tbody></table>
  <div class="section-title">By Model</div>
  <table><thead><tr><th>Model</th><th>Requests</th><th>Tokens</th></tr></thead><tbody id="t-model"></tbody></table>
  <p class="muted">Auto-refresh every 15s.</p>
</div>
<script>
  const KEY = ${JSON.stringify(adminKey)};
  async function load() {
    try {
      const r = await fetch("/dashboard/data?key=" + encodeURIComponent(KEY));
      if (!r.ok) { document.getElementById("reqs").textContent = "auth needed"; return; }
      const d = await r.json();
      document.getElementById("reqs").textContent = d.totals.total_requests ?? 0;
      document.getElementById("tokens").textContent = (d.totals.total_tokens ?? 0).toLocaleString();
      document.getElementById("errors").textContent = d.totals.errors ?? 0;
      document.getElementById("t-cust").innerHTML = (d.by_customer||[]).map(r =>
        "<tr><td>"+r.name+"</td><td>"+r.requests+"</td><td>"+(r.tokens||0).toLocaleString()+"</td></tr>").join("") || '<tr><td colspan="3" class="muted">no data</td></tr>';
      document.getElementById("t-model").innerHTML = (d.by_model||[]).map(r =>
        "<tr><td>"+r.model+"</td><td>"+r.requests+"</td><td>"+(r.tokens||0).toLocaleString()+"</td></tr>").join("") || '<tr><td colspan="3" class="muted">no data</td></tr>';
    } catch(e) { document.getElementById("reqs").textContent = "error"; }
  }
  load(); setInterval(load, 15000);
</script>
</body>
</html>`
}
