# `POST /api/news/delete`

Hide a news article site-wide. Owner-only editorial control — the "nuke" behind
`/news?admin=<ADMIN_KEY>`.

| | |
|---|---|
| **Handler** | inline in `routeRequest`, shared with `/api/news/restore` |
| **Methods** | `POST` only. Any other method falls through to the 404 guard. |
| **CORS** | **none, deliberately** — same-origin only |
| **Cache** | not set; responses are not cacheable in practice |

## Request

```json
{ "link": "https://…", "key": "<ADMIN_KEY>" }
```

## Auth

`isAdmin(env, body.key)` compares against the `ADMIN_KEY` Worker secret with
`timingSafeEqual()` — constant-time over equal-length strings, short-circuiting
only on length, which reveals key length and nothing else.

## Responses

| Status | Body | When |
|---|---|---|
| 200 | `{"ok": true, "blocked": true}` | stored |
| 400 | `{"error": "invalid_request"}` | `link` missing or not a non-empty string |
| 401 | `{"error": "unauthorized"}` | body unparseable, or key mismatch |
| 500 | `{"error": "store_failed"}` | KV write threw |
| 503 | `{"error": "admin_unavailable"}` | `ADMIN_KEY` unset — the whole feature is inert |

## Storage

Writes the worker-owned `news_blocklist` KV key: `{articleLink: blockedAtMs}`.
Entries older than 60 days are pruned on every write — an article past the news
routine's 45-day freshness gate cannot reappear, so its block can go.

## Effect

`loadNews()` filters against the key, so the article vanishes **immediately** on
the next render everywhere: `/news`, the homepage card, `/api/news`, `/news.xml`.
`scripts/fetch-news.mjs` reads the same key via `loadBlocklist()` and drops those
links, so the article **stays gone** even though Google's RSS keeps returning it.

## Not documented publicly

Absent from `/openapi.json`, `/.well-known/api-catalog`, `llms.txt` and
`README.md` — deliberately and consistently. It is a secret-gated owner control
surface, not a public data API. Confirmed intentional in
`docs/audit/2026-07-30-state.md`, section (c).
