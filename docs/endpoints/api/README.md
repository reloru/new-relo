# `/api/*` — shared contract

The nine public data endpoints share this contract. Each endpoint's own file
records only what differs: its loader, its response shape, its cache TTL, and its
conditional-GET seed.

Public, unauthenticated, no rate limits, CORS `*`. English-only.

## Request

`GET` (and `HEAD`). `OPTIONS` gets a 204 preflight from the shared branch in
`routeRequest`, allowing `GET, OPTIONS`, `access-control-max-age: 86400`.

No query parameters are read by any of them.

## Conditional GET

All nine go through `conditional(request, seed, make, headers)` (`src/lib/http.js`):

- **ETag** — weak, `W/"<seed>"`, with any `"` stripped from the seed.
- **Last-Modified** — set only when the seed parses as a date. Informational;
  only `If-None-Match` is evaluated, since that is what ETag-aware clients send.
- A matching `If-None-Match` (or `*`) returns a **body-less 304** carrying the
  same headers. The body is built lazily, so a 304 never serializes it.

The seed must change whenever the body would. Where the body depends on the
current Central date — sun times, the upcoming-events cutoff — the seed carries
that date as well as the KV freshness stamp.

## Response headers

```
content-type: application/json; charset=utf-8
access-control-allow-origin: *
cache-control: public, max-age=<per endpoint>
link: <https://crosbynews.com/openapi.json>; rel="service-desc"; type="application/json"
etag: W/"…"
```

`/api/weather` additionally sends `x-cache` (`hit`, `miss-warmed`, or
`miss-warmfail`).

## Errors

A loader throw returns **502** with

```json
{ "error": "unavailable", "message": "<err.message>" }
```

and CORS, but no ETag. `/api/weather` uses `"upstream_unavailable"` instead of
`"unavailable"`; the shape is otherwise identical.

Note that these endpoints surface `err.message` to the caller. That is
intentional for a debuggable public API and is a different judgement from
`renderError`, which does the same on HTML pages where it is not intentional
(`docs/audit/2026-07-30-state.md`, finding 1).

## Documented in

- `/openapi.json` — all nine plus `/api/health`
- `/.well-known/api-catalog` — all nine, each with `service-desc`, `service-doc`
  and a `status` link to `/api/health`
- `/llms.txt` — eight of the nine; **`/api/fishing` is missing**
  (`docs/audit/2026-07-30-state.md`)
- `README.md` and `/developers` — all nine

Adding a public API endpoint means adding it to all of those, plus an MCP tool if
it warrants one, plus a file here.
