# "Today at a Glance" — Data Flow & Refresh Investigation (2026-07-10)

Investigation of how the homepage "Today at a Glance" section works end to end,
and of an observed sequence where **Heat Index / Feels Like read 95° → 102° → 95°**
and **Air Quality read 51 → 48** while the section appeared to refresh roughly
every 15 minutes.

Location note: the repo had no docs directory or documented report convention
(CLAUDE.md specifies none), so this lives at `docs/<date>-<topic>.md`.

Evidence tags used throughout: **CONFIRMED** (directly observed, cited),
**INFERRED** (follows necessarily from confirmed evidence), **HYPOTHESIS**
(plausible, not proven), **UNKNOWN** (evidence unavailable; what would resolve
it is stated). File/line references are to `src/index.js` at commit `30a08d1`
unless noted.

---

## 1. Executive Summary

**How the section works.** "Today at a Glance" is rendered entirely
server-side by `todayGlance()` (`src/index.js:1184`) inside the homepage
handler. Every number comes from one KV entry (`weather` key in the `WEATHER`
namespace) that a Cloudflare cron (`*/15 * * * *`) rewrites every 15 minutes
from five upstreams fetched in parallel: NWS daily forecast, NWS hourly
forecast, NWS active alerts, EPA UV, and Open-Meteo AQI
(`fetchWeather()`, `src/index.js:185`). There is no client-side data fetching
for this section; instead, an inline script (`HOME_SCRIPT`,
`src/index.js:814-823`) reloads the whole page every 15 minutes when the tab
is visible — which is why the section "appeared to refresh roughly every 15
minutes" (**CONFIRMED**, both mechanisms cited below).

**Cause of the observed behavior** (confidence: high for AQI, high for the
95° values, medium for the 102° value):

- The observation window is pinned to **≈8:29–9:52 PM CT on July 9** by
  Worker request logs showing a Houston-area residential user repeatedly
  loading `/` at those times (**CONFIRMED**, §4.1).
- **Air Quality 51 → 48 is upstream data movement, not a defect.**
  Open-Meteo's own hourly US-AQI series for Crosby's coordinates reads **51
  for the 8 PM CT hour and 48 for the 9 PM CT hour on July 9** — the cron
  simply picked up the new hour's modeled value at the 9:00 PM tick
  (**CONFIRMED** upstream series; the value's path through the code is
  verbatim).
- **95° and 102° are both real values for that day** — NWS observations
  ~20 mi from Crosby show the heat index was **93–96 during the observation
  window** (95 ≈ correct for "now/rest of evening") and had **peaked at
  102–105 that afternoon** (**CONFIRMED**, §4.3).
- The displayed "Feels like up to" number is a **max over whichever of
  today's hours the latest cached NWS hourly product happens to contain**.
  That window is unstable: NWS regenerates the product on its own lazy
  schedule, the product's first hour can lag the wall clock (documented
  in-repo from user screenshots; re-confirmed live in this investigation),
  and NWS's CDN was **directly observed serving an older product generation
  after a newer one** (04:56 → 04:59 → back to the 04:56 copy) during live
  sampling (**CONFIRMED** mechanism). A snapshot whose hour-window still
  reached back toward the afternoon yields ~102; a snapshot starting at the
  current evening hour yields ~95. The specific product generations served
  at the 8:15–9:45 PM cron ticks were not archived by anyone, so the exact
  95→102→95 sequence cannot be replayed byte-for-byte (**UNKNOWN** residual,
  §4.5) — but the flap is fully consistent with observed upstream behavior
  and requires no implementation defect.
- Separately, this investigation **directly captured** the section changing
  materially with *zero* data change: at the midnight CT rollover, the same
  KV snapshot rendered 7 rows before midnight and 9 rows (including
  "Feels like up to 102°" and "Peak UV 11") after, because the hour filter
  keys on request-time `Date.now()` (**CONFIRMED**, §4.4). Not the cause of
  the 8–10 PM incident, but proof that identical upstream input can produce
  different output purely from render-time behavior.

**Verdict:** no computation bug found. The observed changes are expected
behavior of the current design — a forecast-derived max over an unstable
hour window, refreshed every 15 minutes — plus genuine upstream drift. The
real issues are presentational: the section mixes metrics with different
(and shifting) time bases under one "Today" heading with no timestamp and no
indication that "Feels like up to" is (a) forecast-derived and (b) computed
over a window that silently shrinks/moves during the day (§7, Findings).

---

## 2. Architecture Overview

```
 upstreams (fetched by the Worker cron, every 15 min, in parallel)
 ┌──────────────────────────────────────────────────────────────────┐
 │ NWS daily forecast   api.weather.gov/gridpoints/HGX/75,101/forecast
 │ NWS hourly forecast  api.weather.gov/gridpoints/HGX/75,101/forecast/hourly
 │ NWS active alerts    api.weather.gov/alerts/active?point=29.9119,-95.0608
 │ EPA UV (hourly)      data.epa.gov/efservice/getEnvirofactsUVHOURLY/ZIP/77532/JSON
 │ Open-Meteo AQI       air-quality-api.open-meteo.com/v1/air-quality?...&current=us_aqi,...
 └──────────────────────────────────────────────────────────────────┘
        │  fetchWeather() bundles all five into one JSON object
        │  { updated, place, periods, hourly[48], alerts, uv, aqi }
        ▼
 Workers KV: namespace WEATHER (id da96de7d…), key "weather"
   written by: scheduled() cron (*/15 * * * *)  — src/index.js:6272-6289
              loadWeather() cold-cache warm     — src/index.js:4434-4456
        │  read at request time (env.WEATHER.get(KV_KEY, "json"))
        ▼
 GET / (or /es) handler — src/index.js:6061-6100
   loadWeather() → homeHtml(weather, …) → todayGlance(weather, lang)
        │  HTML string, headers: cache-control: public, max-age=300, x-cache
        ▼
 Cloudflare edge (NO cache rules for HTML; response not edge-cached)
        ▼
 Browser
   · renders the section (server-generated <li> rows; no client data JS)
   · HOME_SCRIPT setTimeout 900000 → location.reload() when tab visible
     (src/index.js:814-823) — the ONLY client-side "refresh" mechanism
```

Evidence for the non-obvious arrows:

- **No client-side data path**: the only scripts on the page are
  `HOME_SCRIPT` (auto-reload + service-worker registration + WebMCP tool
  registration; the WebMCP tools call `/api/weather` only when an agent
  invokes them) — `src/index.js:814-864`, included at `:1084` (weather page)
  and `:1468` (homepage). No fetch/XHR updates the glance DOM. **CONFIRMED.**
- **No edge caching of the HTML**: the zone has no `http_request_cache_settings`
  ruleset (zone rulesets list: only sanitize / managed-WAF / ddos_l7 /
  dynamic_redirect phases), and live responses carry no `cf-cache-status`
  header. The `max-age=300` is a browser directive only. **CONFIRMED** (zone
  API + live headers, 2026-07-10).
- **Production code = repo code**: the deployed bundle (downloaded from the
  Workers API, version `a812c6e0`, deployed 2026-07-07T05:30:20Z) contains
  `todayGlance`, `heatIndexF`, `feelsLikeRawF`, `currentHourly`, `fetchUv`,
  `fetchAqi` functionally identical to the repo source (differences are
  esbuild artifacts: stripped comments, `__name` wrappers, unicode escapes).
  **CONFIRMED** by direct diff of the downloaded bundle.

### Phase A file/component inventory

| Piece | Where |
|---|---|
| Section renderer (HTML) | `todayGlance()` `src/index.js:1184-1224`; rows injected in `homeHtml()` at `:1327-1338` |
| Section renderer (markdown variant, `?format=md`) | same `todayGlance()` via `homeMarkdown()` `src/index.js:1493-1496` |
| Explainers under the section | `glanceExplainers()` `src/index.js:1228-1272` (static text) |
| Upstream fetch | `fetchWeather()` `:185`, `fetchUv()` `:229`, `fetchAqi()` `:297` |
| Derivations | `heatIndexF()` `:367`, `windChillF()` `:380`, `feelsLikeRawF()` `:387`, `currentHourly()` `:400`, `pop()` `:352`, `uvPeakToday()` `:263`, `uvCategory()` `:271`, `aqiCategory()` `:325` |
| Cache read + cold-warm | `loadWeather()` `:4434-4456` (`KV_KEY` = `"weather"`) |
| Scheduled refresh | `scheduled()` `:6272-6289`; cron `*/15 * * * *` in `wrangler.jsonc:17-19` |
| Homepage route | `:6056-6100` (headers `cache-control: public, max-age=300`, `x-cache: hit|miss-warmed|miss-warmfail`) |
| Client-side refresh | `HOME_SCRIPT` `:814-823` (15-min visible-tab `location.reload()`) |
| Config / flags | `wrangler.jsonc` (KV binding, cron, observability). No env vars or feature flags affect this section; the Worker's only secrets are the Web-Push VAPID keys, which don't touch this path. **CONFIRMED** |

---

## 3. Metric Inventory (Phase B)

All metrics render from the single cached `weather` KV object plus the
request-time clock. "Today" everywhere below means the **America/Chicago
calendar date at render time** (`ctDay` filter, `src/index.js:1185-1187`).
"Today's cached hours" means: entries of the cached 48-entry NWS `hourly`
array whose `startTime` falls on that CT date — which is *whatever portion of
today the latest NWS product happens to contain* (the array starts at the
product's generation hour, so early hours of today age out as the product
regenerates; see §4.5).

| Metric | Source | Endpoint / Retrieval | Source Fields | Transformation Logic | Time Period Represented | Refresh Behavior | Cache Behavior | Evidence |
|---|---|---|---|---|---|---|---|---|
| High | NWS daily forecast | `…/HGX/75,101/forecast` via cron | `periods[].temperature`, `isDaytime` | first `isDaytime` period's temp, verbatim + `°` (`:1189,1195`) | Today's forecast high **until NWS drops the "Today" period in the evening (~6 PM CT), after which it is silently TOMORROW's high** | new value only when cron rewrites KV | KV snapshot; browser max-age=300 | **CONFIRMED**: at 23:56 CT Jul 9 live page showed "High 92°" while KV `periods[0]`="Tonight", first daytime period = "Friday" (Jul 10, 92°) |
| Low | NWS daily forecast | same | `periods[].temperature`, `isDaytime` | first non-daytime period's temp (`:1190,1196`) | tonight's forecast low | same | same | **CONFIRMED** (same snapshot: "Tonight" 79°) |
| Feels like up to | derived from NWS hourly | `…/forecast/hourly` via cron | `hourly[].temperature`, `relativeHumidity.value`, `windSpeed` | per-hour `feelsLikeRawF()` = NWS heat-index (two-step Steadman→Rothfusz, `:367-378`) or wind-chill; **max over today's cached hours**; row hidden unless `feelsMax >= dayP.temperature` (`:1197-1198`) | forecast max over an **unstable window**: the hours of today still present in the latest NWS product (usually ≈now→midnight, can reach back 1+ h) | value changes when cron rewrites KV **or** at midnight CT rollover | same | **CONFIRMED** computation (local replay of `todayGlance` on the live KV snapshot reproduced the live page byte-for-byte); window instability §4.5 |
| Rain chance | NWS hourly | same | `probabilityOfPrecipitation.value` | `pop()` (null→0, rounded); **max over today's cached hours** (`:1199-1200`) | same unstable today-window | same | same | **CONFIRMED**: 2% at 23:56 CT (1 hour left in window) vs 36% at 00:02 CT (full new day), same KV snapshot |
| Wind | NWS hourly | same | `windSpeed` (e.g. "5 to 10 mph"), `windDirection` | regex all numbers from today's hours → min–max range; modal direction (`:1201-1207`) | same unstable today-window | same | same | **CONFIRMED**: "S 5 mph" → "S 0–10 mph" across the same midnight boundary |
| Gusts to | NWS hourly | same | `windGust` | max of parsed numbers over today's hours; row absent if no gusts (`:1208-1209`) | same unstable today-window | same | same | **CONFIRMED** code path; row absent in all live samples (no gusts in product) |
| Humidity | NWS hourly | same | `relativeHumidity.value` of the hour covering `Date.now()` | `currentHourly()` picks the period straddling now (`:400-412`); rounded % (`:1210-1211`) | **current hour** (forecast value for it) | changes at every top-of-hour even with unchanged KV, and on cron rewrite | same | **CONFIRMED**: 77% at 23:56 → 79% at 00:02, same snapshot (hour rolled) |
| Dew point | NWS hourly | same | `dewpoint.value` (°C) of current hour | °C→°F, rounded (`:1212-1213`) | **current hour** | same as Humidity | same | **CONFIRMED** (75° in all samples) |
| Peak UV | EPA Envirofacts | `data.epa.gov/efservice/getEnvirofactsUVHOURLY/ZIP/77532/JSON` via cron | `DATE_TIME` (CT wall-clock), `UV_VALUE` | parse rows → `{date,hour,value}`; `uvPeakToday()` = **max over ALL of today's rows (past hours included — EPA keeps them)**; hidden when 0 (`:263-268,1217-1218`) | **whole calendar day's** forecast peak | new value when cron rewrites KV; appears/disappears at midnight & when day's rows go 0 | same | **CONFIRMED**: KV snapshot fetched 23:45 CT still contained Jul 9 hours 19–23 (past); "Peak UV 11 (Extreme)" appeared at 00:02 CT from Jul-10 rows in the same snapshot |
| Air quality (modeled) | Open-Meteo air-quality API | `…/v1/air-quality?…&current=us_aqi,…` via cron | `current.us_aqi` (+ per-pollutant sub-AQIs for the dominant label elsewhere) | `Math.round` at fetch (`:306`); displayed verbatim + EPA category band (`:1221-1222,325-333`) | **current hour** of the CAMS-based model (`aqi.time` is top-of-hour; e.g. fetch at 23:45 CT carried `time: "2026-07-09T23:00"`) | new value when cron rewrites KV; model value steps on hour boundaries | same | **CONFIRMED**: live KV `aqi:{usAqi:47, time:"2026-07-09T23:00"}`; upstream hourly series direct-checked (§4.2) |

Cross-metric note (**CONFIRMED** by the table above): one rendered card mixes
four different time bases — current-hour (Humidity, Dew point, Air quality),
whole-day (Peak UV), first-forecast-period (High/Low, which flips to
tomorrow in the evening), and moving-window aggregates (Feels like up to,
Rain chance, Wind, Gusts) — with no per-row labeling of that difference.

---

## 4. Refresh / Cache / State Lifecycle (Phase C) and Incident Analysis (Phase D)

### 4.1 The lifecycle, with real timestamps

- **Trigger — schedule:** deployed cron is `*/15 * * * *` (**CONFIRMED**,
  Workers schedules API, modified 2026-07-07T05:30:21Z). Observability
  aggregation counted **96 cron invocations in the trailing 24 h** — exactly
  4/hour, none missed, all sampled events `outcome: ok` (**CONFIRMED**).
  Cron fires at ~:51s past the quarter-hour (e.g. events at 04:45:51.827,
  02:30:51.826); the KV `updated` stamps land ~2–3 s later (04:45:53.731,
  05:00:54.213) (**CONFIRMED**, logs + live `/api/weather`).
- **Trigger — request:** page loads never refresh data unless the KV entry
  is missing/invalid (`loadWeather()` cold-warm). Every live sample returned
  `x-cache: hit` (**CONFIRMED**), so the warm path was not in play.
- **Trigger — client:** `HOME_SCRIPT` reloads a visible tab every 15 min
  (**CONFIRMED**, `:818-823`). The two 15-minute cycles (reload vs cron) are
  **not phase-aligned** — a reload picks up whatever snapshot is current, 0–15
  min old.
- **Computed vs stored:** upstream values are fetched/stored by the cron;
  all derivations (`feelsLikeRawF`, maxima, `currentHourly` selection, CT-date
  filter, UV peak, categories) run **at render time on the stored snapshot**
  (**CONFIRMED**, code path §2). So a single rendered page = one KV snapshot
  + the render-time clock.
- **Storage & TTLs:** one KV value, no expiration TTL, overwritten each tick.
  Workers KV is eventually consistent (per-edge cached reads up to ~60 s).
  HTML responses: browser cache `max-age=300`, **no edge cache** (§2), no
  ETag on the homepage (the conditional-GET machinery, `conditional()`
  `:4421`, covers only the API/feed endpoints — **CONFIRMED**).
- **Do metrics refresh together?** All values from one page load come from
  one snapshot (single `loadWeather()` read) — but the *upstreams* inside a
  snapshot have their own staleness: the NWS hourly product in the snapshot
  can be tens of minutes old (its `generatedAt`/first-hour lag —
  **CONFIRMED** below), AQI is a top-of-hour model value, UV is a daily
  product. So a page always shows a *coherent snapshot* whose components
  represent different upstream generation times. **CONFIRMED/INFERRED** as
  labeled.
- **Cadence cross-check:** observed "~every 15 minutes" = the `HOME_SCRIPT`
  reload (the visible trigger), sampling the cron's 15-min snapshots.
  Consistent; no mismatch beyond the phase offset. **CONFIRMED.**

### 4.2 Air Quality 51 → 48 — resolved

Open-Meteo's own hourly US-AQI series for Crosby's exact coordinates
(29.9119, -95.0608), retrieved 2026-07-10 05:04 UTC:

```
2026-07-09T19:00 CT  52
2026-07-09T20:00 CT  51   ← "51 (Moderate)" displayed while this was the current hour
2026-07-09T21:00 CT  48   ← "48 (Good)" from the ~9:00 PM CT cron tick onward
2026-07-09T22:00 CT  47
```

The code path is verbatim (`Math.round(current.us_aqi)` → displayed), so the
site's 51→48 is the upstream hour-boundary step. **CONFIRMED** upstream
series + code path; the only caveat is that this series is the model's
current (re-run) view — the live `current.us_aqi` served at 8–9 PM could
have differed by a point (**HYPOTHESIS** that it didn't; resolving would
need a log of the exact fetched values, which nothing records). The
51→48 crossing also flips the EPA category (51 = Moderate, ≤50 = Good),
which is why the label changed too (**INFERRED**).

This anchors the observation window to ≈8–10 PM CT July 9 — independently
corroborated by Worker request logs (**CONFIRMED**): a Houston, TX
residential (Comcast) client browsed the site from 8:29:17 PM to 9:52 PM CT
(01:29–02:52 UTC) — and not at all in the four hours before (a query over
4:00–8:29 PM CT returned zero Houston events), so the session opened at
8:29 PM (its first load carries the service worker's precache signature:
`/`, `/alerts`, `/es`, `/es/alerts`, manifest, favicon fetched in the same
second). The session: `/` at 8:29:17, 8:29:49; **four `/weather` loads in
12 s** at 8:30:10–8:30:22; `/` at 8:30:24–27, 8:32:14, 8:33:07; `/tropics`
8:30:56; `/` 8:53:23, 8:54:34, 8:56:48; `/sitemap` 8:54:44; **`/api/health`
at 8:56:30** (the cache-freshness endpoint — the user was actively checking
freshness); `/` 9:01:37, 9:04:32, 9:37:16, 9:52:21 PM CT.

Mapped against the KV writes (…:54 s past each quarter-hour, **CONFIRMED**
cadence), the session rendered up to seven distinct snapshots
(**INFERRED** mapping):

| Loads (CT) | Snapshot written | AQI hour carried |
|---|---|---|
| 8:29:17–8:30:27 PM | 8:15:54 PM | 20:00 → **51** |
| 8:32–8:33 PM | 8:30:54 PM | 20:00 → **51** |
| 8:53–8:56 PM | 8:45:54 PM | 20:00 → **51** |
| 9:01:37 PM (43 s after the write — inside KV's ≤60 s propagation window, could be either), 9:04 PM | 9:00:54 PM | 21:00 → **48** |
| 9:37 PM | 9:30:54 PM | 21:00 → 48 |
| 9:52 PM | 9:45:54 PM | 21:00 → 48 |

The AQI column matches the reported 51 → 48 exactly (loads through 8:56 PM
showed 51; loads from ≈9:01 PM showed 48). The 95→102→95 sequence fits the
same snapshot ladder — e.g. 95 at 8:29 (8:15 snapshot), 102 in one or more
of the 8:30/8:45 snapshots, 95 again from 9:00 onward — three consecutive
snapshots, ~15–30 min apart, exactly the reported cadence.

### 4.3 The three heat-index values — reconstruction

What each displayed value must have been (mechanically, from §3): the max of
`feelsLikeRawF` over the hours of Thursday July 9 present in the NWS hourly
product cached at that moment, shown only because it was ≥ the first daytime
period's temperature (Friday, 92°, since Thursday's day period had already
rotated out — **INFERRED** from the product's period structure confirmed at
23:45 CT).

Ground truth for the day (KIAH observations, nearest first-order station,
~20 mi from Crosby — **CONFIRMED**, api.weather.gov station obs):

- Afternoon (12:50–4:45 PM CT): heat index **102–105°F** (e.g. 1:53 PM = 102,
  2:05 PM = 105, 3:30 PM = 105).
- Observation window (8:05–9:15 PM CT): heat index **94–96°F**, i.e. ≈95.

So: **95 = the evening's true feels-like** (a fresh product whose
today-window starts at the current evening hour produces exactly this), and
**102 = the afternoon range** (a product whose today-window still reached
back into the afternoon — or an evening-hour forecast briefly revised hot —
produces this). Each of the three observed values independently corresponds
to a snapshot the pipeline could really have served:

1. **First 95 (~8:29 PM, 8:15 snapshot):** product window ≈ 8 PM→11 PM;
   forecast feels-like ≈ 93–96 → 95. Gate: 95 ≥ 92 → shown.
   **INFERRED** (matches observed conditions; exact product not archived).
2. **102 (one or more of the 8:30/8:45 snapshots):** a snapshot whose window
   included hotter hours — either hours reaching back toward the afternoon
   (a lagged/older product generation) or early-evening hours whose forecast
   still carried near-peak values (a 7 PM hour forecast at T≈92/RH≈57 gives
   HI ≈ 102 by `heatIndexF`). See §4.5 for the mechanisms. **HYPOTHESIS** as
   to which; the *value* matches the day's real 102–105 peak
   (**CONFIRMED** that 102 is that range).
3. **Second 95 (from ≈9:00 PM snapshots):** a current-generation product
   again; window ≈ 9 PM→11 PM → 95. **INFERRED.**

### 4.4 Can identical upstream input produce different output? Yes — captured live

At 04:56–04:59 UTC (23:56–23:59 CT Jul 9) the live homepage rendered, from
KV snapshot `updated: 2026-07-10T04:45:53.731Z`:

```
High 92° · Low 79° · Rain chance 2% · Wind S 5 mph · Humidity 77% · Dew point 75° · Air quality 47 (Good)
```

At 05:02 UTC (00:02 CT Jul 10) the same-family snapshot rendered:

```
High 92° · Low 79° · Feels like up to 102° · Rain chance 36% · Wind S 0–10 mph ·
Humidity 79% · Dew point 75° · Peak UV 11 (Extreme) · Air quality 47 (Good)
```

Two rows appeared ("Feels like up to", "Peak UV"), and Rain/Wind changed —
because `ctDay(new Date())` rolled to July 10 and the filter now matched 24
new hours instead of Thursday's last one. A local Node replay of
`todayGlance()` against the byte-identical KV value reproduced the live HTML
rows exactly (**CONFIRMED**, both directly observed). This is the
implementation-behavior half of the answer: the section's content is a
function of (snapshot, render clock), not of the snapshot alone.

(For completeness: the 00:02 render followed the 05:00:54 KV write; the
00:01 local replay used the 04:45 snapshot — both snapshots produced the
same 9 rows, so the row change is attributable to the clock, not the write.
**CONFIRMED** by the replay.)

### 4.5 Candidate mechanisms, each evaluated (Phase D checklist)

| Candidate | Exists in code? | Can affect this output? | Tied to THIS sequence by evidence? |
|---|---|---|---|
| Time-dependent logic / date rollover | Yes — CT-date filter `:1185-1187`, `currentHourly` `:400` | Yes — captured live (§4.4) | **No** for 95→102→95: window was 8:29–9:52 PM CT, not midnight; AQI at midnight was 47, not 51/48. **Ruled out as the incident cause; CONFIRMED as a real behavior.** |
| Forecast-period selection / ordering | Yes — `periods.find(isDaytime)` `:1189`; hourly array order assumed chronological | Affects High/Low semantics + the feels-like gate threshold (92 = Friday's high that evening) | Gate stayed satisfied for all three values (95,102 ≥ 92) — affects visibility, not the number. **CONFIRMED behavior, not the cause.** |
| **Unstable hour-window of the NWS hourly product** | Yes — the array "starts at the product's generation hour"; `todayGlance` takes *all* of today's hours present, past or future | Yes — directly moves the max: today's replay showed the Jul-10 max (102, 3 PM hour) with shoulder hours at 100–101, so ±1–2° revisions or ±1 h of window flip the displayed value | **Strongest hypothesis.** Product lag documented in-repo from user screenshots (fixed for the hero in PR #58, `:394-399` comment: "first period … can lag the real clock by an hour or more"); live sampling caught the *KV* snapshot fetched at 23:45 CT whose first hour was 23:00 (45-min-old window). What's missing: the actual product generations served at the 8:15–9:45 PM ticks (nobody archives them) — **HYPOTHESIS** for the 102, UNKNOWN residual below |
| **NWS CDN serving generations non-monotonically** | N/A (upstream behavior) | Yes — a later cron tick can fetch an *older* product than the previous tick, resurrecting a hotter window | **CONFIRMED as a live behavior of the upstream during this investigation**: direct fetches of `…/forecast/hourly` returned `generatedAt` 04:56:32 → 04:59:35 → **04:56:32 again** within 10 minutes (two CDN cache copies alternating). Tie to the incident window: **HYPOTHESIS** (same UNKNOWN as above) |
| Genuine forecast revision between generations | N/A (upstream) | Yes — same-hour values get re-forecast each generation; the 100–102 cluster means small revisions move the max | Plausible for 95→102 (an evening hour briefly forecast ~102 then corrected); observed evening HI never exceeded 96, so this requires a ~6° transient over-forecast — **HYPOTHESIS**, weaker than the window explanations |
| Fallback / cached intermediates | Yes — `loadWeather` cold-warm `:4445-4453` | Would *refresh* data (miss → refetch), never resurrect old data | All sampled responses `x-cache: hit`; cold-warm also can't produce older values. **Ruled out (CONFIRMED mechanism direction).** |
| Async / race conditions | KV eventual consistency (≤ ~60 s per-edge read cache); cron write vs read race | Only within ~1 min of a write; the 8:29–8:33 PM burst straddled the 8:30:54 write, so *those* loads could mix snapshots | Cannot explain differences between loads 15+ min apart (staleness bound ≪ 15 min). **Partially in play for the burst only (INFERRED); ruled out as the main cause.** |
| Environment / deployment differences | — | — | **Ruled out (CONFIRMED):** deployments API shows the newest deploy is 2026-07-07T05:30:20Z (version `a812c6e0`) — nothing deployed on Jul 9/10; zero error-level Worker logs in the trailing 72 h; single production environment. |

**Remaining uncertainty (UNKNOWN):** the exact NWS hourly product bytes the
cron fetched at 01:15, 01:30, 01:45, 02:00 UTC on July 10. The Worker logs
only invocation metadata (nothing logs the fetched `generatedAt` or the
rendered values), NWS does not expose product history, and the KV key is
overwritten each tick. Resolving it would require any one of: KV write
history (doesn't exist), logging `generatedAt`+`feelsMax` per tick (a cheap
future aid — see Recommendations), or an external archive of HGX hourly
products for that evening.

---

## 5. Cloudflare / Infrastructure Review (Phase E)

Scope kept to the data path: the `crosbynews` Worker, its cron, the
`WEATHER` KV namespace, and HTML cacheability. All **CONFIRMED** via the
Cloudflare API (2026-07-10, 05:0x UTC):

- **Worker deployments:** 10 total; newest `a812c6e0` at 2026-07-07T05:30:20Z
  (a cluster of 4 on Jul 7 tracking PRs #78–80, which touched only the news
  script and docs). No deploy inside or near the Jul 9 evening window.
- **Deployed code:** downloaded and diffed — functionally identical to repo
  `src/index.js` for every function in this data path (§2).
- **Cron:** one schedule, `*/15 * * * *`; 96 invocations in 24 h (aggregation
  query), sampled events all `outcome: ok`, wall time 5–8 s; zero error-level
  log lines in 72 h (so no `Cron weather refresh failed` / EPA / Open-Meteo
  failures in that period — within the limits of log sampling/retention).
- **KV:** namespace `da96de7d…`, key `weather` read directly via the KV API:
  `updated: 2026-07-10T04:45:53.731Z`, then `05:00:54.213Z` after the next
  tick — the 15-min rewrite in action. Value shape matches `fetchWeather()`.
- **Cache:** no cache rulesets on the zone; homepage responses carry no
  `cf-cache-status`; only browser caching (`max-age=300`) applies. KV's
  eventual consistency (≤ ~60 s) is the only distributed-cache effect in the
  path.
- **Env/config:** no Worker environment variables/flags affect this path
  (only the VAPID push secrets exist; unrelated).
- **Request logs:** used to pin the observation window (§4.2). Note Workers
  Logs are ABR-sampled at query time — raw event listings under-return (35
  cron events listed over 72 h) while aggregation queries give true counts
  (96/24 h); both cited accordingly.

## 6. Reproduction (Phase F)

Performed 2026-07-10 04:56–05:33 UTC against the live site (samples retained
in the investigation session; representative values inline above):

- Repeated `GET /`, `GET /api/weather`, direct NWS hourly, and direct
  Open-Meteo fetches every ~3 min across cron ticks (05:00, 05:15, …) and
  the midnight-CT boundary.
- **Reproduced:** (a) the 15-min KV rewrite (`updated` 04:45:53.731 →
  05:00:54.213 → 05:15:53.835);
  (b) a material section change with unchanged data at the CT date rollover
  (§4.4) — the display went from *no* feels-like row to **"Feels like up to
  102°"**, today's real forecast peak; (c) upstream non-monotonic product
  serving: across 8 direct fetches in 21 min, NWS's CDN alternated between
  exactly two product generations (`generatedAt` 04:56:32 and 04:59:35) in
  the interleaved order A B B A B B A B — tonight the two copies carried
  identical forecast values (diffed: 0 value differences, 3 min apart), so
  the alternation was harmless *now*, but the same delivery behavior
  interleaves *differing* generations whenever a forecaster revision or an
  hour rollover lands between two copies — the incident's proposed
  mechanism; (d) exact agreement between
  a local replay of `todayGlance()` on the fetched KV bytes and the live
  rendered HTML.
- **Not reproduced:** the specific 95→102→95 flap. Why: it requires the NWS
  product's today-window/values to shift across ticks during hot daytime
  hours; the sampling window was overnight (feels-like values stable, and
  the "max" hours of Jul 10 are all still in every product's window until
  afternoon). What would be needed: the same sampling harness run across
  several afternoon/evening cron ticks (any hot day), watching `feelsMax`
  per snapshot alongside each product's `generatedAt` — or the per-tick
  logging recommended below.

## 7. UI/Copy Consistency (Phase G) and Findings

**Findings** (F1–F6; none are computation bugs):

1. **F1 — "Feels like up to" has an unstable, undisclosed time basis.**
   It reads as "today's max feels-like" but is actually "max over the hours
   of today still present in the latest NWS hourly product" — a window that
   shrinks through the day, can lag backward into past hours, and can jump
   between cron ticks when the upstream serves a different generation
   (§4.5). The label, and the feels-like explainer (`:1230-1237`), say
   nothing about forecast-basis or window. **CONFIRMED** (code + live
   captures). This is the direct enabler of the 95→102→95 experience: each
   number was honest for its snapshot; the row's meaning moved between
   snapshots.
2. **F2 — "High" silently becomes tomorrow's high in the evening.** After
   NWS rotates out the "Today" period (~6 PM CT), `periods.find(isDaytime)`
   is tomorrow; at 11:56 PM Thu the live page showed "High 92°" — Friday's
   forecast — under "**Today** at a Glance". **CONFIRMED** (§3 row 1).
3. **F3 — one card, four time bases, no labeling.** Current-hour (Humidity,
   Dew point, Air quality), whole-day (Peak UV), evening-shifted first-period
   (High/Low), moving-window aggregates (Feels like/Rain/Wind/Gusts) are
   visually identical rows; the card carries no "Updated" stamp (the hero's
   stamp is outside the card). A reader reasonably parses all of them as
   live "now" readings. **CONFIRMED** presentation; the misread is the
   likely origin of this incident report. (The AQI "modeled" labeling, by
   contrast, is accurate and consistently applied — hero label, row label,
   explainer, `/about`, API flag. **CONFIRMED.**)
4. **F4 — the midnight rollover makes the section jump with no data change**
   (rows appear; Rain chance 2%→36%; Wind range widens) — startling to
   anyone watching, though defensible behavior. **CONFIRMED** live (§4.4).
5. **F5 — single-degree sensitivity of the displayed max.** Today's snapshot
   has feels-like 100/101/101/101/102/100/101 across midday hours — a ±1°
   upstream nudge changes the headline number. Cosmetic volatility inherent
   to `Math.max` over rounded per-hour values. **CONFIRMED** (replay output).
6. **F6 — nothing records what was served.** No per-tick log of the
   product's `generatedAt`, the computed `feelsMax`, or the AQI value —
   which is why this incident can be explained but not replayed
   byte-for-byte. **CONFIRMED** (grep: the scheduled path logs only errors).

## 8. Recommendations

Only where a Finding supports one; each with risk/confidence:

1. **(F1, F6) Log one structured line per cron tick** — e.g.
   `console.log(JSON.stringify({generatedAt, updateTime, firstHour, feelsMax, usAqi}))`
   in `scheduled()`. Zero user-facing risk; observability is already enabled;
   turns any future flap report into a lookup. Confidence this resolves the
   forensic gap: high.
2. **(F1) Stabilize the feels-like window.** Either (a) pin the max to the
   *full* CT day by retaining today's already-elapsed hours across refreshes
   (merge cached past hours with the new product before overwriting KV), or
   (b) explicitly compute over now→midnight and label it "rest of today".
   (a) makes the number monotonic-ish within a day (a true daily max);
   (b) is honest about the shrinking window. Low risk either way; (a)
   touches the KV write path so needs the usual live verification.
   Confidence this removes the flap class: high for the window component;
   upstream *revisions* will still move forecast values (correctly).
3. **(F2) In the evening, either relabel High as "Tomorrow's high" (NWS's own
   period name is available) or drop the row once the "Today" period is
   gone.** Small, localized change in `todayGlance`. Low risk. Confidence: high.
4. **(F3, F4) Add a per-card "Updated <time>" stamp and, for the aggregate
   rows, a one-word basis hint** (e.g. "Feels like up to (rest of today)",
   "Peak UV (today)", "Humidity (now)") — or fold the basis into the
   existing explainers. Presentation-only. Low risk. Confidence that it
   prevents the "why did it change?" misread: medium-high (users may not
   read hints, but the incident becomes self-explaining).
5. **(F5) Optional: smooth the headline max** (e.g. display the max of the
   top-2 hours, or round to 5°). Trades precision for stability; only worth
   it if the volatility keeps generating reports. Confidence/necessity: low —
   recommend against for now, since honesty-to-source is a site principle.

No recommendation for the AQI behavior: 51→48 was the model doing its job,
and the "modeled" labeling is already correct (F3's stamp/hint covers the
rest).

## 9. Evidence Quality (Phase D/G roll-up)

**CONFIRMED** (direct observation, all cited above): section render path and
its single-KV-snapshot input; absence of client-side data refresh; the
15-min `location.reload()`; deployed cron `*/15` and 96/24 h execution with
`outcome: ok`; KV write timestamps (`04:45:53.731` → `05:00:54.213`); no
edge-cache rules and no `cf-cache-status` on responses; deployed bundle ≡
repo source for this path; last deploy 2026-07-07 (none in the incident
window); zero error logs in 72 h; the Houston/Comcast `GET /` sequence
8:29–9:52 PM CT Jul 9; Open-Meteo hourly AQI 51 (20:00 CT) → 48 (21:00 CT)
Jul 9; KIAH heat index 102–105 afternoon vs 93–96 in the window; the
midnight same-data render change; local replay ≡ live HTML; NWS
`generatedAt` non-monotonic within 10 min; EPA product retaining past hours;
the feels-like gate, window filter, and every transformation in §3.

**INFERRED:** each 95 reading = a current-generation product window (from
observed conditions + code); the 8:29–8:33 PM burst could mix two snapshots
(straddled write + KV consistency bounds); the AQI category label change
(band math); page-level coherence of any single render.

**HYPOTHESES (open):** which exact mechanism put ~102 into a mid-window
snapshot — stale/lagged product window (favored), non-monotonic CDN copy
(observed tonight, unproven for that window), or a transient hot revision of
an evening hour (least favored, contradicts observations by ~6°); that the
live `current.us_aqi` served at the time equaled today's archived 51/48.

**UNKNOWN / missing evidence:** the NWS hourly product bytes fetched at the
01:15–02:00 UTC Jul-10 cron ticks (would settle the 102 mechanism); the
user's exact screenshots and which element they read — the session logs show
they viewed both `/` (glance row "Feels like up to") and `/weather` (hero
"Feels like", current-hour, ±3° gated). The reconstruction assumes the
glance row; a hero reading of 102 would additionally require the *current*
evening hour's forecast to have run ~6° above what was being observed —
possible for a forecast, but the glance's window mechanics explain 102
without that stretch. Also unobserved: whether EPA's intraday UV product
ever drops morning hours (its evening product retained them; afternoon
behavior unobserved).

---
*Investigation performed 2026-07-10 ~04:55–05:35 UTC on the live site,
Cloudflare account APIs, api.weather.gov, data.epa.gov, and
air-quality-api.open-meteo.com, from repo commit `30a08d1`.*
