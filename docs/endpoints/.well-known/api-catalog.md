# `GET /.well-known/api-catalog`

RFC 9727 linkset — a machine-readable index of the public API.

| | |
|---|---|
| **Builder** | `apiCatalog()` (`src/api/openapi.js`) |
| **Content-type** | `application/linkset+json; charset=utf-8` |
| **Cache** | `public, max-age=3600` |
| **CORS** | `*` |

## Contents

One `linkset` entry per public data endpoint — nine of them: `/api/weather`,
`/api/news`, `/api/calendar`, `/api/water`, `/api/fishing`, `/api/tropics`,
`/api/pollen`, `/api/air`, `/api/traffic`.

Each carries:

| Relation | Target |
|---|---|
| `anchor` | the endpoint URL |
| `service-desc` | `/openapi.json` |
| `service-doc` | the human page for that data (`/water`, `/air`, …; `/api/weather` points at `/`) |
| `status` | `/api/health` |

`/api/health` itself is not an anchor — it is the `status` link of every entry.
The push and news-admin endpoints are deliberately absent, consistent with every
other discovery surface.

## Caveat on the `status` relation

`/api/health` returns `{"status":"ok"}` unconditionally, so a consumer following
this relation is polling a constant. See
`docs/endpoints/api/health.md`.

## Advertised by

`linkHeader()` (`rel="api-catalog"` on `/` and `/weather`), `llms.txt`'s
`## Optional` section, `/developers`, and the `/sitemap` page.
