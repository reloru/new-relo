# `GET /sitemap.xml`

The machine-readable crawler sitemap. Distinct from `/sitemap`, the
human-readable page — see `docs/pages/sitemap.md`.

| | |
|---|---|
| **Builder** | `sitemapXml()` (`src/discovery.js`), from `PAGES` in `src/registry.js` |
| **Content-type** | `application/xml; charset=utf-8` |
| **Cache** | `public, max-age=3600` |

## Contents

Every page in `src/registry.js` **× 2 languages** (21 pages, 42 `<url>` entries
today), in registry order. Each carries `xhtml:link` hreflang alternates
(`en-US`, `es-MX`, `x-default` → English) asserting the same pairing as the
in-page `hreflangTags()`.

**`<lastmod>`** is present only on pages that declare `feeds` in the registry,
and is the newest `changedAt` among those feeds in `cron_status` — when the
data's content last changed. The route reads that one KV key and passes it to
`sitemapXml(cronStatus)`. Static pages have no `<lastmod>`. There is no
`<changefreq>` or `<priority>`. Reasons: `docs/ops/search.md`.

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
