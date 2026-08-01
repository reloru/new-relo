# docs/endpoints/

Current expected state for every route that is **not** a content page. Page state
lives in `docs/pages/`. No history — see `docs/README.md`.

## Every response

The exported `fetch()` wrapper stamps these on **every** response, including
errors, 304s and images:

```
strict-transport-security: max-age=63072000; includeSubDomains
x-frame-options: SAMEORIGIN
content-security-policy: <computed once per isolate>
cross-origin-opener-policy: same-origin
x-content-type-options: nosniff
referrer-policy: strict-origin-when-cross-origin
permissions-policy: geolocation=(), camera=(), microphone=(), browsing-topics=()
```

Paths in `PAGE_PATHS` additionally get `Link: …; rel="canonical"`. **No route in
this directory is in `PAGE_PATHS`** — including `/mcp`.

HSTS is also set at the Cloudflare zone edge, so it lands on edge-generated
responses the Worker never sees (notably the `www` → apex 301). Cloudflare
de-dupes, leaving one header.

## File map

Files mirror route paths. Where one handler serves several paths, they share a
file.

| File | Route(s) |
|---|---|
| `api/*.md` | the nine public data APIs plus `/api/health` |
| `api/news/{delete,restore}.md` | the admin nuke endpoints |
| `api/push/*.md` | the Web Push endpoints |
| `mcp.md` | `POST /mcp` — the JSON-RPC transport (`GET /mcp` is `docs/pages/mcp.md`) |
| `openapi.json.md` | `/openapi.json` |
| `robots.txt.md`, `llms.txt.md`, `sitemap.xml.md` | discovery files |
| `alerts.xml.md`, `news.xml.md` | the RSS feeds |
| `sw.js.md`, `manifest.json.md`, `app-icons.md` | the PWA surface |
| `app-icons.md` | `/favicon.ico`, `/favicon.svg`, `/icon.svg`, `/apple-touch-icon.png`, `/apple-touch-icon-precomposed.png` |
| `badge.svg.md` | the hotlinkable weather badge |
| `radar-image.md` | the KHGX radar proxy |
| `icons.md` | the `/icons/*` NWS icon proxy |
| `.well-known/*.md` | security.txt, api-catalog, the MCP server card, agent skills |

## Language

**Every route here is English-only** and carries no `/es` prefix. The `/es`
mapping in `_fetch` happens *after* all of these have matched, so they are
structurally out of reach of it. The one exception is a page, not an endpoint:
`/es/mcp` (see `docs/pages/mcp.md`).

## CORS

`OPTIONS` to any `/api/*` path gets a 204 preflight allowing `GET, OPTIONS` with
`access-control-max-age: 86400`.

The nine public data APIs, `/api/health`, `/api/push/*`, and the discovery files
send `access-control-allow-origin: *`. **`/api/news/delete` and
`/api/news/restore` deliberately do not** — they are same-origin only.
