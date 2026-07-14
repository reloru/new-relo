# crosbynews.com — Cloudflare Worker

## Working with this repo
- This is a **live, complete, self-maintaining** production site. Make targeted
  changes only — don't rebuild it.
- After deploying, verify against the live site with `curl` (deploys land in
  ~10–40s) — check the headers/routes you touched.
- **Keep this file current:** when you change a route, a behavior, or an
  invariant that lives outside the Worker, update CLAUDE.md in the same PR.

## Agent operating notes (process, not site mechanics)
Not about the Worker's behavior — about working this repo session-to-session
as a coding agent. A human reading for site behavior can skip this section.

- **`TaskList`/`TaskCreate` do NOT persist across sessions** — they're
  session-local, so a fresh session reports zero tasks even right after a prior
  session logged (and completed) dozens. If a prompt says "check the tracker for
  the backlog," it does NOT mean these tools. **The persistent backlog is GitHub
  Issues:** they survive across sessions and are queryable/writable from every
  session via the `mcp__github__*` tools (`list_issues`, `issue_write`, …). Prefer
  filing backlog items as Issues (label them, e.g., `backlog`) over encoding them
  into a trigger prompt or into CLAUDE.md prose — a routine can then just say
  "work the oldest open issue labeled `backlog`." When you DO get a backlog in
  the prompt text (as PRs #62–72 did), treat that text as the source of truth for
  that run; there's nothing else to query.
- **Verify a new external upstream before writing any feature code against
  it.** A sandbox/container `curl` succeeding is not sufficient proof — Google
  News answers fine from a container but 503s the deployed Worker's IPs (the
  reason the news pipeline runs out-of-band at all). The pattern used for NHC
  (`/tropics`), EPA (UV), and Open-Meteo (AQI) — all confirmed this way before
  any feature code existed: add a temporary `/debug-<name>-canary` route that
  fetches the candidate upstream, `npx wrangler deploy` it for real (not just
  `wrangler dev` — must be the actual edge runtime and its egress IPs), curl
  the *live* URL to confirm a real 200 + body, then `git restore` the file and
  redeploy clean before building anything that depends on it.
- **`AskUserQuestion` can fail silently in automated/routine-driven sessions**
  (observed failure: "Tool permission request failed: Error: Tool permission
  stream closed before response received" — there's no human available to
  answer synchronously in that context). When genuinely blocked on a decision
  only the user can make, don't retry the tool — lay out the tradeoffs and
  named options directly in your response text and end the turn; the user
  answers in their next message instead of through the tool UI.
- **`.claude/skills/*/SKILL.md` files drift independently of CLAUDE.md** —
  nothing forces them to be touched when a feature ships. Concretely happened
  here: `/kv`'s SKILL.md still described three KV keys for two feature-cycles
  after `/water` shipped a fourth. When a change touches something a skill
  describes (KV keys, routes, deploy steps), grep the skills directory too,
  not just this file. (`.github/pull_request_template.md` carries a checklist
  reminder for this + the CLAUDE.md-currency rule.)
## Claude Code PR workflow (merge autonomy)
Owner policy (set 2026-07-14): a Claude Code session owns its PR end-to-end
and does not wait for human approval at any step.

- **One independent change per PR**, verified live before the next one starts,
  rather than batching several features into one. This is how the 2026
  Tier-1/3 roadmap (PRs #48–70) got done without any PR becoming hard to
  review or revert in isolation.
- **Implement, then verify for real** — `node --check` and the dry-run build
  must pass, and the change itself gets exercised (live `curl` after a deploy,
  `wrangler dev`, or a committed test script), not just syntax-checked.
- **Document in the same PR** — update CLAUDE.md and any `.claude/skills/`
  file the change makes stale (the drift gotcha above) when routes, KV keys,
  behaviors, or deploy steps change.
- **Squash-merge to `main` yourself** once correctness and doc-currency are
  verified; no additional approval required. The only merge gate is the
  required `Syntax check` CI job.
- **Post-merge, verify the deploy** — confirm CI's deploy job landed, then run
  `/verify-site` (it already encodes the full live-site checklist: routes →
  200, one-hop canonicalization, security headers, markdown negotiation,
  unknown-path 404 — don't re-derive those checks ad hoc). Report status
  plainly: Worker live, routes answering, KV readable.
- **Branch cleanup now happens on its own.** "Automatically delete head
  branches" is **ON** (owner enabled it 2026-07-14), so a squash-merge deletes
  its own head branch — a session no longer needs to flag cleanup or the owner
  to click "Delete branch." Two caveats: (1) it only fires on *future* merges,
  so the ~31 pre-existing stray `claude/*` branches are orphaned and only the
  owner can remove them (bulk-delete on the branches page); (2) a session still
  **cannot** delete a branch or write repo settings itself — the cloud git
  proxy rejects `git push --delete` and the GitHub API ref-deletion +
  repo-settings paths 403 through the egress proxy ("not permitted through this
  proxy" — re-verified 2026-07-14, unchanged by the workflow-permission
  toggles, which govern Actions' `GITHUB_TOKEN`, not a session's credentials).
  So don't retry those writes; the auto-delete setting is what does the work.
- **Merge method is squash by *convention*, not enforced.** All three methods
  (merge/squash/rebase) remain enabled on the repo, so nothing stops a stray
  merge commit (PR #91 landed as one). Always choose squash when merging, and
  keep in mind the divergence gotcha in the CI section below (a squashed branch
  can't just keep committing onto `main`'s rewritten history).

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
  `--remote` (the KV gotcha below). Knows `weather` + `calendar` + `water` +
  `tropics` (cron-owned) vs `news` (routine-owned); read commands are
  pre-authorized, put/delete are not.

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
- `.github/workflows/deploy.yml` runs three jobs on every push/PR to `main`:
  - **Syntax check** (`node --check src/index.js`) — runs on all PRs and pushes. The **only
    required** status check (branch protection keys on the exact name "Syntax check", so don't
    rename this job).
  - **Build check (dry-run)** (`npm ci` + `npx wrangler deploy --dry-run`) — runs on all PRs and
    pushes. Parses `wrangler.jsonc` and bundles the Worker without uploading, catching
    config/bundling errors and the compat-date/wrangler-pin coupling that `node --check` can't
    see. No auth needed (`--dry-run` uploads nothing). NOT a required check (adding it to branch
    protection needs the admin API), but **the deploy job `needs` it**, so a broken build blocks
    the prod deploy even though a PR could technically still be merged with it red.
  - **Deploy** (`cloudflare/wrangler-action@v3`) — runs on push to `main` only, after BOTH checks
    pass (`needs: [check, build]`). Has a `concurrency: { group: deploy-production,
    cancel-in-progress: false }` guard so two quick squash-merges deploy in order instead of
    racing (wrangler is last-write-wins).
- `wranglerVersion: "4"` is required in the wrangler-action config. Without it, the action
  installs wrangler 3.x, which can't parse `wrangler.jsonc` and fails with "Missing entry-point".
  The deploy action installs the latest 4.x; the build-check job and local dev use the repo's
  pinned `wrangler` devDependency (`^4.107.0`, via `npm ci`) so the dry-run, local `wrangler dev`,
  and prod runtime stay aligned.
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
  never reuse a branch that was already merged **by just continuing to commit on it** — main has
  a rewritten single commit where your branch has the full original history, so a naive push
  diverges or conflicts.
  There's one sanctioned exception, used repeatedly across PRs #48–70: to keep working on the
  *same* long-lived feature branch across many small PRs, reconcile immediately after each
  squash-merge with `git fetch origin main && git merge -X ours origin/main` (merge, not rebase)
  and push, before opening the next PR from that branch. `-X ours` discards the now-redundant
  diff (main already has your changes, squashed) while keeping the branch valid for a fresh PR.
  This is different from resuming a stale branch untouched — always reconcile first.
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
- UV index: the one weather number NOT from NWS. `fetchUv()` pulls the U.S.
  EPA's hourly UV forecast for Crosby's ZIP (77532) from EPA Envirofacts
  (`data.epa.gov/efservice/getEnvirofactsUVHOURLY/ZIP/77532/JSON`, no API key;
  Worker reachability canary-verified from the deployed runtime before
  shipping). It's folded into the existing `weather` KV entry as `uv:{hourly}`,
  NOT its own key/page — `fetchWeather()` fetches it as a fourth parallel call,
  failure-tolerant (`uv:null` on any EPA error so an EPA hiccup never blocks
  the NWS refresh). EPA publishes `DATE_TIME` in the ZIP's LOCAL (Central)
  wall-clock and its rows can wrap into the prior evening, so `uvCurrent`/
  `uvPeakToday` match on the CT date+hour. Shown (gated to UV>0, so night's
  "0" doesn't read as a dead daytime) on the `/weather` hero, the homepage
  "Today at a Glance" (Peak UV) + a glance explainer, `/weather` + homepage
  markdown, `/api/weather` (`uv:{current,currentCategory,peakToday,...}`, raw
  0s kept), and MCP `get_current_conditions` + the briefing. Categories
  (Low/Moderate/High/Very High/Extreme) via `uvCategory()`. **A pre-feature
  `weather` cache entry has no `uv`** — the freshness check keys on `hourly`,
  so UV stays absent (and gracefully hidden) only until the next cron write
  (≤15 min) or a cold-cache warm.
- Air quality (AQI): the site's one **modeled** number and its only non-US-gov
  source. No EPA/AirNow monitor sits in Crosby, so rather than misattribute a
  distant monitor, `fetchAqi()` pulls Open-Meteo's modeled US AQI (CAMS-based,
  no API key) for Crosby's coordinates — Worker reachability canary-verified
  from the deployed runtime first. Folded into the `weather` KV entry as
  `aqi:{usAqi,dominant,pm25,pm10,ozone,time}`, a fifth parallel call in
  `fetchWeather()`, failure-tolerant (`aqi:null` on any error). **Labeled
  "modeled" everywhere it appears** — the hero/`Now` meta ("Air 47 (Good,
  modeled)"), the homepage "Today at a Glance" **"About air quality"
  explainer** (which states it's modeled; the glance ROW itself is a bare
  "Air quality N (Category)" with no inline "modeled" tag — the tag was dropped
  from the row so it stops wrapping the narrow desktop column, the explainer
  carries the disclosure),
  `/api/weather` (`airQuality:{…, modeled:true, source}`) and MCP
  `get_current_conditions`/briefing — never presented as a measurement.
  Categories are the EPA 0–500 bands via `aqiCategory()`; the dominant
  pollutant comes from Open-Meteo's per-pollutant sub-AQIs. Meaningful day and
  night (unlike UV), so it's not gated. The honest "modeled, not a monitor
  reading" disclosure lives on `/about`. (AirNow — the official monitor
  source — was skipped: it needs a managed API key; if one is added later,
  swapping the upstream is localized to `fetchAqi()`.)
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
  refreshes the `calendar` key (Crosby ISD iCal, throttled to ~6h), the
  `water` key (NWPS river/bayou gauges, every tick — levels move fast in a
  flood), and the `tropics` key (NHC CurrentStorms.json, throttled ~1h);
  `fetch()` cold-warms all three. (The `news` key is written out-of-band —
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
  `/es/alerts`, `/es/water`, `/es/tropics`, `/es/news`, `/es/calendar`,
  `/es/emergency`, `/es/about`, `/es/developers`, `/es/privacy`, `/es/contact`,
  `/es/sitemap`). Same fifteen content pages, same markdown negotiation. (`/es` is the Spanish hub;
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
  language. Non-page routes (API, assets, `.well-known`) are English-only
  and never carry an `/es` prefix; the JSON API and the MCP **protocol/API** are
  intentionally English-only too. **Exception: `/es/mcp`** is a Spanish HUMAN
  explainer (GET/HEAD only) — the protocol still lives only at `/mcp`, and the
  Spanish page tells readers to connect to `/mcp`, not `/es/mcp` (a POST to
  `/es/mcp` 404s; it is not an endpoint).
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
  (`todayGlance()` returns `{today, now}` — two groups the way weather apps do
  it: the day's outlook (High, Low, Feels like, Rain chance, UV index, Wind,
  Gusts) rendered first, then a "Right now" sub-heading over the current-hour
  readings (Humidity, Dew point, Air quality) — all from cached data). **Labels
  are bare metric names** (no "Peak"/"now" qualifiers): the time basis lives in
  the "Right now" group heading and in each metric's `<details>` explainer,
  which now LEADS with what/when ("This is the highest feels-like expected for
  the rest of today…", "This is the humidity right now…") — the weather-app
  convention (weather.com/AccuWeather/NWS all use bare labels + a current-vs-
  forecast split). Rationale for this over-per-row-qualifiers came from user
  feedback 2026-07-10 (couldn't tell highs from averages / calendar-day vs
  rolling-24h vs their phone app); the investigation is at
  `docs/2026-07-10-today-at-a-glance-investigation.md`. Mechanics preserved:
  aggregate rows are max/range over the REMAINING hours of the CT calendar day
  (past hours excluded even when the NWS product still carries them), and in the
  evening — when NWS drops today's daytime period — the High row relabels to
  "High tomorrow" (a correctness label, kept). `glanceStamp()` is now just the
  date ("Friday, Jul 10"); freshness moved to a tiny **data-source footnote**
  under the explainers (`glanceSourceLine()`: "Data from the National Weather
  Service, EPA, and Open-Meteo · updated H:MM CT (N min ago)", `relTime()` for
  the relative part). The homepage hero also carries a "Currently in Crosby,
  Texas" eyebrow (`.hub-eyebrow`) above the temp.
  Then: Weather peek, an **Alerts
  status card** (count or "None" — no-alerts is news), Water (badge +
  `Updated` stamp; detail line only when not normal), News, Calendar. It loads
  all four datasets in parallel (`Promise.all`, each `.catch`-degrading to an
  empty shape) so one slow/failed source can't blank or serially block the
  page. Content-negotiated (`?format=md` / `Accept: text/markdown`). The full
  forecast moved to `/weather` during the 2026 nav/homepage restructure (root
  used to serve the forecast). The Bing `msvalidate.01` verification meta lives
  on the hub (the root Bing has on file). **Bing Webmaster URL submission**: the
  site is verified in Bing Webmaster Tools and the cloud env carries
  `BING_WEBMASTER_API_KEY`, so a session can push URLs for (re)indexing via the
  JSON API — `POST https://ssl.bing.com/webmaster/api.svc/json/SubmitUrlbatch?apikey=$BING_WEBMASTER_API_KEY`
  with body `{siteUrl, urlList}`; check remaining quota with
  `GetUrlSubmissionQuota` (daily 100 / monthly 1900). All 30 content-page URLs
  (both languages) plus `/mcp` and `/es/mcp` were submitted on 2026-07-14.
  (Google indexing is not API-driven here — Search Console is DNS-verified; see
  the MCP Registry section.)
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
  thirty content pages (the fifteen English routes `/`, `/weather`, `/hourly`,
  `/radar`, `/alerts`, `/water`, `/tropics`, `/news`, `/calendar`, `/emergency`, `/about`, `/developers`,
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
- `/tropics` — Atlantic tropical outlook (`tropicsHtml`/`tropicsMarkdown`).
  **Cron + KV pattern** (key `tropics`, cron-owned, throttled ~hourly):
  `fetchTropics()` reads NOAA NHC's `CurrentStorms.json`, filtered to the
  Atlantic basin (storm ids `al…` — Pacific storms don't threaten Crosby) and
  throws on failure so a transient NHC outage never wipes the last snapshot;
  `loadTropics()` cold-warms, degrading to an empty shape. **Worker
  reachability to www.nhc.noaa.gov was canary-verified from the deployed
  Worker runtime** (temporary debug route, 200 + real body, then removed)
  before committing to the upstream. Quiet basin (most of the year) renders a
  green all-clear panel + an evergreen "hurricane season and Crosby" guide
  (inland rain flooding is the local threat, not surge; watch-vs-warning;
  links to NHC, `/alerts`, `/water`, `/emergency`) so the page never goes
  thin; active storms render violet cards (classification + name via the
  `NHC_CLASS` hand dictionary, winds in mph — NHC's `intensity` is in KNOTS,
  converted `kt × 1.15078` rounded to 5 like NHC's own advisories — pressure,
  position, movement compass direction only since `movementSpeed`'s unit
  isn't clearly documented, and the official advisory link). The **homepage
  strip** (`hubTropicsBanner`, violet, calmer than the red alerts banner)
  self-hides when the basin is quiet; the hub loads tropics as its fifth
  parallel dataset. Storm names/advisories stay in NHC English. In the topbar
  as `m-only` under Weather. Markdown-negotiated.
- `/news` — local news for Crosby + nearby towns. The Worker is a pure renderer:
  it serves the WEATHER KV `news` key (read-only via `loadNews()`). That key is
  written out-of-band by `scripts/fetch-news.mjs` (see "News pipeline"), NOT by
  the Worker — Google News blocks Cloudflare Worker IPs. Markdown-negotiated.
  **Admin nuke** (owner-only editorial control, no accounts/public voting):
  visiting `/news?admin=<ADMIN_KEY>` renders every article with 🗑 Hide /
  ↩ Restore buttons (and dims already-hidden ones); the button POSTs the
  article link + the secret to `POST /api/news/delete` (or `/api/news/restore`),
  which the Worker checks against the `ADMIN_KEY` **Worker secret** (constant-
  time, via `isAdmin()`) and records in the worker-owned **`news_blocklist`** KV
  key (`{link: blockedAtMs}`, auto-pruned past 60 days). `loadNews()` filters
  against that key so a hidden article vanishes **instantly** on the next render
  everywhere it appears (/news, the homepage card, `/api/news`, `/news.xml`);
  `loadNews(env, {includeBlocked:true})` is the admin variant that keeps blocked
  items (annotated `.blocked`). The news routine also reads `news_blocklist`
  (`loadBlocklist()`) and drops those links, so a nuked article **stays gone**
  even though Google's RSS keeps returning it. The whole feature no-ops if
  `ADMIN_KEY` is unset (endpoints 503, buttons never render); admin responses
  are `private, no-store` and English/Spanish share one CSP-hashed script
  (`NEWS_ADMIN_SCRIPT`, labels via `data-*`). No cookies or visitor data — the
  secret lives in the URL you bookmark, checked server-side; privacy model
  unchanged. Rotate by re-running `wrangler secret put ADMIN_KEY`.
  **Admin renders omit `<link rel="manifest">`** — otherwise iOS "Add to Home
  Screen" reads the manifest's `start_url` (`/`) and pins the *homepage* instead
  of the `?admin=` URL (the web-app URL field is locked when a manifest is
  present). Dropping the manifest tag on admin renders makes iOS bookmark the
  actual `/news?admin=…` URL (a plain Safari web-clip, not a standalone PWA).
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
- `/emergency` — bilingual emergency-resources directory for Crosby / NE Harris
  County: 911 + non-emergency numbers (HCSO, Poison Control, 988, 211, plus a
  "Houston 311 doesn't cover unincorporated Crosby" note), official alert
  channels (ReadyHarris, NWS HGX), flood tools (county FWS, the FEMT
  address-level floodplain lookup, HCFCD, FloodSmart/NFIP 30-day-wait basics,
  our `/water`), roads (TranStar, DriveTexas), CenterPoint outage/gas-leak
  reporting, the East Harris County **CAER industrial-incident line**
  (281-476-2237 / ehcma.org — Crosby has plants of its own), shelters/recovery
  (Red Cross, DisasterAssistance.gov), and hurricane prep (H-GAC Zip-Zone
  evacuation maps; Crosby is outside the surge zones). Pure static content,
  zero data loading — content in `EMERGENCY`/`EMERGENCY_ES` objects;
  `emergencyHtml()`/`emergencyMarkdown()` render. Every external link + phone
  number was curl-verified before shipping (`texaspoison.com` is a parked
  domain now — poison numbers point at poison.org; ready.gov /
  disasterassistance.gov / ehcma.org WAF-block datacenter curl but are
  canonical). Phone numbers are `tel:` links. JSON-LD: `WebPage`.
  Markdown-negotiated. In the topbar as an `m-only` link under "More" (kept off
  the flat desktop bar to avoid re-wrapping it); linked prominently from
  `/alerts` (the intro row under the status panel, both languages + markdown)
  and from the shared footer ("Emergency" / "Emergencias"), `/sitemap`, and
  llms.txt.
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
- **PWA/offline** — `/manifest.json` (web app manifest: installable,
  `display: standalone`, brand colors), `/icon.svg` (512px app icon —
  full-bleed navy square, `purpose: "any maskable"`, art inside the maskable
  safe zone), `/apple-touch-icon.png` (+ `-precomposed`; a **180×180 PNG**
  rasterized from `ICON_SVG`, the site's ONLY raster asset — inline base64
  constant `APPLE_TOUCH_ICON_B64`, so the no-static-files rule still holds. iOS
  "Add to Home Screen" needs a PNG touch icon and ignores SVG here; the admin
  `/news?admin=` view drops the manifest so it also links this explicitly,
  otherwise iOS invents a letter tile), and `/sw.js` (hand-written service worker, no build step). The
  SW precaches the storm-critical pages (`/`, `/alerts`, `/es`, `/es/alerts`,
  manifest, favicon) at install, then runs **network-first for navigations**
  (always fresh online; caches query-less copies as it goes) with the
  last-good copy — or the language hub — as the offline fallback, so the site
  still answers during storm-time connectivity drops. All three are Worker
  routes (constants `MANIFEST`/`ICON_SVG`/`SW_SCRIPT` near the favicon), per
  the no-static-assets rule. `/sw.js` is served `no-cache` so deploys take
  effect next visit; **bump the `CACHE` version inside SW_SCRIPT when
  changing SW behavior** (activate sweeps old caches). Registration lives in
  `HOME_SCRIPT` (so its CSP hash recomputes automatically); every page's
  `<head>` carries `<link rel="manifest">`. CSP note: worker-src isn't set,
  so SW loading falls back to `script-src 'self'`, which passes.
  **Vary gotcha (caught in testing):** the content pages send `Vary: Accept`
  and the Cache API respects Vary — a navigation's Accept header never equals
  the precache fetch's `*/*`, so every SW `caches.match` MUST pass
  `{ ignoreVary: true }` or offline matches all miss and collapse to the hub.
  Offline behavior is verified by the committed **`scripts/test-sw-offline.mjs`**
  (`NODE_PATH=/opt/node22/lib/node_modules node scripts/test-sw-offline.mjs`):
  it boots `wrangler dev`, registers + precaches, then **KILLs the server** and
  re-navigates against a persistent profile, asserting cached pages serve
  themselves and uncached paths fall back to the language hub. It has to kill
  the server because Playwright's `setOffline` does NOT apply to SW-initiated
  fetches — run this script after any SW change instead of re-deriving the
  procedure. This is the service-worker foundation the severe-alert
  Web Push feature (below) builds on; **the SW now also carries the `push` +
  `notificationclick` handlers** (hence `CACHE` = `crosby-v2`).
- **Severe-alert Web Push** — opt-in browser push for life-threatening
  **warnings only** (`SEVERE_PUSH_EVENTS`: Tornado / Flash Flood / Hurricane /
  Hurricane Force Wind / Extreme Wind / Tropical Storm Warning — warnings, never
  watches/advisories, to avoid alert fatigue). **Design: empty VAPID wake-up +
  local composition** — the cron sends a *payload-less* VAPID-authed POST (no
  ECDH/HKDF/AES-GCM payload encryption at all); the SW `push` handler then
  fetches `/api/weather` and composes the notification itself from the live
  alerts (`userVisibleOnly` is satisfied even in the expired-by-now race via a
  generic fallback). `notificationclick` focuses/opens `/alerts`. **Keys:** a
  P-256 VAPID keypair — `VAPID_PRIVATE_KEY` (private JWK JSON) + `VAPID_PUBLIC_KEY`
  (base64url raw point) are **Worker secrets** (set via `wrangler secret put`;
  also in gitignored `.dev.vars` for local dev). `vapidAuth()` signs a short
  ES256 JWT (WebCrypto ECDSA already yields the raw r‖s JWS form — no DER
  unwrap). To **rotate**, generate a new pair and `wrangler secret put` both;
  existing subscriptions keep working only if the public key is unchanged, so a
  rotation invalidates them (subscribers re-opt-in). The whole feature no-ops
  cleanly if the secrets are absent (endpoints 503 / UI hides). **Storage:** one
  KV entry per subscription under the `push:` prefix (key = hash of the
  endpoint, so re-subscribing overwrites), value = `{endpoint, keys, added}`;
  plus a `push_notified` key holding the alert IDs already pushed (dedupe, so an
  ongoing warning doesn't re-notify every 15 min — reconciled each tick to
  only-currently-active IDs so a reissued warning under a new ID can notify
  again). **SSRF guard:** the cron POSTs to whatever endpoint was stored, so
  `/api/push/subscribe` allowlists real push hosts only (`*.googleapis.com`,
  `*.push.apple.com`, `*.notify.windows.com`, `*.push.services.mozilla.com`) —
  never an arbitrary URL. Dead subs are pruned on 404/410. **Endpoints:**
  `GET /api/push/vapid-key` (public key, or null → UI hides), `POST
  /api/push/subscribe`, `POST /api/push/unsubscribe`. **Opt-in UI** lives on
  `/alerts` (`PUSH_CLIENT_SCRIPT`, its own CSP hash; language-agnostic bytes —
  all strings via `data-*` on `#push-optin`, so one hash serves both langs);
  progressive-enhancement, stays hidden without push support or a VAPID key —
  EXCEPT iPhone Safari tabs, where it shows an add-to-Home-Screen hint
  (`data-ios`) instead: **iOS exposes Web Push only to Home-Screen web apps**,
  so a plain-tab visitor would otherwise never learn the feature exists.
  Two Safari gotchas baked into the click handler (found in the real-device
  soft launch): `Notification.requestPermission()` must be the FIRST await in
  the tap handler (Safari only honors it during the tap's transient
  activation), and base64url→bytes padding uses the plain while-loop — a
  slicker closed-form pad expression shipped broken once (atob threw on every
  subscribe attempt, in every browser).
  Privacy policy has a "Push notifications" section (both languages): only an
  anonymous subscription is stored, no message content is sent through it,
  deletable anytime. **Verifiable in-sandbox:** VAPID JWT sign/verify round-trip,
  subscribe/unsubscribe, SSRF rejection, the dedup/reconcile state machine, and
  prune-on-404 (sending an empty wake-up to a bogus FCM token → 404 → pruned).
  **NOT verifiable in-sandbox:** a real notification landing on a device (needs
  a real browser push subscription) — that's a manual real-device check.
  **Real-device check PASSED 2026-07-06** (iPhone, Home-Screen web app):
  subscribe → KV entry → manual empty VAPID wake-up → APNs `201` →
  notification displayed (generic fallback branch, correct since no severe
  warning was active) → tap → `notificationclick` opened `/alerts`. Also
  live-confirmed the severity gate: an active Special Weather Statement did
  NOT push (not in `SEVERE_PUSH_EVENTS`) — only the manual wake-up did.
- `/badge.svg` — hotlinkable live-weather badge (SVG, 300×80, brand-styled
  with the favicon sun-and-cloud): current temp + condition (truncated to
  fit), gated feels-like, and a status flag ("✓ NO ALERTS" green / "⚠ N
  ALERTS" red). Rendered by `badgeSvg(data)` from the same KV cache
  (`loadWeather`); CORS `*`, `cache-control: max-age=300, s-maxage=900`
  (≈ the cron cadence) so hotlinks cost almost nothing. On total data
  failure it serves a neutral "unavailable" badge (no alert claim) with a
  60s cache instead of a broken image. Text rows use tspan flow, so
  variable-width values never collide. English-only; an asset, not a page
  (no PAGE_PATHS/sitemap.xml entry, mirroring `/radar-image`). Documented
  on `/developers` ("Embeddable weather badge", with the copy-paste `<img>`
  snippet), the human `/sitemap` developer list, and llms.txt `## Optional`.
- `/sitemap.xml` — lists `/`, `/weather`, `/hourly`, `/radar`, `/alerts`,
  `/water`, `/tropics`, `/news`, `/calendar`, `/emergency`, `/about`, `/developers`, `/privacy`, `/contact`, `/sitemap`
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
- `/api/weather` — public JSON (location, current, hourly, forecast, alerts,
  plus the derived `sun`, the EPA `uv` object, and the modeled `airQuality`
  object), CORS `*`. `/api/health` — status + cache freshness.
- Conditional GET: the polled endpoints (`/api/weather`, `/api/news`,
  `/api/calendar`, `/api/water`, `/api/tropics`, `/alerts.xml`, `/news.xml`)
  send weak ETags derived from
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
- `/api/tropics` — the same NHC data behind `/tropics` as public JSON (CORS
  `*`): per-storm id/name/classification (+ human `classificationLabel`),
  `windMph` (converted from NHC knots, rounded to 5), `intensityKt`,
  `pressureMb`, position, `movementDirection` (compass only), and the official
  `advisoryUrl`. An empty `storms` array is the normal quiet-basin state.
  Documented in `/openapi.json` + api-catalog; MCP tool `get_tropical_outlook`.
  English-only.
- `/.well-known/api-catalog` (`application/linkset+json`, RFC 9727) and
  `/openapi.json` (OpenAPI 3.1) describe the API. All read from the same KV
  cache via `loadWeather()`.
- `/mcp` — stateless MCP server (Streamable HTTP, JSON-RPC) with tools
  `get_current_conditions`, `get_forecast` (optional `hours` 1–48, the full
  KV hourly supply), `get_alerts`, `get_tropical_outlook`, `get_crosby_news`,
  `get_school_events`, `get_river_levels`, `get_emergency_contacts` (the
  static `EMERGENCY` directory as a tool), and `get_radar` (fetches the NWS
  KHGX still `KHGX_0.gif` server-side and returns it as inline MCP image
  content, base64 GIF, with a text fallback when the upstream is down — the
  one tool whose result is an image, so it has no `structuredContent`/
  `outputSchema`). Every tool carries `annotations` (`readOnlyHint: true`,
  `openWorldHint: false` — the shared `MCP_READ_ONLY` const) so clients can
  skip per-call confirmation, and every data tool declares an `outputSchema`
  (shallow + permissive: NWS/NHC objects pass through with more fields than
  enumerated; full docs live in `/openapi.json`). `get_current_conditions`
  adds normalized `dewpointF`/`humidityPercent` alongside the raw NWS fields.
  `initialize` only echoes a requested protocolVersion from
  `MCP_SUPPORTED_VERSIONS` (else answers with our latest, per spec — never
  parrot an unsupported version like `2026-07-28`). Prompt `crosby_briefing`
  (prompts/get composes live weather + alerts + news + school events — plus
  river gauges above normal and active Atlantic storms, each only when
  present — server-side into a self-contained briefing prompt); resources
  `llms.txt` + `openapi.json` (readable in-protocol via resources/read).
  Discovery card at `/.well-known/mcp/server-card.json`. A GET (or HEAD) gets a human explainer
  page (`mcpInfoHtml()` — **indexable**: the old `noindex` meta was removed
  2026-07-13 so Google's AI Overviews/AI Mode can cite `/mcp` as a supporting
  link, since a page must be indexed to be AI-citable), markdown-negotiated like the content pages
  (`Accept: text/markdown` / `?format=md` → `mcpInfoMarkdown()`, so the footer's
  "View as Markdown" link works) — except a GET asking for the SSE stream
  (`Accept: text/event-stream`, checked first), which 405s since we don't offer
  that stream (Streamable HTTP spec). POST does the protocol. Both explainer
  renderers take a `lang` arg: **`/es/mcp`** is a Spanish HUMAN explainer
  (GET/HEAD only; `mcpInfoHtml("es")`/`mcpInfoMarkdown("es")`) that describes the
  server in Spanish, links its en/es pair via `hreflangTags("/mcp")` +
  per-language `canonical`, and repeatedly tells readers to connect to the
  English `/mcp` (not `/es/mcp`). The protocol is unchanged — a POST to `/es/mcp`
  404s (it's a page, not an endpoint).
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
  `BLOTTER_RE` drops police-blotter / report-index boilerplate ("For Reports
  Between <date> & <date>" digests, "police blotter" roundups — index pages,
  not stories);
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
  and a DNS:Edit-only token suffices. (Both `CLOUDFLARE_ZONE_ID` and the token
  are already set in the cloud environment; if the default token is ever short
  a scope, the env also carries `CLOUDFLARE_ZONE_API_KEY` with wider zone
  permissions.) Note the account-owned token can't call
  `/user/tokens/verify` (returns "Invalid API Token") even when it's valid for
  zone/DNS calls — sanity-check it with a resource call, not `verify`.
- Intentionally skipped: OAuth/OIDC, oauth-protected-resource, and auth.md —
  the site has no protected APIs to authenticate against.

## Official MCP Registry (published listing)
- The `/mcp` server is **published to the official MCP Registry**
  (`registry.modelcontextprotocol.io`) as **`com.crosbynews/weather`** — a
  **remote** server (no downloadable package): `remotes: [{ type:
  "streamable-http", url: "https://crosbynews.com/mcp" }]`. `server.json` at the
  repo root is the source of truth (validated with `mcp-publisher validate`).
  Verify: `curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=com.crosbynews/weather"`.
- **Namespace auth = DNS.** The `com.crosbynews` namespace is proven by a TXT
  record on the apex `crosbynews.com`: `v=MCPv1; k=ed25519; p=<base64 pubkey>`
  (added via the Cloudflare DNS API alongside the SPF/DKIM/DMARC/DNS-AID
  records). **Leave that TXT record in place** — re-publishing/updating the
  listing re-checks it.
- **The `mcp-publisher` CLI**: the GitHub release binary download is blocked by
  the agent egress proxy (403), but `go install
  github.com/modelcontextprotocol/registry/cmd/publisher@latest` works (the Go
  module proxy is allowlisted; needs Go ≥1.26, which `GOTOOLCHAIN=auto`
  auto-fetches, and `GOSUMDB` left at its default since `sum.golang.org` is
  reachable). The built binary is named `publisher`.
- **To update the listing** (new tools, a metadata change): bump `version` in
  `server.json`, then re-auth + publish. Because the publish keypair is
  ephemeral, the flow is: `openssl genpkey -algorithm Ed25519 -out key.pem` →
  derive the pubkey (`openssl pkey -in key.pem -pubout -outform DER | tail -c
  32 | base64`) → overwrite the `crosbynews.com` MCP TXT record's content with
  the new `v=MCPv1; k=ed25519; p=…` → `publisher login dns --domain
  crosbynews.com --private-key <hex>` → `publisher publish`.
- **PulseMCP needs no separate submission** — it ingests the official registry
  automatically, so the listing propagates to `pulsemcp.com` on its next sync
  (~daily). (A manual `pulsemcp.com/submit` would only create a duplicate.)
- **Google Search Console**: the domain is **verified** — confirmed by the live
  `google-site-verification=…` TXT record on `crosbynews.com` (checked via the
  Cloudflare API). Sitemap submission + per-URL "Request indexing" (e.g. for the
  now-indexable `/mcp`) are account-level actions in the GSC UI, not visible
  from the repo.

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
- **Rollout ladder** (set via the `DMARC_POLICY` env var): currently
  **`p=quarantine`** (escalated from `p=none` on 2026-07-07 at the user's
  direction, after ~3 weeks at none). The remaining rung is `=reject`: after
  a clean observation window at quarantine (aggregate reports showing iCloud
  mail aligned, nothing legitimate quarantined), run
  `DMARC_POLICY=reject node scripts/dmarc.mjs`. Aggregate reports (`rua`) go
  to `security@crosbynews.com`, so that alias must be a real iCloud
  mailbox/catch-all or the reports are silently lost.
- No SMTP port-blocking or Spamhaus PBL concern applies here: there's no origin
  server/VPS sending mail (Cloudflare Worker, no public SMTP IP), and outbound
  mail leaves from iCloud's own (non-PBL) IPs.

## KV gotcha
- `wrangler kv key get/put/list` default to *local* (miniflare) state. To read
  or write the real production namespace, pass `--remote`. (A get without it can
  say "Value not found" even when the deployed Worker is reading the key fine.)
- The WEATHER namespace holds five content keys: `weather`, `calendar`, `water`,
  and `tropics` (all cron-owned — the Worker refreshes them) and `news`
  (routine-owned — written out-of-band, the Worker only reads it). It also holds
  the Web Push state: `push_notified` (cron-owned dedupe list — first created
  when a severe warning actually pushes, so it's absent until then; that's the
  normal quiet state, not a bug) and one entry per
  subscriber under the `push:` prefix (written by `/api/push/subscribe`, pruned
  by the cron). Don't hand-edit the `push:*`/`push_notified` keys — deleting a
  `push:` entry just unsubscribes that device; deleting `push_notified` would
  re-notify every currently-active severe warning on the next tick.
- The **`news_blocklist`** key is worker-owned (written by the `/api/news/delete`
  + `/api/news/restore` admin endpoints, read by both the Worker's `loadNews()`
  and the news routine's `loadBlocklist()`): `{articleLink: blockedAtMs}` of
  articles the owner hid via the `/news?admin=` nuke. Deleting it just un-hides
  everything; it self-prunes entries older than 60 days. See the `/news` route.
