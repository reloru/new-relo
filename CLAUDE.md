# crosbynews.com — Cloudflare Worker

## Working with this repo
- This is a **live, complete, self-maintaining** production site. Make targeted
  changes only — don't rebuild it.
- After deploying, verify against the live site with `curl` (deploys land in
  ~10–40s) — check the headers/routes you touched. **Sample more than once:** a
  new Worker version reaches Cloudflare's edges over a minute or two, so a single
  curl can return the OLD page from a colo that has not rolled over yet (see the
  propagation gotcha below).
- **Keep this file current:** when you change a route, a behavior, or an
  invariant that lives outside the Worker, update CLAUDE.md in the same PR.
- **A PR that changes a page's handler, content, data source, canonical URL,
  sitemap presence, meta, or CSP expectations MUST update that page's
  `docs/pages/<page>.md` in the same PR.** The same rule applies to non-page
  routes and `docs/endpoints/`. Those files record **current expected state**,
  not history — overwrite them, don't append. Dated write-ups go in
  `docs/audit/` or `docs/investigations/` instead, and are never edited in
  place. `docs/README.md` explains the split.

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
- **A check that reuses the code under test cannot falsify it.** The 2026-08-05
  audit concluded HHD had stopped publishing pollen counts, and said so in a
  merged doc. It hadn't. The audit probed for the "missing" days by GENERATING
  candidate URLs from the same date pattern `pollenSlugDate()` uses — so the
  probe inherited the exact bug it existed to find, got a clean 404 for every
  day, and returned a confident wrong answer that survived review. The counts
  were being published the whole time; our parser had stopped recognizing the
  URLs. When checking whether a parser is missing data, **extract what the
  upstream actually serves using a deliberately looser pattern and diff it
  against our parse** — never re-derive the expected input from our own logic.
  Generalized: prefer ground truth (what the upstream returns, what the live
  site renders) over a re-derivation of the thing being tested, and treat a
  check that agrees with the code on every case as unproven rather than passing.
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
- **Reach for `gh` when `mcp__github__*` doesn't cover it** — account settings,
  repo settings, Actions/workflows. It isn't installed by default:
  `apt-get install -y gh` (Ubuntu repos, 2.45.x). Auth needs no setup —
  `GH_TOKEN`/`GITHUB_TOKEN` are real PATs already in the environment, so
  **never `gh auth login`**. `gh auth status` false-negatives on a valid token;
  check with `gh api user`. GraphQL-backed subcommands (`gh repo view`) 403
  through the proxy — use REST: `gh api repos/{owner}/{repo}/...`.
- **Parse GitHub API JSON with `jq` or `python3`, never `grep`** — fields sit on
  separate lines, so a pattern spanning two of them silently never matches and a
  poll loop spins forever.
- **A post-deploy `curl` can be WRONG for a minute or two, and a cache-buster
  does not help.** A new Worker version propagates across Cloudflare's colos
  over roughly 1–2 minutes, and requests fan out across them — so a request with
  a brand-new `?cb=` query string can still be served by an edge running the
  PREVIOUS version. This is version propagation, not caching, which is why the
  usual cache-busting trick does nothing for it. Measured 2026-08-05 on
  `/es/developers`: 7 of 8 fresh requests showed the new build and 1 showed the
  old, for about two minutes after the deploy job went green; three separate
  "final" verifications that day were briefly wrong because they sampled once and
  happened to hit the stale edge. **Sample ~8 times and require them to agree**
  before calling a deploy verified:

      for i in $(seq 1 8); do curl -s "$URL?cb=$RANDOM-$i" | grep -c "$MARKER"; done

  Separately, edge *caching* is real too and behaves differently: content pages
  carry `max-age=300`–`3600`, so a bare re-request (no cache-buster) can serve a
  stale copy for far longer. Cache-busting fixes that one; only waiting fixes
  propagation.
- **For an HTTP status, use `curl -s -o /dev/null -w "%{http_code}"`.** With
  `curl -sI` the proxy's CONNECT tunnel prepends `HTTP/1.1 200 Connection
  Established`, so the first `HTTP/...` line is not the response's and a `301`
  reads as `200`. `-sI` is still fine when you want the headers themselves —
  print *every* `^HTTP` line plus `location:` and read them, e.g.
  `curl -sI "$url" | grep -iE "^HTTP/|^location:"`. It's `head -1` / `grep -m1`
  that does the damage, not `-sI`.
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
- `/verify-site` — curl health-check of the live deploy: **all 20 content pages in
  BOTH languages** return 200 and are substantive, plus security headers, one-hop
  canonicalization, markdown negotiation, unknown-path 404. Encodes the "verify
  with curl after deploy" rule above. Read-only. **The both-languages sweep is
  the point** — roughly half the render branches never execute under `lang="en"`,
  and an English-only pass let `/es/hourly` sit 502 in production for two deploys.
- `/deploy` — syntax-check every file under `src/`, surface branch/working-tree state,
  `npx wrangler deploy`, then verify the live site. Encodes the Deploy rules
  below (never `wrangler login`; the binding-permission gotcha; manual deploy
  ships the working tree, not git).
- `/kv` — inspect/edit the production `WEATHER` KV namespace, always with
  `--remote` (the KV gotcha below). Knows `weather` + `calendar` + `water` +
  `fishing` + `tropics` + `pollen` + `traffic` (cron-owned) vs `news`
  (routine-owned); read commands are pre-authorized, put/delete are not.

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
- `.github/workflows/deploy.yml` runs three jobs on every push/PR to `main`:
  - **Syntax check** (`find src -name '*.js' -print0 | xargs -0 -n1 node --check`) — runs on all
    PRs and pushes. The **only required** status check (branch protection keys on the exact name
    "Syntax check", so don't rename this job). It covers **every file under `src/`, not just the
    entry point**: `node --check` validates one file at a time and does not follow imports, so
    checking only `src/index.js` would go green while an imported module was unparseable.
  - **Build check (dry-run)** (`npm ci` + `npx wrangler deploy --dry-run`) — runs on all PRs and
    pushes. Parses `wrangler.jsonc` and bundles the Worker without uploading, catching
    config/bundling errors and the compat-date/wrangler-pin coupling that `node --check` can't
    see. No auth needed (`--dry-run` uploads nothing). NOT a required check (adding it to branch
    protection needs the admin API), but **the deploy job `needs` it**, so a broken build blocks
    the prod deploy even though a PR could technically still be merged with it red.
    **Treat a green dry-run as a hard merge gate anyway.** It resolves imports, so it catches
    a missing or renamed export across files — a failure `node --check` cannot see.
    **But it does NOT catch a module using another module's export without importing it**:
    esbuild treats an unresolved identifier as a *global* and emits no error. That gap is
    covered by the third step below.
  - **Check cross-module references** (`node scripts/check-module-refs.mjs`) — runs inside the
    required `Syntax check` job (pure node, no install). Flags any module referencing a name
    exported elsewhere under `src/` without importing or declaring it. Added after a real
    escape during the decomposition: `src/lib/format.js` used `TZ` without importing it and
    BOTH gates went green. It wouldn't even have crashed — `fmt()` wraps its body in
    try/catch and returns `""`, so every timestamp, day heading and "Updated" stamp on the
    site would have silently rendered empty. A swallowed `ReferenceError` is worse than a
    loud one.
    **It has a known blind spot**: it does not descend into a template literal nested inside
    a `${...}` substitution, so `${lang === "es" ? \`<p>${ES_NWS_NOTE}</p>\` : ""}` is
    invisible to it. That exact line shipped `/es/hourly` as a **502 in production** with all
    three gates green.
  - **Check renderers (both languages)** (`node scripts/check-renders.mjs`) — also in the
    required job. Imports every module and calls every `*Html`/`*Markdown`/`api*`/`jsonld*`
    export with stub data **in both `en` and `es`**, failing on `ReferenceError`. Running the
    code is the only ground truth; every static approximation of "is this name in scope" has
    so far found a new way to be wrong. **The two-language sweep is the point** — roughly half
    the site's render branches never execute under `lang="en"`, which is why `/hourly` was fine
    while `/es/hourly` was down.
  - **Deploy** (`cloudflare/wrangler-action@v3`) — runs on push to `main` only, after BOTH checks
    pass (`needs: [check, build]`). Has a `concurrency: { group: deploy-production,
    cancel-in-progress: false }` guard so two quick squash-merges deploy in order instead of
    racing (wrangler is last-write-wins).
- `wranglerVersion: "4"` is required in the wrangler-action config. Without it, the action
  installs wrangler 3.x, which can't parse `wrangler.jsonc` and fails with "Missing entry-point".
  The deploy action installs the latest 4.x; the build-check job and local dev use the repo's
  pinned `wrangler` devDependency (see `package.json`, via `npm ci`) so the dry-run and the
  prod runtime stay aligned. **`package.json` is the only place the version number lives —
  don't repeat it here.**
- **Compatibility date — the constraint is one-directional.** `compatibility_date`
  (currently `2026-07-01`) must be ≤ the bundled `workerd`'s ceiling. Bumping `wrangler`
  RAISES that ceiling, so a version bump can never violate it and needs no boot check.
  Only RAISING the date is risky ("The Workers runtime failed to start"), and CI never runs
  `wrangler dev`, so that's the one change worth a local `npx wrangler dev`.
- **Verification gate: `node --check` + `npx wrangler deploy --dry-run`.** Runtime coverage
  comes from `/verify-site` against the live deploy, not a local boot. Don't add
  `wrangler dev` to routine checks — it's a server, so it never exits 0 (timeout → 124,
  SIGTERM → 143) and reads as failed after serving fine. Judge it by HTTP, not exit status.
  `scripts/test-sw-offline.mjs` is the one legitimate user and already does this right.
- **`wrangler <cmd> | head -N` hangs** — wrangler doesn't exit on EPIPE, so a short `head`
  wedges it until the command timeout. `--version | head -2` hangs; `| head -20` is fine.
  Redirect to a file, or use `tail`.
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
- **Preview URLs are OFF on purpose** — only `previews_enabled` is false;
  production `enabled` stays `true` for the `*.workers.dev` URL above. Both at
  `/accounts/{account_id}/workers/scripts/crosbynews/subdomain`.
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
  **The `(not ssl)` clause is load-bearing** — it upgrades http directly, so even
  http://www reaches the apex in ONE hop. Don't remove it. Lives in the
  zone/dashboard, not wrangler.jsonc or fetch(); it matches
  `<link rel="canonical">` and the sitemap `<loc>`.
- "Always Use HTTPS" (SSL/TLS → Edge Certificates) is **ON**. Redundant with the
  Redirect rule but harmless: Cloudflare runs Single Redirects first, so the
  rule's `(not ssl)` clause always wins and there's no double hop. Either state
  is fine as long as that clause stays; ON is a safety net if it ever doesn't.
- HSTS is enabled at the Cloudflare **zone edge** (SSL/TLS → Edge Certificates →
  HSTS: `max-age=63072000; includeSubDomains`, no preload) so the header lands on
  edge-generated responses too — notably the `www` → apex 301, which the Worker
  never sees (the redirect rule runs before it) and so can't stamp HSTS on. The
  Worker ALSO sets the same HSTS on its own (apex) responses; Cloudflare de-dupes,
  leaving a single header. Zone/dashboard config, not wrangler.jsonc.

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
- Air quality (AQI): now **measured** with a modeled fallback. `fetchAqi(env)`
  tries **EPA/AirNow first** — the official measured monitors — via
  `/aq/observation/current/ziplatlong/` (`airnowapi.org`, `AIRNOW_API_KEY` Worker
  secret; host Worker-reachability canary-verified from the deployed runtime).
  That endpoint returns the **closest reporting monitor for each pollutant**
  (per AirNow's own NowCast lookup), so we NAME the real nearby TCEQ monitors
  (e.g. ozone from "Baytown Garth", PM2.5 from "Baytown C148" — ~8–15 mi; there's
  no monitor in Crosby itself, so it's still an area reading, not a Crosby-pinpoint
  value, and it's labeled that way). **Why per-pollutant, not one "nearest
  monitor":** a single station rarely measures every pollutant — e.g. Channelview
  C15 (~8 mi) reports ozone ONLY, so pinning to it would hide an elevated PM2.5
  at a Baytown monitor and understate risk. Overall US AQI = max of the pollutant
  NowCast sub-indices (`nowcastAQI`); dominant = the one at that max. When AirNow
  is unreachable, the key is unset, or the monitors report nothing, `fetchAqi`
  **falls back to Open-Meteo's modeled** US AQI for Crosby's exact coordinates
  (CAMS-based, no key), labeled "modeled". Folded into the `weather` KV entry as
  `aqi:{usAqi,dominant,subIndices,sites,dominantSite,agency,pm25,pm10,ozone,
  measured,source,reportingArea,observed,time}` (`sites` maps each pollutant token
  → monitor site name; raw pm/ozone concentrations are Open-Meteo-only, null on
  the AirNow path), a parallel call in `fetchWeather(env)` (env is threaded
  `loadWeather`→`fetchWeather`→`fetchAqi` for the key), failure-tolerant
  (`aqi:null` on total failure). **Labeled honestly by source everywhere** via
  `aqiSourceTag()` (short: the dominant pollutant's monitor, e.g. "Baytown Garth
  monitor", or "modeled") and `aqiSourceNote()` (the sentence, lists the
  per-pollutant monitors): the hero/`Now` meta ("Air 84 (Moderate, Baytown Garth
  monitor)"), the homepage "Today at a Glance" **"About air quality" explainer**
  (reflects measured-vs-modeled, links `/air`; the glance ROW is still a bare
  "Air quality N (Category)"), the glance data-source footnote (names AirNow vs
  Open-Meteo), `/api/weather` (`airQuality:{…, measured, modeled(=!measured,
  back-compat), dominantMonitor, monitors, reportingAgency, reportingArea,
  observed, subIndices, source}` via the shared `aqiApiObject()`), `/api/air`,
  the **`/air` page** (below, per-pollutant cards show each monitor's site), and
  MCP `get_current_conditions`/`get_air_quality`/briefing. Categories are the EPA
  0–500 bands via `aqiCategory()`. Meaningful day and night (unlike UV), so it's
  not gated. The measured-vs-modeled disclosure lives on `/about`. **AirNow
  endpoint retirement (handled):** the legacy `/aq/observation/latLong/current/`
  we first shipped on **retires 2026-09-30** (AirNow API Updates, June 2026); we
  already migrated to the June-2026 replacement `/aq/observation/current/
  ziplatlong/`. Open-Meteo stays the fallback, so any future AirNow change
  degrades gracefully and the swap is localized to `fetchAqiAirNow()`. (TCEQ runs
  the underlying monitors and may offer a keyless feed — a future no-key
  alternative.)
- **Nearest dedicated ozone monitor (cross-reference):** because the headline
  names the CLOSEST reporting monitor per pollutant, a locally elevated reading at
  a slightly-farther monitor could hide behind it. `fetchNearbyOzone(env)` pulls
  **Channelview C15** ozone (AQS `482010026`, ~8.5 mi; Baytown Garth ~7.7 mi is
  marginally closer and usually drives the headline ozone) from AirNow's
  **observations-by-monitoring-site** endpoint (`/aq/data/`, hourly, bounding box
  — an ACTIVE service, NOT one of the by-zip/lat-long endpoints retiring fall
  2026; reuses `AIRNOW_API_KEY` + the canaried `airnowapi.org` egress). It's a 6th
  failure-tolerant parallel fetch in `fetchWeather(env)`, attached as
  `aqi.nearby:{site,distanceMi,aqi,agency,observedIso}` only when both it and the
  headline AQI resolve (any error or reporting gap → dropped, card hidden). Shown
  on `/air` as a "Nearby ozone monitor" card (timestamp + a native `<details>`
  "i" expander — no JS, CSP-safe), in the `/air` markdown, and as
  `airQuality.nearbyMonitor` on `/api/air` + `/api/weather` + MCP
  `get_air_quality`. Ozone only — PM is already covered by the headline monitors.
- Derived data: "feels like" temperature (`feelsLikeF`/`feelsLikeRawF` in
  `src/lib/derived.js`) is the one number on the site NOT taken verbatim from NWS —
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
  flood), the `fishing` key (USGS real-time water conditions, every tick), the
  `tropics` key (NHC CurrentStorms.json, throttled ~1h), the
  `pollen` key (Houston Health Department daily count, throttled ~2h — one
  count per weekday morning), and the
  `traffic` key (Houston TranStar RSS, every tick — incidents and high-water
  reports move fast); `fetch()` cold-warms all seven. (The `news` key is
  written out-of-band — see the News pipeline.)
- **Pollen is the only HTML scrape, and HHD changes its URL shape without
  notice.** Everything else on the site reads an API or a feed; `/pollen` reads
  a city Drupal site that has already changed twice. On 2026-08-03 the slug lost
  the hyphen between day and year (`…-august-52026`, where `…-july-31-2026` had
  been the format) and some days moved to a capitalized `/Services/` path. Both
  matchers in `pollenNewestFromIndex()` are therefore **deliberately
  permissive** — optional day-year separator, case-insensitive href — and
  `parsePollenCount()` is the strict gate, because it is the one that can tell a
  real layout change from a cosmetic URL change. **Do not tighten the URL
  patterns**; `scripts/test-pollen-parse.mjs` (required CI job) pins both
  formats and both casings. The failure mode is silent by construction: when a
  matcher stops matching, the fetch still succeeds, an older page still parses,
  the KV entry is still rewritten on schedule, and `/api/health` still reports
  the feed fresh — the count just stops advancing. That ran three days before a
  human noticed. Issue #156 tracks the health-side check that would catch it.
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
  footer on every page: per-page source attribution, a links row (Home · Emergency ·
  About · Developers · Privacy · Contact · Sitemap · View as Markdown), and an independent-project
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
  must use the `/es` form. The language toggle is exempt (it is the switcher,
  identified by `hreflang="en-US"`), and deliberate exceptions live in that
  script's `ES_LINK_ALLOW`. This exists because `/sitemap` linked Spanish
  readers to the English `/mcp` for four days: `/mcp` stopped being an
  English-only endpoint and the non-localizing link helper stayed.
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
  fresh cache (user screenshots: the hero said 5:00 PM at 6:19 PM).
  `currentHourly(data)` picks the period covering `Date.now()` and feeds both
  heroes, both markdowns, `/api/weather` `current`, and the MCP tools. Freshness
  labels show `data.updated` — when WE refreshed — never a period start time.
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
  total), so `?format=md` variants consolidate onto one URL. **`/mcp` and
  `/es/mcp` are in that set**, and in `sitemapXml()`, as of 2026-08-01. They were
  outside both while `/mcp` was protocol-only; it became a real HTML page (and
  was deliberately made indexable so AI search can cite it) and nothing that
  treats pages as pages was updated to match. `PAGE_PATHS` matches on pathname,
  not method, so a `POST /mcp` JSON-RPC response also carries the canonical
  `Link` header — inert for MCP clients, which read the body and the
  `mcp-*` headers.
- **Adding a page** means touching, in the same PR: the handler, `PAGE_PATHS`,
  `sitemapXml()`, `llmsTxt()`, `topbar()`, the `/sitemap` page, and a new
  `docs/pages/<page>.md`. Adding a public endpoint: the handler,
  `openApiSpec()`, `apiCatalog()`, `llmsTxt()`, `README.md`, `/developers`,
  **the `/sitemap` page** (`src/pages/sitemap.js` — BOTH the HTML list and the
  markdown one), and `docs/endpoints/…`.
  **The `/sitemap` page is the one nothing points at**, which is why
  `/api/water`, `/api/fishing` and `/api/tropics` were all missing from it until
  the 2026-08-01 audit. None of these lists is generated or cross-checked by CI
  — adding an endpoint and skipping one of them fails silently.

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
  a scope, the env also carries `CLOUDFLARE_ZONE_API_TOKEN` with wider zone
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
- **Bump `server.json`'s `version` and `MCP_SERVER_INFO.version` (`src/mcp/server.js`)
  in the same PR** whenever the tool set changes. (`/openapi.json`'s
  `info.version` is a separate track — it describes the REST API.) Bumping
  `server.json` does NOT publish; the listing only moves when someone runs the
  publish flow below, so a bumped-but-unpublished version is normal, and an
  unpublished version is skipped rather than backfilled.
- **Five hand-maintained places name the tools — update every one when adding a
  tool.** `mcpTools()` is the only generated list; these five are prose that goes
  stale silently: `CROSBY_WEATHER_SKILL` (served at
  `/.well-known/agent-skills/crosby-weather/SKILL.md`), `llmsTxt()`, the
  `MCP server` section of **both** `DEVELOPERS` and `DEVELOPERS_ES`
  (the `/developers` page), and `README.md`.
  Two surfaces that look like they belong on that list do NOT: `mcpServerCard()`
  derives its tool list from `mcpTools()` so it cannot drift, and the MCP
  `initialize` `instructions` string is prose about the data with no tool names
  in it. (This entry said "six" and counted those two until the 2026-08-01
  audit; `src/mcp/server.js` and `src/discovery.js` had already said five.)
- **Namespace auth = DNS.** The `com.crosbynews` namespace is proven by a TXT
  record on the apex `crosbynews.com`: `v=MCPv1; k=ed25519; p=<base64 pubkey>`
  (added via the Cloudflare DNS API alongside the SPF/DKIM/DMARC/DNS-AID
  records). **Leave that TXT record in place** — re-publishing/updating the
  listing re-checks it.
- **The `publisher` CLI**: `command -v publisher` first, then if missing
  `GOBIN=/usr/local/bin go install
  github.com/modelcontextprotocol/registry/cmd/publisher@latest`. **`GOBIN` is
  required** — without it the binary lands in `/root/go/bin`, which is not on
  PATH, and the install "succeeds" while `which publisher` finds nothing.
- **To update the listing** (new tools, a metadata change): bump `version` in
  `server.json`, then re-auth + publish. Because the publish keypair is
  ephemeral, the flow is: `openssl genpkey -algorithm Ed25519 -out key.pem` →
  derive the pubkey (`openssl pkey -in key.pem -pubout -outform DER | tail -c
  32 | base64`) → overwrite the `crosbynews.com` MCP TXT record's content with
  the new `v=MCPv1; k=ed25519; p=…` → `publisher login dns --domain
  crosbynews.com --private-key <hex>` → `publisher publish`. Notes:
  - **`xxd` is NOT installed in this environment**, so the usual `... | xxd -p`
    for the private-key hex fails with "command not found". Use
    `openssl pkey -in key.pem -outform DER | tail -c 32 | od -An -tx1 | tr -d ' \n'`
    instead (must be exactly 64 hex chars).
  - **PATCH the existing MCP TXT record by id — never bulk-write the apex.** The
    apex carries five TXT records (MCP, SPF, google-site-verification,
    apple-domain, openai-domain-verification); the MCP one is id
    `8f0e53d79ee64be84df930d7e46a874b`. `PATCH
    /zones/{zone}/dns_records/{id}` with just `{"content": "v=MCPv1; …"}`
    leaves the other four untouched — re-verify all five afterward.
  - Wait for the new key to appear in public DNS (`curl -H 'accept:
    application/dns-json' 'https://cloudflare-dns.com/dns-query?name=crosbynews.com&type=TXT'`)
    before `publisher login dns`, which checks the record live.
  - Keep `key.pem` OUT of the repo (use a scratch dir). It's single-use: the
    next publish rotates the TXT record to a fresh pubkey anyway.
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
- **Rollout ladder (complete):** `p=none` → `p=quarantine` (2026-07-07) →
  **`p=reject`** (2026-07-28 at the user's direction), the final rung — mail
  spoofing `security@`/`contact@` is now hard-rejected by receivers, not just
  quarantined. **The live record's `rua` has two recipients, not just the
  script's default:** `mailto:282e2a686e3c4a1fadc35dbc7b496a67@dmarc-reports.cloudflare.net`
  (Cloudflare's own DMARC-monitoring address, added out-of-band — not by
  `scripts/dmarc.mjs`, which only knows `security@crosbynews.com`) plus
  `mailto:security@crosbynews.com`. **Re-running `scripts/dmarc.mjs` as-is
  would silently drop the Cloudflare address** (it overwrites the whole
  record with just its one `rua`), so any future policy change should PATCH
  the existing record's `p=` in place (or update the script to preserve both
  recipients) rather than re-running it unmodified. `security@crosbynews.com`
  must stay a real iCloud mailbox/catch-all or its half of the reports is
  silently lost.
- No SMTP port-blocking or Spamhaus PBL concern applies here: there's no origin
  server/VPS sending mail (Cloudflare Worker, no public SMTP IP), and outbound
  mail leaves from iCloud's own (non-PBL) IPs.

## KV gotcha
- `wrangler kv key get/put/list` default to *local* (miniflare) state. To read
  or write the real production namespace, pass `--remote`. (A get without it can
  say "Value not found" even when the deployed Worker is reading the key fine.)
- **Local KV persists across runs** in `.wrangler/state/v3/kv/` (gitignored), so
  a "fresh" `wrangler dev` is NOT a cold cache — it replays whatever the last
  local run warmed, however many days ago. Verified 2026-08-05: a dev server was
  served a `weather` value written four days earlier, with every hourly period
  long elapsed. `rm -rf .wrangler/state` for a genuinely cold start. This is also
  why `/api/health` legitimately returns 503 in local dev, and why nothing should
  use it as a liveness probe (see `docs/endpoints/api/health.md`).
- The WEATHER namespace holds eight content keys: `weather`, `calendar`, `water`,
  `fishing`, `tropics`, `pollen`, and `traffic` (all cron-owned — the Worker refreshes them) and
  `news` (routine-owned — written out-of-band, the Worker only reads it). The cron
  also writes **`cron_status`** at the end of every tick — per-feed
  `{ok, at, skipped?, error?}` — which is how `/api/health` reports whether the
  last refresh ATTEMPT succeeded, distinct from whether the data is fresh. It also holds
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
