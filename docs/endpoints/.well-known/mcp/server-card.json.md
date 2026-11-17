# `GET /.well-known/mcp/server-card.json` (and `GET /mcp/server-card`)

MCP discovery card. Both paths serve the same body from the same builder;
`/mcp/server-card` is the per-endpoint path that some crawlers try (Lowdown
looks there first and recorded a 404 before it existed).

| | |
|---|---|
| **Builder** | `mcpServerCard()` (`src/mcp/server.js`) |
| **Content-type** | `application/json; charset=utf-8` |
| **Cache** | `public, max-age=3600` |
| **CORS** | `*` |
| **Registry entry** | Not in `registry.js` `ENDPOINTS`; linked from `/developers`, `llms.txt` and `README.md` |

## Contents

Top-level fields shaped like `server.json`, so a crawler can match the card
to the registry listing:

- `name`: `com.crosbynews/weather` (`MCP_REGISTRY_NAME`), the registry name.
- `title`, `version`: from `MCP_SERVER_INFO`.
- `websiteUrl`, `repository`: the same values as `server.json`.
- `remotes`: `[{type: "streamable-http", url: "https://crosbynews.com/mcp",
  supportedProtocolVersions: ["2025-06-18", "2025-03-26"]}]`. The versions
  are `MCP_SUPPORTED_VERSIONS`, newest first: exactly the versions
  `initialize` echoes back. An unlisted version gets `2025-06-18`.

Then the older fields, kept for existing readers: `serverInfo`
(`MCP_SERVER_INFO`, whose `name` stays `crosbynews-weather`, which is what
`initialize` returns), `protocolVersion`, a prose `description`, `transport`
(`{type: "streamable-http", endpoint: "https://crosbynews.com/mcp"}`),
`capabilities`, and `documentation`.

**`tools`, `prompts` and `resources` are derived** from `mcpTools()`,
`mcpPrompts()` and `MCP_RESOURCES`, projected to name/title/description. So this
card cannot drift from the protocol, unlike the five hand-maintained prose
surfaces listed in `docs/endpoints/mcp.md`.

The `description` string **is** hand-written and does need updating when the data
surface changes.

There is no `$schema`: the server-card proposal's schema URL did not resolve
when this was written (2026-11-17), so the card does not claim one.

## Tests

`scripts/test-mcp-server.mjs` checks that `name`, `version`, `websiteUrl`,
`repository` and the remote's type and URL match `server.json`. It also checks
that every claimed protocol version is echoed by `initialize` and that an
unclaimed one is not. `scripts/test-routes.mjs` checks that both paths answer
200 with JSON and identical bodies.

## Versioning

`MCP_SERVER_INFO.version` must be bumped together with `server.json`'s `version`
whenever the tool set changes. That pair is separate from `/openapi.json`'s
`info.version`, which tracks the REST API.

## Advertised by

`README.md`, `/developers`, `llms.txt`, and the `/sitemap` page.
