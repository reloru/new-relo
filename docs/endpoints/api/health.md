# `GET /api/health`

Liveness and cache freshness.

| | |
|---|---|
| **Handler** | inline in `routeRequest` |
| **Cache** | `no-store` |
| **CORS** | `*` |
| **Conditional GET** | none — not routed through `conditional()` |

## Response

```json
{ "status": "ok", "updated": "<weather.updated or null>" }
```

`updated` is read straight from the `weather` KV key inside a bare `try/catch`.

## Known limitation

**`status` is the literal `"ok"` on every path.** A KV outage, a corrupt value,
or a cache stale for six hours all return `200 {"status":"ok"}` — the catch
swallows the failure and leaves `updated` as `null`. So `updated` is the only
real signal, and a caller has to compute staleness itself.

This matters because `/.well-known/api-catalog` advertises this endpoint as the
`status` link of every entry, so anything monitoring the site through the catalog
is monitoring a constant. Recorded as finding 3 in
`docs/audit/2026-07-30-state.md`.

## Documented in

`/openapi.json` and the api-catalog. **Not in README.md** — an omission, not a
policy, unlike the push and admin endpoints. Also in the `/verify-site` skill's
route list.
