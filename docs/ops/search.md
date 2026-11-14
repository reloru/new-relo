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

## IndexNow (removed)

The Worker submitted changed pages to IndexNow from 2026-11-11 (#263) until
2026-11-13.
Both endpoints answered every submission from the Worker with 429 (issue
#274: Workers share egress addresses), and the owner links the site to search
engines another way, so the submitter, its key file (`/<key>.txt`, now 404),
the `indexNow` field on `/api/health` and the per-page signal counts were
removed. The KV key `indexnow_state` is left orphaned (`/kv`). Don't re-add
IndexNow without asking the owner.

## Tested

`scripts/test-freshness.mjs` ("Check freshness signals" in CI): every page in
both languages and both representations revalidates with its own ETag and not
with another's; changed data invalidates the old tag; data pages send
`Last-Modified` and static ones do not; no page contains a relative time;
sitemap dates equal `changedAt` and do not move on a no-change re-fetch; the
old IndexNow key file answers 404; and, with every `data-nosnippet` element
removed, no page leaves a temperature, gauge reading or live status quotable
while each guide still is.
