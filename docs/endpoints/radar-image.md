# `GET /radar-image`

Proxies the NWS KHGX radar image through our origin.

| | |
|---|---|
| **Handler** | inline in `routeRequest` |
| **Upstream** | `radar.weather.gov/ridge/standard/KHGX_loop.gif`, or `KHGX_0.gif` with `?still=1` |
| **Content-type** | upstream's, else `image/gif` |
| **Cache** | `public, max-age=120, s-maxage=180`; upstream fetched with `cf: {cacheTtl: 180, cacheEverything: true}` |
| **Errors** | 502 `Radar unavailable` on a throw or a non-OK upstream |

## Why proxy rather than hotlink

NWS's robots.txt disallows all crawling, so a hotlinked radar image cannot be
indexed. Serving it from our own origin makes it crawlable and edge-cacheable —
and it is also what lets the page's `img-src 'self' data:` CSP allow it.

## Locked to two upstreams

The handler builds its upstream URL from a fixed pair of filenames chosen by a
boolean, with **no path or host taken from the request**. It cannot become an
open proxy. Do not parameterize the upstream.

`?still=1` serves the latest single frame for readers who prefer a non-animated
image; `/radar` links it explicitly.

## Query parameters

Only `still` is read. It is compared `=== "1"`, so anything else is the loop.

## Matched on `path`, not `page`

The branch runs before the `/es` mapping is applied to the routing decision, so
there is no `/es/radar-image`. A request to that path 404s.

## Not a page

No `PAGE_PATHS` entry, no `sitemap.xml` entry.
