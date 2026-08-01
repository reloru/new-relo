# `/radar` — weather radar

Embeds the NWS KHGX (Houston-Galveston) radar loop, which covers Crosby.

| | |
|---|---|
| **Handlers** | `radarHtml(lang, data)` / `radarMarkdown(lang)` — `src/index.js` |
| **Route** | `_fetch` → `page === "/radar"` |
| **Spanish** | `/es/radar` |
| **Cache** | `public, max-age=3600` |
| **Negotiation** | `Accept: text/markdown` or `?format=md`; `Vary: Accept` |

## Content blocks

| Block | Source |
|---|---|
| Radar image — the animated loop | `/radar-image` (proxy; see `docs/endpoints/radar-image.md`) |
| Still-frame link for readers who prefer no animation | `/radar-image?still=1` → `KHGX_0.gif` |
| Explanatory copy + link back to the forecast | static |
| Footer freshness line | `weather` KV `updated` |

The image is **proxied through our own origin**, not hotlinked. NWS's robots.txt
disallows all crawling, so a hotlinked radar image is uncrawlable; serving it
from `/radar-image` makes it indexable and edge-cacheable.

## Data

`loadWeather(env)` is called only so the footer can show the same freshness line
as the other weather pages — the radar image itself comes from the proxy route.
It is a cheap KV read, and **failure is non-fatal**: the catch re-renders
`radarHtml(lang)` with no `data`, which simply omits the freshness line. This
page does not 502.

## Canonical & sitemap

- Canonical `https://crosbynews.com/radar` · Spanish `/es/radar`
- `hreflangTags("/radar")`
- In `PAGE_PATHS` → `Link: rel="canonical"`
- `sitemap.xml`: yes — `changefreq: daily`, `priority: 0.7`, no `lastmod`

## Meta

- Title "Crosby, TX Weather Radar" / "Radar meteorológico de Crosby, TX"
- Per-language description naming KHGX and the greater Houston area
- OG title/description/type/url + `OG_COMMON`
- JSON-LD: `JSONLD_SITE` only
- `<link rel="manifest">`, favicon

## CSP

No inline script. `img-src 'self' data:` covers the radar image, because it is
served from our own origin via the proxy — a hotlinked upstream image would be
blocked by that directive.

## Locale

All page copy through `T()`. The radar image itself is a NOAA product with
burned-in English labels and is not localized.
