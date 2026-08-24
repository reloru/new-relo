# `/tropics` — Atlantic tropical outlook

Active Atlantic storms from the National Hurricane Center, the areas it is
watching for development, plus what hurricane season actually means for Crosby.

| | |
|---|---|
| **Handlers** | `tropicsHtml(data, lang)` / `tropicsMarkdown(data, lang)` — `src/features/tropics.js` |
| **Route** | `routeRequest` (`src/router.js`) → `page === "/tropics"` |
| **Spanish** | `/es/tropics` |
| **Cache** | `public, max-age=900` |
| **Negotiation** | `Accept: text/markdown` or `?format=md`; `Vary: Accept` |
| **Nav label** | "Tropics" / "Trópicos" (`m-only`, under Weather) |

## Content blocks

The status panel has **four** states, and which one shows is the load-bearing
part of this page:

| State | Condition | Panel |
|---|---|---|
| Named storms | `storms.length` | violet, storm cards below |
| Areas under watch | no storms, `disturbances.length` | **amber**, watch cards below |
| Confirmed quiet | no storms, `disturbances` is `[]` | green all-clear |
| Unknown | `disturbances` is `null` | grey "outlook unavailable" |

**The green all-clear requires BOTH lists to be empty.** Until 2026-08-24 it
was drawn whenever `storms` was empty, which is how the page showed "Nothing
active in the Atlantic" while NHC was watching AL95 at 50% and AL96 at 60% —
see "Two NHC products" below. `disturbances: null` is deliberately NOT the
same as `[]`: an unreadable outlook must never render as a confirmed quiet
basin.

| Block | Source |
|---|---|
| Violet storm cards — classification + name, winds (mph), pressure (mb), position, movement direction, official advisory link | `tropics` KV |
| Amber watch cards — area name, invest id, 48-hour and 7-day formation chance + category | `tropics.disturbances` |
| Evergreen "hurricane season and Crosby" guide — inland rain flooding is the local threat, not surge; watch vs warning; links to NHC, `/alerts`, `/water`, `/emergency` | static |

A formation chance is **not a forecast track**, and both the panel and the
watch section say so. The percentage is the chance a cyclone forms at all; it
carries no information about where one would go. Watch cards are deliberately
styled lighter than storm cards — an area at 40% is not a storm, and giving it
equal visual weight overstates it to someone already anxious.

`NHC_CLASS` is a hand dictionary mapping NHC classification codes to human
labels. Winds are converted from NHC's **knots** (`intensity`) with
`ktToMph` — `kt × 1.15078`, rounded to the nearest 5, matching NHC's own
advisory rounding. Movement is shown as a **compass direction only**
(`degToCompass`), because `movementSpeed`'s unit is not clearly documented
upstream and guessing it would put a wrong number on a hurricane page.

## Two NHC products, and why one was not enough

`CurrentStorms.json` lists **named/numbered cyclones only**. Everything NHC is
watching before it earns a name — the shaded areas with percentages on the
graphical outlook — lives in a completely separate product, the **Tropical
Weather Outlook** (`nhc.noaa.gov/xml/TWOAT.xml`).

Reading only the first produced a page that was *true and wrong*: on
2026-08-24, in peak season, `/tropics` rendered a green "Nothing active in the
Atlantic" while NHC's outlook carried AL95 at 50% and AL96 at 60% over seven
days. Nothing failed. `CurrentStorms.json` was correctly empty, `/api/health`
reported the feed `ok`, and the only visible symptom was `hoursSinceChange`
sitting at 263h. Same shape as a burn-ban page saying "no ban": literally
accurate, read as "nothing to watch".

The TWO has **no JSON form** — it is forecaster prose — so it is parsed the way
the pollen scrape is: permissively, and pinned offline by
**`scripts/test-two-parse.mjs`** (CI step "Check tropical outlook parsing")
against real bulletins. Two structural rules do the work:

- **A heading is always preceded by a blank line.** Without that requirement, a
  prose sentence ending in a colon becomes the "area" and steals the
  percentages that follow it — a plausible-looking, fabricated disturbance.
- **A heading with no formation chance under it is not a disturbance.** NHC
  writes `Special Feature:` sections and similar; kept, they render as an area
  with null percentages that NHC never assigned.

`twoTextFromRss()` picks the bulletin **by content**, not position — the channel
description and a "NOAA logo" item both appear before the real one, so taking
the first `<description>` silently yields zero disturbances.

## Data

Cron + KV, key `tropics`, cron-owned, throttled to ~hourly during Atlantic
hurricane season (June–November, Central time — NHC advisories update every
2–6h then) and ~24h the rest of the year (NHC issues far fewer outlooks
off-season). `fetchTropics()` reads **both** upstreams in one call, so a single
KV write carries a consistent pair: `CurrentStorms.json` filtered to the
Atlantic basin (storm ids beginning `al`, since Pacific storms do not threaten
Crosby), and the TWO.

Both **throw on failure**, so a transient NHC outage never wipes the last
snapshot — and, critically, a failure to read the outlook throws rather than
writing `disturbances: []`. An empty list has to mean "NHC is watching
nothing", never "we could not ask".

`loadTropics()` cold-warms when `disturbances` is not an array, which also
migrates entries written before the outlook shipped — a legacy snapshot would
otherwise render as "nothing being watched", reintroducing the exact
false-negative. Total failure degrades to `disturbances: null` (the grey
panel), not `[]`.

An **empty `storms` array is the normal quiet-basin state, not an error** — but
on its own it is NOT an all-clear.

Worker reachability to `www.nhc.noaa.gov` was canary-verified from the deployed
runtime — a temporary debug route, a real 200 with a real body, then removed —
before any feature code was written against it.

On throw: `renderError`, 502.

## Canonical & sitemap

- Canonical `https://crosbynews.com/tropics` · Spanish `/es/tropics`
- `hreflangTags("/tropics")`
- In `PAGE_PATHS` → `Link: rel="canonical"`
- `sitemap.xml`: yes — `changefreq: daily`, `priority: 0.6`, no `lastmod`

## Meta

- Per-language title and description built in `tropicsHtml`
- OG title/description/type/url + `OG_COMMON`
- JSON-LD: `JSONLD_SITE` only
- `<link rel="manifest">`, favicon

## CSP

No inline script.

## Locale

Classification labels via `tropicsClassLabel(code, lang)`; guide copy via `T()`.
**Storm names and advisory text stay in NHC's official English** — the same
policy as NWS text.

## Related surface

`hubTropicsBanner` puts a violet strip on the homepage when storms are active
and self-hides when the basin is quiet. It is deliberately calmer than the red
alerts banner.
