# `/` — homepage hub

The front page of Crosby: a scannable local dashboard, weather-forward, linking
into every section. Not the full forecast — that moved to `/weather` in the 2026
nav restructure.

| | |
|---|---|
| **Handlers** | `homeHtml(weather, water, news, cal, tropics, lang)` / `homeMarkdown(…)` — `src/index.js` |
| **Route** | `_fetch` fallthrough after every other `page` check; anything else 404s |
| **Spanish** | `/es` (not `/es/`) — same handlers, `lang="es"` |
| **Cache** | `public, max-age=300` |
| **Negotiation** | `Accept: text/markdown` or `?format=md`; `Vary: Accept` |
| **Extra headers** | `Link: linkHeader("/", lang)`, `x-cache`, `x-markdown-tokens` (Markdown only) |

## Content blocks

| Block | Source |
|---|---|
| Hero — "Currently in Crosby, Texas" eyebrow, temp, condition, feels-like, wind spelled out via `dirWord()`, rain chance, NWS `detailedForecast` as the summary, `Updated` stamp | `weather` KV via `loadWeather` — current hour from `currentHourly(data)`, never `hourly[0]` |
| Alerts banner — progressive disclosure: hidden when quiet, compact red banner with count + condensed types + `alertSummaryLine()` for 1–3, count + highest-severity type only for 4+ | `weather` KV `alerts`, ranked by `ALERT_SEVERITY_RANK` |
| Tropics strip (`hubTropicsBanner`) — violet, self-hides when the basin is quiet | `tropics` KV |
| Today at a Glance (`todayGlance` → `{today, now}`) — day outlook (High, Low, Feels like, Rain chance, UV index, Wind, Gusts), then a "Right now" sub-heading over Humidity, Dew point, Air quality | `weather` KV, incl. the folded-in `uv` and `aqi` objects |
| Glance explainers (`glanceExplainers`) — native `<details>`, one per metric, each leading with what/when | static copy + `aqiSourceNote()` for the air-quality one |
| Glance date stamp (`glanceStamp`) and data-source footnote (`glanceSourceLine`) | `weather.updated` + `relTime()` |
| Weather peek | `weather` KV |
| Alerts status card — count or "None" | `weather` KV `alerts` |
| Water card — badge + `Updated` stamp; detail line only when not normal (`hubWaterSummary`) | `water` KV |
| News card | `news` KV via `loadNews` (blocklist-filtered) |
| Calendar card | `calendar` KV |

**Aggregate-row mechanics.** High / Low / Feels like / Rain chance / UV / Wind /
Gusts are max or range over the **remaining** hours of the CT calendar day — past
hours are excluded even when the NWS product still carries them. In the evening,
when NWS drops today's daytime period, the High row relabels to "High tomorrow".
Labels are bare metric names; the time basis lives in the "Right now" group
heading and in each metric's explainer. Rationale:
`docs/investigations/2026-07-10-today-at-a-glance.md`.

**Never render whole alert products here.** One Special Weather Statement once
ate 80% of the mobile page. Full products render only on `/alerts` and
`/weather`.

## Data

Five datasets loaded with `Promise.all`, so one slow source cannot serially block
the front page. Each `.catch`-degrades to an empty shape rather than blanking the
page: `loadWeather` → `{hourly:[], periods:[], alerts:[], updated:null}`,
`loadWater` → `{gauges:[]}`, `loadNews` → `{items:[]}`, `loadCalendar` →
`{events:[]}`, `loadTropics` → `{storms:[]}`.

A throw outside that `Promise.all` renders `renderError` with a 502.

## Canonical & sitemap

- Canonical `https://crosbynews.com/` · Spanish `https://crosbynews.com/es`
- `hreflangTags("/")` — `en-US`, `es-MX`, `x-default` → English
- In `PAGE_PATHS`, so the response also carries `Link: rel="canonical"`
- `sitemap.xml`: yes — `changefreq: hourly`, `priority: 1.0`, `lastmod` present

## Meta

- Title and description are per-language, built in `homeHtml`
- `theme-color` `#0b3d61`; OG title/description/type + `OG_COMMON`; `og:url` = canonical
- `<meta name="msvalidate.01">` — the Bing Webmaster verification, which lives on
  the root because that is the URL Bing has on file. Do not move it.
- JSON-LD: `JSONLD_SITE` only (`WebSite` + `Organization` `@graph`)
- `<link rel="manifest">`, favicon SVG + ICO alternate

## CSP

Inlines `HOME_SCRIPT` (`src/assets/client-scripts.js`) in a `<script>` block — 15-minute auto-refresh, service
worker registration, and WebMCP tool registration (`get_crosby_forecast`,
`get_crosby_alerts` via `navigator.modelContext`, backed by `/api/weather`).

`contentSecurityPolicy()` allow-lists it by SHA-256 of the constant's exact
bytes, computed at runtime from the same constant that is inlined — so the hash
cannot drift from the script. `/` and `/weather` are the only two pages that
carry `HOME_SCRIPT`.

## Locale

`/es` renders the same handlers with `lang="es"`. Short conditions go through the
`ES_SHORT` dictionary; period names, wind, and directions through
`ES_PERIOD`/`ES_WEEKDAY`/`ES_DIR`. The NWS `detailedForecast` used as the hero
summary line **stays in official English** — NWS publishes no Spanish forecast
API — with `ES_NWS_NOTE` explaining why. The language toggle in the topbar links
the paired URL without redirecting.
