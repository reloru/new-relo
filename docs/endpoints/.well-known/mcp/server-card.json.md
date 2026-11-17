# `GET /.well-known/mcp/server-card.json`

The older MCP discovery card (the SEP-1649 proposal's path). Crawlers still
request it, so it stays. The current card is the SEP-2127 Server Card at
`/mcp/server-card` (`docs/endpoints/mcp/server-card.md`). Unlike that card,
this one lists tools, prompts and resources.

| | |
|---|---|
| **Builder** | `mcpServerCard()` (`src/mcp/server.js`) |
| **Content-type** | `application/json; charset=utf-8` |
| **Cache** | `public, max-age=3600` |
| **CORS** | `*` |
| **Registry entry** | Not in `registry.js` `ENDPOINTS`; linked from `/developers`, `llms.txt` and `README.md` |

## Contents

The identity and connection fields shared with the Server Card
(`mcpCardIdentity()`): `name` (`com.crosbynews/weather`), `title`, `version`,
`websiteUrl`, `repository`, and `remotes` with `supportedProtocolVersions`
(`MCP_SUPPORTED_VERSIONS`, newest first).

Then the older fields: `serverInfo` (`MCP_SERVER_INFO`, whose `name` is
`crosbynews-weather`, as `initialize` returns), `protocolVersion`, a prose
`description`, `transport`, `capabilities`, `documentation`, and **derived**
`tools`, `prompts` and `resources` (from `mcpTools()`, `mcpPrompts()` and
`MCP_RESOURCES`, so they cannot drift). The prose `description` is
hand-written and needs updating when the data surface changes.

## Tests

`scripts/test-mcp-server.mjs` checks the shared fields against `server.json`,
and that every claimed protocol version is echoed by `initialize` and an
unclaimed one is not. `scripts/test-routes.mjs` checks status, content type,
name and that the tool list is present.

## Versioning

`MCP_SERVER_INFO.version` must be bumped together with `server.json`'s `version`
whenever the tool set changes. That pair is separate from `/openapi.json`'s
`info.version`, which tracks the REST API.
