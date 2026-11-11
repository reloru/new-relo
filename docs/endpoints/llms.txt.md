# `GET /llms.txt`

Plain-language site summary for LLMs (llmstxt.org).

| | |
|---|---|
| **Builder** | `llmsTxt()` (`src/discovery.js`) |
| **Content-type** | `text/markdown; charset=utf-8` — the body *is* markdown, same as the site's `?format=md` views |
| **Cache** | `public, max-age=3600` |

## Sections

| Section | Contents |
|---|---|
| Intro | what the site is, where weather data comes from, the 15-minute cadence |
| `## Pages` | 20 of the 21 content pages, one line each — `/mcp` is deliberately listed under `## API & agent access` instead, as the endpoint it mostly is |
| `## Languages` | the `/es` prefix, hreflang pairing, and the explicit note that free-form NWS text and alerts stay in English while the JSON API and MCP server are English-only |
| `## API & agent access` | the public endpoints, the OpenAPI spec, the MCP endpoint and its 13 tool names, the server card |
| `## Data policy` | public domain, no auth, no rate limits, attribution string |
| `## Optional` | the spec's skippable-links section: both RSS feeds, `/badge.svg`, `/sitemap.xml`, the api-catalog, security.txt |

The `## Pages` list is every `PAGES` entry in `src/registry.js` (name + its
`llms` line). The `## API & agent access` list is every `ENDPOINTS` entry with
`group: "api"` — the ten public data APIs — followed by the MCP endpoint and
the server card. `## Optional` is every `group: "optional"` entry: `/api/health`,
`/openapi.json`, the RSS feeds, `/badge.svg`, the api-catalog, `/sitemap.xml`
and `security.txt`. (`/api/health` sits under Optional rather than with the
data APIs on purpose: it is a status probe, not a data endpoint.) The push and
news-admin endpoints are not in `ENDPOINTS` and so are withheld here exactly as
they are from `openapi.json` and the api-catalog.

## Hand-maintained

Only the prose: the opening summary, the Languages and Data policy sections,
and the line naming the MCP tools (one of the prose surfaces that name them).
The page and endpoint lists are generated, and `scripts/test-routes.mjs` fails
if one is missing.
