# `/fishing` — fishing-water conditions

Live USGS water conditions for the waters people actually fish near Crosby.

| | |
|---|---|
| **Handlers** | `fishingHtml(data, lang)` / `fishingMarkdown(data, lang)` — `src/features/fishing.js` |
| **Route** | `routeRequest` (`src/router.js`) → `page === "/fishing"` |
| **Spanish** | `/es/fishing` |
| **Cache** | `public, max-age=300` |
| **Negotiation** | `Accept: text/markdown` or `?format=md`; `Vary: Accept` |
| **Nav label** | "Fishing" / "Pesca" (`m-only` — mobile menu, under Weather) |

## Content blocks

| Block | Source |
|---|---|
| Station cards grouped by water body (`fishingGroups`) | `fishing` KV |
| Per-station metrics (`fishingMetrics`) — water temp (°F), dissolved oxygen, pH, turbidity, gage height | `fishing` KV `params` |
| Dissolved-oxygen badge (`fishingState`) — > 6 healthy, 4–6 moderate, < 4 low | derived from `params.do` |
| Honest-labeling note (`fishingNote`) — nearby station, not the exact hole; conditions, not a guaranteed bite | static |
| TPWD license + water-safety note linking `/water` | static |
| Per-station link to the USGS monitoring-location page | `usgsSiteUrl(id)` |

**Location selection is fishing-first, not data-first.** Only waters people fish,
each matched to its nearest USGS station. Lake Houston (three in-lake stations
including FM 1960), the San Jacinto forks and the Trinity at Liberty carry the
full water-quality suite. Cedar Bayou, Luce Bayou and the San Jacinto below the
lake are fished but have only a stage gauge, and render as "water level only".

Industrial sites that are physically *closer* — Lynchburg Reservoir, the SJRA
canal — are deliberately excluded. Nearest data is not the same as a place people
fish.

## Data

Cron + KV, key `fishing`, cron-owned, refreshed **every tick** (USGS instantaneous
values post about every 15–30 minutes).

`fetchFishing()` makes **one** call to `waterservices.usgs.gov/nwis/iv/` for all
`FISHING_SITES` — the keyless legacy service, not the newer keyed API. Parameter
codes via `USGS_PARAMS`: `00010` → `tempC` (converted with `cToF`), `00300` → DO,
`00400` → pH, `63680` → turbidity, `00065` → gage height. `usgsNum()` filters
USGS's `-999999` no-data sentinel and empty strings.

The legacy service intermittently returns 503 (observed in production), and
because it's one bulk request for all 9 stations, a 503 costs the whole batch
for that tick, not just one station. `fetchUsgsIv()` retries once, after a
1.5s delay, on 503 or 429 before giving up — anything else still fails fast.

It **throws when nothing usable comes back**, so a total USGS outage skips the
write and the last snapshot survives — the same pattern as `/water`.
`loadFishing()` cold-warms.

On throw: `renderError`, 502.

## Canonical & sitemap

- Canonical `https://crosbynews.com/fishing` · Spanish `/es/fishing`
- `hreflangTags("/fishing")`
- In `PAGE_PATHS` → `Link: rel="canonical"`
- `sitemap.xml`: yes — `changefreq: hourly`, `priority: 0.6`, no `lastmod`

## Meta

- Per-language title and description built in `fishingHtml`
- OG title/description/type/url + `OG_COMMON`
- JSON-LD: `JSONLD_SITE` only
- `<link rel="manifest">`, favicon

## CSP

No inline script.

## Locale

Metric labels, badges and page copy through `T()`. USGS station names stay in
their official English.
