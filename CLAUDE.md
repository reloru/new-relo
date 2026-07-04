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
  `--remote` (the KV gotcha below). Knows `weather` + `calendar` (cron-owned) vs
  `news` (routine-owned); read commands are pre-authorized, put/delete are not.

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
  CI installs the latest 4.x; the repo's `wrangler` devDependency is pinned to match
  (`^4.107.0`) so local `wrangler dev` behaves like the CI/prod runtime.
- **Compatibility date gotcha:** `wrangler.jsonc`'s `compatibility_date` (currently
  `2026-07-01`) must be ≤ the bundled `workerd`'s ceiling. Production always runs the newest
  `workerd`, so any past date is fine there — but a *local* `wrangler dev` on an older pinned
  wrangler fails with "The Workers runtime failed to start" if the date is newer than its
  runtime. So bump the `wrangler` devDependency and the compat date together, and re-run
  `wrangler dev` to confirm the runtime still boots.
- `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: "true"` is set on the deploy step (GitHub is migrating
  Actions to Node 24; this opts in early to suppress deprecation failures).
- The workflow installs **Node 22** via `actions/setup-node@v4` for the job steps (the
  `node --check` syntax check runs on it). That's separate from `FORCE_..._NODE24`, which
  targets GitHub's JS-Actions runtime, not the Node the steps themselves use.
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
- HSTS is enabled at the Cloudflare **zone edge** (SSL/TLS → Edge Certificates →
  HSTS: `max-age=63072000; includeSubDomains`, no preload) so the header lands on
  edge-generated responses too — notably the `www` → apex 301, which the Worker
  never sees (the redirect rule runs before it) and so can't stamp HSTS on. The
  Worker ALSO sets the same HSTS on its own (apex) responses; Cloudflare de-dupes,
  leaving a single header. Zone/dashboard config, not wrangler.jsonc.

## Conventions
- Plain Workers, ES modules (`export default { fetch, scheduled }`). No
  framework and no runtime dependencies — standard `fetch` + Workers KV only.
- Layout: `src/index.js` is the single entry point; `wrangler.jsonc` is config.
- Security headers: the `fetch` wrapper stamps every response with HSTS,
  `X-Frame-Options: SAMEORIGIN`, CSP (homepage inline script allow-listed by
  hash — see `contentSecurityPolicy()`), `Cross-Origin-Opener-Policy`,
  `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, and a `Permissions-Policy`
  denying geolocation/camera/microphone and opting out of the Topics API.
- Content: live data from the U.S. National Weather Service (api.weather.gov)
  for Crosby, TX (lat 29.9119, lon -95.0608). NWS requires a `User-Agent` on
  every request — we send "crosbynews.com".
- Derived data: "feels like" temperature (`feelsLikeF`/`feelsLikeRawF` in
  `src/index.js`) is the one number on the site NOT taken verbatim from NWS —
  it's the heat index or wind chill, computed in-Worker from NWS's own
  published formulas applied to the temperature/humidity/wind NWS already
  returns. Heat index uses NWS's two-step algorithm: the simple Steadman form
  for any T > 50°F, upgraded to the Rothfusz regression when the result
  reaches 80 — the gate is on the RESULT, not the air temperature, so muggy
  sub-80° hours get real values instead of "–" gaps (a bug fixed after user
  screenshots). `feelsLikeRawF()` (the unconditional value) feeds `/api/weather`
  (as `feelsLike` on `current` and each `hourly` entry) and the `/hourly` table
  (a "Feels"/"Sensación" column on desktop, showing "–" when it doesn't apply;
  on phones ≤600px that column folds into Temp as "82° (88°)" with an on-page
  note, so five roomy full-word columns — Rain/"Lluvia" for precip — replace
  six cramped ones; the tables use `table-layout:fixed` with shared `.c-*`
  width classes so every day's columns align and long condition names wrap
  whole at spaces, no hyphenation);
  `feelsLikeF()` gates it to prominent single-value spots (hero, homepage
  markdown, MCP `get_current_conditions` text) so it only shows when >=3°F
  different from air temp — otherwise it's noise. Sunrise/sunset
  (`sunTimes`/`sunTimesForCtDate`) is the other derived value: computed
  astronomically in-Worker (standard sunrise equation, SunCalc formulation —
  the NWS forecast API doesn't provide sun times), validated against published
  Houston-area times across summer/winter/equinox dates. Shown in the hero and
  homepage markdown (today's), on `/hourly` per day heading, and in
  `/api/weather` (`sun.sunrise`/`sun.sunset` ISO) + MCP `get_current_conditions`.
  `sunTimesForCtDate()` anchors to noon Central of the timestamp's calendar
  date so evening hours can't round into the next solar day. Both derived
  values are documented honestly on `/about` as the two exceptions to "we
  don't adjust the numbers."
- Caching: the cron (`*/15 * * * *`) writes the forecast + active alerts to the
  WEATHER KV namespace under key "weather" as JSON. `fetch()` serves that cache
  and falls back to a live fetch + warm on a cold cache. The same cron also
  refreshes the `calendar` key (Crosby ISD iCal, throttled to ~6h) and the
  `water` key (NWPS river/bayou gauges, every tick — levels move fast in a
  flood); `fetch()` cold-warms both. (The `news` key is written out-of-band —
  see the News pipeline.)
- Styling: an inline `<style>` block in the rendered HTML — no build step,
  no static assets.
- Chrome: `topbar(current, lang)` renders the site header with nav links, and
  starts with a visually-hidden skip-to-content link (`.skip-link`, appears on
  keyboard focus) targeting `<main id="main">` — present on every page. On
  screens ≤920px the nav collapses into a CSS-only hamburger menu (native `<details>`
  element, no JS). (The breakpoint was raised from 600px to 920px so landscape
  phones stop wrapping the toolbar — worst in Spanish, where the labels are
  longer.) One markup, two layouts: the desktop bar is a flat inline row,
  while the mobile menu adds group headers (`.nav-group-label` — Weather /
  Community / More) and the mobile-only links `a.m-only` (Hourly under Weather,
  Developers under More), all
  `display:none` on desktop and shown only inside the open hamburger. Español
  stays a standalone toggle (never folded into the menu); the hamburger is a
  44px tap target spaced clear of it. **Invariant:** desktop relies on
  `.nav-menu::details-content { content-visibility: visible }` to keep the links
  inline — current Chromium hides closed-`<details>` content via
  `::details-content` and `display:contents` does NOT override it, so removing
  that rule makes the entire desktop nav disappear (only brand + Español show).
  `footer({ page, lang, source, data })` renders a shared
  footer on every page: per-page source attribution, a links row (Home · About ·
  Developers · Privacy · Contact · Sitemap · View as Markdown), and an independent-project
  disclaimer. Weather pages (`/`, `/weather`, `/hourly`, `/radar`, `/alerts` —
  the `WEATHER_PAGES` set) also show an alert-status + freshness line when `data`
  is passed.
- SEO/structured data: every HTML page emits schema.org JSON-LD — `JSONLD_SITE`
  (a `WebSite` + `Organization` `@graph`) sitewide; `/about` adds `AboutPage`;
  `/developers` adds `JSONLD_DATASET` (a `Dataset` describing the public weather
  API, for dataset search engines — a truthful type, unlike forecast markup)
  plus a `WebPage` node (`jsonldDevelopers`); `/contact` adds `ContactPage`,
  `/privacy` adds `WebPage`, and `/calendar` adds `Event` nodes. It's a `<script type="application/ld+json">` data block
  (not executable), so CSP needs no hash for it. Kept deliberately honest — no
  schema for the forecast (no truthful type exists) and no fake ratings/FAQ.
- Link previews: every HTML page emits Open Graph tags (`og:title`,
  `og:description`, `og:type`) plus per-page `og:url` and the shared
  `OG_COMMON` (`og:site_name` "Crosby News", `twitter:card` "summary"). No
  `og:image` — that would need a committed binary, which the "no static assets"
  rule forbids; cards still render title + description + site name.

## Languages (English + Mexican Spanish)
- The site is bilingual: English at the root paths and Mexican Spanish (`es-MX`)
  under an **`/es` prefix** (`/es`, `/es/weather`, `/es/hourly`, `/es/radar`,
  `/es/alerts`, `/es/water`, `/es/news`, `/es/calendar`, `/es/about`,
  `/es/developers`, `/es/privacy`, `/es/contact`, `/es/sitemap`). Same twelve
  content pages, same markdown negotiation. (`/es` is the Spanish hub;
  `/es/weather` the Spanish forecast.)
- **One set of render functions serves both languages** (no duplicated pages, so
  they can't drift). Each `*Html`/`*Markdown` takes a `lang` arg; the i18n block
  near the top of `src/index.js` holds the machinery: `T(lang,en,es)` for inline
  UI strings (English literals stay in place), parallel content objects for prose
  (`ABOUT_ES`, `ALERT_GUIDE_ES`), and locale-aware date helpers (`fmt`/`fullTime`/…
  take an optional `lang`, defaulting to English so every existing call site is
  unchanged).
- **Live NWS text is handled deterministically — never machine-translated.**
  Short conditions (`shortForecast`) go through the hand-written `ES_SHORT`
  dictionary (compound "X then Y" values are split on " then " and each segment
  looked up; unmapped phrases fall back to English). Period names (`ES_PERIOD`/
  `ES_WEEKDAY`), wind ("to"→"a", `ES_DIR` W→O), and AM/PM/weekday formatting are
  localized too. The free-form `detailedForecast` paragraphs and **all alert
  text stay in NWS's official English** (a short on-page note, `ES_NWS_NOTE`,
  says so). Rationale: NWS exposes no Spanish forecast/alert API, and its
  experimental auto-translation was paused in 2025 — English is the only
  authoritative source, and mistranslating a warning is unsafe.
- Routing: `_fetch` maps an `/es` request to its English path + `lang="es"`
  (`page = path.slice(3)`), then the shared content-page handlers render either
  language. Non-page routes (API, MCP, assets, `.well-known`) are English-only
  and never carry an `/es` prefix; the JSON API and MCP server are intentionally
  English-only too.
- SEO wiring: every page emits reciprocal `hreflang` link tags (`en-US`,
  `es-MX`, `x-default`→English) via `hreflangTags()`; `<html lang>`, `<title>`,
  description, OG, and `<link rel=canonical>` are all per-language
  (`canonicalFor()`); the sitemap lists both languages with `xhtml:link`
  alternates; and the topbar carries a no-redirect language toggle. `/` pairs
  with `/es` (not `/es/`).

## Routes (agent-readiness)
- `/` — the **homepage hub** (`homeHtml`/`homeMarkdown`): the "front page of
  Crosby," designed as a scannable local dashboard. Weather-forward hero
  (temp + condition, "Feels like", wind spelled out via `dirWord()`, rain
  chance, NWS's own `detailedForecast` prose as the summary line, and the
  cache's `Updated` stamp — NOT a clock time). **Alerts use progressive
  disclosure** (`hubAlertsBanner()`): no banner when quiet; 1–3 alerts → a
  compact red banner (count, condensed types, primary alert's one-line summary
  via `alertSummaryLine()`, severity-ranked) linking to `/alerts`; 4+ → count +
  highest-severity type only. Full alert products render ONLY on `/alerts` and
  `/weather` — never dump whole NWS statements on the hub (user-reported: one
  SWS ate 80% of the mobile page). Cards: **Today at a Glance**
  (`todayGlance()`: high/low, feels-like max, peak rain chance, wind
  range+gusts, humidity, dew point — all from cached data — plus `<details>`
  explainers for feels-like/humidity/dew point), Weather peek, an **Alerts
  status card** (count or "None" — no-alerts is news), Water (badge +
  `Updated` stamp; detail line only when not normal), News, Calendar. It loads
  all four datasets in parallel (`Promise.all`, each `.catch`-degrading to an
  empty shape) so one slow/failed source can't blank or serially block the
  page. Content-negotiated (`?format=md` / `Accept: text/markdown`). The full
  forecast moved to `/weather` during the 2026 nav/homepage restructure (root
  used to serve the forecast). The Bing `msvalidate.01` verification meta lives
  on the hub (the root Bing has on file).
- **Current-conditions invariant:** never render `hourly[0]` as "now" — NWS's
  `forecastHourly` first period is the product's generation hour and can lag
  the wall clock by 1h+ even with a fresh cache (user screenshots: hero said
  5:00 PM at 6:19 PM). `currentHourly(data)` picks the period covering
  `Date.now()`; it feeds the hub + `/weather` heroes, both markdowns,
  `/api/weather` `current`, and MCP `get_current_conditions`/the briefing
  prompt. Freshness labels show `data.updated` (when WE refreshed), not period
  start times.
- `/weather` — the full forecast (`renderHtml`/`renderMarkdown`): current
  conditions hero, 12-hour strip, 7-day forecast. Canonical `/weather`; this is
  what the root served pre-restructure. Content-negotiated. The homepage/`/weather`
  `Link` header advertises the markdown alternate, sitemap, api-catalog, and
  OpenAPI service-desc (via the parameterized `linkHeader(enPath, lang)`). All
  twenty-four content pages (the twelve English routes `/`, `/weather`, `/hourly`,
  `/radar`, `/alerts`, `/water`, `/news`, `/calendar`, `/about`, `/developers`,
  `/privacy`, `/contact`, `/sitemap` and their `/es` Spanish counterparts) emit an HTTP
  `Link: rel="canonical"` header — added centrally in the `fetch` wrapper via
  `PAGE_PATHS` — so the `?format=md` variants and the http→https pair consolidate
  onto one URL. Back-links from the sub-pages say "← Back to the forecast" and
  point at `/weather`; the nav's "Home" points at `/`, "Weather" at `/weather`.
  (See the Languages section for the `/es` bilingual setup.)
- `/hourly` — full multi-day hourly forecast table, grouped by day. Reuses the
  cached NWS hourly data. `fetchWeather()` keeps 48 hourly periods; the homepage
  strip, the homepage markdown, and `/api/weather` each `.slice(0, 12)` so only
  `/hourly` shows the full 48. Same markdown negotiation.
- `/radar` — embeds the NWS KHGX (Houston-Galveston) radar loop, which covers
  Crosby. The GIF is proxied via `/radar-image` (locked to fixed upstreams,
  short edge TTL) so it's crawlable and edge-cached; `?still=1` serves the
  latest single frame (`KHGX_0.gif`) instead of the loop, linked from the page
  for users who prefer a non-animated image. Same markdown negotiation.
- `/about` — static "what this site is" page (source, cadence, privacy,
  contact, disclaimer — human-facing). Same markdown negotiation. Content lives once in the
  `ABOUT` object; `aboutHtml()`/`aboutMarkdown()` render it so the two can't
  drift. Shared chrome (`BASE_CSS`, `topbar()` nav) is reused by all pages. The
  API/MCP/agent detail lives on `/developers` (moved off `/about` in the 2026
  restructure so `/about` stays human-facing); `/about` carries one pointer
  section to it.
- `/developers` — the developer/agent surface, gathered on one page (`DEVELOPERS`/
  `DEVELOPERS_ES` content objects, same `{h,p,links}` shape as `ABOUT`;
  `developersHtml()`/`developersMarkdown()` render): the public JSON API, specs
  &amp; discovery (OpenAPI, api-catalog), Markdown-for-every-page, the MCP server,
  agent skills, and the RSS feeds, plus terms/attribution. Emits `JSONLD_DATASET`
  (see SEO section) — this is where the `Dataset` node now lives. Both languages
  list the same English-only endpoints; only the prose and the self-referential
  markdown link localize. Same markdown negotiation. In the topbar only as an
  `m-only` link under "More" (hidden on the flat desktop bar); linked from the
  footer, `/about`, `/sitemap`, and llms.txt.
- `/alerts` — active NWS alerts for Crosby plus an evergreen severe-weather
  guide (`ALERT_GUIDE`) so the page stays substantial when nothing is active
  (avoids thin content). Markdown-negotiated.
- `/water` — live river/bayou levels for the waters that flood Crosby / NE
  Harris County (Cedar Bayou nr Crosby, San Jacinto R nr Sheldon + at Lake
  Houston, Luce Bayou nr Huffman, Goose Creek, E Fork San Jacinto — the
  `WATER_GAUGES` list of NWPS location IDs). Uses the **cron + KV pattern**
  (key `water`, cron-owned, refreshed every tick): `fetchWater()` pulls each
  gauge from NOAA/NWS NWPS (`api.water.noaa.gov/nwps/v1/gauges/{lid}`), which
  gives observed stage + flow + the flood-category THRESHOLDS all keyed to the
  same gauge datum (so reading and thresholds are directly comparable — never
  mixed). NWPS's own `floodCategory` drives the colored badge (Normal → Action
  → Minor → Moderate → Major); we never invent a classification. `-9999`
  (undefined threshold) / `-999` (no forecast) are sentinels, filtered by
  `waterNum()`. Per-gauge try/catch; `fetchWater()` throws only if EVERY gauge
  fails, so a total NWPS outage aborts-without-writing and the last snapshot
  survives. No API key needed (NWPS is public; a USGS key exists in reserve if
  we later want USGS's higher-frequency observed data). `loadWater()` cold-warms
  like `loadCalendar()`. Emits a 911/turn-around-don't-drown safety note and
  links each gauge's official NWPS page. Markdown-negotiated. Nav label
  "Water Levels" / "Niveles de agua".
- `/news` — local news for Crosby + nearby towns. The Worker is a pure renderer:
  it serves the WEATHER KV `news` key (read-only via `loadNews()`). That key is
  written out-of-band by `scripts/fetch-news.mjs` (see "News pipeline"), NOT by
  the Worker — Google News blocks Cloudflare Worker IPs. Markdown-negotiated.
- `/calendar` — Crosby ISD school calendar. Renders the district's public iCal
  feed (the combined "All Calendars" feed, `feedID=BB92BE3D…`, which is the union
  of every campus) as upcoming events grouped by month, plus one-tap subscribe
  links (`webcal://`, Google Calendar, `.ics`) for the whole district, the
  District academic calendar (`calendar_350.ics`), and each campus. Unlike news,
  the Worker CAN reach crosbyisd.org, so this uses the **cron + KV pattern**: the
  cron refreshes the `calendar` KV key (cron-owned, throttled to ~6h since it
  changes rarely), and `loadCalendar()` self-heals on a cold cache. A tiny
  hand-rolled `parseIcs()` (no dependency; the feed has no RRULE) reads it.
  Emits honest `Event` JSON-LD (a real schema.org type, unlike the forecast);
  every Event carries a `location` (the feed's venue, else Crosby ISD / Crosby,
  TX) since Google requires that field — without it the Rich Results Test flags
  every event "A value for the location field is required."
  Event titles stay in the district's official English (small `ES_EVENT` dict +
  English fallback, same policy as NWS text). Markdown-negotiated. The label in
  the nav is "School Calendar" / "Calendario escolar".
- `/privacy` — full privacy policy page. No cookies, no trackers, no personal
  data — details on logging, third-party data sources, and analytics. Content
  lives in `PRIVACY`/`PRIVACY_ES` objects; `privacyHtml()`/`privacyMarkdown()`
  render. JSON-LD: `WebPage`. Markdown-negotiated. Not in the topbar; linked from
  `/about` and the shared footer.
- `/contact` — contact page with general (contact@) and security (security@)
  email addresses. Content in `CONTACT`/`CONTACT_ES` objects;
  `contactHtml()`/`contactMarkdown()` render. JSON-LD: `ContactPage`.
  Markdown-negotiated. Not in the topbar; linked from `/about` and the shared
  footer.
- `/sitemap` — human-readable sitemap listing every page and endpoint, grouped by
  category (Weather & Forecast, Community, About & Policies, Developers &
  Agents). `sitemapPageHtml()`/`sitemapPageMarkdown()` render. Static, no data
  loading. Markdown-negotiated. Not in the topbar; linked from the shared footer.
  Distinct from `/sitemap.xml` (the machine-readable XML sitemap for crawlers).
- `/robots.txt` — RFC 9309 rules, explicit AI-crawler allows, and a `Sitemap:`
  reference. Open by default (public NWS data). (No `Content-Signal` line — it
  confused some crawlers when present, so it's intentionally omitted.)
- `/alerts.xml` and `/news.xml` — RSS 2.0 feeds rendered from the same KV
  data as the pages (the no-accounts notification channel). Alerts feed:
  guid = the NWS alert URN, empty channel when all clear, `ttl` 15;
  news feed: guid = the article link, `<category>` community|incident,
  `ttl` 60. Advertised via `<link rel="alternate" type="application/rss+xml">`
  on `/alerts` + `/news` (both languages), llms.txt `## Optional`, and the
  `/sitemap` page. English-only like the API; no `/es` variants.
- `/sitemap.xml` — lists `/`, `/weather`, `/hourly`, `/radar`, `/alerts`,
  `/water`, `/news`, `/calendar`, `/about`, `/developers`, `/privacy`, `/contact`, `/sitemap`
  in both languages
  (each English route plus its `/es` counterpart), every `<url>` carrying
  `xhtml:link` hreflang alternates (`en-US`, `es-MX`, `x-default`).
- `/llms.txt` — plain-language site summary for LLMs (llmstxt.org). Served as
  `text/markdown` (the body is markdown, same as the site's `?format=md` views),
  and carries the spec's `## Optional` section (skippable discovery links:
  sitemap, api-catalog, security.txt).
- `/.well-known/security.txt` — RFC 9116 security contact
  (`security@crosbynews.com`). `Expires` is computed ~1 year out at request time,
  so the file can't go stale. **Gotcha:** Cloudflare's zone-managed security.txt
  (dashboard, Security Center) silently overrides this route at the edge with a
  fixed `Expires` when enabled — it was found on and disabled during the
  2026-07-02 audit; keep it OFF so the Worker's self-refreshing version serves.
- `/api/weather` — public JSON (location, current, hourly, forecast, alerts),
  CORS `*`. `/api/health` — status + cache freshness.
- Conditional GET: the polled endpoints (`/api/weather`, `/api/news`,
  `/api/calendar`, `/alerts.xml`, `/news.xml`) send weak ETags derived from
  the KV freshness stamp (plus the Central calendar date where the body
  depends on it: sun times, upcoming-events cutoff) and `Last-Modified`
  where the stamp is a date; `If-None-Match` → body-less 304 (see
  `conditional()` in `src/index.js`), so feed readers and dashboards poll
  nearly free.
- `/api/news` and `/api/calendar` — the same KV data behind `/news` and
  `/calendar` as public JSON (CORS `*`): news items (title/link/source/
  published ISO/`category` community|incident, folding the internal crime
  flag) and upcoming Crosby ISD events (soonest first, capped 60; floating
  Central wall-clock — timed events as zone-less ISO local time, all-day as
  plain dates, same convention as the Event JSON-LD). Both documented in
  `/openapi.json` + the api-catalog, and exposed as MCP tools
  `get_crosby_news` / `get_school_events`. English-only like the rest of the
  API.
- `/api/water` — the same NWPS data behind `/water` as public JSON (CORS `*`):
  per-gauge id/name/usgsId, observed stage (ft) + flow (cfs), `category`, NWS
  `thresholds`, and the official NWPS `officialUrl`. Documented in
  `/openapi.json` + api-catalog; MCP tool `get_river_levels`. English-only.
- `/.well-known/api-catalog` (`application/linkset+json`, RFC 9727) and
  `/openapi.json` (OpenAPI 3.1) describe the API. All read from the same KV
  cache via `loadWeather()`.
- `/mcp` — stateless MCP server (Streamable HTTP, JSON-RPC) with tools
  `get_current_conditions`, `get_forecast`, `get_alerts`, `get_crosby_news`,
  `get_school_events`; prompt `crosby_briefing` (prompts/get composes live
  weather + alerts + news + school events server-side into a self-contained
  briefing prompt); resources `llms.txt` + `openapi.json` (readable
  in-protocol via resources/read). Discovery card at
  `/.well-known/mcp/server-card.json`. A GET (or HEAD) gets a human explainer
  page (`mcpInfoHtml()`, noindex), markdown-negotiated like the content pages
  (`Accept: text/markdown` / `?format=md` → `mcpInfoMarkdown()`, so the footer's
  "View as Markdown" link works) — except a GET asking for the SSE stream
  (`Accept: text/event-stream`, checked first), which 405s since we don't offer
  that stream (Streamable HTTP spec). POST does the protocol.
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
  famous "Crosby" people / other-state Crosbys; `GEO_REJECT` (word-boundary
  matched, so "uk" can't fire on "truck"/"Duke") for other-place Crosbys that
  otherwise rank straight in — Crosby in Merseyside/Liverpool/Sefton, England
  (UK); Crosby High School in **Waterbury, CT** (matches the `crosby high`
  relevance token); and **Crosbyton, TX**; real-estate + obituary drops;
  `AFTERMATH` drops grief/aftermath follow-ups (vigil / "family mourns" rewrites)
  so one death doesn't spawn a string of them; `CRIME_WORDS`/`CRIME_STEMS` for
  down-ranking (word-boundary matched, so e.g. "dead" doesn't tag "deadline");
  45-day freshness; `stalePastEvent()` drops "upcoming event" announcements whose
  date has passed (only when an explicit month-name date parses AND
  `pubDate < eventDate < now` AND an event/scheduling cue is present — so crime
  reports citing a past date, next-year announcements, retrospectives, and policy
  stories that merely mention a date are all spared); aggressive fuzzy de-dup
  (Jaccard > 0.35). Incidents are capped at 2 AND limited to one per crime
  "family" (`crimeFamily()`: violence > vehicle > hazard > other), so the page
  shows a couple of DISTINCT events and one case's many reworded headlines
  collapse to a single slot — `/news` leans community, not crime-blotter. Tone
  knobs: the incident cap (`incidents.length >= 2`), the `crimeFamily()` buckets,
  and the `CRIME_WORDS`/`CRIME_STEMS`/`AFTERMATH` lists.
- Run manually: `CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node
  scripts/fetch-news.mjs` (add `DRY_RUN=1` to print the would-be payload without
  writing KV — handy for testing the filters against live Google News). The
  routine just needs Bash (to run node) — NOT git write. If the routine stops, items age out at 45 days and `/news` shows an
  honest "no recent news" (never errors). If a run hits a total upstream failure
  (every Google query empty), it aborts WITHOUT writing, so a transient block
  can't wipe the last good snapshot.
- Fire on demand (no laptop needed): the routine has an **API trigger**, so a
  `POST` to its fire endpoint starts a run immediately (handy to apply a filter
  change now instead of waiting for the daily schedule). The per-routine token +
  URL live in the cloud-environment env vars `ROUTINE_FIRE_TOKEN` (secret,
  `sk-ant-oat01-…`) and `ROUTINE_FIRE_URL`
  (`https://api.anthropic.com/v1/claude_code/routines/trig_<id>/fire`). The
  request MUST send `Authorization: Bearer $ROUTINE_FIRE_TOKEN` (NOT `x-api-key`)
  AND `anthropic-beta: experimental-cc-routine-2026-04-01` (omitting the beta
  header 400s):

      curl -X POST "$ROUTINE_FIRE_URL" \
        -H "Authorization: Bearer $ROUTINE_FIRE_TOKEN" \
        -H "anthropic-version: 2023-06-01" \
        -H "anthropic-beta: experimental-cc-routine-2026-04-01" \
        -H "Content-Type: application/json" -d '{"text":"manual news refresh"}'

  It returns a `claude_code_session_url` and the run rewrites the `news` KV key a
  few minutes later (the routine is NOT IP-blocked, unlike the Worker). The real
  fire URL (with the `trig_` id) is intentionally kept in the env var, not
  committed here, since this repo is public; the token is generated/rotated in
  the routine's API-trigger settings at claude.ai/code/routines (shown once —
  regenerating revokes the old token).

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

## Email auth (SPF/DKIM/DMARC — lives in Cloudflare DNS, not the Worker)
- The domain receives mail via **iCloud Custom Email Domain** (the published
  `contact@` and `security@crosbynews.com` addresses). The MX records
  (`mx01`/`mx02.mail.icloud.com`), SPF (`v=spf1 include:icloud.com ~all`), and
  DKIM (`sig1._domainkey` CNAME → iCloud, key published) are all **iCloud-managed**
  — created by Apple's domain-setup flow, not this repo. The Worker sends no email.
- **DMARC is the one record we own.** `_dmarc.crosbynews.com` publishes a policy
  so receivers can reject mail spoofing the domain (e.g. phishing as `security@`)
  and so aggregate reports flow back. Reproduce/update with `node scripts/dmarc.mjs`
  (idempotent). Same Cloudflare-token rules as DNS-AID above: `Zone:DNS:Edit` to
  write, plus `Zone:Zone:Read` to resolve the zone id by name — or set
  `CLOUDFLARE_ZONE_ID=09de1864babbf541c26590b0fe42f25f` and a DNS:Edit-only token
  suffices.
- **Rollout ladder** (set via the `DMARC_POLICY` env var): currently **`p=none`**
  (monitor — collect reports, confirm iCloud mail aligns). After ~1–2 weeks of
  clean reports, escalate `DMARC_POLICY=quarantine node scripts/dmarc.mjs`, then
  `=reject`. Aggregate reports (`rua`) go to `security@crosbynews.com`, so that
  alias must be a real iCloud mailbox/catch-all or the reports are silently lost.
- No SMTP port-blocking or Spamhaus PBL concern applies here: there's no origin
  server/VPS sending mail (Cloudflare Worker, no public SMTP IP), and outbound
  mail leaves from iCloud's own (non-PBL) IPs.

## KV gotcha
- `wrangler kv key get/put/list` default to *local* (miniflare) state. To read
  or write the real production namespace, pass `--remote`. (A get without it can
  say "Value not found" even when the deployed Worker is reading the key fine.)
- The WEATHER namespace holds four keys: `weather`, `calendar`, and `water`
  (all cron-owned — the Worker refreshes them) and `news` (routine-owned —
  written out-of-band, the Worker only reads it).
