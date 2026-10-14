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

**Two gauges show stage only (`noFlow` in `WATER_GAUGES`).** NWPS reports a
flow for both, but USGS measures nothing it could stand for: HSJT2 (USGS
08072000) is a lake-level gage with no discharge series at all, and SHLT2 (USGS
08072050) is tidal, where USGS's measured flow swings through zero in both
directions while NWPS's figure stays thousands of cfs positive. Where USGS does
measure discharge (HCDT2, HFFT2, NCET2) NWPS's flow matches it.

## Data

Cron + KV, key `water`, cron-owned, refreshed **every tick** (levels move fast in
a flood). `fetchWater()` pulls each gauge from
`api.water.noaa.gov/nwps/v1/gauges/{lid}` — public, no API key.

**Per-gauge try/catch**, and `fetchWater()` throws only if *every* gauge fails.
A total NWPS outage therefore aborts without writing, and the last good snapshot
survives. `loadWater()` cold-warms on a missing or stale-shaped entry.

`USGS_API_KEY` is used by `/fishing` (see `docs/pages/fishing.md`), not `/water` —
this page still reads NWPS, no key needed. `USGS_ACCOUNT_ID` exists as a Worker
secret alongside it but is unused by either page.

On throw: `renderError`, 502.

## Canonical & sitemap

- Canonical `https://crosbynews.com/water` · Spanish `/es/water`
- `hreflangTags("/water")`
- In `PAGE_PATHS` → `Link: rel="canonical"`
- `sitemap.xml`: yes — `changefreq: hourly`, `priority: 0.7`, no `lastmod`

## Meta

- Per-language title and description built in `waterHtml`
- OG title/description/type/url
- JSON-LD: `JSONLD_SITE` only
- `sharedHead(lang)` (`src/seo.js`): viewport, `theme-color` `#0b3d61`, `og:site_name`, absolute `og:image` (`/og-image.png`, 512×512 PNG with type/width/height/alt), `twitter:card`, PNG tab icons, inline 180px PNG `apple-touch-icon`, `<link rel="manifest">`

## CSP

No inline script.

## Locale

Flood-category labels via `waterCatLabel(cat, lang)`; page copy via `T()`. Gauge
names stay in NWPS's official English.
