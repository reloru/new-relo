# `/fishing` — fishing-water conditions

Live USGS water conditions for the waters people actually fish near Crosby,
followed by TCEQ's dated water samples (E. coli, dissolved oxygen, clarity) from
the D1 record.

| | |
|---|---|
| **Handlers** | `fishingHtml(data, lang, samples)` / `fishingMarkdown(data, lang, samples)` — `src/features/fishing.js`; the samples section is `waterSamplesHtml` / `waterSamplesMarkdown` in `src/features/waterquality.js` |
| **Route** | `PAGE_HANDLERS["/fishing"]` (`src/router.js`): loads `{ data: loadFishing(env), samples: loadWaterSamples(env) }`, the samples failure-tolerant |
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
| Water samples: for each of the four TCEQ stations, the latest 6 sampling days (E. coli, oxygen, Secchi clarity in inches), its span on record, a link to its portal page, and the limits list (`waterSampleLimits`). Not `data-nosnippet`: it is the record | D1 `water_samples` |

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

`fetchFishing(env)` makes **one** call to `api.waterdata.usgs.gov`'s
`collections/latest-continuous/items` — USGS's modernized OGC-API-Features
water data service, authenticated with the `USGS_API_KEY` Worker secret
(header `X-Api-Key`) — for all `FISHING_SITES` and every parameter code at
once. Parameter codes via `USGS_PARAMS`: `00010` → `tempC` (converted with
`cToF`), `00300` → DO, `00400` → pH, `63680` → turbidity, `00065` → gage
height. `usgsNum()` filters USGS's `-999999` no-data sentinel and empty
strings. (Previously this called the legacy keyless
`waterservices.usgs.gov/nwis/iv/` service, which intermittently 503'd on this
bulk multi-site request and is being superseded by the API used here —
migrated 2026-08-05.)

USGS can register more than one time series for the same parameter at a site
(different sensors/methods); `latest-continuous` returns one feature per time
series, so the parser keeps whichever feature has the most recent `time` per
(station, parameter) rather than the last one in response order — confirmed
live that Jack's Ditch (Lake Houston) reports multiple time series per
parameter, which a naive last-wins parse would have picked nondeterministically.

`api.waterdata.usgs.gov` can still return a transient 503, or 429 if the
per-key rate limit is ever exceeded (unlikely at ~4 requests/hour); the fetch
retries once, after a 1.5s delay, on either before giving up — anything else
still fails fast.

It **throws when nothing usable comes back**, so a total USGS outage skips the
write and the last snapshot survives — the same pattern as `/water`.
`loadFishing()` cold-warms.

On throw: `renderError`, 502.

### Water samples

TCEQ's samples from four monitoring stations, as the Water Quality Portal
publishes them: Lake Houston at FM 1960 East (`TCEQMAIN-11212`, from 1981),
Cedar Bayou at FM 1960 (`11123`, from 1988) and at US 90 (`11120`, from 1969),
and Luce Bayou at the Grand Parkway (`22429`, from 2023). Stored in D1
`water_samples` (`docs/ops/record.md`), loaded by the cron, read at request time
(`loadWaterSamples()`, which summarizes in `summarizeStation()`).

- **A D1 failure drops only this section**, like `/burn-ban`'s past-bans table:
  the page is live conditions first. While the table is empty the section is
  left out.
- **A sampling day** is one station on one date. A day's measure shows one
  value, or the range low–high when TCEQ published several results that differ
  without saying what separates them (several activities the same day; the
  portal publishes no depth for them). Real case: Lake Houston, 2004.
- **24-hour oxygen deployments.** On 38 days (19 at each Cedar Bayou station,
  1999–2015) one activity holds three unlabeled mg/L oxygen values plus a
  unitless count of 96 or 144 (method "N/A Calculation"). They very probably
  are a day's readings, but nothing labels which value is which. The whole
  day's oxygen is dropped (`dropAmbiguous()`), single readings from the same
  day too, so a 24-hour value is never set beside a daytime one; the day's
  E. coli and clarity are kept, and a day with nothing else is not listed.
  Showing a separate "24-hour low" waits on TCEQ's own procedures confirming
  the meaning.
- **Units.** E. coli is MPN/100 mL (unit "None" plus the comment "TCEQ Unit:
  MPN/100ml." since about 2007), or `#/100mL` (a count) in 2000–2001 at Lake
  Houston; a count is marked "(#)" and kept apart, never merged with an MPN
  (2001 has both). Oxygen is mg/L, dissolved fraction only. Clarity is
  converted to inches from metres. E. coli holding time ("hours") is dropped.
- **No standards.** The page cites no Texas bacteria or oxygen standard and
  says so; none has been verified from a TCEQ primary source.
- The portal carries no `<`/`>` qualifiers (every row "Final", "Actual"), so a
  value at a method's floor is shown as published, and the page says so.
- Station names are hand-translated in `WQ_STATIONS`.

## Canonical & sitemap

- Canonical `https://crosbynews.com/fishing` · Spanish `/es/fishing`
- `hreflangTags("/fishing")`
- In `PAGE_PATHS` → `Link: rel="canonical"`
- `sitemap.xml`: yes — `changefreq: hourly`, `priority: 0.6`, no `lastmod`
- IndexNow: submitted, with the gauge page that shows the station, when a
  station gains a sampling day (`waterSamples` signal, `docs/ops/search.md`)

## Tested

`scripts/test-water-samples.mjs` ("Check water samples" in CI): every station
shown, latest days only, Spanish and Markdown rows, a D1 failure leaving a 200
with the live cards, and no section while the record is empty.

## Meta

- Per-language title and description built in `fishingHtml`
- OG title/description/type/url
- JSON-LD: `JSONLD_SITE` only
- `sharedHead(lang)` (`src/seo.js`): viewport, `theme-color` `#0b3d61`, `og:site_name`, absolute `og:image` (`/og-image.png`, 512×512 PNG with type/width/height/alt), `twitter:card`, PNG tab icons, inline 180px PNG `apple-touch-icon`, `<link rel="manifest">`

## CSP

No inline script.

## Locale

Metric labels, badges and page copy through `T()`. USGS station names stay in
their official English.
