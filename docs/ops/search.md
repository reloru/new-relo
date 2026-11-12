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

## IndexNow

Tells Bing (and the engines and assistants that draw on its index) to fetch a
page now. Google does not take part.

| | |
|---|---|
| **Key** | `INDEXNOW_KEY` in `src/indexnow.js`, public by design, served at `/<key>.txt` |
| **Endpoint** | `POST https://api.indexnow.org/indexnow` |
| **State** | KV `indexnow_state`: `{ signals, last }` |
| **Outcome** | `indexNow` on `/api/health` |

A *signal* is a short string that changes exactly when a page's state does:

| Signal | Changes when | Submits |
|---|---|---|
| `burnban`, `pollen`, `news`, `calendar` | that feed's content hash in `cron_status` changes | the page, both languages |
| `alerts` | the set of active alert ids changes | `/alerts` |
| `water` | any gauge's flood **category** changes (not its level) | `/water` |
| `tropics` | the set of storms and watched areas changes (not the outlook's issue time) | `/tropics` |

Weather, fishing and traffic change every tick and are never submitted. A feed
not fetched in a tick is "no information", not "changed to empty". The first
run, with no stored state, submits every page once. A submission that fails is
recorded and **not retried** — signals are stored regardless, so a refusing
endpoint is not hit every 15 minutes.

## Tested

`scripts/test-freshness.mjs` ("Check freshness signals" in CI): every page in
both languages and both representations revalidates with its own ETag and not
with another's; changed data invalidates the old tag; data pages send
`Last-Modified` and static ones do not; no page contains a relative time;
sitemap dates equal `changedAt` and do not move on a no-change re-fetch; and
IndexNow fires on each state change, on nothing else, and records a refusal.
