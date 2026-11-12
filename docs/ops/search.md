# Search: what crawlers are told, and why

Current expected state of everything the site says to a search engine about
itself. Overwritten in place — no history; see `docs/README.md`.

## The problem this is built around

The data refreshes every 15 minutes. A crawler revisits a page every few days
at best (measured from Cloudflare's edge logs in November 2026: Google fetched
roughly a dozen of the 42 pages in a month). So the copy of a page that a
search result or an AI answer is built from is **days to weeks old**, and
anything on it that reads as "now" is, by then, wrong.

The site therefore does two things: it keeps a record that does not go stale
(`docs/ops/record.md`), and it is exact about *when* on everything else.

## Freshness signals

| Signal | Where | Rule |
|---|---|---|
| Visible stamps | `dateStamp()` / `clockStamp()` / `timeTag()` (`src/lib/format.js`) | Every "updated" a person can read is wrapped in `<time datetime="ISO">`. Each page has at least one stamp with a full date. **No relative times** ("10 min ago") anywhere in a page: they are true only at the instant of rendering |
| `ETag` + `304` | `servePage()` (`src/router.js`) | A SHA-1 digest of the exact bytes being sent, per representation. Correct by construction — nothing has to know which inputs a page depends on. `If-None-Match` with the current tag gets a body-less 304 |
| `Last-Modified` | `servePage()` | The newest `updated` among the datasets the page loaded. A static page sends none rather than a guess |
| `<lastmod>` | `sitemapXml()` (`src/discovery.js`) | The newest `changedAt` among the page's `feeds` (`src/registry.js`) in the cron's status record — the moment the data's *content* last changed, which a re-fetch of identical data does not move. Static pages carry no `<lastmod>`. No `<changefreq>` or `<priority>`; Google ignores both |
| IndexNow | `src/indexnow.js`, called at the end of the cron | Submit a page only when its **state** changed, never because its numbers moved |

Google states it uses `lastmod` only while it is consistently accurate, and
that an absent value is better than a guessed one. Both rules above follow
from that.

## What a result may quote (`data-nosnippet`)

One rule, applied by how fast a value goes stale:

| Changes over | Examples | Treatment |
|---|---|---|
| minutes to hours | temperature, forecast periods, the hourly table, active alerts, gauge readings and badges, AQI hero and pollutant tiles, fishing readings, traffic incidents, tropical status, the burn-ban page's wind/humidity strip | inside `data-nosnippet` — never quotable |
| a day | the pollen count | quotable, and printed with its full date in `<time>` |
| weeks or longer | burn-ban status (with "in effect since"), flood stages, lane-closure schedules, every guide and explainer | quotable — this is the content a result should show |

Until 2026-11-12 it was the other way round: the guides were excluded and the
live numbers were the only quotable text, on the reasoning that "the live
status should win the snippet". For a status that holds for weeks (the burn
ban) that reasoning stands and its placement is unchanged; for a temperature it
puts a days-old number in a result as if it were current.

`data-nosnippet` is only valid on `div`, `section` and `span`, so the banners
(which are `<a>`) are wrapped rather than tagged. Meta descriptions are 50–160
characters (enforced by `scripts/test-routes.mjs`) and never contain a live
value.

## Site name

`crosbynews.com` everywhere a machine reads it: `WebSite.name`, `og:site_name`
and the title suffix, with `alternateName: "Crosby News"`. Google picks a site
name from these and falls back to the domain when they disagree.

## IndexNow

Tells Bing (and the engines and assistants that draw on its index) to fetch a
page now. Google does not take part.

| | |
|---|---|
| **Key** | `INDEXNOW_KEY` in `src/indexnow.js`, public by design, served at `/<key>.txt` |
| **Endpoint** | `POST https://api.indexnow.org/indexnow` |
| **State** | KV `indexnow_state`: `{ signals, known, last, pending? }` — `known` is the page list last submitted; `last.attempts` keeps every endpoint's answer |
| **Outcome** | `indexNow` on `/api/health` |

A *signal* is a short string that changes exactly when a page's state does:

| Signal | Changes when | Submits |
|---|---|---|
| `burnban`, `pollen`, `news`, `calendar` | that feed's content hash in `cron_status` changes | the page, both languages |
| `alerts` | the set of active alert ids changes | `/alerts` |
| `water` | any gauge's flood **category** changes (not its level) | `/water`, plus the page of each gauge whose category moved |
| `crests` | NOAA's crest count for a gauge changes (`seen.waterHistory`) | that gauge's page |
| `gaugeWarnings` | the record's river-flood-warning count for a gauge changes (`gaugeWarningCounts()`, set by the cron's record step) | that gauge's page |
| `history` | the record's row counts (`nws_events`, `alerts`) grow | `/history` |
| `tropics` | the set of storms and watched areas changes (not the outlook's issue time) | `/tropics` |

Weather, fishing and traffic change every tick and are never submitted. A feed
not fetched in a tick is "no information", not "changed to empty". The first
run, with no stored state, submits every page once, and so does any later page
missing from `known` (why: "new pages") — a new page is submitted once without
anyone remembering to.

**Two endpoints, tried in order:** `api.indexnow.org`, then
`www.bing.com/indexnow`. The shared endpoint answered the Worker's first
submission with a 429 while accepting the same request from elsewhere —
Workers share egress addresses. A submission that fails on both is kept in
`pending` and retried **hourly, at most six times**, with anything that changed
meanwhile folded in; it is never retried every tick. `/api/health` shows
`indexNow.attempts`, each endpoint's status or error, in order.

## Tested

`scripts/test-freshness.mjs` ("Check freshness signals" in CI): every page in
both languages and both representations revalidates with its own ETag and not
with another's; changed data invalidates the old tag; data pages send
`Last-Modified` and static ones do not; no page contains a relative time;
sitemap dates equal `changedAt` and do not move on a no-change re-fetch; and
IndexNow fires on each state change, on nothing else, falls back and retries
on a refusal; and, with every `data-nosnippet` element removed, no page leaves
a temperature, gauge reading or live status quotable while each guide still is.
