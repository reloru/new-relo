# `GET /.well-known/mcp/server-card.json`

MCP discovery card.

| | |
|---|---|
| **Builder** | `mcpServerCard()` (`src/mcp/server.js`) |
| **Content-type** | `application/json; charset=utf-8` |
| **Cache** | `public, max-age=3600` |
| **CORS** | `*` |

## Contents

`serverInfo` (`MCP_SERVER_INFO`), `protocolVersion`, a prose `description`,
`transport` (`{type: "streamable-http", endpoint: "https://crosbynews.com/mcp"}`),
`capabilities`, and `documentation`.

**`tools`, `prompts` and `resources` are derived** — `mcpTools()`,
`mcpPrompts()` and `MCP_RESOURCES`, projected to name/title/description. So this
card cannot drift from the protocol, unlike the five hand-maintained prose
surfaces listed in `docs/endpoints/mcp.md`.

The `description` string **is** hand-written and does need updating when the data
surface changes.

## Versioning

`MCP_SERVER_INFO.version` must be bumped together with `server.json`'s `version`
whenever the tool set changes. That pair is separate from `/openapi.json`'s
`info.version`, which tracks the REST API.

## Advertised by

`README.md`, `/developers`, `llms.txt`, and the `/sitemap` page.
