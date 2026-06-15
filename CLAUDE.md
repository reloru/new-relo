# crosbynews.com — Cloudflare Worker

## Working with this repo
- This is a **live, complete, self-maintaining** production site. Make targeted
  changes only — don't rebuild it.
- After deploying, verify against the live site with `curl` (deploys land in
  ~10–40s) — check the headers/routes you touched.
- **Keep this file current:** when you change a route, a behavior, or an
  invariant that lives outside the Worker, update CLAUDE.md in the same PR.

## Repo skills (.claude/)
Committed Claude Code skills live under `.claude/skills/<name>/SKILL.md` — the
directory name becomes the `/command`. Current skills:
- `/verify-site` — curl health-check of the live deploy (routes → 200, security
  headers, one-hop canonicalization, markdown negotiation, unknown-path 404).
  Encodes the "verify with curl after deploy" rule above. Read-only.
- `/deploy` — syntax-check `src/index.js`, surface branch/working-tree state,
  `npx wrangler deploy`, then verify the live site. Encodes the Deploy rules
  below (never `wrangler login`; the binding-permission gotcha; manual deploy
  ships the working tree, not git).
- `/kv` — inspect/edit the production `WEATHER` KV namespace, always with
  `--remote` (the KV gotcha below). Knows `weather` (cron-owned) vs `news`
  (routine-owned); read commands are pre-authorized, put/delete are not.

## Deploy
- Deploy with `npx wrangler deploy`. Never run `wrangler login` — auth comes
  from CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, already set in the cloud
  environment.
- This repo is the source of truth. Cloud sessions deploy from committed code,
  so commit before expecting a deploy to reflect a change.
- If a deploy fails with an auth/permission error right after you add a new
  binding (D1, Queues, Vectorize, etc.), it's almost always the API token
  missing that permission — widen it in the Cloudflare dashboard, not a code bug.

## CI / GitHub Actions
- `.github/workflows/deploy.yml` runs two jobs on every push/PR to `main`:
  - **Syntax check** (`node --check src/index.js`) — runs on all PRs and pushes.
  - **Deploy** (`cloudflare/wrangler-action@v3`) — runs on push to `main` only, after check passes.
- `wranglerVersion: "4"` is required in the wrangler-action config. Without it, the action
  installs wrangler 3.x, which can't parse `wrangler.jsonc` and fails with "Missing entry-point".
- `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: "true"` is set on the deploy step (GitHub is migrating
  Actions to Node 24; this opts in early to suppress deprecation failures).
- Repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set at the repository
  level — same token as used by the manual deploy path.
- PRs are squash-merged. After a squash-merge, the old branch diverges from main (its history
  is rewritten into one commit). Always branch fresh off `origin/main` before starting new work;
  never reuse a branch that was already merged.
- The repo is **public**. Branch protection on `main` is **enabled** (classic protection):
  it requires the `Syntax check` status check and blocks force-pushes + branch deletion, with
  admin bypass left on (`enforce_admins: false`) and no required PR reviews — so solo squash-
  merges still work, but `main`'s history can't be force-pushed or the branch deleted. `strict`
  is off, so a PR needn't be up to date with `main` before merging.
- Secret scanning + push protection are **on** (free on public repos): a push containing a
  detectable secret is blocked before it lands.

## Domain
- Live on crosbynews.com (apex + www) and the *.workers.dev URL.
- Attachment (verified via API, added out-of-band — dashboard/API, not wrangler):
  apex `crosbynews.com` is a **Custom Domain**; `www.crosbynews.com/*` is a
  **Workers Route**. Both bind to the `crosbynews` worker.
- These are intentionally NOT in wrangler.jsonc. `wrangler deploy` with a
  route-silent config leaves existing routes/custom-domains untouched (verified:
  repeated deploys never disturbed routing). Keeping custom-domain management out
  of the config also avoids deploy-time domain-reconciliation surprises. Inspect
  with `/zones/{id}/workers/routes` and `/accounts/{id}/workers/domains`.
- Hard canonicalization is on via a single Cloudflare Redirect rule (Single
  Redirects), so every variant reaches `https://crosbynews.com/` in ONE hop:
  - expression: `(not ssl) or (http.host eq "www.crosbynews.com")`
  - target: `concat("https://crosbynews.com", http.request.uri.path)`, 301,
    preserve query string.
  - `https://crosbynews.com` matches neither clause → serves 200, no loop.
  "Always Use HTTPS" is intentionally OFF: the rule already upgrades http, and
  having both caused a 2-hop chain for http://www (→https, then →apex). This
  lives in the zone/dashboard, not wrangler.jsonc or fetch(). It matches
  `<link rel="canonical">` and the sitemap `<loc>`.

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
  api-catalog, and OpenAPI service-desc. All six content pages (`/`, `/hourly`,
  `/radar`, `/alerts`, `/news`, `/about`) also emit an HTTP `Link: rel="canonical"`
  header — added centrally in the `fetch` wrapper via `PAGE_PATHS` — so the
  `?format=md` variants and the http→https pair consolidate onto one URL.
- `/hourly` — full multi-day hourly forecast table, grouped by day. Reuses the
  cached NWS hourly data. `fetchWeather()` keeps 48 hourly periods; the homepage
  strip, the homepage markdown, and `/api/weather` each `.slice(0, 12)` so only
  `/hourly` shows the full 48. Same markdown negotiation.
- `/radar` — embeds the NWS KHGX (Houston-Galveston) radar loop, which covers
  Crosby. The GIF is proxied via `/radar-image` (locked to that one upstream,
  short edge TTL) so it's crawlable and edge-cached. Same markdown negotiation.
- `/about` — static "what this site is" page (source, cadence, API/MCP, NWS
  attribution, disclaimer). Same markdown negotiation. Content lives once in the
  `ABOUT` object; `aboutHtml()`/`aboutMarkdown()` render it so the two can't
  drift. Shared chrome (`BASE_CSS`, `topbar()` nav) is reused by all pages.
- `/alerts` — active NWS alerts for Crosby plus an evergreen severe-weather
  guide (`ALERT_GUIDE`) so the page stays substantial when nothing is active
  (avoids thin content). Markdown-negotiated.
- `/news` — local news for Crosby + nearby towns. The Worker is a pure renderer:
  it serves the WEATHER KV `news` key (read-only via `loadNews()`). That key is
  written out-of-band by `scripts/fetch-news.mjs` (see "News pipeline"), NOT by
  the Worker — Google News blocks Cloudflare Worker IPs. Markdown-negotiated.
- `/robots.txt` — RFC 9309 rules, explicit AI-crawler allows, and a `Sitemap:`
  reference. Open by default (public NWS data). (No `Content-Signal` line — it
  confused some crawlers when present, so it's intentionally omitted.)
- `/sitemap.xml` — lists `/`, `/hourly`, `/radar`, `/alerts`, `/news`, `/about`.
- `/llms.txt` — plain-language site summary for LLMs (llmstxt.org).
- `/api/weather` — public JSON (location, current, hourly, forecast, alerts),
  CORS `*`. `/api/health` — status + cache freshness.
- `/.well-known/api-catalog` (`application/linkset+json`, RFC 9727) and
  `/openapi.json` (OpenAPI 3.1) describe the API. All read from the same KV
  cache via `loadWeather()`.
- `/mcp` — stateless MCP server (Streamable HTTP, JSON-RPC) with tools
  `get_current_conditions`, `get_forecast`, `get_alerts`. Discovery card at
  `/.well-known/mcp/server-card.json`. A GET gets a human explainer page
  (`mcpInfoHtml()`, noindex) — except a GET asking for the SSE stream
  (`Accept: text/event-stream`), which 405s since we don't offer that stream
  (Streamable HTTP spec). POST does the protocol.
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

## News pipeline (runs OUTSIDE the Worker)
- Google News RSS is the only source with real Crosby coverage, but it hard-
  blocks Cloudflare Worker datacenter IPs (503). Bing News RSS + outlet feeds
  ARE reachable from the Worker but are too sparse. So news is fetched out-of-
  band: `scripts/fetch-news.mjs` runs on a **Claude routine** (whose environment
  is NOT IP-blocked), queries Google News for Crosby + nearby towns, filters,
  and writes the result straight to the WEATHER KV `news` key via the Cloudflare
  KV API. The Worker only renders that key (`loadNews()` is read-only).
- The script holds all the filtering logic (relevance gate `areaTier`: core
  Crosby incl. Barrett Station vs. nearby towns w/ TX context; `REJECT` for
  famous "Crosby" people / other-state Crosbys; real-estate + obituary drops;
  `CRIME_WORDS`/`CRIME_STEMS` for down-ranking (word-boundary matched, so e.g.
  "dead" doesn't tag "deadline"); 45-day freshness; aggressive fuzzy de-dup
  (Jaccard > 0.4). Tone knobs: the incident cap (`incidents.slice(0, 3)`) and the
  `CRIME_WORDS`/`CRIME_STEMS` lists.
- Run manually: `CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node
  scripts/fetch-news.mjs`. The routine just needs Bash (to run node) — NOT git
  write. If the routine stops, items age out at 45 days and `/news` shows an
  honest "no recent news" (never errors). If a run hits a total upstream failure
  (every Google query empty), it aborts WITHOUT writing, so a transient block
  can't wipe the last good snapshot.

## DNS-AID (lives in Cloudflare DNS, not the Worker)
- Published as SVCB records `_index._agents.crosbynews.com` (org-level entry
  point) and `_mcp._agents.crosbynews.com` (MCP server), each
  `1 crosbynews.com. alpn="h2,h3" port=443`. Zone DNSSEC is active, so they
  resolve authenticated (AD=true).
- Reproduce with `node scripts/dns-aid.mjs`. The token needs **`Zone:DNS:Edit`**
  to write the records AND **`Zone:Zone:Read`** to look up the zone id by name —
  DNS:Edit alone makes the `/zones?name=` lookup return an empty list (success,
  not an error), so the script fails with "could not resolve zone id". Either
  widen the token, or set `CLOUDFLARE_ZONE_ID=09de1864babbf541c26590b0fe42f25f`
  and a DNS:Edit-only token suffices. Note the account-owned token can't call
  `/user/tokens/verify` (returns "Invalid API Token") even when it's valid for
  zone/DNS calls — sanity-check it with a resource call, not `verify`.
- Intentionally skipped: OAuth/OIDC, oauth-protected-resource, and auth.md —
  the site has no protected APIs to authenticate against.

## KV gotcha
- `wrangler kv key get/put/list` default to *local* (miniflare) state. To read
  or write the real production namespace, pass `--remote`. (A get without it can
  say "Value not found" even when the deployed Worker is reading the key fine.)
