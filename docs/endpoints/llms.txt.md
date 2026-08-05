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
| `## Pages` | all 19 content pages, one line each |
| `## Languages` | the `/es` prefix, hreflang pairing, and the explicit note that free-form NWS text and alerts stay in English while the JSON API and MCP server are English-only |
| `## API & agent access` | the public endpoints, the OpenAPI spec, the MCP endpoint and its 13 tool names, the server card |
| `## Data policy` | public domain, no auth, no rate limits, attribution string |
| `## Optional` | the spec's skippable-links section: both RSS feeds, `/badge.svg`, `/sitemap.xml`, the api-catalog, security.txt |

The `## API & agent access` list names **all nine public data APIs** — weather,
water, fishing, tropics, pollen, air, traffic, news, calendar — plus the OpenAPI
spec, the MCP endpoint and the server card. (`/api/health` is deliberately out:
it is a status probe, not a data endpoint, and belongs to the api-catalog's
`status` relation.) The push and news-admin endpoints are withheld here exactly
as they are from `openapi.json` and the api-catalog.

## Hand-maintained

This is one of the five prose surfaces that name the MCP tools, and one of the
places a new page or public endpoint has to be added by hand.
