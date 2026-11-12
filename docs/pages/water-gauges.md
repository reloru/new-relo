# `/water/<gauge>` — river-gauge flood history pages

One page per river gauge whose record has content of its own. All four share
one handler, so this one file describes them all.

| Path | Gauge (NWS LID) | Spanish |
|---|---|---|
| `/water/cedar-bayou-crosby` | HCDT2, Cedar Bayou near Crosby | `/es/water/cedar-bayou-crosby` |
| `/water/san-jacinto-sheldon` | SHLT2, San Jacinto River near Sheldon | `/es/water/san-jacinto-sheldon` |
| `/water/lake-houston` | HSJT2, San Jacinto River at Lake Houston | `/es/water/lake-houston` |
| `/water/east-fork-new-caney` | NCET2, East Fork San Jacinto River near New Caney | `/es/water/east-fork-new-caney` |

Luce Bayou (HFFT2) and Goose Creek (GMKT2) have no page: NOAA lists no crests
for them, so a page would be the live card and nothing else. Add one (a `PAGES`
entry with `gauge:`) once the record gives it content.

| | |
|---|---|
| **Handlers** | `loadGaugePage(env, lid)`, `gaugeHtml(d, lang)`, `gaugeMarkdown(d, lang)`, `gaugeLastmod(env, lid)` — `src/features/gauge.js` |
| **Route** | generated in `src/router.js` for every `PAGES` entry with a `gauge` field |
| **Registry** | `src/registry.js`, section `weather`, no nav or footer entry; reached from its `/water` card ("Flood history →") |
| **Cache** | `public, max-age=900` |
| **Negotiation** | `Accept: text/markdown` or `?format=md`; `Vary: Accept` |

## Content blocks

| Block | Source | Snippet |
|---|---|---|
| Lede: gauge id, how many crests NOAA lists and since when, the highest one against today's stages | D1 `gauge_crests` + `water` KV thresholds | quotable |
| Current level: stage, flood-category badge, distance to action stage, reading time | `water` KV | `data-nosnippet` |
| Flood stages defined today | `water` KV thresholds | quotable |
| Highest recorded crests (every crest on the current datum, highest first) with today's-stage comparison, NOAA flow, USGS flow, status | D1 `gauge_crests`, `gauge_peaks` | quotable |
| Crests on an older gauge datum (newest first, never compared) | D1 `gauge_crests.old_datum = 1` | quotable |
| What NOAA says happens at each level (highest first; English on `/es`, marked `lang="en"`) | D1 `gauge_meta.impacts` | quotable |
| River flood warnings for this gauge | D1 `nws_events`, `scope = 'gauge'`, `nwsli = lid` — filed live from NWS flood products since 2026-11-12, IEM archive before | quotable |
| Daily readings recorded by this site (latest 31 days) | D1 `gauge_daily` | quotable |
| About these numbers (method notes) | computed | quotable |

A section with nothing to show is left out (impacts, old-datum crests) or says
so in a sentence (warnings, daily record). Lake Houston defines no flood
stages, so its crest table has no comparison column.

## Rules the page follows

- **Comparisons use today's flood stages**, and the page says so: the stages in
  force when a crest happened may have been different. A crest is described
  against the highest stage it reached, or the lowest it fell short of.
- **Old-datum crests are never compared.** NOAA's `olddatum` flag means the
  number is on a different reference level. Cedar Bayou has 23 of these.
- **A crest NOAA dates without a time arrives as midnight UTC** and is shown as
  that calendar date, never converted to Central (which would move it back a
  day). A crest with a real time is shown in Central time. A genuine crest at
  exactly 00:00 UTC would be shown date-only; none is known.
- **Status** is NWS's crest status, from the letter NWPS sends in its
  `preliminary` field: P Preliminary, O Official, R Record (`crestStatus()`).
  The mapping is inferred: NWS's HydroBase Crest History screen offers exactly
  those three statuses and the field comes from the IHFS `crest.prelim`
  column, but no NWS document prints the letters beside the words. R sits only
  on each gauge's highest crest. An unexpected letter is shown as sent. By the
  owner's decision (2026-11-12) the page carries no note about the mapping.
- **USGS flow** is USGS's annual peak flow (D1 `gauge_peaks`, from
  `api.waterdata.usgs.gov` collection `peaks`), shown beside a crest only when
  that water year's peak falls on the crest's date: NOAA's own date for a
  date-only crest, the Central date for a timed one (`crestDay()`). The column
  appears only when at least one crest in the table has a match. At Cedar
  Bayou the two agencies' Harvey flows differ (NOAA 45,125 cfs, USGS 10,600
  cfs); both are shown, each named. A one-line note explains the column's
  dashes.
- **NOAA crest flow of 0 was stored as NULL** (unknown) by
  `recordGaugeHistory()` and shows as a dash. The two `noFlow` gauges have no
  NOAA flow column (NOAA's figure there is not a measured flow); USGS's own
  peak flows still show where USGS published them (Sheldon, 2021 onward).
- **River flood warnings: live since 2026-11-12, archive before.** The cron
  files them from NWS's own flood products (`recordRiverWarnings()`,
  `docs/ops/record.md`); earlier ones come from the IEM archive. The page says
  both, with the start date (`RIVER_WARNINGS_OBSERVED_FROM`), and prints the
  earliest gauge warning in the record (computed) so a gap before it is not
  read as "no flooding".

## Data and failure

`loadGaugePage()` reads the `water` KV snapshot (degrading to empty like
`/water`) and six D1 queries. **No `env.DB`, or any D1 error, is a 502** naming
"the site's flood record": a page with its history silently missing would be a
wrong page.

## Dates

`Last-Modified` and the sitemap `<lastmod>` are the same instant: the newer of
the gauge's latest reading (`validTime`) and its newest crest. Not the
snapshot's fetch time, which moves every 15 minutes whether or not the page
did. The sitemap reads it through the handler's `lastmod(env)` hook, which
overrides registry `feeds`.

## IndexNow

A gauge's page is submitted when its flood category changes (the `water`
signal, together with `/water`), when NOAA's crest count for it changes (the
`crests` signal), and when a river flood warning is filed for it
(`gaugeWarnings`). See `docs/ops/search.md`.

## Canonical, meta, CSP

- Canonical and hreflang from the page's own path; in `PAGE_PATHS`, so it gets
  the `Link: rel="canonical"` header and the GET/HEAD-only guard.
- Description is the registry `desc` (no live value). Title
  "<gauge>: Flood History and Current Level".
- JSON-LD: `JSONLD_SITE` plus a `BreadcrumbList` (Water Levels › gauge).
- No inline script.

## Tested

`scripts/test-gauge-pages.mjs` ("Check gauge pages" in CI) seeds production
rows and checks literal values: Harvey at Cedar Bayou is "5.59 ft above minor
flood stage", Lake Houston's Harvey crest stays on Aug 29, the old-datum crest
is never compared, impacts sort highest first, Sheldon shows no flow, Spanish
pages link Spanish pages, a D1 failure is a 502, and a newer crest dates the
page in both `Last-Modified` and the sitemap. `scripts/test-routes.mjs` covers
the generic page contract once the page is registered.
