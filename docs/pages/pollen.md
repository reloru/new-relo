# `/pollen` — pollen & mold count

The Houston Health Department's measured daily pollen and mold count — a directly
measured, Crosby-area-relevant number, not a model.

| | |
|---|---|
| **Handlers** | `pollenHtml(data, lang)` / `pollenMarkdown(data, lang)` — `src/features/pollen.js` |
| **Route** | `routeRequest` (`src/router.js`) → `page === "/pollen"` |
| **Spanish** | `/es/pollen` |
| **Cache** | `public, max-age=1800` |
| **Negotiation** | `Accept: text/markdown` or `?format=md`; `Vary: Accept` |
| **Nav label** | "Pollen" / "Polen" (`m-only`, under Weather) |

## Content blocks

| Block | Source |
|---|---|
| Four category-colored cards — tree, weed, grass pollen + mold spores, each with NAB category and grains/m³ | `pollen` KV `groups` |
| Count-date label ("Count for Friday, Jul 10") | `pollen.countDate` via `pollenDateLabel` |
| "What's in the air" species breakdown, per genus | `pollen` KV `species` |
| NAB threshold table (thresholds differ per group) | static |
| Evergreen Gulf Coast allergy-calendar guide | static |
| Link to the HHD source page | `pollen.url` |

**Categories are republished verbatim** from the lab — never reclassified.
`pollenCatRank` is used only for ordering and for deciding whether the MCP
briefing mentions pollen (Heavy or worse).

## Data

Cron + KV, key `pollen`, cron-owned. HHD publishes exactly one count per
weekday morning, so the gate isn't a flat age threshold: the cron skips the
block entirely on Sat/Sun (Central time), and on weekdays fetches only when
the cached entry's `countDate` isn't today's Central-time date yet — "have we
got today's count," not "how long has it been."

There is **no API**. `fetchPollen()` scrapes `houstonhealth.org`: the index page
(`/services/pollen-mold`) lists per-date count pages with slug dates
(`…/houston-pollen-mold-count-thursday-july-16-2026`);
`pollenNewestFromIndex()` picks the newest by slug date (via `pollenSlugDate`),
and `parsePollenCount` reads the four groups plus the per-genus species lists
(the first `<ul>` after each "Major … counted" heading, bounded at `</ul>`).

**URL matching in `pollenNewestFromIndex()` is deliberately permissive, in two
places**, because HHD changes the shape of these URLs without notice:

- the day-year separator is **optional** — HHD publishes both
  `…-july-31-2026` and, from 2026-08-03, `…-august-52026`
- the index href match is **case-insensitive** — HHD serves this section as both
  `/services/…` and `/Services/…`, mixing the two on a single index page

Neither strictness fails loudly. The fetch still succeeds, an older count still
parses, and the page keeps rendering a real but **frozen** count. Both patterns
were strict until 2026-08-05, and between them they hid three days of published
counts while `/pollen` showed July 31 as though nothing were wrong. Let
`parsePollenCount` be the strict gate — it is the one that can distinguish a
real layout change from a cosmetic URL change.

`pollenNewestFromIndex()` is split out of `fetchPollen()` and takes no network,
so the selection is pinned offline by **`scripts/test-pollen-parse.mjs`** in the
required `Syntax check` job: both URL formats, both path casings, the greedy
day/year split on the joined form, and newest-wins regardless of page order.
Fixing only one of the two matchers still yields a wrong-but-plausible answer
(Aug 3 rather than Aug 5), which is why the test asserts the composed result and
not just the date parser.

`fetchPollen()` **throws on failure OR on an unrecognizable layout** (fewer than
2 groups parsed), so neither a transient outage nor a Drupal redesign can wipe
the last good count. `loadPollen()` cold-warms.

Note what that guarantee does and does not cover: it protects the last good
count from being *wiped*, not from going *stale*. A count that stops advancing
is the failure mode this page is most exposed to. `/api/health` now surfaces it:
`feeds.pollen.dataChangedAt` moves only when the cached content actually
changes, so a refresh that keeps re-storing the same count leaves that stamp
sitting still while `lastAttempt` keeps advancing.

**Weekends serve Friday's count**, labeled honestly with the count's own date.
It is never presented as today's.

Worker reachability was canary-verified from the deployed runtime on 2026-07-17 —
200 with a real body, for both the index and a count page.

On throw: `renderError`, 502.

## Canonical & sitemap

- Canonical `https://crosbynews.com/pollen` · Spanish `/es/pollen`
- `hreflangTags("/pollen")`
- In `PAGE_PATHS` → `Link: rel="canonical"`
- `sitemap.xml`: yes — `changefreq: daily`, `priority: 0.6`, no `lastmod`

## Meta

- Per-language title and description built in `pollenHtml`
- OG title/description/type/url + `OG_COMMON`
- JSON-LD: `JSONLD_SITE` only
- `<link rel="manifest">`, favicon

## CSP

No inline script.

## Locale

NAB categories via the `POLLEN_CAT_ES` hand dictionary; group labels via
`pollenGroupLabel`; guide copy via `T()`. **Species and genus names stay in the
lab's official English + Latin** — the same policy as NWS text.

## Related surface

Pairs with `/air` — both answer "what's in the air". Unlike AQI, pollen is not
shown on the homepage glance; it surfaces via `/api/pollen`, MCP `get_pollen`,
and a briefing line only when a group is Heavy or worse.
