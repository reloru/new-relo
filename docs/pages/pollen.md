# `/pollen` — pollen & mold count

The Houston Health Department's measured daily pollen and mold count — a directly
measured, Crosby-area-relevant number, not a model.

| | |
|---|---|
| **Handlers** | `pollenHtml(data, lang)` / `pollenMarkdown(data, lang)` — `src/features/pollen.js` |
| **Route** | `_fetch` → `page === "/pollen"` |
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

Cron + KV, key `pollen`, cron-owned, throttled to ~2h. HHD publishes one count
per weekday morning, so ~2h catches a new count without hammering a city Drupal
site.

There is **no API**. `fetchPollen()` scrapes `houstonhealth.org`: the index page
(`/services/pollen-mold`) lists per-date count pages with slug dates
(`…/houston-pollen-mold-count-thursday-july-16-2026`); `pollenSlugDate` picks the
newest by slug date, and `parsePollenCount` reads the four groups plus the
per-genus species lists (the first `<ul>` after each "Major … counted" heading,
bounded at `</ul>`).

`fetchPollen()` **throws on failure OR on an unrecognizable layout** (fewer than
2 groups parsed), so neither a transient outage nor a Drupal redesign can wipe
the last good count. `loadPollen()` cold-warms.

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
