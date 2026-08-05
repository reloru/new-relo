# `/sitemap` — human-readable sitemap

Every page and endpoint, grouped by category. Distinct from `/sitemap.xml`, which
is the machine-readable crawler sitemap — see
`docs/endpoints/sitemap.xml.md`.

| | |
|---|---|
| **Handlers** | `sitemapPageHtml(lang)` / `sitemapPageMarkdown(lang)` — `src/pages/sitemap.js` |
| **Route** | `routeRequest` (`src/router.js`) → `page === "/sitemap"` |
| **Spanish** | `/es/sitemap` |
| **Cache** | `public, max-age=3600` |
| **Negotiation** | `Accept: text/markdown` or `?format=md`; `Vary: Accept` |

## Content blocks

Static, no data loading. Four groups:

| Group | Contents |
|---|---|
| Weather & Forecast | `/`, `/weather`, `/hourly`, `/radar`, `/alerts`, `/water`, `/fishing`, `/tropics`, `/pollen`, `/air` |
| Community | `/news`, `/traffic`, `/calendar`, `/emergency` |
| About & Policies | `/about`, `/privacy`, `/contact` |
| Developers & Agents | `/developers`, all ten `/api/*` endpoints, `/openapi.json`, `/mcp`, the RSS feeds, `/badge.svg`, `/llms.txt`, `/.well-known/api-catalog`, `/sitemap.xml` |

The API entries are the nine public data endpoints plus `/api/health`. The push
and news-admin endpoints are withheld, matching `openapi.json`, the api-catalog
and `llms.txt`.

**This list is hand-maintained.** Adding a page or a public endpoint means adding
it here as well as to `sitemapXml()`, `llmsTxt()`, and — for pages — `PAGE_PATHS`
and the topbar. Nothing generates it and nothing cross-checks it, so it is the
easiest surface on the site to forget: `/api/water`, `/api/fishing` and
`/api/tropics` each shipped without being added, and stayed missing until the
2026-08-01 audit (finding B5).

## Canonical & sitemap

- Canonical `https://crosbynews.com/sitemap` · Spanish `/es/sitemap`
- `hreflangTags("/sitemap")`
- In `PAGE_PATHS` → `Link: rel="canonical"`
- `sitemap.xml`: yes — `changefreq: monthly`, `priority: 0.3`, no `lastmod`

## Meta

- Per-language title and description built in `sitemapPageHtml`
- OG title/description/type/url + `OG_COMMON`
- JSON-LD: `JSONLD_SITE` only
- `<link rel="manifest">`, favicon

## CSP

No inline script.

## Locale

Group headings and link labels via `T()`. Endpoint paths are identical in both
languages, since the API and MCP surfaces are English-only.

## Inbound links

Not in the topbar. Linked from the shared footer on every page.
