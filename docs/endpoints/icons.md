# `GET /icons/*`

Proxies NWS weather icons through our origin.

| | |
|---|---|
| **Handler** | inline in `_fetch`, matched with `path.startsWith("/icons/")` |
| **Upstream** | `https://api.weather.gov${path}${url.search}` |
| **Methods** | `GET`, `HEAD`. Anything else → **405** `Allow: GET, HEAD` |
| **Content-type** | upstream's, else `image/png` |
| **Cache** | `public, max-age=86400, s-maxage=604800, immutable`; upstream fetched with `cf: {cacheTtl: 604800, cacheEverything: true}` |
| **Errors** | 404 if the upstream 404s, else 502 `Icon unavailable` |

## Why proxy rather than hotlink

Same reason as `/radar-image`: NWS's robots.txt disallows all crawling, so
hotlinked icons are uncrawlable. Proxying makes them indexable and
edge-cacheable. The rendered HTML rewrites NWS icon URLs to this path via
`iconUrl()`.

## Prefix-locked, not an open proxy

The upstream is `api.weather.gov` + the request path, and the branch only runs
for paths already starting `/icons/`. `new URL()` has normalized any `..`
segments before the check, so the prefix cannot be escaped.

The query string **is** forwarded — NWS icon URLs carry a `size` parameter.

## Not a page

No `PAGE_PATHS` entry, no `sitemap.xml` entry. Icons are edge-cached hard because
they are effectively static.
