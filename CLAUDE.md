# crosbynews.com — Cloudflare Worker

## Working with this repo
- This is a **live, complete, self-maintaining** production site. Make targeted
  changes only — don't rebuild it.
- After deploying, verify against the live site with `curl` (deploys land in
  ~10–40s) — check the headers/routes you touched. **Sample more than once:** a
  new Worker version reaches Cloudflare's edges over a minute or two, so a single
  curl can return the OLD page from a colo that has not rolled over yet
  (`CLAUDE_NOTES.md` has the full propagation gotcha + sampling script).
- **Keep this file current:** when you change a route, a behavior, or an
  invariant that lives outside the Worker, update CLAUDE.md in the same PR.
- **Where state lives, by kind:** `docs/pages/<page>.md` (one file per content
  page — handler, content, data source, canonical URL, sitemap presence, meta,
  CSP) and `docs/endpoints/` (same, for non-page routes) — **a PR that changes
  any of that MUST update the matching file in the same PR.** `docs/ops/<topic>.md`
  is the same rule for cross-cutting operational config that isn't a page or
  endpoint (CI, GitHub settings, domain/DNS, MCP registry, email auth, news
  pipeline). All three record **current expected state**, not history —
  overwrite them, don't append. Dated write-ups go in `docs/audit/` or
  `docs/investigations/` instead, and are never edited in place.
  `CLAUDE_NOTES.md` (repo root) is a current-state catch-all for anything that
  doesn't fit those categories. `docs/README.md` explains the full split.

## Agent operating notes (process, not site mechanics)
Not about the Worker's behavior — about working this repo session-to-session
as a coding agent. A human reading for site behavior can skip this section.
Narrower tooling trivia (exact `gh` install steps, curl/JSON gotchas) lives in
`CLAUDE_NOTES.md`, not here — this keeps only the rules that apply regardless
of tooling specifics.

- **`TaskList`/`TaskCreate` do NOT persist across sessions.** **The persistent
  backlog is GitHub Issues** — queryable/writable via `mcp__github__*`
  (`list_issues`, `issue_write`, …). Prefer filing backlog items as Issues
  (labeled `backlog`) over encoding them into a trigger prompt or CLAUDE.md.
- **Verify a new external upstream before writing any feature code against
  it.** A sandbox/container `curl` succeeding is not sufficient proof — Google
  News answers fine from a container but 503s the deployed Worker's IPs (why
  the news pipeline runs out-of-band; see `docs/ops/news-pipeline.md`). Pattern
  used for NHC/EPA/Open-Meteo: add a temporary `/debug-<name>-canary` route,
  `npx wrangler deploy` it for real (not `wrangler dev` — must be the actual
  edge runtime + egress IPs), curl the live URL for a real 200 + body, then
  `git restore` and redeploy clean before building on it.
- **A check that reuses the code under test cannot falsify it.** A 2026-08-05
  audit wrongly concluded HHD had stopped publishing pollen counts because it
  probed for "missing" days by GENERATING candidate URLs from the same date
  pattern the parser uses — inheriting the exact bug it existed to find. When
  checking whether a parser is missing data, **extract what the upstream
  actually serves with a deliberately looser pattern and diff against our
  parse** — never re-derive the expected input from our own logic.
- **`AskUserQuestion` can fail silently in automated/routine-driven sessions**
  (no human available to answer synchronously). When genuinely blocked on a
  decision only the user can make, don't retry the tool — lay out the
  tradeoffs in your response text and end the turn.
- **`.claude/skills/*/SKILL.md` files drift independently of CLAUDE.md** —
  nothing forces them to be touched when a feature ships (`/kv`'s SKILL.md
  once went two feature-cycles describing three keys after a fourth shipped).
  When a change touches something a skill describes, grep the skills
  directory too, not just this file.

## Claude Code PR workflow (merge autonomy)
Owner policy (set 2026-07-14): a Claude Code session owns its PR end-to-end
and does not wait for human approval at any step.

- **One independent change per PR**, verified live before the next one starts,
  rather than batching several features into one.
- **Implement, then verify for real** — `node --check` and the dry-run build
  must pass, and the change itself gets exercised (live `curl` after a deploy,
  `wrangler dev`, or a committed test script), not just syntax-checked.
- **Document in the same PR** — update CLAUDE.md, the relevant `docs/`
  state file, and any `.claude/skills/` file the change makes stale.
- **Squash-merge to `main` yourself** once correctness and doc-currency are
  verified; no additional approval required. The merge gates are the required
  `Syntax check` **and `Build check (dry-run)`** jobs, and the branch must be up
  to date with `main` first (`strict` is on — see `docs/ops/ci-cd.md`).
- **Post-merge, verify the deploy** — confirm CI's deploy job landed, then run
  `/verify-site` (it already encodes the full live-site checklist: routes →
  200, one-hop canonicalization, security headers, markdown negotiation,
  unknown-path 404 — don't re-derive those checks ad hoc). Report status
  plainly: Worker live, routes answering, KV readable.
- **Branch cleanup now happens on its own.** "Automatically delete head
  branches" is **ON**, so a squash-merge deletes its own head branch. A
  session still **cannot** delete a branch or write repo settings itself —
  the cloud git proxy and GitHub API both 403 those paths — so don't retry
  those writes; the auto-delete setting is what does the work.
- **Merge method is squash by *convention*, not enforced.** All three methods
  remain enabled on the repo, so nothing stops a stray merge commit. Always
  choose squash when merging (see `docs/ops/ci-cd.md` for the branch-divergence
  gotcha this creates).

## Repo skills (.claude/)
Committed Claude Code skills live under `.claude/skills/<name>/SKILL.md` — the
directory name becomes the `/command`. Current skills:
- `/verify-site` — curl health-check of the live deploy: all 20 content pages in
  **both languages** return 200 and are substantive, plus security headers,
  one-hop canonicalization, markdown negotiation, unknown-path 404. Read-only.
  The both-languages sweep matters — roughly half the render branches never
  execute under `lang="en"`, and an English-only pass let `/es/hourly` sit 502
  in production for two deploys.
- `/deploy` — syntax-check every file under `src/`, surface branch/working-tree
  state, `npx wrangler deploy`, then verify the live site.
- `/kv` — inspect/edit the production `WEATHER` KV namespace, always with
  `--remote` (the KV gotcha below). Knows all eight content keys; read commands
  are pre-authorized, put/delete are not.

## Deploy
- Deploy with `npx wrangler deploy`. Never run `wrangler login`.
- **Use `CLOUDFLARE_ZONE_API_TOKEN` for anything scoped to this Worker/domain** —
  deploy, KV, and any future D1/R2/Queues bindings. Pair it with
  `CLOUDFLARE_ACCOUNT_ID`, **not a zone id**: wrangler has no
  `CLOUDFLARE_ZONE_ID` concept. Reach for the plain `CLOUDFLARE_API_TOKEN`
  (account-scoped, narrower) only for genuinely account-level work. Both are
  set in the cloud environment.
- This repo is the source of truth. Cloud sessions deploy from committed code,
  so commit before expecting a deploy to reflect a change.
- If a deploy fails with an auth/permission error right after you add a new
  binding (D1, Queues, Vectorize, etc.) even with `CLOUDFLARE_ZONE_API_TOKEN`,
  it's a genuinely missing permission on that token — widening it requires the
  Cloudflare dashboard, which a session can't do itself, so say so rather than
  retrying blind.

## CI / GitHub Actions
Full detail — job breakdown, wrangler-action pin reasoning, branch-protection
ruleset contents — lives in `docs/ops/ci-cd.md`. The facts an agent must not
violate:
- `.github/workflows/deploy.yml` has two required checks: **"Syntax check"**
  (covers every file under `src/` via `node --check`, plus the cross-module-
  reference and both-language renderer checks) and **"Build check (dry-run)"**
  (`npm ci` + `wrangler deploy --dry-run`). **Don't rename either job** —
  branch protection keys on the exact names.
- `strict_required_status_checks_policy` is on: a PR must be up to date with
  `main` before it can merge.
- `compatibility_date` can only safely be RAISED, never guessed — a raise is
  the one change worth a local `npx wrangler dev` boot check; a `wrangler`
  version bump only raises the ceiling, never violates it.
- The deploy job runs on push to `main` only, guarded by
  `concurrency: { group: deploy-production, cancel-in-progress: false }` so
  concurrent squash-merges deploy in order.
- After a squash-merge, never keep committing on the same branch without
  reconciling first — `git fetch origin main && git merge -X ours origin/main`
  before opening the next PR from a long-lived feature branch.
- A **second workflow**, `.github/workflows/claude.yml`, runs the `@claude`
  assistant (`anthropics/claude-code-action@v1`, auth via the
  `CLAUDE_CODE_OAUTH_TOKEN` repo secret — unrelated to the Cloudflare
  tokens). Runs on a GitHub-hosted runner, **not** through the Claude Code
  session's GitHub proxy — none of the GraphQL/repo-scoping/credential-
  substitution restrictions in `docs/ops/github-security.md` apply to it.
  Deliberately unconstrained on tools: bare `Bash`, no turn cap.
  **`allowed_bots` is unset and must stay that way** — a cloud session's
  comments already trigger it as `reloru` (the bot badge in the UI is
  `performed_via_github_app`, not the actor), unset is what prevents a
  self-trigger loop, and `"*"` would hand any bot on this public repo full
  shell access. It cannot push to `main` — the ruleset is the backstop,
  not the token scope.

## GitHub security settings
Full detail — on/off inventory, the three-way 403 taxonomy, why the toggles
can't be flipped from a session — lives in `docs/ops/github-security.md`. The
short version: **nothing in `package.json` ships to production** (the deployed
artifact is the esbuild bundle rooted at `src/index.js`; a Dependabot alert
here is not a live-site vulnerability), so the real threat model is
supply-chain compromise of the deploy token, not a runtime CVE. Dependabot
alerts/security-updates, CodeQL default setup, and secret scanning are on;
`vulnerability-alerts`/`automated-security-fixes`/private-vulnerability-reporting
toggles are dashboard-only for this session (egress-proxy + GitHub App
permission limits, not a token problem — don't retry with a different token).

## Domain
Full detail — subdomain/preview settings, HSTS layering — lives in
`docs/ops/domain.md`. The one invariant that matters day-to-day: hard
canonicalization runs via a single Cloudflare Redirect rule
(`(not ssl) or (http.host eq "www.crosbynews.com")` → `https://crosbynews.com`
+ path, 301, one hop). It lives in the zone/dashboard, not `wrangler.jsonc` or
`fetch()` — don't try to reproduce it in the Worker.

## Conventions
- Plain Workers, ES modules (`export default { fetch, scheduled }`). No
  framework and no runtime dependencies — standard `fetch` + Workers KV only.
- Layout: `src/index.js` is the entry point Wrangler resolves via `wrangler.jsonc`'s
  `main`. It is deliberately thin (~50 lines): the two Worker handlers plus the
  response wrapper. **The route table is `src/router.js`** and **the cron is
  `src/cron.js`**; everything else lives in `src/features/` (one vertical slice
  per data source: fetch + loader + renderers + API shape together),
  `src/pages/` (the static pages), `src/lib/` (format, derived math, http),
  `src/mcp/`, `src/api/`, plus `config.js`, `i18n.js`, `chrome.js`, `seo.js`,
  `discovery.js`, `push.js`. **`src/assets/`
  holds the inline client-side assets** (`icons.js`, `sw-script.js`,
  `base-css.js`, `client-scripts.js`) — template literals whose escape sequences
  belong to the *shipped* string, not to the source file. Move or edit their
  content, never their framing: reformatting silently ships broken client JS
  that `node --check` cannot see, because to the Worker it is all just a string.
  When touching them, verify the bytes, not the syntax — the CSP header
  publishes the SHA-256 of `HOME_SCRIPT`, `PUSH_CLIENT_SCRIPT` and
  `NEWS_ADMIN_SCRIPT`, and `/sw.js` is `SW_SCRIPT` verbatim, so a before/after
  digest comparison against the live site is a complete check.
- Security headers: the `fetch` wrapper stamps every response with HSTS,
  `X-Frame-Options: SAMEORIGIN`, CSP (homepage inline script allow-listed by
  hash — see `contentSecurityPolicy()`), `Cross-Origin-Opener-Policy`,
  `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, and a `Permissions-Policy`
  denying geolocation/camera/microphone and opting out of the Topics API.
- Content: live data from the U.S. National Weather Service (api.weather.gov)
  for Crosby, TX (lat 29.9119, lon -95.0608). NWS requires a `User-Agent` on
  every request — we send "crosbynews.com". Feature-specific data-source detail
  (UV, AQI, derived "feels like"/sun-times math, the pollen HTML-scrape
  fragility) lives in each feature's `docs/pages/<page>.md` — see `/weather.md`,
  `/air.md`, `/pollen.md` — not duplicated here.
- Caching: the cron (`*/15 * * * *`) writes the forecast + active alerts to the
  WEATHER KV namespace under key "weather" as JSON, and refreshes seven other
  keys on various cadences (see `## KV gotcha` below and `/kv`'s SKILL.md for
  the full list and throttle intervals). `fetch()` serves the cache and falls
  back to a live fetch + warm on a cold cache.
- Styling: an inline `<style>` block in the rendered HTML — no build step,
  no static assets.
- Chrome: `topbar(current, lang)` renders the site header, with a
  visually-hidden skip-to-content link (`.skip-link`) targeting
  `<main id="main">` on every page. ≤920px collapses nav into a CSS-only
  hamburger (native `<details>`, no JS); one markup serves both layouts via
  `display:none`. **Invariant:** desktop relies on
  `.nav-menu::details-content { content-visibility: visible }` to keep the
  links inline — Chromium hides closed-`<details>` content otherwise
  (`display:contents` does NOT override it), so removing that rule makes the
  desktop nav disappear except brand + Español. `footer({ page, lang, source,
  data })` renders a shared footer with source attribution and a links row;
  weather pages also show an alert-status + freshness line.
- SEO/structured data: every HTML page emits schema.org JSON-LD (`JSONLD_SITE`
  sitewide plus per-page nodes). Kept deliberately honest — no schema for the
  forecast (no truthful type exists) and no fake ratings/FAQ.
- Link previews: every HTML page emits Open Graph tags plus the shared
  `OG_COMMON`. No `og:image` — that would need a committed binary, which the
  "no static assets" rule forbids; cards still render title + description +
  site name.

## Pages & routes — where the per-page state lives

Per-page and per-endpoint state — content blocks and the data feeding each,
canonical URL, sitemap presence, meta and CSP expectations, locale handling —
lives in `docs/pages/` (one file per content page) and `docs/endpoints/` (one
file per non-page route). Start there rather than here; this file keeps only the
invariants that cut across pages.

- **`/es` is not a second page set.** `lang` is a parameter threaded through the
  render functions, and `routeRequest()` (`src/router.js`) strips the prefix before dispatch
  (`page = path.slice(3)`, with `/es` and `/es/` both normalizing to `/`), so one
  set of handlers serves both languages and they cannot drift. Non-page routes
  (API, MCP protocol, assets, `.well-known`) are English-only and never carry the
  prefix. The one exception is `/es/mcp`, a Spanish HUMAN explainer page —
  GET/HEAD only, a POST there 404s; the protocol lives only at `/mcp`.
  **A Spanish page must link to Spanish pages.** `scripts/check-renders.mjs`
  enforces it: any anchor on an `/es` page pointing at a path in `PAGE_PATHS`
  must use the `/es` form. The language toggle is exempt (identified by
  `hreflang="en-US"`), and deliberate exceptions live in that script's
  `ES_LINK_ALLOW`.
- **Live third-party text is never machine-translated.** Short NWS conditions,
  period names, wind and directions go through hand-written dictionaries
  (`ES_SHORT`, `ES_PERIOD`, `ES_WEEKDAY`, `ES_DIR`); the same pattern covers
  pollen categories, traffic types, NHC classifications, and Crosby ISD event
  titles, each with an English fallback. **Free-form NWS `detailedForecast`
  prose and ALL alert text stay in official English** (`ES_NWS_NOTE` says so on
  the page). NWS exposes no Spanish forecast/alert API and paused its
  experimental auto-translation in 2025; mistranslating a warning is unsafe.
- **Never render `hourly[0]` as "now".** NWS's `forecastHourly` first period is
  the product's generation hour and can lag the wall clock by 1h+ even with a
  fresh cache. `currentHourly(data)` picks the period covering `Date.now()` and
  feeds both heroes, both markdowns, `/api/weather` `current`, and the MCP
  tools. Freshness labels show `data.updated` — when WE refreshed — never a
  period start time.
- **Every content page is markdown-negotiated**: `Accept: text/markdown` or
  `?format=md`, with `Vary: Accept`. HTML and Markdown render from one content
  object per page so they can't drift.
- **The cron + KV pattern** backs every live-data page: the cron writes a KV key,
  `load*()` cold-warms on a missing or stale-shaped entry, and the fetcher throws
  rather than writing a partial snapshot — so an upstream outage keeps the last
  good data instead of wiping it. Key ownership and cadence are in `/kv`'s SKILL.md
  and in each page's file.
- **Canonical `Link` headers** are added centrally in the `fetch` wrapper from
  `PAGE_PATHS` (the 20 English content paths + their `/es` counterparts, 40
  total), so `?format=md` variants consolidate onto one URL. `/mcp` and
  `/es/mcp` are in that set, and in `sitemapXml()`. `PAGE_PATHS` matches on
  pathname, not method, so a `POST /mcp` JSON-RPC response also carries the
  canonical `Link` header — inert for MCP clients.
- **Adding a page** means touching, in the same PR: the handler, `PAGE_PATHS`,
  `sitemapXml()`, `llmsTxt()`, `topbar()`, the `/sitemap` page, and a new
  `docs/pages/<page>.md`. Adding a public endpoint: the handler,
  `openApiSpec()`, `apiCatalog()`, `llmsTxt()`, `README.md`, `/developers`,
  **the `/sitemap` page** (`src/pages/sitemap.js` — BOTH the HTML list and the
  markdown one), and `docs/endpoints/…`. **The `/sitemap` page is the one
  nothing points at** — none of these lists is generated or cross-checked by
  CI, so adding an endpoint and skipping one of them fails silently.

## News pipeline (runs OUTSIDE the Worker)
Full filter-logic detail (relevance gates, dedup, crime-family capping) and
the fire-on-demand curl command live in `docs/ops/news-pipeline.md`. Short
version: Google News RSS has the only real Crosby coverage but blocks Worker
datacenter IPs, so `scripts/fetch-news.mjs` runs out-of-band on a Claude
routine and writes straight to the WEATHER KV `news` key. The Worker only
reads it (`loadNews()` is read-only, no cron involvement).

## Analytics — there is none
**No analytics script ships, and the CSP allows no third-party script origin at
all.** Cloudflare Web Analytics was auto-injected at the zone edge (never in this
repo) until it was deleted 2026-08-19. Two traps, both in
`docs/ops/analytics.md`: the beacon is **invisible to a default-UA `curl`**
(Cloudflare only injects it for browser-looking requests, so check with a real
browser UA + HTML `Accept`), and `/privacy` + `/about` state "no third-party
analytics scripts" in BOTH languages — that claim and the CSP are one change, so
adding any vendor means editing `src/pages/privacy.js`, `src/pages/about.js` and
`contentSecurityPolicy()` together.

## DNS-AID, MCP Registry, Email auth
Three more `docs/ops/` topics, none of which live in the Worker — all lives
in Cloudflare DNS / external registries:
- **DNS-AID** (`docs/ops/dns-aid.md`) — SVCB records advertising the site to
  agent discovery; reproduce with `node scripts/dns-aid.mjs`.
- **MCP Registry** (`docs/ops/mcp-registry.md`) — the `/mcp` server is
  published as `com.crosbynews/weather`. **Five hand-maintained places name
  the tools and go stale silently when a tool is added** — `CROSBY_WEATHER_SKILL`,
  `llmsTxt()`, `DEVELOPERS`/`DEVELOPERS_ES`'s "MCP server" section, and
  `README.md`. (`mcpServerCard()` and the MCP `initialize` instructions
  derive/don't need updating — see the ops file.) Bump `server.json`'s
  `version` in the same PR as any tool-set change; publishing is a separate,
  manual step.
- **Email auth** (`docs/ops/email-auth.md`) — mail is iCloud-managed; DMARC
  (`_dmarc.crosbynews.com`, `p=reject`) is the one record this repo owns,
  reproducible with `node scripts/dmarc.mjs` (careful: re-running it as-is
  drops a second `rua` recipient Cloudflare added out-of-band — PATCH the
  live record instead of re-running the script unmodified).

## KV gotcha
- `wrangler kv key get/put/list` default to *local* (miniflare) state. To read
  or write the real production namespace, pass `--remote`. (A get without it can
  say "Value not found" even when the deployed Worker is reading the key fine.)
- **Local KV persists across runs** in `.wrangler/state/v3/kv/` (gitignored), so
  a "fresh" `wrangler dev` is NOT a cold cache — it replays whatever the last
  local run warmed, however many days ago. `rm -rf .wrangler/state` for a
  genuinely cold start.
- The WEATHER namespace holds eight content keys: `weather`, `calendar`, `water`,
  `fishing`, `tropics`, `pollen`, and `traffic` (all cron-owned) and `news`
  (routine-owned, Worker-read-only). Full key ownership/cadence table lives in
  `/kv`'s SKILL.md. The cron also writes `cron_status` every tick (what
  `/api/health` serves) and the Web Push state (`push_notified`, `push:*`) —
  don't hand-edit either; deleting `push_notified` would re-notify every
  active severe warning on the next tick.
- The **`news_blocklist`** key is worker-owned (written by the
  `/api/news/delete` + `/api/news/restore` admin endpoints): articles the
  owner hid via the `/news?admin=` nuke. Self-prunes entries older than 60
  days.
