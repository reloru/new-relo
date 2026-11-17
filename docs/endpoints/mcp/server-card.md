# `GET /mcp/server-card`

The MCP Server Card, as defined by the Server Card extension (SEP-2127,
Final). The path is the extension's reserved default:
`<streamable-http-url>/server-card`, and our endpoint is `https://crosbynews.com/mcp`.
`/.well-known/ai-catalog.json` lists it.

| | |
|---|---|
| **Builder** | `mcpServerCardV1()` (`src/mcp/server.js`), served by `discoveryJson()` (`src/router.js`) |
| **Content-type** | `application/mcp-server-card+json` |
| **Cache** | `public, max-age=3600`, a weak `ETag`; `If-None-Match` → 304 |
| **CORS** | `Access-Control-Allow-Origin: *`, `-Allow-Methods: GET`, `-Allow-Headers: Content-Type, If-None-Match`, `-Expose-Headers: ETag` |
| **Methods** | GET, HEAD; OPTIONS → 204; anything else → 405 |

## Contents

- `$schema`: `https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json`.
  The extension's schema requires exactly this value. The URL itself
  returned 404 on 2026-11-17; the schema is published in the
  extension repository (`modelcontextprotocol/ext-server-card`, `schema.json`).
- `name`: `com.crosbynews/weather` (`MCP_REGISTRY_NAME`).
- `version`, `title`: from `MCP_SERVER_INFO`.
- `description`: `MCP_REGISTRY_DESCRIPTION`, the same string as
  `server.json` (both are limited to 100 characters).
- `websiteUrl`, `repository`: as in `server.json`.
- `icons`: `/icon-192.png` and `/icon-512.png`.
- `remotes`: one `streamable-http` remote at `https://crosbynews.com/mcp`,
  with `supportedProtocolVersions` = `MCP_SUPPORTED_VERSIONS`, newest first.

No `tools`, `prompts`, `resources` or `capabilities`: the extension leaves
those to runtime listing on purpose. The older card at
`/.well-known/mcp/server-card.json` still lists them.

## Names

The card's `name` is the registry name. The `serverInfo.name` that the server
reports at runtime is `crosbynews-weather`. The two are different kinds of
name (a reverse-DNS registry identifier and an implementation name), and the
extension's consistency rule is advisory. Lowdown's own server differs the
same way (`io.github.PetShopBros/lowdown-proxy` in its card, `lowdown` at
runtime). We kept the runtime name so existing clients see no change.

## Tests

- `scripts/test-mcp-server.mjs` checks name, version, description, title and
  remotes against `server.json` and the older card, and that the card carries
  no primitives or capabilities.
- `scripts/test-routes.mjs` checks the media type, CORS, Cache-Control, ETag
  and 304 response, OPTIONS 204, POST 405, and the `$schema`, name and remote
  as hand-written literals.
- The card was validated once against the extension's `schema.json` with
  ajv (2020-12) when this was written (2026-11-17). That is not repeated in CI,
  which installs nothing.
