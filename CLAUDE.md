# crosbynews.com — Cloudflare Worker

## Deploy
- Deploy with `npx wrangler deploy`. Never run `wrangler login` — auth comes
  from CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, already set in the cloud
  environment.
- This repo is the source of truth. Cloud sessions deploy from committed code,
  so commit before expecting a deploy to reflect a change.

## Token / permissions
- The API token is deliberately scoped to a Worker deploy, not the whole account.
- If a deploy fails with an auth/permission error after adding a binding
  (D1, Queues, Vectorize, etc.), the token is missing that permission — widen it
  in the Cloudflare dashboard. Don't assume it's a code bug.

## Domain
- The Worker serves on its *.workers.dev URL today.
- crosbynews.com attaches via a Workers route: add the route to the wrangler
  config and redeploy. The token already carries Workers Routes edit.

## Conventions
- Plain Workers, ES modules (`export default { fetch, scheduled }`). No
  framework and no runtime dependencies — standard `fetch` + Workers KV only.
- Layout: `src/index.js` is the single entry point; `wrangler.jsonc` is config.
- Content: live data from the U.S. National Weather Service (api.weather.gov)
  for Crosby, TX (lat 29.9119, lon -95.0608). NWS requires a `User-Agent` on
  every request — we send "crosbynews.com".
- Caching: the cron (`*/15 * * * *`) writes the forecast + active alerts to the
  WEATHER KV namespace under key "weather" as JSON. `fetch()` serves that cache
  and falls back to a live fetch + warm on a cold cache.
- Styling: an inline `<style>` block in the rendered HTML — no build step,
  no static assets.

## Routes (agent-readiness)
- `/` — the weather page. Content-negotiated: `Accept: text/markdown` (or
  `?format=md`) returns a markdown rendering; browsers get HTML. `Vary: Accept`.
  The homepage `Link` header advertises the markdown alternate, sitemap,
  api-catalog, and OpenAPI service-desc.
- `/robots.txt` — RFC 9309 rules, explicit AI-crawler allows, `Content-Signal`
  preferences, and a `Sitemap:` reference. Open by default (public NWS data).
- `/sitemap.xml` — single canonical URL.
- `/api/weather` — public JSON (location, current, hourly, forecast, alerts),
  CORS `*`. `/api/health` — status + cache freshness.
- `/.well-known/api-catalog` (`application/linkset+json`, RFC 9727) and
  `/openapi.json` (OpenAPI 3.1) describe the API. All read from the same KV
  cache via `loadWeather()`.
- `/mcp` — stateless MCP server (Streamable HTTP, JSON-RPC) with tools
  `get_current_conditions`, `get_forecast`, `get_alerts`. Discovery card at
  `/.well-known/mcp/server-card.json`.
- `/icons/...` — proxies NWS weather icons from `api.weather.gov/icons/`
  through our origin (locked to that prefix, not an open proxy). NWS's
  robots.txt disallows all crawling, so hotlinked icons are uncrawlable;
  proxying makes them indexable and edge-cacheable. The HTML rewrites icon
  URLs to this path via `iconUrl()`.
- `/.well-known/agent-skills/index.json` (agentskills.io v0.2.0) lists the real
  `crosby-weather` SKILL.md (served alongside it). The index `digest` is a
  runtime SHA-256 of the file, so the two can't drift. The homepage also
  registers WebMCP tools (`get_crosby_forecast`, `get_crosby_alerts`) via
  `navigator.modelContext`, backed by `/api/weather`.
- Any other path 404s. Canonical origin is the `SITE` constant in `src/index.js`.

## DNS-AID (lives in Cloudflare DNS, not the Worker)
- Published as SVCB records `_index._agents.crosbynews.com` (org-level entry
  point) and `_mcp._agents.crosbynews.com` (MCP server), each
  `1 crosbynews.com. alpn="h2,h3" port=443`. Zone DNSSEC is active, so they
  resolve authenticated (AD=true).
- Reproduce with `node scripts/dns-aid.mjs` using a token that has
  `Zone:DNS:Edit` (the Worker deploy token does not need this).
- Intentionally skipped: OAuth/OIDC, oauth-protected-resource, and auth.md —
  the site has no protected APIs to authenticate against.

## KV gotcha
- `wrangler kv key get/put/list` default to *local* (miniflare) state. To read
  or write the real production namespace, pass `--remote`. (A get without it can
  say "Value not found" even when the deployed Worker is reading the key fine.)
