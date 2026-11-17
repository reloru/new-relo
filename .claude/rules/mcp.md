---
paths:
  - "src/mcp/**"
  - "server.json"
  - "src/discovery.js"
  - "src/pages/developers.js"
  - "src/api/openapi.js"
---

# MCP server

- `/mcp` is Streamable HTTP and stateless, published as
  `com.crosbynews/weather`. It is dual-era: `initialize` negotiates only
  `MCP_LEGACY_VERSIONS` (2025-03-26 through 2025-11-25); a single message
  whose `params._meta` carries `io.modelcontextprotocol/protocolVersion` is
  served by `mcpHandleModern()` (2026-07-28). That `_meta` key is the only
  era signal, never the `MCP-Protocol-Version` header, which legacy clients
  send too. Legacy response bodies are unchanged (the
  `MCP-Protocol-Version` response header now reads 2025-11-25);
  `test-mcp-modern` pins both eras.
- On any change to the tool set, bump `MCP_SERVER_INFO.version` and
  `server.json` together. Publishing to the registry is a separate manual
  step (`docs/ops/mcp-registry.md`).
- Tool names are written by hand in `llmsTxt()`, `CROSBY_WEATHER_SKILL`,
  `/developers` (both languages) and `README.md`. `test-mcp-server` fails if
  any of them is missing one.
- The record tools (`src/mcp/history-tools.js`) use the same loaders as their
  pages.
- Arguments are validated, never clamped (`validateToolArgs()`). There is no
  `Origin` check on `/mcp`: the spec's 403 is for an invalid Origin, and on a
  public, credential-free, read-only server none is invalid.
- Not yet submitted to Anthropic's directory
  (`docs/ops/anthropic-directory.md`). Once listed, material tool changes
  need a notice.
