# `/developers` — the developer & agent surface

Everything an API consumer or agent needs, on one page. Split off `/about` in the
2026 restructure.

| | |
|---|---|
| **Handlers** | `developersHtml(lang)` / `developersMarkdown(lang)` — `src/pages/developers.js` |
| **Content** | `DEVELOPERS` / `DEVELOPERS_ES` objects, same `{h, p, links}` shape as `ABOUT` |
| **Route** | `_fetch` → `page === "/developers"` |
| **Spanish** | `/es/developers` |
| **Cache** | `public, max-age=3600` |
| **Negotiation** | `Accept: text/markdown` or `?format=md`; `Vary: Accept` |
| **Nav label** | "Developers" / "Desarrolladores" (`m-only`, under More) |

## Content blocks

Static, from the `DEVELOPERS` object:

| Section | Covers |
|---|---|
| Public JSON API | the nine public `/api/*` endpoints, CORS, no auth, no rate limits |
| Specs & discovery | `/openapi.json`, `/.well-known/api-catalog` |
| Markdown for every page | `Accept: text/markdown` / `?format=md` |
| MCP server | `/mcp`, the 13 tools by name, the server card |
| Agent skills | `/.well-known/agent-skills/index.json` and the served `SKILL.md` |
| RSS feeds | `/alerts.xml`, `/news.xml` |
| Embeddable weather badge | `/badge.svg`, with a copy-paste `<img>` snippet |
| Terms & attribution | public-domain source data, attribution string |

**Both languages list the same English-only endpoints.** Only the prose and the
self-referential markdown link localize — the API and the MCP protocol are
English-only by design.

## Tool-name drift warning

The `MCP server` section of **both** `DEVELOPERS` and `DEVELOPERS_ES` names the
13 tools in prose. These are two of the hand-maintained places that go stale
silently when a tool is added. The others are `CROSBY_WEATHER_SKILL`, `llmsTxt()`
and `README.md`. Only `mcpTools()` is generated; `mcpServerCard()` derives from
it, and the MCP `initialize` `instructions` string names no tools at all.

Adding or renaming an MCP tool means editing all five prose surfaces in the same
PR.

## Canonical & sitemap

- Canonical `https://crosbynews.com/developers` · Spanish `/es/developers`
- `hreflangTags("/developers")`
- In `PAGE_PATHS` → `Link: rel="canonical"`
- `sitemap.xml`: yes — `changefreq: monthly`, `priority: 0.4`, no `lastmod`

## Meta

- Title from `DEVELOPERS.title` — crosbynews.com
- Description from `DEVELOPERS.description`
- OG title/description/type/url + `OG_COMMON`
- JSON-LD: `JSONLD_SITE` + **`JSONLD_DATASET`** + `jsonldDevelopers(lang)`
  (`WebPage`). `JSONLD_DATASET` is a `Dataset` node describing the public weather
  API for dataset search engines — a truthful type, unlike forecast markup, and
  this page is where it lives.
- `<link rel="manifest">`, favicon

## CSP

No inline script.

## Locale

Prose translated via `DEVELOPERS_ES`; endpoint paths, tool names and code
snippets identical in both.

## Inbound links

Not on the flat desktop topbar (`m-only`, under More). Linked from the shared
footer, `/about`, `/sitemap`, and `llms.txt`.
