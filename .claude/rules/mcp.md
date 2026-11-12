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
  `com.crosbynews/weather`.
- On any change to the tool set, bump `MCP_SERVER_INFO.version` and
  `server.json` together. Publishing to the registry is a separate manual
  step (`docs/ops/mcp-registry.md`).
- Tool names are written by hand in `llmsTxt()`, `CROSBY_WEATHER_SKILL`,
  `/developers` (both languages) and `README.md`. `test-mcp-server` fails if
  any of them is missing one.
- The record tools (`src/mcp/history-tools.js`) use the same loaders as their
  pages.
- Arguments are validated, never clamped (`validateToolArgs()`). There is no
  `Origin` check on `/mcp`.
- Not yet submitted to Anthropic's directory
  (`docs/ops/anthropic-directory.md`). Once listed, material tool changes
  need a notice.
