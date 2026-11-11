# `/sitemap` — human-readable sitemap

Every page and endpoint, grouped by category. Distinct from `/sitemap.xml`, which
is the machine-readable crawler sitemap — see
`docs/endpoints/sitemap.xml.md`.

| | |
|---|---|
| **Handlers** | `sitemapPageHtml(lang)` / `sitemapPageMarkdown(lang)` — `src/pages/sitemap.js` |
| **Route** | `PAGE_HANDLERS["/sitemap"]` (`src/router.js`) |
| **Spanish** | `/es/sitemap` |
| **Cache** | `public, max-age=3600` |
| **Negotiation** | `Accept: text/markdown` or `?format=md`; `Vary: Accept` |

## Content blocks

Static, no data loading. **Generated from `src/registry.js`**: each `SECTIONS`
group lists its `PAGES` in registry order, and the developers group then lists
every `ENDPOINTS` entry. Both renderers use the same names and descriptions.

| Group | Contents |
|---|---|
| Weather & Conditions | `/`, `/weather`, `/hourly`, `/radar`, `/alerts`, `/water`, `/fishing`, `/tropics`, `/pollen`, `/air`, `/burn-ban` |
| Community | `/news`, `/traffic`, `/calendar`, `/emergency` |
| About & Policies | `/about`, `/privacy`, `/contact`, `/sitemap` |
| For Developers & Agents | `/developers`, `/mcp`, then the endpoints: the ten data APIs, `/api/health`, `/openapi.json`, `/llms.txt`, the RSS feeds, `/badge.svg`, the api-catalog, `/sitemap.xml`, `security.txt` |

The push and news-admin endpoints are not in `ENDPOINTS`, so they are withheld
here exactly as they are from `openapi.json`, the api-catalog and `llms.txt`.

**The `/mcp` entry's name differs by language, and has to.** English says
"MCP Server" pointing at `/mcp`, which is accurate because that one URL is both
things — a GET renders the page, a POST *is* the server. Spanish says "Acerca del
servidor MCP" pointing at `/es/mcp`, because `POST /es/mcp` is a 404: that URL is
never a server, only a page about one. Pages localize their href; endpoints
never do.

Nothing here is maintained by hand. `scripts/test-routes.mjs` checks that both
renderers, in both languages, link every registered page and endpoint.

## Canonical & sitemap

- Canonical `https://crosbynews.com/sitemap` · Spanish `/es/sitemap`
- `hreflangTags("/sitemap")`
- In `PAGE_PATHS` → `Link: rel="canonical"`
- `sitemap.xml`: yes — `changefreq: monthly`, `priority: 0.3`, no `lastmod`

## Meta

- Per-language title and description built in `sitemapPageHtml`
- OG title/description/type/url
- JSON-LD: `JSONLD_SITE` only
- `sharedHead(lang)` (`src/seo.js`): viewport, `theme-color` `#0b3d61`, `og:site_name`, absolute `og:image` (`/og-image.png`, 512×512 PNG with type/width/height/alt), `twitter:card`, PNG tab icons, inline 180px PNG `apple-touch-icon`, `<link rel="manifest">`

## CSP

No inline script.

## Locale

Group headings and link labels via `T()`. Endpoint paths are identical in both
languages, since the API and MCP surfaces are English-only.

## Inbound links

Not in the topbar. Linked from the shared footer on every page.
