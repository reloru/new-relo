# `/rain` — rainfall record

Rain measured by the USGS weather station at the Lake Houston dam (site
08072000, "Lk Houston nr Sheldon, TX", about 5 miles west of Crosby), every
15 minutes since 2024-10-30.

| | |
|---|---|
| **Handlers** | `loadRain(env)`, `rainHtml(d, lang)`, `rainMarkdown(d, lang)`, `rainLastmod(env)` — `src/features/rain.js` |
| **Route** | `PAGE_HANDLERS["/rain"]` (`src/router.js`) |
| **Spanish** | `/es/rain` |
| **Registry** | section `weather`, mobile-menu nav "Rain" / "Lluvia" |
| **Cache** | `public, max-age=900` |
| **Linked from** | `/weather` (lead links), `/water` (bottom links) |

## Content blocks (all summed from D1 at request time)

| Block | Snippet |
|---|---|
| Latest: last hour, last 24 hours, the latest reading's day so far — each window ends at the latest reading, whose time is shown | `data-nosnippet` |
| Rain by month: total, rain days (≥ 0.01 in), wettest day, days recorded / days in month, incomplete days | quotable |
| Wettest days on record (top 10), with the heaviest 15 minutes | quotable |
| The last 31 days, with readings / expected | quotable |
| About these numbers | quotable |

## Data

- **Source:** `api.waterdata.usgs.gov` collection `continuous`, parameter
  `00045`, the station's primary series `c6f1f52bc09c4f81b4a3f99122eff49c`
  ("Weather Station"). A second series that began 2026-07-13 is ignored.
  USGS publishes "decumulated" amounts: the rain in each 15-minute interval,
  provisional until reviewed. Fetched with the Worker's `USGS_API_KEY`.
- **Stored raw:** D1 `rain_readings` (`migrations/0004_rain.sql`), one row per
  interval as published. Nothing is aggregated at write time.
- **Day:** `rainDay()` (`src/record.js`) treats each amount as the 15 minutes
  ending at its time stamp, the usual convention for interval totals, so the
  reading stamped midnight closes the day before. A Central day holds 96
  readings, 92 on the spring-forward Sunday and 100 on the fall-back Sunday
  (`expectedReadings()`, US rule since 2007). Fewer means the day is marked
  incomplete; a gap is never shown as a dry day.
- **Cron:** each tick re-reads the last 26 hours; at 10:00 UTC the last 35
  days, so USGS's revisions land. Record step "rain"; failure shows as
  `record.ok: false`.
- **Backfill:** `scripts/backfill-rain.mjs` (dry run by default, `--apply`)
  loaded the record from 2024-10-30, one request per calendar quarter, using
  the same fetcher and `rainDay()` as the cron. It uses `USGS_API_KEY` from the
  environment; the key's quota is 1,000 requests an hour.

D1 failure → 502 naming "the site's rain record".

## Dates and IndexNow

`Last-Modified` and sitemap `<lastmod>` are the latest reading's time
(`rainLastmod()`). The `rain` IndexNow signal is the count of days on record
with ≥ 0.01 in (`rainDayCount()`): it changes when a day first records rain,
not while totals move.

## Meta, CSP

Title "Crosby, TX Rainfall Record"; description is the registry `desc`;
JSON-LD `JSONLD_SITE` only; no inline script.

## Tested

`scripts/test-rain.mjs` ("Check rain record" in CI): DST reading counts; the
fetcher dropping null and negative amounts, following `next` links, and making
no request for an empty window; the day boundary; the live block, month row,
partial first month, wettest day, incomplete marking and fall-back day from
hand-computed values; both languages, Markdown, sitemap date, the links from
`/weather` and `/water`; 502 on a D1 failure. `test-record` covers the cron
step and its IndexNow signal.
