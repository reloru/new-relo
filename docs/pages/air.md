# `/air` — air quality

The measured US Air Quality Index for the area that includes Crosby, with a
per-pollutant breakdown and health guidance.

| | |
|---|---|
| **Handlers** | `airHtml(weather, lang)` / `airMarkdown(weather, lang)` — `src/features/air.js` |
| **Route** | `_fetch` → `page === "/air"` |
| **Spanish** | `/es/air` |
| **Cache** | `public, max-age=600` |
| **Negotiation** | `Accept: text/markdown` or `?format=md`; `Vary: Accept` |
| **Nav label** | "Air Quality" / "Calidad del aire" (`m-only`, under Weather) |

## Content blocks

| Block | Source |
|---|---|
| AQI hero, colored by the EPA band (`AQI_BANDS`) | `weather.aqi.usAqi` |
| Per-pollutant sub-index cards (O₃, PM2.5, PM10), dominant flagged, each naming its monitor site | `weather.aqi.subIndices` + `aqi.sites` |
| Category health guidance (`aqiHealth`) | derived from the AQI value |
| "Nearby ozone monitor" card (`nearbyOzoneCard`) — Channelview C15, with timestamp and a native `<details>` "i" expander | `weather.aqi.nearby`; **card hidden entirely when absent** |
| EPA-band "how to read the AQI" table | static |
| Evergreen Gulf Coast ozone / PM2.5 guide — ozone peaks on hot stagnant afternoons; TCEQ Ozone Action Days | static |
| Source note (`aqiSourceNote`) — names the per-pollutant monitors, or says modeled | derived |

## Data

**No KV key of its own and no cron write.** This page renders the AQI object that
`fetchAqi()` already folds into the `weather` cache, so `loadWeather(env)` feeds
it. The dedicated URL exists to give the number a standalone page for search
("Crosby / Houston air quality") and room for the breakdown.

**Measured first, modeled as fallback.** `fetchAqi(env)` tries EPA/AirNow —
`airnowapi.org` `/aq/observation/current/ziplatlong/`, `AIRNOW_API_KEY` Worker
secret — which returns the **closest reporting monitor per pollutant**. So the
page names real TCEQ monitors (e.g. ozone from Baytown Garth, PM2.5 from Baytown
C148, ~8–15 mi). There is no monitor in Crosby itself, and the page says so.

**Why per-pollutant rather than one nearest monitor:** a single station rarely
measures everything. Channelview C15 (~8 mi) reports ozone only, so pinning to it
would hide an elevated PM2.5 reading at a Baytown monitor and understate risk.

Overall AQI is the max of the pollutant NowCast sub-indices; dominant is the one
at that max. When AirNow is unreachable, the key is unset, or the monitors report
nothing, it falls back to **Open-Meteo's modeled** US AQI for Crosby's exact
coordinates (CAMS-based, keyless), labeled "modeled" everywhere it appears.

The nearby-ozone cross-reference (`fetchNearbyOzone`) is a separate
failure-tolerant call to AirNow's **observations-by-monitoring-site** endpoint
(`/aq/data/`) — an active service, not one of the by-zip endpoints retiring in
fall 2026. It attaches only when both it and the headline AQI resolve.

**Endpoint retirement, already handled:** the legacy
`/aq/observation/latLong/current/` endpoint retires 2026-09-30; we migrated to
the June-2026 replacement. Open-Meteo remains the fallback, so any future AirNow
change degrades gracefully and the swap stays localized to `fetchAqiAirNow()`.

On throw: `renderError`, 502.

## Canonical & sitemap

- Canonical `https://crosbynews.com/air` · Spanish `/es/air`
- `hreflangTags("/air")`
- In `PAGE_PATHS` → `Link: rel="canonical"`
- `sitemap.xml`: yes — `changefreq: hourly`, `priority: 0.6`, no `lastmod`

## Meta

- Per-language title and description built in `airHtml`
- OG title/description/type/url + `OG_COMMON`
- JSON-LD: `JSONLD_SITE` only
- `<link rel="manifest">`, favicon

## CSP

No inline script. The `<details>` expander on the nearby-ozone card is native
HTML, deliberately — it needs no JS and so needs no CSP hash.

## Locale

Health guidance and guide copy via `T()`; pollutant names via
`aqiDominantLabel(key, lang)`; band names via `aqiCategory(v, lang)`. Monitor
site names stay in their official English.

## Honest-labeling invariant

Measured-vs-modeled is disclosed everywhere the number appears, via
`aqiSourceTag()` (short — "Baytown Garth monitor" or "modeled") and
`aqiSourceNote()` (the full sentence listing per-pollutant monitors): this page,
the `/weather` hero, the homepage glance explainer and data-source footnote,
`/api/air`, `/api/weather`, and the MCP tools. The disclosure also lives on
`/about`. Unlike UV, AQI is meaningful day and night, so it is never gated.
