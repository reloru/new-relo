# `/history` — weather warning history

Every National Weather Service event the record holds for Crosby, counted by
type and year. One page, deliberately: no page per alert and no page per
back-filled year.

| | |
|---|---|
| **Handlers** | `loadHistory(env)`, `historyHtml(d, lang)`, `historyMarkdown(d, lang)`, `historyLastmod(env)` — `src/features/history.js` |
| **Route** | `PAGE_HANDLERS["/history"]` (`src/router.js`) |
| **Spanish** | `/es/history` |
| **Registry** | section `weather`, mobile-menu nav "Warning History" / "Historial de avisos" |
| **Cache** | `public, max-age=3600` |
| **Negotiation** | `Accept: text/markdown` or `?format=md`; `Vary: Accept` |
| **Linked from** | `/alerts` (bottom links), each gauge page's warnings section |

## Content blocks (all computed from D1 at request time)

| Block | Query |
|---|---|
| Lede: tornado warnings since 2007-10-01 with their years; severe thunderstorm and flash flood counts; zone warnings by type (two or fewer carry their dates) | `nws_events` |
| Warnings drawn around Crosby, by year (2007 → current year, zeros shown): tornado, severe thunderstorm, flash flood, flood warning, flood advisory, with totals | `scope = 'point'` |
| Every tornado warning that included Crosby, with NWS's issue-time tags | `scope = 'point'`, `TO.W` |
| Severe thunderstorm warnings with a considerable/destructive damage-threat tag | `scope = 'point'`, `SV.W`, `tags` has `damage` |
| Zone products for TXZ213, grouped warnings / watches / advisories / statements: count, first, latest | `scope = 'zone'` |
| Harris County watches | `scope = 'county'` |
| River flood warnings per gauge (linked to the gauge page where one exists) | `scope = 'gauge'` |
| How this is counted | static text with computed dates |

Nothing is hard-coded: a new row changes the page on the next request.

## Limits printed on the page

- One row per NWS event (VTEC key): an extended warning counts once.
- **Years are the Central-time calendar year of `issued`**, not the VTEC `year`
  column (which is UTC-based). A warning at 03:00 UTC on Jan 1 counts in the
  previous year.
- Polygon warnings from **2007-10-01**; 2007 is a partial year and says so.
- Zone products are "issued for TXZ213"; its current "Inland Harris"
  definition took effect **2026-04-16**, so older entries cover whatever the
  zone covered then. The zone record's start date is computed.
- County watches cover all of Harris County; county-coded polygon warnings are
  excluded.
- Tags are what NWS stated at issuance, not what happened.
- Before `RECORD_OBSERVED_FROM` (2026-11-11; river warnings
  `RIVER_WARNINGS_OBSERVED_FROM`, 2026-11-12) events come from the Iowa
  Environmental Mesonet archive, credited on the page and in the footer.

Spanish event names come from the hand-written `ES_EVENT` dictionary keyed on
`phenomena.significance`; anything missing falls back to NWS's English name.

## Data and failure

No `env.DB`, or any D1 error, is a 502 naming "the site's record".

## Dates

`Last-Modified` and the sitemap `<lastmod>` are the newer of `MAX(issued)`
over `nws_events` and `MAX(first_seen)` over `alerts`, via `historyLastmod()`.
Known gap: a back-filled row older than the newest one changes the page
without moving the date; backfills are rare and run by hand.

## IndexNow

The `history` signal is `"<events>|<alerts>"` row counts (`historyCount()`,
read by the cron after its record writes). It only grows, so an alert expiring
does not submit the page; a new row does.

## Meta, CSP

- Title "Crosby, TX Weather Warning History"; description is the registry
  `desc` (no counts in it).
- JSON-LD: `JSONLD_SITE` only. No inline script.

## Tested

`scripts/test-history.mjs` ("Check warning history" in CI): literal counts for
a seeded set, the Central-time year boundary, rare zone warnings dated once,
gauge links, both languages, Markdown, the sitemap date, the links from
`/alerts` and the gauge pages, and a 502 on a D1 failure.
