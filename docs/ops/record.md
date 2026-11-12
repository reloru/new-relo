# The record (D1 `crosby-record`)

Current expected state of everything the site keeps beyond the latest snapshot.
Overwritten in place — no history; see `docs/README.md`.

The KV cache holds *now*: every 15 minutes the cron replaces each key with the
newest reading. The record is the other half. `src/record.js` files each
observation in D1, so what happened yesterday, last month and in 2017 can still
be read — and the pages built on it do not change between a crawler's visits.

| | |
|---|---|
| **Database** | D1 `crosby-record`, bound as `env.DB` (`wrangler.jsonc`) |
| **Schema** | `migrations/0002_record.sql` (plus `0001_hits.sql`, the request counts — `docs/ops/analytics.md`) |
| **Writers** | `src/record.js`, called from `recordTick()` at the end of `scheduled()` (`src/cron.js`) |
| **Backfill** | `scripts/backfill-nws-events.mjs`, run from a session |
| **Health** | the `record` object on `/api/health` |
| **Readers** | the gauge pages, `/water/<gauge>` (`src/features/gauge.js`, `docs/pages/water-gauges.md`); `/history` (`src/features/history.js`, `docs/pages/history.md`) |
| **Tests** | `scripts/test-record.mjs` ("Check the record" in CI); `scripts/test-gauge-pages.mjs` for the pages that read it |

## Rules every writer follows

- **Idempotent.** Each row has a natural key and is upserted. Recording the same
  observation twice changes nothing, so a retry or a replay is always safe.
- **Only what a source published or this site observed.** Nothing is inferred,
  smoothed or filled in. A gap in a feed is a gap in the record.
- **Never in the way.** The cron writes the record after its cache writes, each
  table in its own try/catch. A database failure cannot cost a live page its
  refresh; it shows as `record.ok: false` with the error on `/api/health`,
  which — with Workers Logs off — is the only place it would show.

## Tables

| Table | One row per | Written | Source |
|---|---|---|---|
| `nws_events` | NWS watch/warning/advisory event (its VTEC key: year, office, phenomena, significance, event number) | every tick an alert is active; every tick for new river flood products; backfill | live alerts and NWS flood products (`source = 'observed'`), IEM archive (`'iem'`) |
| `alerts` | alert *message* this site received, with the official text | every tick an alert is active | live alerts |
| `gauge_crests` | historic crest per gauge, as NOAA publishes it | daily (10:00 UTC), or at once when empty | NWPS gauge response |
| `gauge_meta` | gauge: name, USGS id, flood-impact statements | with the crests | NWPS gauge response |
| `gauge_daily` | gauge × Central day: max (and when), min, latest, highest flood category, distinct readings | every tick | the `water` snapshot |
| `pollen_daily` | HHD count date | when a count is fetched, and hourly from the cache | the `pollen` snapshot |
| `aqi_daily` | Central day: highest index seen, its time and pollutant, measured vs modeled | every tick | the `weather` snapshot's `aqi` |
| `burnban_periods` | burn ban: start day, end day, where each date came from | on each burn-ban refresh, and hourly from the cache | the `burnban` snapshot |

### `nws_events.scope` — how an event covered Crosby

| Scope | Meaning | From |
|---|---|---|
| `point` | the warning's polygon contained Crosby's coordinates (tornado, severe thunderstorm, flash flood, areal flood) | live: the alert reached us through a point query. Archive: IEM `sbw_by_point` |
| `zone` | issued for forecast zone TXZ213, which contains Crosby (tropical, winter, heat, fire weather, fog) | live: the alert's UGC list. Archive: IEM `vtec_events_byugc` |
| `county` | issued for Harris County as a whole (tornado and severe-thunderstorm watches) | same, UGC `TXC201` |
| `gauge` | a river flood warning for a forecast point this site tracks (`nwsli`, the NWS LID) | live since 2026-11-12: `recordRiverWarnings()` reads HGX's FLW/FLS products from `api.weather.gov/products` and pairs each VTEC line with the hydrologic VTEC line after it (`/SHLT2.1.ER.…/`), which names the point — the alert API carries no point. Archive: IEM county list, `hvtec_nwsli` |

**Limits to state wherever these are shown:**

- Polygon warnings are recorded from **2007-10-01**, the day storm-based
  warnings became the official warned area. IEM holds earlier polygons, but
  before that date a warning legally covered the whole county, so "the polygon
  included Crosby" says nothing about who was warned.
- Zone products are "issued for TXZ213", and **the zone has been redrawn** (its
  current definition, "Inland Harris", took effect 2026-04-16). An older entry
  covers whatever TXZ213 covered then; coastal flood products in the record
  through 2018 show it once took in shoreline it no longer does.
- County-coded *polygon* warnings are deliberately not taken from the county
  list: most were for some other part of a very large county.
- An event number is unique within the year the event was **issued**. A
  continuation that arrives after New Year is filed under the year that already
  holds the event (`eventYear()`), not the year the message was sent.
- A cancellation or expiration ends an event when that message was sent,
  whatever end time earlier messages stated.
- River flood warnings: products read are remembered in KV `river_products`
  (`{ seen: [product ids], tries: {id: n}, at }`, last 300) and marked read
  only after their rows are written, so a failed tick is retried. At most 20
  products per tick. Each product stands alone: one NWS lists but no longer has
  (404/410) is marked read at once; any other failure is retried for 3 ticks
  and then given up; either way the products behind it are still filed, and
  the tick reports the failure. A
  warning that also reaches the site as an alert keeps `scope = 'gauge'` and its
  `nwsli` (the alert writer never touches scope). Only FL.W for the six tracked
  gauges is filed. Failure shows as `record.ok: false` ("river warnings: …").

### `gauge_daily`

Days are **Central days of the reading's own time**, not UTC days and not the
time we fetched. `readings` counts distinct reading times, so re-recording the
same reading on every tick until the gauge reports again adds nothing. An
out-of-order older reading can raise the day's max or lower its min but never
becomes "latest". `max_rank` is the highest NWS flood category that day: 0 none,
1 action, 2 minor, 3 moderate, 4 major. Flow is in thousand cubic feet per
second, as NWPS reports it in the live reading; crest flow is in cubic feet per
second, as NWPS publishes crests.

### `burnban_periods`

An active ban opens one period, dated by the Forest Service's own start date
when it gives one (`start_source = 'tfs'`), otherwise by the day we first saw it
(`'observed'`). "No ban" closes whichever period is open on the day first seen
lifted (`end_source = 'observed'`) — accurate to the 4-hour refresh. Rows
entered by hand from Commissioners Court orders use `'order'` and carry a `url`.

## Backfill

```bash
node scripts/backfill-nws-events.mjs            # fetch, write SQL, print a summary by type
node scripts/backfill-nws-events.mjs --apply    # …and run it against production D1
```

Fetches three IEM queries (polygons by point, events by zone, events by county),
keeps what each scope allows (table above), and upserts. Safe to re-run: a row
the Worker has since observed keeps `source = 'observed'`. It runs from a
session, never from the Worker — nothing the live site serves depends on IEM
being reachable. Credit on any page that shows this data: Iowa Environmental
Mesonet, Iowa State University.

Gauge crests need no backfill script: they arrive in the NWPS response the cron
already fetches, and the cron seeds them on its first tick.

## Reading it

```bash
npx wrangler d1 execute crosby-record --remote --command \
  "SELECT name, COUNT(*) FROM nws_events WHERE scope = 'point' GROUP BY name"
```
