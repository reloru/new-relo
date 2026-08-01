# `GET /llms.txt`

Plain-language site summary for LLMs (llmstxt.org).

| | |
|---|---|
| **Builder** | `llmsTxt()` |
| **Content-type** | `text/markdown; charset=utf-8` — the body *is* markdown, same as the site's `?format=md` views |
| **Cache** | `public, max-age=3600` |

## Sections

| Section | Contents |
|---|---|
| Intro | what the site is, where weather data comes from, the 15-minute cadence |
| `## Pages` | all 19 content pages, one line each |
| `## Languages` | the `/es` prefix, hreflang pairing, and the explicit note that free-form NWS text and alerts stay in English while the JSON API and MCP server are English-only |
| `## API & agent access` | the public endpoints, the OpenAPI spec, the MCP endpoint and its 13 tool names, the server card |
| `## Data policy` | public domain, no auth, no rate limits, attribution string |
| `## Optional` | the spec's skippable-links section: both RSS feeds, `/badge.svg`, `/sitemap.xml`, the api-catalog, security.txt |

## Known gap

The `## API & agent access` list names eight public APIs and **omits
`/api/fishing`**, while the same function lists `get_fishing` among the MCP tools
four lines later. An oversight from the PR that shipped `/fishing`, not a policy
— `openapi.json`, the api-catalog and README all carry it. See
`docs/audit/2026-07-30-state.md`, section (c).

## Hand-maintained

This is one of the five prose surfaces that name the MCP tools, and one of the
places a new page or public endpoint has to be added by hand.
