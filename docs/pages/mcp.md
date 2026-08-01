# `GET /mcp` — MCP server explainer (human-facing)

The human page a browser gets when it opens `/mcp`. **The JSON-RPC protocol at
`POST /mcp` is a different interface and is documented separately** — see
`docs/endpoints/mcp.md`.

| | |
|---|---|
| **Handlers** | `mcpInfoHtml(lang)` / `mcpInfoMarkdown(lang)` — `src/index.js` |
| **Route** | `_fetch` → `path === "/mcp"`, GET/HEAD branch; `path === "/es/mcp"` for Spanish |
| **Spanish** | `/es/mcp` — **GET/HEAD only; any other method 404s.** It is a page, not an endpoint. |
| **Cache** | `public, max-age=3600` |
| **Negotiation** | `Accept: text/markdown` or `?format=md`; `Vary: Accept` |
| **Extra headers** | `Allow: GET, HEAD, POST, OPTIONS` and the MCP CORS headers (on `/mcp` only) |

## Method dispatch on `/mcp`

Order matters:

1. `OPTIONS` → 204 with `MCP_CORS`
2. `GET`/`HEAD` with `Accept: text/event-stream` → **405**, `Allow: POST,
   OPTIONS`. Checked *first*, so it wins over markdown for a combined Accept.
   The `Allow` deliberately omits GET — that is the Streamable HTTP spec's "no
   SSE stream here" signal.
3. Any other `GET`/`HEAD` → this page. HEAD is treated as GET (the runtime strips
   the body), so `curl -I /mcp` mirrors GET instead of 405ing.
4. `POST` → the protocol (`docs/endpoints/mcp.md`)
5. Anything else → 405

## Content blocks

| Block | Source |
|---|---|
| What MCP is and what this server does | static |
| Tool list — name + description, one `<li>` each | **generated from `mcpTools()`**, so it cannot drift from the protocol |
| How to connect, with a copy-paste `claude mcp add` command | static |
| Pointer to the server card and OpenAPI spec | static |

## Canonical & sitemap

- Canonical `https://crosbynews.com/mcp` · Spanish `https://crosbynews.com/es/mcp`
- `hreflangTags("/mcp")` — the en/es pair is linked reciprocally
- **Not in `PAGE_PATHS`**, so unlike the other 19 content pages this response
  carries no HTTP `Link: rel="canonical"` header. The in-HTML canonical still
  does the work.
- **Not in `sitemap.xml`.**
- **Indexable.** The old `noindex` meta was removed 2026-07-13 so Google's AI
  Overviews / AI Mode can cite `/mcp` as a supporting link — a page must be
  indexed to be AI-citable. That intent and the sitemap omission sit oddly
  together; recorded in `docs/audit/2026-07-30-state.md`, finding 4.

## Meta

- Title "MCP Server" / "Servidor MCP" — crosbynews.com
- Per-language description
- `theme-color` `#0b3d61`
- **No JSON-LD.** This is the one HTML page that emits no `JSONLD_SITE` block.
- `<link rel="manifest">`, favicon SVG + ICO alternate

## CSP

No inline script.

## Locale

`/es/mcp` is a Spanish **human explainer only**. The protocol is English-only and
lives at `/mcp`; the Spanish page repeatedly tells readers to connect to `/mcp`,
never `/es/mcp`. A POST to `/es/mcp` 404s by design.

Tool names and descriptions come from `mcpTools()` and are English in both
languages.
