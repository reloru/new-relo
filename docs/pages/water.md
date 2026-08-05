# `/water` — river & bayou levels

Live flood gauges for the waters that flood Crosby and NE Harris County.

| | |
|---|---|
| **Handlers** | `waterHtml(data, lang)` / `waterMarkdown(data, lang)` — `src/features/water.js` |
| **Route** | `routeRequest` (`src/router.js`) → `page === "/water"` |
| **Spanish** | `/es/water` |
| **Cache** | `public, max-age=300` |
| **Negotiation** | `Accept: text/markdown` or `?format=md`; `Vary: Accept` |
| **Nav label** | "Water Levels" / "Niveles de agua" |

## Content blocks

| Block | Source |
|---|---|
| Per-gauge cards — name, colored flood-category badge, observed stage (ft), flow (cfs), threshold line, context line | `water` KV |
| Safety note — 911, turn around don't drown | static |
| Per-gauge link to the official NWPS page | `nwpsGaugeUrl(lid)` |

Gauges (`WATER_GAUGES`, NWPS location IDs): Cedar Bayou nr Crosby, San Jacinto R
nr Sheldon, San Jacinto R at Lake Houston, Luce Bayou nr Huffman, Goose Creek,
E Fork San Jacinto.

**The badge is NWPS's own `floodCategory`** — Normal → Action → Minor → Moderate
→ Major, via `waterCatLabel` / `waterCatClass`. We never invent a classification.
Reading and thresholds come from the same gauge datum, so they are directly
comparable and are never mixed across data.

`-9999` (undefined threshold) and `-999` (no forecast) are NWPS sentinels,
filtered by `waterNum()` so they never render as numbers. Flow is stored in
kcfs upstream and converted by `waterFlowCfs()`.

## Data

Cron + KV, key `water`, cron-owned, refreshed **every tick** (levels move fast in
a flood). `fetchWater()` pulls each gauge from
`api.water.noaa.gov/nwps/v1/gauges/{lid}` — public, no API key.

**Per-gauge try/catch**, and `fetchWater()` throws only if *every* gauge fails.
A total NWPS outage therefore aborts without writing, and the last good snapshot
survives. `loadWater()` cold-warms on a missing or stale-shaped entry.

USGS reserve keys (`USGS_API_KEY`, `USGS_ACCOUNT_ID`) exist as Worker secrets but
are **unused** — `/fishing` reads the keyless legacy USGS service instead. They
are held for a possible future move to the keyed API.

On throw: `renderError`, 502.

## Canonical & sitemap

- Canonical `https://crosbynews.com/water` · Spanish `/es/water`
- `hreflangTags("/water")`
- In `PAGE_PATHS` → `Link: rel="canonical"`
- `sitemap.xml`: yes — `changefreq: hourly`, `priority: 0.7`, no `lastmod`

## Meta

- Per-language title and description built in `waterHtml`
- OG title/description/type/url + `OG_COMMON`
- JSON-LD: `JSONLD_SITE` only
- `<link rel="manifest">`, favicon

## CSP

No inline script.

## Locale

Flood-category labels via `waterCatLabel(cat, lang)`; page copy via `T()`. Gauge
names stay in NWPS's official English.
