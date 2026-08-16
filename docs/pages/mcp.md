# `GET /mcp` — MCP server explainer (human-facing)

The human page a browser gets when it opens `/mcp`. **The JSON-RPC protocol at
`POST /mcp` is a different interface and is documented separately** — see
`docs/endpoints/mcp.md`.

| | |
|---|---|
| **Handlers** | `mcpInfoHtml(lang)` / `mcpInfoMarkdown(lang)` — `src/mcp/server.js` |
| **Route** | `routeRequest` (`src/router.js`) → `path === "/mcp"`, GET/HEAD branch; `path === "/es/mcp"` for Spanish |
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
| **Spanish only:** an `Idioma` card — where the endpoint really is, that you can use it in Spanish anyway, and the alert-translation caveat | static |
| Tool list — one `<li>` each | **generated from `mcpTools()`**, so it cannot drift from the protocol. English: `code` name + English description. Spanish: **Spanish name** + `code` name + Spanish description, from `MCP_TOOL_ES` |
| How to connect, with a copy-paste `claude mcp add` command | static |
| Pointer to the server card and OpenAPI spec | static |

## Canonical & sitemap

- Canonical `https://crosbynews.com/mcp` · Spanish `https://crosbynews.com/es/mcp`
- `hreflangTags("/mcp")` — the en/es pair is linked reciprocally
- **In `PAGE_PATHS`**, so this response carries the HTTP `Link: rel="canonical"`
  header like every other content page. `PAGE_PATHS` matches on pathname, not
  method, so a `POST /mcp` JSON-RPC response carries it too — inert for MCP
  clients, which read the body and the `mcp-*` headers.
- **In `sitemap.xml`** — `changefreq: monthly`, `priority: 0.4`, both languages.
- **Indexable.** The old `noindex` meta was removed 2026-07-13 so Google's AI
  Overviews / AI Mode can cite `/mcp` as a supporting link — a page must be
  indexed to be AI-citable, and a crawler working from the sitemap has to be
  able to find it.

**This page is the standing example of a route outgrowing its own machinery.**
`/mcp` began as protocol-only; when it grew an HTML explainer, none of the things
that treat pages as pages — `PAGE_PATHS`, `sitemapXml()`, the Open Graph block,
`JSONLD_SITE` — were updated to match, and each omission then read as deliberate
to the next person. All four were closed 2026-08-01 (audit finding B6). When a
non-page route becomes a page, walk the "Adding a page" checklist in CLAUDE.md
against it rather than assuming the gaps are intentional.

## Links to this page

`/sitemap` links it with the **localizing** helper, so `/es/sitemap` points at
`/es/mcp`. Its neighbours in that section use the non-localizing one, which is
correct for them — they are English-only endpoints — and was wrong here from the
moment `/mcp` gained a Spanish counterpart. Reported by the owner 2026-08-05.

Two links to `/mcp` from Spanish pages are deliberate and are allow-listed in
`scripts/check-renders.mjs`:

- **this page's own** `/mcp` references — the Idioma section exists to say the
  protocol is English-only and to connect to `/mcp`, never `/es/mcp`
- **`/developers`**, where the link's label *is* the endpoint URL. A POST to
  `/es/mcp` 404s by design, so localizing it would document a broken endpoint.
  **The Spanish page carries a second, separate link to `/es/mcp`** labelled as
  the Spanish explainer, so a reader who wants the explanation in Spanish has
  one. That pairing is what makes the exception honest: the endpoint entry keeps
  label and href identical, which a developers page needs, and the human page is
  still reachable in the reader's language. Before it existed, the Spanish note
  promised "un GET muestra una página explicativa" and delivered the English one
  — reported by the owner 2026-08-05, after the first fix in this area missed it.

## Meta

- Title "MCP Server" / "Servidor MCP" — crosbynews.com
- Per-language description, hoisted to a const and reused verbatim by
  `og:title` / `og:description` so the two cannot drift
- `theme-color` `#0b3d61`
- Open Graph: `og:title`, `og:description`, `og:type`, per-page `og:url`, plus
  the shared `OG_COMMON` — like every other page
- `JSONLD_SITE` — like every other page
- `<link rel="manifest">`, favicon SVG + ICO alternate

## CSP

No inline script.

## Locale

`/es/mcp` is a Spanish **human explainer only**. The protocol is English-only and
lives at `/mcp`; the Spanish page repeatedly tells readers to connect to `/mcp`,
never `/es/mcp`. A POST to `/es/mcp` 404s by design.

**The Spanish page is fully localized copy over that unchanged English
protocol** (2026-08-16). Tool titles and descriptions on `/es/mcp` come from
`MCP_TOOL_ES` in `src/mcp/server.js` — presentation layer only. The protocol
never sees it: `mcpTools()`, `initialize`, and the server card stay English, and
no tool takes a language argument. The tool's real `name` stays in `<code>`
beside the Spanish title, because that is the identifier the agent actually
calls; a reader who wants raw technical metadata has the server card linked in
the same section.

Two things keep this honest rather than making it a sixth stale prose surface:

- The list is still driven by `mcpTools()`, so a new tool **appears** on the
  Spanish page (in English) rather than vanishing from it.
- `scripts/check-renders.mjs` **fails the build** on a tool with no
  `MCP_TOOL_ES` entry, and on an orphan entry whose tool was renamed or removed.

The Spanish `Idioma` card also states the thing the page exists to prevent
readers concluding: an English-only protocol does **not** mean an English-only
experience — the agent answers in whatever language you write in. The one carve
-out it names is the same as `ES_NWS_NOTE`'s: NWS alert and detailed-forecast
wording is official English with no official Spanish edition, so a translation
explains but never replaces it. That policy is stated in-protocol too, via
`MCP_LANGUAGE_NOTE` (appended to `initialize`'s `instructions` and folded into
the `get_alerts` / `get_forecast` descriptions, since many clients read tool
descriptions and never surface `instructions`).
