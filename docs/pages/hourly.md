# `/hourly` — full hourly forecast

The complete multi-day hourly table, grouped by day. Reuses the cached NWS hourly
data — no extra upstream call.

| | |
|---|---|
| **Handlers** | `hourlyHtml(data, lang)` / `hourlyMarkdown(data, lang)` — `src/features/hourly.js` |
| **Route** | `routeRequest` (`src/router.js`) → `page === "/hourly"` |
| **Spanish** | `/es/hourly` |
| **Cache** | `public, max-age=300` |
| **Negotiation** | `Accept: text/markdown` or `?format=md`; `Vary: Accept` |

## Content blocks

| Block | Source |
|---|---|
| Per-day heading with sunrise/sunset | `sunTimesForCtDate()`, computed in-Worker |
| Hourly table, one section per CT calendar day | `weather.hourly` — all 48 periods |
| Mobile note explaining the folded Feels column | static, shown ≤ 600px |

**Table layout is load-bearing.** `table-layout: fixed` with shared `.c-*` width
classes, so every day's columns align and long condition names wrap whole at
spaces rather than hyphenating.

**Desktop:** six columns including a separate "Feels" / "Sensación" column, which
shows "–" when neither heat index nor wind chill applies.
**Phones ≤ 600px:** the Feels column folds into Temp as `82° (88°)` with an
on-page note, leaving five roomy full-word columns (Rain / "Lluvia" for precip)
instead of six cramped ones.

`feelsLikeRawF()` — the unconditional value — feeds this table, unlike the
prominent single-value spots, which use the gated `feelsLikeF()`.

## Data

`loadWeather(env)`. `fetchWeather` keeps 48 hourly periods; the homepage strip,
the homepage markdown and `/api/weather` each slice to 12, so this is the only
surface that shows the full supply.

On throw: `renderError`, 502.

## Canonical & sitemap

- Canonical `https://crosbynews.com/hourly` · Spanish `/es/hourly`
- `hreflangTags("/hourly")`
- In `PAGE_PATHS` → `Link: rel="canonical"`
- `sitemap.xml`: yes — `changefreq: hourly`, `priority: 0.8`, `lastmod` present

## Meta

- Title "Crosby, TX Hourly Forecast" / "Pronóstico por hora de Crosby, TX"
- Per-language description covering temperature, conditions, precipitation
  chance and wind for the next two days
- OG title/description/type/url + `OG_COMMON`
- JSON-LD: `JSONLD_SITE` only
- `<link rel="manifest">`, favicon

## CSP

No inline script. Inline `<style>` only, covered by `style-src 'unsafe-inline'`.

## Locale

Conditions via `ES_SHORT`; hour labels, weekday names and AM/PM via the
locale-aware `fmt` helpers with `lang`. Column headers translated inline through
`T()`. In the topbar this link is `m-only` — it appears in the mobile hamburger
under Weather, not on the flat desktop bar.
