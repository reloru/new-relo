# `POST /mcp` — MCP JSON-RPC transport

The Model Context Protocol server. Stateless, Streamable HTTP, JSON-RPC 2.0.

**`GET /mcp` is a different interface** — a human explainer page, documented in
`docs/pages/mcp.md`, which also records the full method-dispatch order.

| | |
|---|---|
| **Handlers** | `mcpHandle(msg, env)` (`src/mcp/server.js`), dispatched from `routeRequest` |
| **Methods** | `POST` for the protocol; `OPTIONS` → 204; `GET`/`HEAD` → the page (or 405 for `Accept: text/event-stream`); anything else → 405 |
| **CORS** | `MCP_CORS` |
| **Language** | English-only. `POST /es/mcp` **404s** — that path is a page, not an endpoint. |
| **Registry** | published as `com.crosbynews/weather`, `remotes: [{streamable-http, https://crosbynews.com/mcp}]` |
| **Anthropic directory** | ready to submit — checklist and portal fields in `docs/ops/anthropic-directory.md` |
| **Origin** | not checked, deliberately — a strict `Origin` check is a documented cause of Claude connector `initialize` timeouts, and the server is public and read-only |
| **Test** | `scripts/test-mcp-server.mjs` (CI step "Check MCP server contract") |

## Request and batching

A single JSON-RPC message, or an array of them. Each is handled in turn.

- Unparseable body → **400** with `{-32700, "Parse error"}`
- A batch containing only notifications produces no responses → **202**, no body
- Otherwise → 200 with a single object, or an array matching the request

## No SSE stream

A strict client opening the optional SSE stream sends `GET` with
`Accept: text/event-stream`. We do not offer it, so that gets **405** with
`Allow: POST, OPTIONS` — the `Allow` omits GET deliberately, as the spec's "no
SSE here" signal. That check runs *before* markdown negotiation so it wins for a
combined `Accept`.

## Methods

| Method | Behavior |
|---|---|
| `initialize` | Echoes a requested `protocolVersion` **only if it is in `MCP_SUPPORTED_VERSIONS`** (`2025-03-26`, `2025-06-18`); otherwise answers with our latest, per spec. Never parrot an unsupported version back — echoing e.g. `2026-07-28` would falsely promise that revision's semantics. Returns `serverInfo` and prose `instructions`. |
| `ping` | `{}` |
| `tools/list` | `mcpTools()` |
| `tools/call` | `mcpCallTool(name, args, env)`, in this order: (1) unknown tool → JSON-RPC **`-32602`**, before any KV read; (2) `validateToolArgs()` checks the arguments against the tool's own `inputSchema` and returns an **`isError: true` result** on failure, also before any KV read (see *Argument validation*); (3) the tool runs, and a data-load failure becomes an **`isError: true` result** naming the feed and the human page (`MCP_TOOL_SOURCES`), with the upstream detail kept in parentheses. Tool-level failures are results, not JSON-RPC errors, which is the MCP convention and lets the model read and act on them. |
| `prompts/list` | `mcpPrompts()` |
| `prompts/get` | `mcpGetPrompt(name, env)` |
| `resources/list` | `MCP_RESOURCES` |
| `resources/read` | `mcpReadResource(uri)`; unknown URI → `-32602` |
| anything else | `-32601` for a request; **no response** for a notification (e.g. `notifications/initialized`) |

Invalid envelope (missing `jsonrpc: "2.0"` or a non-string `method`) → `-32600`,
or no response at all if it had no `id`.

## Tools

Fourteen: `get_current_conditions`, `get_forecast` (optional `hours` 1–48, the
full KV hourly supply), `get_alerts`, `get_tropical_outlook`, `get_pollen`,
`get_burn_ban`, `get_air_quality`, `get_crosby_news`, `get_school_events`,
`get_river_levels`, `get_traffic`, `get_fishing`, `get_emergency_contacts`,
`get_radar`.

- Every tool carries `MCP_READ_ONLY` annotations (`readOnlyHint: true`,
  `openWorldHint: false`) so clients can skip per-call confirmation, plus
  `annotations.title` — the field the Anthropic directory reads for its listing.
  `mcpTools()` copies it from the top-level `title`, so the two cannot drift.
- Every **data** tool declares an `outputSchema` — shallow and permissive, since
  NWS and NHC objects pass through with more fields than are enumerated. Full
  docs live in `/openapi.json`.
- The two parameters, `get_forecast.hours` (1–48) and `get_school_events.limit`
  (1–60, default 15), are **validated, never clamped**: a non-integer, an
  out-of-range value (including `hours: 0`) or an unknown argument returns
  `isError` with the allowed range and what omitting it does (`MCP_OMIT_HINTS`).
  `null` counts as omitted. Until v1.7.1 these were silently clamped or fell back
  to the default, which Anthropic's directory review criteria reject ("validate
  inputs and return actionable error messages rather than silently accepting
  invalid data"). Only `type: integer` with `minimum`/`maximum` is implemented;
  `scripts/test-mcp-server.mjs` fails if a tool gains a parameter of any other
  type, so a new parameter cannot skip validation.
- `get_current_conditions` adds normalized `dewpointF` / `humidityPercent`
  alongside the raw NWS fields.
- **`get_radar` is the exception**: its result is an inline base64 GIF fetched
  server-side from the NWS KHGX still, with a text fallback when the upstream is
  down. Being an image, it has no `structuredContent` and no `outputSchema`.

## Usage counters

Every message through this endpoint is counted in aggregate: method, tool name,
outcome class and elapsed ms, plus the `clientInfo.name` sent at `initialize`.
Recording happens in the router's dispatch loop via `mcpRecord()`
(`src/mcp/metrics.js`) — it is never awaited, cannot throw into the protocol
path, and hands the KV write to `ctx.waitUntil`, so **no byte of the JSON-RPC
response and no part of its latency depends on it**.

No addresses, user agents, tool arguments or request contents are stored. Read
the totals at `GET /api/mcp-usage`; the full contract is in
`docs/endpoints/api/mcp-usage.md`. `MCP_METRICS` in `wrangler.jsonc` is the kill
switch.

## Prompt

`crosby_briefing` — `prompts/get` composes live weather, alerts, news and school
events server-side into a self-contained briefing prompt, plus river gauges above
normal, active Atlantic storms, Crosby-corridor road incidents, and Heavy-or-worse
pollen readings, **each only when present**.

## Resources

`llms.txt` and `openapi.json`, readable in-protocol via `resources/read`.

## Tool-name drift

Five hand-maintained prose surfaces name the tools and go stale silently:
`CROSBY_WEATHER_SKILL`, `llmsTxt()`, `DEVELOPERS`, `DEVELOPERS_ES`, and
`README.md`. `mcpTools()` is the generated list; `mcpServerCard()` derives from
it and cannot drift; the `initialize` `instructions` string names no tools.

**Adding or renaming a tool also means bumping `server.json`'s `version` and
`MCP_SERVER_INFO.version` in the same PR.** Bumping does not publish — the
registry listing only moves when someone runs the publish flow.

## Discovery

`/.well-known/mcp/server-card.json`.
