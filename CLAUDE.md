# crosbynews.com — Cloudflare Worker

A live production site for Crosby, Texas: current conditions and forecasts,
and a dated **record** of the town's weather, floods, burn bans and school
dates, with the live pages as its newest entry. One Worker serves every page
in English and Mexican Spanish, a JSON API, an MCP server and RSS feeds.

This file holds the invariants an agent would otherwise break. Detail lives in
`docs/`: `docs/pages/<page>.md` (one per content page), `docs/endpoints/`
(non-page routes) and `docs/ops/<topic>.md` (cross-cutting config) record
**current expected state** — overwrite them in the same PR as the change they
describe. Dated write-ups go in `docs/audit/` or `docs/investigations/` and are
never edited. `CLAUDE_NOTES.md` holds tooling trivia. `docs/README.md` explains
the split.

## Checks, build, deploy

| | |
|---|---|
| Syntax | `find src -name '*.js' -print0 \| xargs -0 -n1 node --check` |
| Tests | every `node scripts/test-*.mjs` and `node scripts/check-*.mjs` listed in `.github/workflows/deploy.yml` (pure Node, no install, no network) |
| Build | `npx wrangler deploy --dry-run` |
| Deploy | CI deploys on push to `main` (D1 migrations first). By hand: `npx wrangler deploy` |
| Live check | `/verify-site` (reads the page list from the live `/sitemap.xml`) |

- **Two required checks: "Syntax check" and "Build check (dry-run)".** Never
  rename either job: branch protection keys on the names. `strict` is on, so a
  PR must be up to date with `main`. Details: `docs/ops/ci-cd.md`.
- Tokens: wrangler uses `CLOUDFLARE_API_TOKEN` with `CLOUDFLARE_ACCOUNT_ID`
  (verified for deploy, D1 and KV on 2026-11-12); `CLOUDFLARE_ZONE_API_TOKEN`
  is the wider zone-scoped token. Never `wrangler login`. A permission
  error after adding a new binding means the token lacks it: say so, a session
  cannot widen it.
- `compatibility_date` may only be raised, never guessed.
- `wrangler kv …` defaults to local state: always pass `--remote`. Local KV
  persists in `.wrangler/state`; `rm -rf` it for a cold start.
- A new Worker version reaches every edge over 1–2 minutes: **sample a live
  check several times** before calling it either way.

## Working method

- **One change per PR**, verified live before the next. A whole audit's
  non-critical findings go in one PR (two at most). Squash-merge yourself once
  both checks pass; the head branch auto-deletes. Squash is convention, not
  enforced. After a merge: `git fetch origin main && git checkout -B <branch> origin/main`.
  A session cannot delete branches or change repo settings (403): don't retry.
- **Document in the same PR**: the matching `docs/` file, this file if an
  invariant changed, and any `.claude/skills/*/SKILL.md` the change makes
  stale (skills drift silently; grep them).
- **Mutation-test every new check**: commit first, break the code, confirm the
  test fails, restore with `git checkout -- <file>`. Never restore from a /tmp
  copy, and never mutate uncommitted work (a restore from git discards it).
  Read `git show --stat HEAD` before pushing a multi-file commit.
- **A check that reuses the code under test cannot falsify it.** Assert literal
  values written out by hand; to test a parser, extract from the upstream with a
  looser pattern and diff.
- **Verify a new upstream from the deployed Worker before building on it**: a
  temporary `/debug-<name>-canary` route, `npx wrangler deploy`, curl it live,
  then restore from git and redeploy. A container curl proves nothing (Google
  News answers containers and refuses Worker IPs).
- **The persistent backlog is GitHub Issues** (label `backlog`); session task
  lists do not persist. `AskUserQuestion` can fail silently in automated
  sessions: lay out the decision in text instead of retrying.
- Live verification uses a bot User-Agent, e.g.
  `Mozilla/5.0 (compatible; CrosbyNewsVerifyBot/1.0; +https://crosbynews.com/)`,
  so it is not counted as browser traffic.

## Layout

- `src/index.js` — entry: `fetch` (dispatch, then security headers and the
  canonical `Link` header) and `scheduled`. Thin by design.
- `src/router.js` — the route table, `PAGE_HANDLERS`, `servePage()`, the JSON
  `API_ROUTES`. `src/registry.js` — **the one list of pages and endpoints**.
  `src/cron.js` — the 15-minute cron. `src/record.js` — D1 writers.
- `src/features/` — one slice per data source (fetch, loader, renderers, API
  shape); `src/pages/` — static pages; `src/lib/`, `src/mcp/`, `src/api/`.
- `src/assets/` — inline client assets as template literals whose escapes
  belong to the **shipped** string. Edit content, never framing; verify bytes,
  not syntax (the CSP publishes SHA-256s of `HOME_SCRIPT`, `PUSH_CLIENT_SCRIPT`
  and `NEWS_ADMIN_SCRIPT`; `/sw.js` is `SW_SCRIPT` verbatim).
- `public/` — binary icons and the `og:image`, written by
  `node scripts/build-icons.mjs` (never hand-edit; `test-icons` checks). Served
  by Workers static assets with `run_worker_first: true`. **No icon is an SVG.**
- `migrations/` — D1 schema, **additive only**, applied by the deploy job.
- No framework, no runtime dependencies: `fetch`, KV, D1, static assets.

## Pages and routes

- **Adding a page:** one `PAGES` entry in `src/registry.js`, a handler in
  `PAGE_HANDLERS` (the router throws at load if the two disagree), a renderer
  whose `<head>` calls `sharedHead(lang)`, and `docs/pages/<page>.md`. Nav,
  footer, `/sitemap.xml`, `/sitemap`, llms.txt and the canonical set follow
  from the registry. Gauge pages are `PAGES` entries with a `gauge:` field and
  share one handler.
- **Adding a public endpoint:** the route, an `ENDPOINTS` entry,
  `openApiSpec()`, `apiCatalog()`, `README.md`, `/developers`,
  `docs/endpoints/…`. `test-routes` cross-checks the specs.
- **`/es` is one handler set with a `lang` flag**, not a second site. A Spanish
  page links only Spanish pages (`test-routes` enforces; exceptions in
  `ES_LINK_ALLOW`). API, MCP, assets and `.well-known` are English-only;
  `/es/mcp` is a human explainer and 404s a POST.
- **Never machine-translate third-party text.** Short NWS phrases, period
  names, directions, pollen categories, NHC classes, school titles and NWS
  product names go through hand-written dictionaries with English fallback.
  NWS forecast prose, alert text and NOAA impact statements stay in English.
- **Never render `hourly[0]` as "now"**: `currentHourly(data)` picks the period
  covering the clock.
- Every content page is Markdown-negotiated (`Accept: text/markdown` or
  `?format=md`, `Vary: Accept`) from the same content as its HTML.
- Pages are GET/HEAD only (405 otherwise); unknown paths 404; a trailing slash
  301s to the slash-less path. Hard canonicalization (www → apex, http → https)
  is one Cloudflare Redirect rule in the zone, not the Worker
  (`docs/ops/domain.md`).

## Data: the cache and the record

- **KV holds now.** The cron writes one key per feed; `load*()` cold-warms a
  missing or stale-shaped entry; a fetcher throws rather than store a partial
  snapshot, so an outage keeps the last good data. Keys, owners and cadence:
  `/kv`'s SKILL.md. `news` is written out-of-band by a routine
  (`docs/ops/news-pipeline.md`: Google News blocks Worker IPs).
- **D1 `crosby-record` (`env.DB`) holds everything after.** `src/record.js`
  files each tick's observations with idempotent upserts, after the cache
  writes and isolated from them (`record.ok` on `/api/health`). Two rules:
  **record only what a source published or the site observed**, and **print
  the limits wherever the data is shown**. Tables, scopes, the archive
  backfill and hand-entered rows: `docs/ops/record.md`.
- Pages built on D1 (`/history`, the gauge pages `/water/<gauge>`) compute every
  count at request time and answer 502 on a D1 failure rather than render a
  page with its history missing. `/burn-ban`'s past-bans table is the
  exception: the page is live status first, so a D1 failure drops only the
  table.
- Crests are compared only with **today's** flood stages, and the page says so;
  old-datum crests are never compared; a crest NOAA dates without a time stays
  a calendar date.
- River flood warnings are filed live from NWS's own flood products: the
  hydrologic VTEC line names the gauge's NWS LID, which the alert API does
  not carry. Before 2026-11-12 they come from the IEM archive.
- Hand-entered rows (past burn bans) go through a committed script that
  dry-runs by default (`scripts/seed-burnban-periods.mjs`) and must have every
  date sourced; an open row would be closed by the cron.
- Tests run the real Worker against `scripts/fixtures/kv/` and a real SQLite
  D1 with the migrations applied (`scripts/lib/harness.mjs`, `d1-stub.mjs`).
  Query production with
  `npx wrangler d1 execute crosby-record --remote --command "SELECT …"`.

## Search and freshness

- **No relative times anywhere.** Stamps go through `dateStamp()`,
  `clockStamp()` or `timeTag()` and carry `<time datetime>`: an ISO instant
  for a stamp, a bare date for something that is a date.
- **`data-nosnippet` on what goes stale within hours** (temperatures,
  readings, active alerts, live status), never on a guide or the record.
  Descriptions are 50–160 characters with no live value. `test-freshness`
  enforces both.
- ETags are a digest of the bytes; `Last-Modified` and sitemap `<lastmod>`
  exist only where a real instant does (registry `feeds`, or a handler's
  `lastmod(env)`).
- **IndexNow fires on state changes only** (a category, a ban, an alert, a new
  crest or record row), plus once for any page never submitted. A new stateful
  page needs a signal in `src/indexnow.js`. Each endpoint's answer is in
  `attempts` on `/api/health`; failures retry hourly, bounded.
  `docs/ops/search.md` has the current status.

## Look and markup

- Inline `<style>` per page on `BASE_CSS`. **Three blues are not
  interchangeable:** `--accent` is decoration only (fails AA as text), `--link`
  is coloured text, `--btn` is a surface under white text and does not flip.
  White text on any fill must clear 4.5:1 at every gradient stop; badge bases
  use `#5b6470`. `test-contrast` measures the real rules.
- The flood-category colours are `WATER_STATE_CSS` in `src/features/water.js`,
  shared by `/water` and the gauge pages.
- Desktop nav depends on `.nav-menu::details-content { content-visibility: visible }`;
  removing it hides the desktop links.
- JSON-LD is kept honest: no forecast schema, no fake ratings or FAQ.

## Privacy and analytics

No browser analytics script, and the CSP allows no third-party script origin.
Aggregate counts only: page requests in D1 `hits` (`src/metrics.js`) and MCP
calls in KV (`src/mcp/metrics.js`); never an address, user agent, referring
URL, search term or query string. `/privacy` describes both in both languages,
and `test-site-metrics` holds the code to it: change the code and the text
together. Reports: `/api/site-usage` and `/api/mcp-usage` (`?key=<ADMIN_KEY>&format=txt`).
Audit the edge with a real browser UA and an HTML `Accept` header: Cloudflare
once injected a tracker a default curl never saw (`docs/ops/cloudflare-zone.md`).

## MCP server

- `/mcp` (Streamable HTTP, stateless), published as `com.crosbynews/weather`.
  **Bump `MCP_SERVER_INFO.version` and `server.json` together** on any
  tool-set change; publishing to the registry is a separate manual step.
- Tool names are written by hand in `llmsTxt()`, `CROSBY_WEATHER_SKILL`,
  `/developers` (both languages) and `README.md`; `test-mcp-server` fails if
  any is missing one. The record tools (`src/mcp/history-tools.js`) use the
  same loaders as their pages.
- Arguments are validated, never clamped (`validateToolArgs()`); no `Origin`
  check on `/mcp`. Not yet submitted to Anthropic's directory
  (`docs/ops/anthropic-directory.md`); once listed, material tool changes need
  a notice.

## Outside the Worker

- **GitHub workflows:** `deploy.yml` (checks, migrations, deploy);
  `claude.yml` (`@claude`; `allowed_bots` is exactly `"github-actions[bot]"`,
  never `"*"`, and its `if:` admits a bot only on an `issues`/`opened` event
  with the `pollen-watch` label — change the two together);
  `pollen-watch.yml` (files a `pollen-watch`-labelled issue, label set at
  creation, when HHD lists a measured count newer than `/api/pollen`). Detail:
  `docs/ops/ci-cd.md`, `docs/pages/pollen.md`.
- **Zone:** HSTS is deliberately not preloaded (owner decision). Never paste a
  TXT record from a Cloudflare DCV email; re-read the certificate pack first.
  `docs/ops/cloudflare-zone.md`, `docs/ops/domain.md`.
- **DNS:** DMARC (`node scripts/dmarc.mjs` drops a second `rua` Cloudflare
  added: PATCH instead), DNS-AID SVCB records (`node scripts/dns-aid.mjs`).
  `docs/ops/email-auth.md`, `docs/ops/dns-aid.md`.
- **GitHub security:** nothing in `package.json` ships; the threat model is the
  deploy token. Several repo toggles are dashboard-only for a session.
  `docs/ops/github-security.md`.

## KV keys an agent must not hand-edit

`cron_status` (what `/api/health` serves), `push_notified` (deleting it
re-notifies every active severe warning), `mcp_metrics` (its `rolledUpThrough`
mark prevents double counting), `indexnow_state` and `river_products` (safe to
delete, never to edit; see `/kv`). `news_blocklist` is written by the
`/news?admin=` endpoints.
