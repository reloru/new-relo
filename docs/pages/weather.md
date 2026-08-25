# `/weather` — full forecast

Current conditions, a 12-hour strip, and the 7-day forecast. This is what the
root served before the 2026 nav restructure; `/weather` is now its canonical
home, and every sub-page's back-link ("← Back to the forecast") points here.

| | |
|---|---|
| **Handlers** | `renderHtml(data, lang)` / `renderMarkdown(data, lang)` — `src/features/weather.js` |
| **Route** | `routeRequest` (`src/router.js`) → `page === "/weather"` |
| **Spanish** | `/es/weather`, same handlers, `lang="es"` |
| **Cache** | `public, max-age=300` |
| **Negotiation** | `Accept: text/markdown` or `?format=md`; `Vary: Accept` |
| **Extra headers** | `Link: linkHeader("/weather", lang)` (markdown alternate, sitemap, api-catalog, OpenAPI service-desc), `x-cache`, `x-markdown-tokens` (Markdown only) |

## Content blocks

| Block | Source |
|---|---|
| Active alerts — compact `alertsBanner()` (count, worst type, one summary line) linking to `/alerts` | `weather` KV `alerts` |
| Hero (`renderHero`) — temp, condition, feels-like, wind, humidity, dew point, UV (gated to UV > 0), air quality with source tag, sunrise/sunset | `weather` KV; current hour from `currentHourly(data)` |
| Spanish-only NWS note (`ES_NWS_NOTE`) | static |
| 12-hour strip (`renderHourly`) | `weather.hourly.slice(0, 12)` |
| 7-day forecast cards (`renderDaily`) — night periods tinted | `weather.periods` |
| Footer link row → `/hourly`, `/radar`, `/water` | static |

## Data

`loadWeather(env)` reads the `weather` KV key; on a missing or stale-shaped entry
it fetches live, warms the cache, and reports `x-cache: miss-warmed` (or
`miss-warmfail` if the write failed). Cron refreshes the key every 15 minutes.

`fetchWeather(env)` fans out in parallel to NWS (`api.weather.gov`, `points` →
`forecast` + `forecastHourly` + active alerts), EPA UV, the AQI chain, and the
nearby-ozone cross-reference. The three non-NWS calls are failure-tolerant — each
degrades to `null` rather than blocking the NWS refresh. 48 hourly periods are
kept; this page slices 12.

Derived in-Worker, not NWS fields: `feelsLikeF()` (heat index / wind chill, shown
only when ≥ 3°F from air temp) and `sunTimes()`.

On throw: `renderError`, 502.

## Canonical & sitemap

- Canonical `https://crosbynews.com/weather` · Spanish `/es/weather`
- `hreflangTags("/weather")`
- In `PAGE_PATHS` → `Link: rel="canonical"`
- `sitemap.xml`: yes — `changefreq: hourly`, `priority: 0.9`, `lastmod` present

## Meta

- Title "Crosby, TX Weather" / "Clima de Crosby, TX" — `crosbynews.com`
- Per-language description naming NWS and the 15-minute cadence
- `theme-color` `#0b3d61`; OG title/description, `og:type: website`, `og:url` = canonical, `OG_COMMON`
- JSON-LD: `JSONLD_SITE` only. **No forecast markup** — no truthful schema.org
  type exists for a forecast, and inventing one is out of policy.
- `<link rel="manifest">`, favicon SVG + ICO alternate

## CSP

Inlines `HOME_SCRIPT` (`src/assets/client-scripts.js`), hash-allow-listed by `contentSecurityPolicy()`. One of
only two pages that carry it (the other is `/`).

## Locale

Same handlers, `lang="es"`. `shortForecast` values are translated through
`ES_SHORT` (compound "X then Y" split on " then " and looked up per segment,
unmapped phrases falling back to English); period names, weekdays, wind and
compass directions through `ES_PERIOD` / `ES_WEEKDAY` / `ES_DIR`.

`detailedForecast` paragraphs and **all alert text stay in NWS's official
English**, with `ES_NWS_NOTE` on the page saying so. NWS exposes no Spanish
forecast or alert API and paused its experimental auto-translation in 2025;
mistranslating a warning is unsafe.
