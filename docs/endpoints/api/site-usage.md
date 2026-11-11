# `GET /api/site-usage`

Owner-only report of the aggregate page-request counts. What is counted and
what is never stored: `docs/ops/analytics.md`.

| | |
|---|---|
| **Handler** | `routeRequest` (`src/router.js`) → `siteUsageReport()` / `siteUsageText()` (`src/metrics.js`) |
| **Auth** | `?key=<ADMIN_KEY>`, compared with `isAdmin()`. No secret configured → `503 admin_unavailable`; wrong or missing key → `401 unauthorized` |
| **Cache** | `private, no-store` |
| **CORS** | none — same-origin only, like the other secret-gated routes |
| **Data** | D1 `hits`, read-only |

Not in `ENDPOINTS`, `openapi.json`, the api-catalog, `llms.txt` or the
`/sitemap` page, matching `/api/mcp-usage`.

## Parameters

- `days` — window length, 1–400, default 14 (Central days, ending today).
- `format=txt` — fixed-width text for a phone. Default is JSON.

## Response

```
curl -s 'https://crosbynews.com/api/site-usage?key=<ADMIN_KEY>&format=txt'
```

| Field | Meaning |
|---|---|
| `daily` | per day: requests by family — `browser`, `search-crawler`, `ai-or-other-crawler`, `script`, `unknown` |
| `browserPages` | browser requests per page (200/304 only) |
| `referrals.byCategory` | browser arrivals per referrer category, excluding `none` and `internal` |
| `referrals.search` / `.ai` / `.other` | the same, by landing page |
| `crawlers` | per crawler × `verified` × page: fetches in the window, plus `firstDay` and `lastDay` over **all retained history** — "when did Google last fetch this page" may be older than the window |
| `statuses` | requests per HTTP status |

These are request counts, not visitors: one person loading three pages is three.
`browser` means a browser-shaped user agent, which some bots also send.

## Errors

`503 database_unavailable` when the `DB` binding is missing; `500 read_failed`
when the query throws (detail goes to the log, never the response).
