# `GET /openapi.json`

OpenAPI 3.1 description of the public REST API.

| | |
|---|---|
| **Builder** | `openApiSpec()` (`src/api/openapi.js`) — the largest single function in the Worker |
| **Content-type** | `application/json; charset=utf-8` |
| **Cache** | `public, max-age=3600` |
| **CORS** | `*` |
| **Conditional GET** | none — the spec is static per deploy |

## Documented paths

All nine public data endpoints plus `/api/health`. The push and news-admin
endpoints are deliberately absent.

## Schema conventions

Component schemas (`HourlyPeriod`, `Period`, `Alert`, …) set
`additionalProperties: true` on purpose: NWS and NHC payloads are passed through
verbatim and carry more fields than are enumerated. Documenting them as closed
would make the spec lie the first time an upstream adds a field. **That applies
to nested passthrough objects too** — `probabilityOfPrecipitation` is open, since
NWS sends `unitCode` alongside `value`.

Derived fields are called out as derived — `feelsLike` carries a description
saying it is a heat index or wind chill computed from NWS's own formulas, and
"Not an NWS field".

**Every shared shape is a `$ref`, not a copy.** Nested schemas used to be
spliced in by value — `items: HourlyPeriod` — so a component appeared inline at
each use site and the same shape could be edited in one place and not another.
That is how `nearbyMonitor` came to be undocumented in BOTH `airQuality` blocks
at once after it shipped on the endpoints (2026-08-01 audit, finding B3). Every
one of the 18 component schemas is now referenced as
`{ $ref: "#/components/schemas/X" }` and defined exactly once. The local consts
in `openApiSpec()` exist only to register those components; they are never
spliced into a path.

`components.parameters.IfNoneMatch` and `components.responses.NotModified` follow
the same rule — one definition, `$ref`'d from the nine conditional endpoints.

## Responses

Each data endpoint documents `200`, `304` and `502`. The `304` is real, not
aspirational: `conditional()` (`src/lib/http.js`) answers a matching
`If-None-Match` with an empty body on all nine. `/api/health` has neither — it is
`no-store` and sends no ETag.

## Authentication

Root `security: []`. The API is deliberately unauthenticated, and an empty root
`security` states that in a form a client generator or linter can read, rather
than leaving it to prose.

## Linting

The spec passes `redocly lint` under Redocly's **default** ruleset with zero
errors and zero warnings. That ruleset is opinionated beyond the OpenAPI
specification itself, and running it is worthwhile precisely because of that: it
is what surfaced the missing `security` declaration and the nine undocumented
`304` responses, neither of which is a spec violation.

    npx @redocly/cli lint <(node -e '…openApiSpec()…')


## Versioning

`info.version` is **its own track**, separate from `server.json` and
`MCP_SERVER_INFO.version`, which version the MCP server. Bumping one does not
imply bumping the other: this describes the REST API, those describe the MCP
tool surface.

## Advertised as

- `Link: <…/openapi.json>; rel="service-desc"` on every `/api/*` response and in
  `linkHeader()` on `/` and `/weather`
- `service-desc` on every `/.well-known/api-catalog` entry
- An MCP resource, readable in-protocol via `resources/read`
- Listed on `/developers`, `/sitemap`, and in `llms.txt`
