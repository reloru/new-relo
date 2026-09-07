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

That condition self-limits on a normal weekday (it stops the moment the morning
count lands) but nothing ended it on a day the count never arrives, so it ran all
96 ticks — twice a real case: HHD skips **City of Houston holidays**, and on
2026-09-04 a slug change hid a count that *had* been published. A **1h floor
between attempts** (added 2026-09-06) bounds that. It keys on the last successful
*write*, not the last attempt, because the case being bounded is a fetch that
succeeds and re-stores the same `countDate` — quiet, and persists for days. A
throwing upstream writes nothing and still retries each tick; that one is loud in
`/api/health` (`ok: false` with the error) and transient, so it needs no floor.

There is **no API** — HHD's only structured output is a *monthly*
`pollen-count-archive-YYYYMM.xlsx` linked from the index, which cannot serve
daily freshness. `fetchPollen()` scrapes `houstonhealth.org`: the index page
(`/services/pollen-mold`) lists per-date count pages with slug dates
(`…/houston-pollen-mold-friday-september-4-2026`);
`pollenNewestFromIndex()` picks the newest by slug date (via `pollenSlugDate`),
and `parsePollenCount` reads the four groups plus the per-genus species lists
(the first `<ul>` after each "Major … counted" heading, bounded at `</ul>`).

**`pollenNewestFromIndex()` asserts nothing about what the slug is called.** It
matches any href under `/services/pollen-mold/` (case-insensitively — HHD mixes
`/services/…` and `/Services/…` on one index page) and lets `pollenSlugDate()`
decide what is a count page: a link whose slug ends in a parseable date is one, a
link without one (the section home, pagination, the monthly archive
spreadsheets) is discarded. `pollenSlugDate()` in turn accepts both `…-july-31-2026`
and `…-august-52026` (day-year hyphen optional, greedy so a two-digit day still
wins), and full or abbreviated month names via `pollenMonth()`, which resolves by
**unique prefix** — three characters is the shortest unambiguous prefix across
all twelve months, so `sept` and any other truncation resolve. An ambiguous or
too-short prefix yields **no date** rather than a guessed month: a wrong date
would present a stale count as current, which is worse than showing none.

This is deliberately looser than it needs to be for any one observed format,
because **the slug's wording is the thing HHD keeps changing** — four times in
five weeks, and every time silently:

| Date | What changed | Result |
|---|---|---|
| 2026-08-03 | day-year hyphen dropped (`…-august-52026`) | 3 days hidden, page pinned to Jul 31 |
| 2026-08-05 | some days moved to capitalized `/Services/` | same outage, second cause |
| 2026-08-24 | month abbreviated (`…-mon-aug-242026`) | newest entry invisible; Friday's count served into Monday evening |
| 2026-09-06 | stem lost "count" (`houston-pollen-mold-friday-…`) | Sep 3 + Sep 4 hidden; Wednesday's count served into Sunday |

Each of the first three was fixed by relaxing the one thing that had just
changed, which is why a fourth happened. Selection now depends only on the two
properties that held across all four — under the section path, ends in a date —
so a rename is absorbed with no code change.

**None of this fails loudly.** The fetch succeeds, an older page parses, the KV
entry is rewritten on schedule, and the page renders a real, correctly-labelled,
**frozen** count with `/api/health` reporting the feed `ok`. Let
`parsePollenCount` be the strict gate — it is the one that can distinguish a real
layout change from a cosmetic URL change.

**The species markup is matched with attributes, never as a bare tag**
(`<ul\b[^>]*>`, `<li\b[^>]*>`). HHD's Drupal began emitting
`<li data-list-item-id="…">` on some lists; a bare `<li>` match dropped every
attributed entry, and since the block only renders when a group has species, the
whole "What's in the air" section disappeared from `/pollen` rather than showing
empty. Found 2026-09-06, affecting weed and mold on every count page checked —
including the one already being served, so it predates the slug change. The
`<ul>` lookup is a regex rather than `indexOf("<ul>")` for the same reason and
one worse: an attribute on `<ul>` would make `indexOf` skip *past* the real list
to a later bare one and parse an unrelated block.

**Every one of these was found by a human noticing a date, not by a check** —
which is what `.github/workflows/pollen-watch.yml` now exists to end. It runs
weekdays at 17:00 UTC and compares the date in HHD's human-readable **link text**
against the `countDate` in `/api/pollen`, opening a labelled `pollen-watch` issue
when HHD is ahead. It shares no failure mode with href matching (the link text
mutated on 2026-09-03 too — it lost "Count" — but the date inside it survived all
four renames), and it keys on nothing time-based, so weekends and City of Houston
holidays cannot trigger it. `.github/scripts/pollen-watch.mjs` deliberately does
**not** import from `src/`: reusing the selection code would inherit the bug it
exists to catch.

`stripToText()` in that script reduces HHD's anchor markup to a plain label
before the date parse, and it is **not** a single `replace(/<[^>]+>/g, "")` —
that pattern needs a closing `>`, so an unterminated `<script` is never matched
and passes through into the GitHub issue body verbatim (CodeQL
`js/incomplete-multi-character-sanitization`, high, caught on #218 *after* it
merged). It strips tags to a fixpoint, separates with a space rather than `""`
so nothing re-forms across the seam — which is what `pollenStrip` in
`src/features/pollen.js` always did and this had diverged from — then drops any
surviving angle brackets outright, which is what makes it complete by
construction. Pinned in `scripts/test-pollen-parse.mjs`, which imports the
watchdog for exactly this (its only import from outside `src/`); the script's
CLI is behind an `import.meta.url` direct-execution guard so that import doesn't
run it.

`pollenNewestFromIndex()` is split out of `fetchPollen()` and takes no network,
so the selection is pinned offline by **`scripts/test-pollen-parse.mjs`** in the
required `Syntax check` job: both URL formats, both path casings, full and
abbreviated month names, the greedy day/year split on the joined form,
ambiguous prefixes yielding no date, and newest-wins regardless of page order.
The composed `pollenNewestFromIndex` assertions are the load-bearing ones —
fixing `pollenSlugDate` alone still looks correct, because the entries that do
parse yield a real, correctly-labelled count that is merely days old.
Fixing only one of the two matchers still yields a wrong-but-plausible answer
(Aug 3 rather than Aug 5), which is why the test asserts the composed result and
not just the date parser.

**That suite stayed green through the 2026-09-06 outage**, because every fixture
in it embedded `houston-pollen-mold-count` — the exact stem that had just
changed. A test built from the format that broke last time cannot catch the
format that breaks next time. It now also carries the real Sept 2026 index (both
stems on one page, plus the dateless section links that must not be selected), a
slug with **no recognisable stem** to prove selection is wording-independent, and
`parsePollenCount` fixtures with `data-list-item-id` on `<li>` and attributes on
`<ul>`. Each of those was confirmed to fail against the pre-fix patterns before
being committed.

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
