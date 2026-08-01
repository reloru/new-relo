# `/tropics` — Atlantic tropical outlook

Active Atlantic storms from the National Hurricane Center, plus what hurricane
season actually means for Crosby.

| | |
|---|---|
| **Handlers** | `tropicsHtml(data, lang)` / `tropicsMarkdown(data, lang)` — `src/features/tropics.js` |
| **Route** | `_fetch` → `page === "/tropics"` |
| **Spanish** | `/es/tropics` |
| **Cache** | `public, max-age=900` |
| **Negotiation** | `Accept: text/markdown` or `?format=md`; `Vary: Accept` |
| **Nav label** | "Tropics" / "Trópicos" (`m-only`, under Weather) |

## Content blocks

**Quiet basin (most of the year):**

| Block | Source |
|---|---|
| Green all-clear panel | `tropics.storms` empty |
| Evergreen "hurricane season and Crosby" guide — inland rain flooding is the local threat, not surge; watch vs warning; links to NHC, `/alerts`, `/water`, `/emergency` | static |

**Active storms:**

| Block | Source |
|---|---|
| Violet storm cards — classification + name, winds (mph), pressure (mb), position, movement direction, official advisory link | `tropics` KV |

`NHC_CLASS` is a hand dictionary mapping NHC classification codes to human
labels. Winds are converted from NHC's **knots** (`intensity`) with
`ktToMph` — `kt × 1.15078`, rounded to the nearest 5, matching NHC's own
advisory rounding. Movement is shown as a **compass direction only**
(`degToCompass`), because `movementSpeed`'s unit is not clearly documented
upstream and guessing it would put a wrong number on a hurricane page.

## Data

Cron + KV, key `tropics`, cron-owned, throttled to ~hourly (NHC advisories update
every 2–6h). `fetchTropics()` reads NOAA NHC's `CurrentStorms.json`, filtered to
the Atlantic basin — storm ids beginning `al`, since Pacific storms do not
threaten Crosby.

It **throws on failure**, so a transient NHC outage never wipes the last
snapshot. `loadTropics()` cold-warms, degrading to an empty shape.

An **empty `storms` array is the normal quiet-basin state, not an error.**

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
