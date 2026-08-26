# `GET /icons/*`

Proxies NWS weather icons through our origin.

| | |
|---|---|
| **Handler** | inline in `routeRequest`, matched with `path.startsWith("/icons/")` |
| **Upstream** | `https://api.weather.gov${path}${url.search}` |
| **Methods** | `GET`, `HEAD`. Anything else → **405** `Allow: GET, HEAD` |
| **Content-type** | upstream's, else `image/png` |
| **Cache** | `public, max-age=86400, s-maxage=604800, immutable`; upstream fetched with `cf: {cacheTtl: 604800, cacheEverything: true}` |
| **Errors** | **404 on any upstream 4xx**, 502 otherwise — `Icon unavailable` |

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

## A bad icon path is the caller's 404, not our 502

Only a literal upstream `404` used to map to 404; every other non-OK status
became 502. NWS answers a malformed icon path with a 4xx that is not 404, so
`/icons/land/day/skc.png` — a real icon, written with an extension NWS paths do
not carry — surfaced as a gateway error blaming our upstream. Any upstream 4xx
is now a 404. 5xx still means 502, because that one genuinely is upstream.

## Not a page

No `PAGE_PATHS` entry, no `sitemap.xml` entry. Icons are edge-cached hard because
they are effectively static.
