# State of the site and repo — 2026-08-01

The first full audit after the 15-step decomposition of `src/index.js` (PRs
#126–#137, finished at commit `8325799`). Written against the live deploy and
the code at that commit, not against CLAUDE.md.

This is an audit, not a state file: it is dated and it is not updated in place.
Current expected state per route lives in `docs/pages/` and `docs/endpoints/`.

- `src/` — 37 modules, 9,665 lines; `src/index.js` is 50 lines
- Live: 40 content-page URLs (20 pages × 2 languages), 30 non-page routes
- Predecessor: `docs/audit/2026-07-30-state.md`, written to plan the decomposition

Every claim below was checked against the live site, the deployed bundle, or the
code — never inferred from prose. Where a check came back clean it is recorded
in section (e), because "we looked and it was fine" is the part that rots
silently.

---

## Status of the 2026-07-30 findings

| # | Finding | Status |
|---|---|---|
| d.1 | `renderError()` blamed NWS for every upstream failure, and leaked `err.message` | **Fixed** (PR #134). Takes a source name; no raw message. |
| d.2 | `loadNews()` unguarded against a corrupt `news` key | **Fixed** (PR #131). `.catch()` → degrade to empty. |
| d.3 | `/api/health` cannot report unhealthy | **Open** — see B2 |
| d.4 | `/mcp` outside `PAGE_PATHS`, `sitemap.xml`, and JSON-LD | **Open**, and wider than recorded — see B6 |
| d.5 | `/verify-site` coverage gaps | **Fixed** (PR #130). Now sweeps both languages, `/mcp`, `SKILL.md`, the icons and `/radar-image`. |
| c.1 | README documented 9 of 15 `/api/*`, omitted `/api/health` | **Fixed.** README now lists all ten public endpoints. |
| c.2 | README never mentioned `/privacy` or `/contact` | **Fixed.** |
| c.3 | README's "no build step" was false | **Fixed.** The Stack section now describes the esbuild bundle and the CI dry-run. |
| c.4 | `llms.txt` omits `/api/fishing` | **Open** — see B4 |
| c.5 | Spliced doc comments around the client-script constants | **Fixed** by the move to `src/assets/client-scripts.js`. |
| c.6 | Stale comments: "all four datasets", the `/water` branch captioned "Crosby ISD school calendar", `topbar`'s escaped backticks | **All three still open** — see D4 |

Two of the six code-level findings survived a 15-PR refactor of the exact files
they live in. That is the pattern worth noting: the decomposition moved code
faithfully and did not sweep the comments or the docs that describe it.

---

## a. Bugs

Ordered by user-visible impact.

### B1. Every TranStar camera link on `/traffic` is a 404

`transtarCameraPage()` (`src/features/traffic.js:200`) builds:

```
https://www.houstontranstar.org/cctv/transtar/by_roadway.aspx?mnu=freeway&rd=<roadway>
```

TranStar moved those pages to the `traffic.` subdomain. Measured:

| URL | Status |
|---|---|
| `https://www.houstontranstar.org/cctv/transtar/by_roadway.aspx?mnu=freeway&rd=US-90` | **404** (ASP.NET "The resource cannot be found.") |
| `https://www.houstontranstar.org/cctv/transtar/by_roadway.aspx?mnu=freeway&rd=IH-10_East` | **404** |
| `https://traffic.houstontranstar.org/cctv/transtar/by_roadway.aspx?mnu=freeway&rd=US-90` | **200**, real "Houston TranStar Cameras" page |
| `https://traffic.houstontranstar.org/cctv/transtar/by_roadway.aspx?mnu=freeway&rd=IH-10_East` | **200**, contains "Crosby" |

`https://www.houstontranstar.org/cctv/` now serves a **PDF**, so the whole
`www` path is gone rather than merely renamed.

Blast radius: two rendered links on `/traffic` and two on `/es/traffic`, plus
`cameras[].pageUrl` for all **14** entries in `TRAFFIC_CAMERAS` — which is
`/api/traffic` and the MCP `get_traffic` tool. The other TranStar URLs on the
page (`TRANSTAR_MAP_URL`, `TRANSTAR_CLOSURES_URL`, both on
`traffic.houstontranstar.org`) are fine at 200.

Fix: change the host in `transtarCameraPage()`. One word.

### B2. `/api/health` can never report unhealthy

`src/router.js:278–291`:

```js
let updated = null;
try {
  const cached = await env.WEATHER.get(KV_KEY, "json");
  updated = cached?.updated ?? null;
} catch {}
return new Response(JSON.stringify({ status: "ok", updated }), …);
```

`status` is the literal `"ok"` on every path — a KV outage, a corrupt value, or
a six-hour-stale cache all return `200 {"status":"ok"}`. The endpoint is the
`status` link of **every** `/.well-known/api-catalog` entry, so anything
monitoring the site through the catalog is monitoring a constant. `updated` is
the only real signal and the caller has to compute staleness itself.

Carried from the 2026-07-30 audit (d.3), where it was scheduled for
decomposition step 13; step 13 shipped without it.

### B3. `airQuality.nearbyMonitor` is missing from `/openapi.json`

The nearby-ozone cross-reference ships on both `/api/air` and `/api/weather`
(verified live: `nearbyMonitor.site = "Channelview C15"`, `usAqi 30`), but
neither `airQuality` schema in `src/api/openapi.js` (≈338 and ≈447) declares
it. Diffing every documented path's schema against its live payload, this is
the only *own-computed* field missing — the rest of the undocumented keys
(`dewpoint`, `@id`, `areaDesc`, …) are NWS passthrough covered by the
deliberate `additionalProperties: true` policy.

Related: the `airQuality` object is written out **twice, verbatim**, once
inline under `/api/weather` and once under `/api/air`, instead of being a
shared component like `HourlyPeriod`. That duplication is how the field came to
be missing from both copies at once.

### B4. `llms.txt` omits `/api/fishing`

`llmsTxt()` lists eight public APIs under `## API & agent access` — weather,
air, news, calendar, water, tropics, traffic, pollen — and skips fishing, while
naming `get_fishing` among the MCP tools four lines later. `/openapi.json`,
`/.well-known/api-catalog`, README and `/developers` all carry it.

Flagged 2026-07-30 (c.4) as "one line to add". Still one line.

### B5. The `/sitemap` page omits three APIs

`src/pages/sitemap.js` lists `/api/weather`, `/api/news`, `/api/calendar`,
`/api/traffic`, `/api/pollen`, `/api/air` and `/api/health`, and skips
**`/api/water`, `/api/fishing`, `/api/tropics`** — in both the HTML (lines
98–104) and the Markdown (160–166), both languages. The page's own lead line
says "Every page and endpoint on crosbynews.com."

Root cause is a checklist gap, not carelessness: CLAUDE.md's "Adding a public
endpoint" rule names the handler, `openApiSpec()`, `apiCatalog()`, `llmsTxt()`,
`README.md`, `/developers`, and `docs/endpoints/…` — but **not** the `/sitemap`
page. It is the one discovery surface nothing points at.

### B6. `/mcp` and `/es/mcp` emit no Open Graph tags and no JSON-LD

Scanning all 40 page URLs for `og:url` / `OG_COMMON` / `JSONLD_SITE`: 38 have
all three, `/mcp` and `/es/mcp` have none. `src/mcp/server.js` imports
`canonicalFor` and `hreflangTags` but not `OG_COMMON` or `JSONLD_SITE` — the
only page module that doesn't.

`docs/pages/mcp.md` records the JSON-LD omission ("**No JSON-LD.** This is the
one HTML page that emits no `JSONLD_SITE` block"), but not the Open Graph one,
and CLAUDE.md still asserts:

> Link previews: every HTML page emits Open Graph tags (`og:title`,
> `og:description`, `og:type`) plus per-page `og:url` and the shared
> `OG_COMMON`.

So a shared link to `/mcp` — the site's most externally depended-on route, the
one published to the MCP Registry — previews without `og:site_name` or a card
type. This is the same page-machinery gap as 2026-07-30 finding d.4 (still also
absent from `PAGE_PATHS` and `sitemap.xml`), one surface wider than recorded.

---

## b. Dead code and decomposition residue

### D1. `b64urlToBytes` is genuinely dead

`src/push.js:52`. Exported; referenced nowhere under `src/`, `scripts/`, or
`docs/`. It is the base64url→bytes helper the payload-encryption path would
have needed — and the module header explains that path was deliberately avoided
by sending empty VAPID wake-ups. It is the only export in the repo with zero
references anywhere, internal or external.

### D2. 40 unused imports across 18 modules

Decomposition residue: names imported into a module that no longer uses them.
`SITE` in 13 files; `TZ`, `fmt`, `dayLabel`, `capFirst`, `sunTimes` in
`features/weather.js`; `aqiHealth` in `router.js`; `aqiApiObject` and
`aqiSourceTag` in `mcp/server.js`; seven pollen/tropics/air names plus
`ES_NWS_NOTE`, `fullTime` and `sunTimesForCtDate` in `features/home.js`.

Harmless at runtime — esbuild tree-shakes them — but they assert coupling that
isn't there, which is exactly the thing a reader of a freshly-split codebase
trusts. Neither `node --check`, the dry-run, `check-module-refs.mjs`, nor
`check-renders.mjs` looks for an import in the *unused* direction.

### D3. Five orphaned or misfiled comments left at the cut lines

- **`src/router.js` ends mid-sentence.** The file's last three lines are the
  *back half* of a comment whose front half is now the header above
  `PAGE_PATHS` in `src/index.js`. Read in file order, `router.js` trails off at
  "…consolidate onto one URL for" and `index.js` opens at "`Link:
  rel=\"canonical\"` header in the wrapper below". One sentence, two files,
  neither half readable alone.
- **`src/lib/derived.js` ends with a truncated comment** —
  `// NWS icon URLs carry a ?size= param; bump it for crisper rendering, and` —
  describing `iconUrl()`, which lives in `src/lib/format.js`.
- **`src/discovery.js:186–198`** carries three empty banner pairs
  (`--- Local news ---` / `--- end Local news ---`,
  `--- Crosby ISD school calendar ---` / its end) with nothing between them, and
  a stray `--- end MCP server ---` with no opener, for code that moved to
  `features/` and `mcp/`.
- **`src/pages/privacy.js:102`** has a `// --- Contact page ---` banner sitting
  above `jsonldPrivacy`. This is precisely the misfiling the 2026-07-30 audit
  predicted: it warned that the `PRIVACY`/`CONTACT` content objects sat under
  duplicate banners 300 lines from their render functions, and that "a naive
  banner-to-banner cut would split those pages across two modules." The cut
  landed the code correctly and brought one wrong banner along.
- **`src/push.js`** repeats its module header almost verbatim immediately below
  itself — the same paragraph about empty VAPID wake-ups, twice.

### D4. Three stale comments that survived the refactor

All three were listed in the 2026-07-30 audit and are unchanged:

- `src/router.js:933` and `src/features/home.js:31` both say the hub loads "all
  four datasets". It loads **five**: weather, water, news, calendar, tropics.
- `src/router.js:723` — the comment above the `/water` branch reads "Crosby ISD
  school calendar — rendered from the cached iCal feed", copy-pasted from
  `/calendar`.
- `src/chrome.js` — `topbar`'s doc comment still contains escaped backticks
  (`` \`current\` ``) inside a `//` comment, where the escapes are meaningless.
  A leftover from when the text lived inside a template literal.

---

## c. Documentation drift

### Doc1. 31 doc files still name a router that no longer exists

`docs/pages/*.md` and `docs/endpoints/**/*.md` describe each route as
`_fetch → page === "/x"`. `_fetch` does not appear anywhere under `src/` — it
became `routeRequest()` in `src/router.js` (PR #137).

What makes this precise rather than general rot: the same files' **module
paths** were updated correctly (they cite `src/features/water.js`,
`src/mcp/server.js`, `src/assets/client-scripts.js`, …). Someone did a
path-update pass and the Route column was not part of it. The repo's own rule —
"a PR that changes a page's handler … MUST update that page's
`docs/pages/<page>.md` in the same PR" — covers exactly this.

### Doc2. CLAUDE.md points at `src/index.js` for code that moved

| CLAUDE.md | Says | Actually |
|---|---|---|
| :372 | ``feelsLikeF`/`feelsLikeRawF` in `src/index.js`` | `src/lib/derived.js` |
| :461 | "`_fetch` strips the prefix before dispatch" | `routeRequest()` in `src/router.js` |
| :587 | ``MCP_SERVER_INFO.version` (`src/index.js`)`` | `src/mcp/server.js` |

### Doc3. Two counting errors in CLAUDE.md

- **:411** — "`fetch()` cold-warms all six." Seven cron-owned keys cold-warm:
  `weather`, `calendar`, `water`, `fishing`, `tropics`, `pollen`, `traffic`.
  Verified by reading all seven `load*()` functions.
- **:433** — the footer links row is given as "Home · About · Developers ·
  Privacy · Contact · Sitemap · View as Markdown". `footer()` renders
  **Emergency** second, right after Home.

### Doc4. "Six hand-maintained places" vs "Five"

CLAUDE.md:593 says six places name the MCP tools. `src/mcp/server.js:11` and
`src/discovery.js:8` both say five. The 2026-07-30 audit already resolved this
— `mcpServerCard()` derives its list from `mcpTools()` and the `initialize`
instructions contain no tool names, so the real hand-maintained set is
`CROSBY_WEATHER_SKILL`, `llmsTxt()`, `DEVELOPERS`, `DEVELOPERS_ES`, README —
five. The code comments were updated during the decomposition; CLAUDE.md
wasn't. Cosmetic: all 13 names currently agree everywhere (section e).

### Doc5. `package.json` still calls this a single-file Worker

`"description": "Live weather and local news for Crosby, Texas — a single-file
Cloudflare Worker."` It is 37 files. This is the last surviving "single file"
claim in the repo (README's was corrected in the CI-gate PR).

### Doc6. README's cron sentence is incomplete

> A 15-minute cron refreshes the cached NWS forecast and alerts (and, on a
> slower cadence, the school calendar, river gauges, and tropical outlook).

Omits fishing, pollen and traffic; and river gauges refresh **every tick**, not
on a slower cadence — only calendar (~6h), tropics (~1h) and pollen (~2h) are
throttled.

### Doc7. `/developers` understates markdown negotiation

> The forecast, hub, water, news, alerts, and calendar pages all support it.

All 20 content pages support it, `/mcp` and `/es/mcp` included — verified by
requesting every one with `Accept: text/markdown` and getting
`text/markdown; charset=utf-8` back.

---

## d. Optional improvements

Not defects. Each is a judgement call with a cost.

### A1. The renderer gate skips the discovery surfaces

`scripts/check-renders.mjs` selects exports matching
`/Html$|Markdown$|^api[A-Z]|Svg$|^jsonld|^mcp[A-Z]/`. That excludes `llmsTxt`,
`robotsTxt`, `sitemapXml`, `openApiSpec`, `agentSkillsIndex`,
`contentSecurityPolicy`, `alertsRss`, `newsRss`, `topbar`, `footer`, and
`renderError`. A `ReferenceError` in any of them would break `/llms.txt`,
`/sitemap.xml`, `/robots.txt`, the CSP header, or *every 502 page*, with all
three CI gates green — the same failure class the script exists to catch.

**Measured, not assumed:** 650 calls into those uncovered exports, both
languages, produced **no ReferenceError**. This is a gate gap today, not a live
bug. Widening the regex (`Txt$|Xml$|Spec$|Rss$|^render|^topbar|^footer`) is a
one-line change.

### A2. Six loaders can no longer reject, so their 502 attribution is stale

`loadWater`, `loadFishing`, `loadTropics`, `loadTraffic`, `loadPollen`,
`loadCalendar` and `loadNews` each catch both the KV read and the cold fetch and
degrade to an empty shape. Only `loadWeather` can still reject. But the router
still wraps each page in `try/catch → renderError(err, "NOAA's river gauges")`
etc.

So those catches can now only fire on a **renderer** bug — in which case telling
the visitor "we couldn't reach NOAA's river gauges" is precisely the
misattribution PR #134 fixed for the generic case. Same for the homepage's five
`.catch()` degradations, four of which are unreachable.

### A3. `linkHeader()` reaches 2 of 19 pages

`/` and `/weather` get the full discovery `Link` set (markdown alternate,
sitemap, api-catalog, service-desc); the other 17 content pages get only the
canonical relation added by the `fetch` wrapper. Its doc comment still says
"for the homepage" — accurate when written, since `/weather` was added later.

Separately, its `rel="alternate"; type="text/markdown"` target is the page's own
URL, identical to the canonical. That is RFC-correct under content negotiation
but carries no information a client can act on; `?format=md` would.

### A4. Trailing-slash variants 404 rather than redirect

`/weather/` → 404, `/es/weather/` → 404. `/es/` is special-cased to the hub;
nothing else is. A one-line normalization before dispatch (or a Cloudflare
redirect rule alongside the existing canonicalization) would turn a class of
crawler and hand-typed 404s into 301s.

### A5. 137 of 311 exports are never imported by another module

Nearly half. This looks like over-exporting, but it is at least partly load-
bearing: `check-module-refs.mjs` builds its universe from *names exported
anywhere under `src/`*, so an unexported local is invisible to it — broad
exporting widens that gate's coverage. Recording it as a conscious tradeoff
rather than a cleanup target; tightening it would silently narrow a CI check.

---

## e. Verified healthy

Recorded so a future audit knows what was measured on this date and can tell a
regression from a first-time look.

**Live surface**

- All 40 content-page URLs (20 pages × en/es) return 200 and are substantive
  (10 KB–42 KB). All 30 non-page routes return 200. An unknown path 404s.
- 121 distinct internal link targets crawled across all 40 pages: **zero
  non-200**.
- All 38 `<loc>` URLs in `sitemap.xml` resolve 200.
- 50 distinct external links checked. Only the two TranStar camera URLs are
  genuinely dead (B1). `www.ehcma.org` returns 403 and `drivetexas.org` times
  out from this sandbox — both look like WAF/datacenter-IP blocking rather than
  rot, and are worth one manual check from a browser rather than a code change.

**Deploy integrity**

- The deployed bundle matches HEAD: `/sw.js` hashes to
  `b8622abe…b6cef0fe`, byte-identical to the local `SW_SCRIPT`; all three CSP
  script hashes on the live header match locally-computed digests of
  `HOME_SCRIPT`, `PUSH_CLIENT_SCRIPT` and `NEWS_ADMIN_SCRIPT`.
- Every inline `<script>` on every page in both languages is CSP-hash
  allow-listed. No external script beyond the allow-listed Cloudflare beacon.
- **695 production events observed via `wrangler tail`** across ~25 minutes:
  zero non-`ok` outcomes, zero error logs, zero exceptions.

**SEO and canonicalization**

- Canonical + reciprocal `hreflang` (en-US / es-MX / x-default) correct on all
  40 pages; every `<link rel="canonical">` matches the page's own URL.
- One-hop canonicalization holds from `http://`, `https://www`, and
  `http://www` — each 301s straight to the apex with the path preserved. The
  apex itself 200s.
- JSON-LD parses on every page that emits it; per-page nodes present where
  documented (`AboutPage`, `ContactPage`, `Dataset` + `WebPage`, `Event` ×25).
- Markup on all 40 pages: exactly one `<h1>`, `<main id="main">`, the skip
  link, the load-bearing `::details-content` nav rule, no duplicate `id`s, no
  `<img>` without `alt`.

**Discovery surfaces**

- **13 MCP tools agree across every surface**: `mcpTools()`, the live
  `tools/list`, `/.well-known/mcp/server-card.json`, `llms.txt`,
  `CROSBY_WEATHER_SKILL`, `DEVELOPERS`, `DEVELOPERS_ES`, README — and the
  published registry listing.
- Registry: `com.crosbynews/weather` is live at **v1.5.0**, `isLatest: true`,
  matching both `server.json` and `MCP_SERVER_INFO.version`. No publish drift.
- Conditional GET works: `/api/weather` and `/news.xml` both return 304 to
  their own ETag.
- `/openapi.json` documents all ten public endpoints; the push and news-admin
  endpoints remain withheld consistently across spec, catalog and `llms.txt`.
- Every endpoint route has a `docs/endpoints/` file, including the
  `.well-known/` subtree and the admin/push endpoints.

**DNS and mail**

- DMARC: `v=DMARC1; p=reject;` with **both** `rua` recipients intact (the
  Cloudflare monitoring address and `security@crosbynews.com`) — the record
  CLAUDE.md warns a naive re-run of `scripts/dmarc.mjs` would clobber.
- All five apex TXT records present, MCP namespace key included.
- Both DNS-AID SVCB records resolve with `AD=true`.

**Localization**

- Heading-level diff across all 20 en/es page pairs surfaces only strings that
  are English *by policy*: NWS alert event names ("Heat Advisory", "Air Quality
  Alert"), place names ("Lake Houston", "Cedar Bayou"), `PM10`, and upstream
  TranStar incident text. No untranslated UI chrome.
- 12 `T(lang, en, es)` calls have identical arguments; all 12 are legitimately
  identical (`AQI`, `AirNow`, `Open-Meteo`, `Temp`, `Radar`, `Normal`,
  `National Allergy Bureau`, `Crosby, Texas`).

**Behavior**

- The three CI gates pass locally: syntax (37 files), cross-module references
  (311 exported names, no unimported use), renderers (130 calls, both
  languages).
- `scripts/test-sw-offline.mjs` passes: 6 storm-critical entries precached,
  `/alerts` and `/es/alerts` served from cache with the server down, uncached
  routes falling back to the correct-language hub.
- Admin surface gated: `POST /api/news/delete` with a wrong key → 401;
  `/news?admin=<wrong>` renders the ordinary public page with the ordinary
  cache header.
- **Not a bug, checked because it looked like one:** `airQuality.nearbyMonitor`
  read `null` at 20:41 UTC and populated (Channelview C15, AQI 30) after the
  next cron tick. `fetchNearbyOzone()` queries a 3-hour window truncated to the
  hour, so a reading AirNow has not yet posted legitimately yields no row, and
  the card correctly hides itself. Working as designed.

---

## f. Recommended order

1. **B1** — the only user-visible breakage; a one-word host change.
2. **B4, B5, B3** — discovery-surface omissions, each a few lines. Fold the
   `/sitemap` page into CLAUDE.md's "Adding a public endpoint" checklist so B5
   cannot recur, and lift `airQuality` into a shared OpenAPI component so B3
   cannot be half-fixed.
3. **Doc1** — 31 files, mechanical (`_fetch` → `routeRequest`), and it is the
   repo's own same-PR rule being visibly unmet.
4. **D1–D4 + Doc2–Doc7** — one sweep. Nothing here changes rendered bytes.
5. **B6, B2** — both need a decision, not just an edit. B6: does `/mcp` join
   `PAGE_PATHS` and `sitemap.xml`, or is it deliberately outside the page
   machinery (in which case `docs/pages/mcp.md` should say so about Open Graph
   too, as it already does about JSON-LD)? B2: what should `/api/health` call
   unhealthy — a stale threshold, a failed KV read, or both?
6. **A1** — cheap, and it closes a gate gap in the direction the last two
   production incidents came from.
