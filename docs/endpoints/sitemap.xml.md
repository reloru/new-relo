# `GET /sitemap.xml`

The machine-readable crawler sitemap. Distinct from `/sitemap`, the
human-readable page — see `docs/pages/sitemap.md`.

| | |
|---|---|
| **Builder** | `sitemapXml()` (`src/discovery.js`) |
| **Content-type** | `application/xml; charset=utf-8` |
| **Cache** | `public, max-age=3600` |

## Contents

20 content pages **× 2 languages = 40 `<url>` entries**. Each carries
`changefreq`, `priority`, `xhtml:link` hreflang alternates (`en-US`, `es-MX`,
`x-default` → English), and — for `/`, `/weather` and `/hourly` — a `<lastmod>`
of the current date, computed at request time.

| Page | changefreq | priority |
|---|---|---|
| `/` | hourly | 1.0 |
| `/weather` | hourly | 0.9 |
| `/hourly` | hourly | 0.8 |
| `/radar`, `/alerts`, `/water` | daily / hourly / hourly | 0.7 |
| `/tropics`, `/pollen`, `/air`, `/fishing`, `/news`, `/traffic`, `/calendar` | daily or hourly | 0.6 |
| `/emergency`, `/about` | monthly | 0.5 |
| `/developers` | monthly | 0.4 |
| `/privacy`, `/contact`, `/sitemap` | monthly | 0.3 |

The hreflang alternates here assert the same pairing as the in-page
`hreflangTags()`, so the two must agree.

## Deliberate omissions

Assets and endpoints are not listed — `/badge.svg`, `/radar-image`, `/icons/*`,
the RSS feeds, the API. They are not pages.

**`/mcp` and `/es/mcp` ARE listed** (`changefreq: monthly`, `priority: 0.4`),
as of 2026-08-01. `/mcp` was deliberately made indexable so AI search can cite
it, which only works if a crawler can find it; it was absent here purely because
`/mcp` predates being an HTML page. Recorded as finding 4 in
`docs/audit/2026-07-30-state.md` and B6 in `docs/audit/2026-08-01-post-decomposition.md`.

## Referenced by

`/robots.txt` (`Sitemap:` line), `linkHeader()` (`rel="sitemap"` on `/` and
`/weather`), and `llms.txt`'s `## Optional` section. Submitted to Google Search
Console (DNS-verified) and Bing Webmaster Tools.
