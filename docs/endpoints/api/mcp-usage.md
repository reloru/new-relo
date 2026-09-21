# `GET /api/mcp-usage`

Aggregate usage counters for the MCP server at `POST /mcp`: how many calls it
receives, which tools they reach for, and how often they fail. Owner-only.

| | |
|---|---|
| **Handler** | inline in `routeRequest`, immediately after `/api/health` |
| **Builder** | `mcpUsageReport()` / `mcpUsageText()` in `src/mcp/metrics.js` |
| **Methods** | not restricted, matching `/api/health` — matched on path alone, so any verb is answered. `GET` in practice; the shared `OPTIONS /api/*` preflight advertises `GET, OPTIONS`. |
| **CORS** | **none, deliberately** — same-origin only |
| **Cache** | `private, no-store` |
| **Conditional GET** | no — the numbers move continuously and the body is small |

## Request

```
GET /api/mcp-usage?key=<ADMIN_KEY>            → JSON
GET /api/mcp-usage?key=<ADMIN_KEY>&format=txt → fixed-width table, ≤60 columns
```

`format=txt` exists because the only person who reads this reads it in a phone
terminal. It wraps at nothing narrower than 60 columns.

## Auth

`isAdmin(env, url.searchParams.get("key"))` against the `ADMIN_KEY` Worker
secret, the same mechanism and the same secret as `/api/news/delete`.

The key travels in the query string, so it appears in Cloudflare's request logs.
That is a pre-existing property of this site's admin surfaces (`/news?admin=`),
accepted here for the same reason: a single copy-pasteable `curl` matters more
than hiding a secret from logs the owner alone can read.

## Responses

| Status | Body | When |
|---|---|---|
| 200 | the report (JSON, or the text table) | ok |
| 401 | `{"error": "unauthorized"}` | `key` missing or mismatched |
| 500 | `{"error": "read_failed"}` | KV read threw. The exception detail goes to the log only — an echoed message can carry internals, and this matches `store_failed` on the other admin routes. |
| 503 | `{"error": "admin_unavailable"}` | `ADMIN_KEY` unset — the feature is inert |

## Shape

```json
{
  "site": "live",
  "checkedAt": "Sunday, Sep 20, 2026, 6:45:03 PM CDT",
  "since": "Saturday, Sep 12, 2026, 2:15:00 AM CDT",
  "rolledUpThrough": "20260920-1840",
  "pending": { "shards": 1, "calls": 12 },
  "note": "Aggregate counts for POST /mcp only. …",
  "today":     { "calls": 142, "requests": 60, "ok": 138, "notifications": 12, "rpcErrors": 1, "toolErrors": 3 },
  "last7Days": { "…same shape…" },
  "lifetime":  { "…same shape…" },
  "tools":      { "last7Days": [{ "name": "get_forecast", "calls": 311, "ms": 57284 }], "lifetime": [] },
  "methods":    { "last7Days": { "tools/call": 702 }, "lifetime": {} },
  "unimplementedRequested": { "last7Days": { "resources/templates/list": 4 }, "lifetime": {} },
  "errorCodes": { "last7Days": { "-32602": 4 },       "lifetime": {} },
  "clients":    { "last7Days": { "claude-ai": 9 },    "lifetime": {} },
  "days":   { "2026-09-20": { "…summary…" } },
  "months": { "2026-08":    { "…summary…" } },
  "rollup": { "at": "…", "ok": true, "shards": 3, "error": null }
}
```

`unimplementedRequested` is **derived at read time**, not stored, so widening
`METHODS_UNIMPLEMENTED` reclassifies history that was already recorded. The
`?format=txt` view prints it under its own "asked for, NOT implemented here"
heading rather than as another row, because it is the one figure here that
suggests an action.

`ms` is a **sum** of elapsed time across that tool's calls, so a mean is
`ms / calls`. It is not latency and must not be read as latency: Workers freeze
`Date.now()` between I/O operations, so a method that performs none (`ping`,
`tools/list`) measures `0` by construction. For `tools/call` the number is
dominated by the tool's KV read and any cold-warm upstream fetch, which does
usefully separate a warm cache from a cold one.

## What is recorded, and what is not

Recorded per JSON-RPC message: the method, the tool name for `tools/call`, an
outcome class, elapsed ms, and for `initialize` the `clientInfo.name`. Plus two
volume counters — `calls` (messages) and `requests` (POSTs), which differ
because one batch carries many messages.

**Never recorded:** IP addresses, User-Agent, tool arguments, request or
response bodies, any cross-request identifier, or any timestamp finer than the
Central calendar day in the durable record. A shard holds counts, not events,
so no per-call row exists even transiently.

Every recorded name is allow-listed before storage, because `method` and
`params.name` are caller-controlled strings and an unbounded record is a remote
storage-growth bug. Tool names outside `mcpTools()` become `(unknown)`; a
malformed envelope becomes `(invalid)`; error codes outside the five JSON-RPC
codes become `(other)`; client names are lower-cased, stripped to
`[a-z0-9._-]`, truncated to 32 characters and capped at 100 distinct values with
the rest folded into `(other)`. Storage and display are separate: the JSON
carries every kept name, while `?format=txt` prints the top 15 and totals the
remainder, because a phone terminal cannot use a hundred-line list.

The cap's **existence** is the load-bearing part, not its value. `clientInfo.name`
is caller-controlled, so without a ceiling a loop of unique names grows the
record until a `put` crosses KV's 25 MiB value limit and the counters stop
recording entirely — it guards the feature's availability, not a storage bill.
Distinct names cost no extra KV *writes*: the flush cadence sets the write
count, and a new name adds roughly 17 bytes to a value that was being written
anyway. Measured 2026-09-20, the whole record was 2,950 bytes; at this cap it
projects to well under 1% of the 25 MiB limit after a year.

The method allow-list is deliberately **wider than what the server dispatches**:
it is the full 25-method list from the MCP spec schema for both protocol
versions in `MCP_SUPPORTED_VERSIONS`, split three ways in `src/mcp/metrics.js`.

| Set | Count | Why it is separate |
|---|---|---|
| `METHODS_IMPLEMENTED` | 8 | dispatched by `mcpHandle` |
| `METHODS_UNIMPLEMENTED` | 8 | spec **requests** this server answers `-32601` to — a nonzero count is a client asking for a capability that is not here |
| `METHODS_NOTIFICATIONS` | 9 | spec notifications; ignoring one is correct protocol behaviour, not a gap, so these are never reported as missing |

Anything outside all three becomes `(other)`. The ceiling is therefore fixed at
25 names plus `(other)` and `(invalid)`.

A spec method collapsed into `(other)` would be indistinguishable from junk,
which is the whole reason for the wider list: the most actionable thing in the
record is a real client reaching for something the server lacks.

## Storage

Reads two things and writes neither:

- **`mcp_metrics`** — the durable record, folded by the cron. 90 days of daily
  detail; older days collapse into `months`, kept indefinitely; `lifetime` is
  never trimmed.
- **`mcpm:<bucket>:<shard>`** — transient per-isolate counters for a 10-minute
  **UTC** bucket, `expirationTtl` 6h. The bucket stays UTC deliberately: it is a
  time window for the rollup's closed-bucket rule, not a calendar day. Only the
  `days` keys inside the values are Central.

The endpoint merges shards the cron has not folded yet, so the answer is current
rather than up to a quarter-hour behind. **The read order is load-bearing**: it
reads `mcp_metrics` first, then lists shards, then keeps only buckets past that
record's `rolledUpThrough`. Listing first would let a cron fold land between the
two steps and count those messages twice.

## Cost

One KV read plus one list, and one read per unfolded shard — in practice one or
two. No writes, so polling it cannot disturb the rollup.

## Tested

`scripts/test-mcp-metrics.mjs`, in the required **Syntax check** job. Drives the
real `mcpHandle` and the real rollup against a stubbed KV, covering
classification of every dispatch branch, idempotency of the rollup under a
re-listed shard, cardinality bounds, retention, and that a burst of eight
messages produces exactly one shard write.

## Not documented publicly

Absent from `/openapi.json`, `/.well-known/api-catalog`, `llms.txt` and
`README.md` — deliberately and consistently, on the same reasoning as
`/api/news/delete`: a secret-gated owner control surface, not a public data API.
The counters identify nobody; what is private is the business fact of how much
the server is used.
