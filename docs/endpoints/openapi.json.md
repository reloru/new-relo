# `GET /openapi.json`

OpenAPI 3.1 description of the public REST API.

| | |
|---|---|
| **Builder** | `openApiSpec()` — the largest single function in the Worker |
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
would make the spec lie the first time an upstream adds a field.

Derived fields are called out as derived — `feelsLike` carries a description
saying it is a heat index or wind chill computed from NWS's own formulas, and
"Not an NWS field".

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
