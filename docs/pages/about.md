# `/about` — what this site is

Human-facing: source, cadence, privacy, contact, disclaimer. The API / MCP /
agent detail moved to `/developers` in the 2026 restructure so this page stays
readable by people; only a pointer section remains.

| | |
|---|---|
| **Handlers** | `aboutHtml(lang)` / `aboutMarkdown(lang)` — `src/pages/about.js` |
| **Content** | `ABOUT` / `ABOUT_ES` objects, `{h, p, links}` shape — rendered by both, so HTML and Markdown cannot drift |
| **Route** | `_fetch` → `page === "/about"` |
| **Spanish** | `/es/about` |
| **Cache** | `public, max-age=3600` |
| **Negotiation** | `Accept: text/markdown` or `?format=md`; `Vary: Accept` |

## Content blocks

Static, from the `ABOUT` object. Sections cover what the site is, where the data
comes from, how often it updates, how it is built, the privacy stance, contact,
and the independence disclaimer.

**Two claims on this page are load-bearing and must stay accurate:**

1. **The data-source list.** It names NWS, NOAA NWPS and NHC, EPA (UV),
   EPA/AirNow with the Open-Meteo modeled fallback, the Houston Health
   Department, USGS, Houston TranStar, Crosby ISD, and Google News. Adding an
   upstream anywhere on the site means adding it here — in **both** `ABOUT` and
   `ABOUT_ES`. (A missing Houston Health Department line in `ABOUT_ES` was a real
   shipped bug, fixed in #116.)
2. **"We don't adjust the numbers", with its two stated exceptions.** Everything
   is NWS verbatim except the two values computed in-Worker: "feels like"
   (`feelsLikeF` — heat index or wind chill, from NWS's own published formulas
   applied to the temperature/humidity/wind NWS already returns) and
   sunrise/sunset (`sunTimes` — the standard sunrise equation, SunCalc
   formulation, since the NWS forecast API provides no sun times). Both are
   disclosed here by name.

The measured-vs-modeled air-quality disclosure also lives here.

## Canonical & sitemap

- Canonical `https://crosbynews.com/about` · Spanish `/es/about`
- `hreflangTags("/about")`
- In `PAGE_PATHS` → `Link: rel="canonical"`
- `sitemap.xml`: yes — `changefreq: monthly`, `priority: 0.5`, no `lastmod`

## Meta

- Title from `ABOUT.title` — Crosby, TX Weather / Clima de Crosby, TX
- Description from `ABOUT.description`
- OG title/description, `og:type: website`, `og:url` = canonical, `OG_COMMON`
- JSON-LD: `JSONLD_SITE` + `jsonldAbout(lang)` (`AboutPage`)
- `<link rel="manifest">`, favicon

## CSP

No inline script.

## Locale

Fully translated via the parallel `ABOUT_ES` object — hand-written, not machine
translated. The two objects must stay structurally parallel: a section added to
one is a bug until it exists in the other.
