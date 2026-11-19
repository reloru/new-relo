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

`format=txt` exists because the only person who reads this reads it on a phone.
It is a fixed-width table of at most 60 columns. The response varies on
`Accept`: a browser (`text/html`) gets the same text in a `<pre>` whose font is
sized from the widest line to fit the screen, because a `text/plain` page wraps
at the window edge and breaks every column; anything else (curl, a script) gets
`text/plain`. `mcpUsageHtml()` in `src/mcp/metrics.js`.

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
outcome class, elapsed ms, and the `clientInfo.name` from `initialize` or from a 2026-07-28 `server/discover` `_meta`. Plus two
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
`[a-z0-9._-]`, truncated to 32 characters and capped at 500 distinct values with
the rest folded into `(other)`. Storage and display are separate: the JSON
carries every kept name, and `?format=txt` prints all of them too: every tool
(zero-call tools listed with 0), methods, unimplemented methods and error codes
for both 7 days and lifetime, every client for both windows, and the per-day and
per-month tables. Nothing is truncated; the record's caps bound the length.

Per-method and per-tool detail, added 2026-11-18 (earlier calls have none, and
the report says so): `methodOutcomes` (`method|outcome`), `toolOutcomes`
(`tool|outcome`) and `toolLat` (`tool|bucket`, a histogram over
25/50/100/250/500/1000/2500 ms and an open-ended top bucket). All are additive
maps over closed key sets, so shards, the cron fold and the month roll-up merge
them like the other counters. The text report shows per tool: calls, errors
(tool errors plus JSON-RPC errors), average, p95 and max, where p95 and max are
bucket upper bounds, not exact timings. Every known method (with ok / notif /
err), every unimplemented method and every error code (with its spec name) is
listed even at 0. `clientMix` (JSON and text) splits sessions opened into
ours / scanners / ai apps / monitors / registries / other by the self-reported
name (`CLIENT_KINDS`, first match wins) and lists the three busiest names in
each; it is a heuristic over caller-chosen strings, not an identity.
`ownClients` lists the names our own tooling connects with
(`MCP_OWN_CLIENTS`, currently `crosbynews-verify`, which `/verify-site` sends).
A tool call carries no caller name, so only sessions opened under those names
can be told apart; `claude-code` is anyone's. The last lines of the text report
say when the durable record was last folded and how many calls are still in
unfolded live shards (already included in the totals).

`unknownTools` records the tool name a client tried when it is not one of ours
(`tools/call` with an unknown name still counts under `(unknown)`). Unlike the
method list this set is open, so it is capped like client names: characters
narrowed to `[A-Za-z0-9._:/-]`, 40 long, 50 distinct per day, lifetime and
month with the rest folded into `(other)`. The text report lists them under
"tool names tried, not found".

The cap's **existence** is the load-bearing part, not its value. `clientInfo.name`
is caller-controlled, so without a ceiling a loop of unique names grows the
record until a `put` crosses KV's 25 MiB value limit and the counters stop
recording entirely — it guards the feature's availability, not a storage bill.
Distinct names cost no extra KV *writes*: the flush cadence sets the write
count, and a new name adds roughly 17 bytes to a value that was being written
anyway. Measured 2026-09-20, the whole record was 2,950 bytes; at this cap it
projects to well under 1% of the 25 MiB limit after a year.

The method allow-list is deliberately **wider than what the server dispatches**:
it is every `method` in the MCP spec schemas for 2025-03-26, 2025-06-18,
2025-11-25 and 2026-07-28, plus `tasks/update` from the 2026 tasks extension:
35 names, split three ways in `src/mcp/metrics.js`.

| Set | Count | Why it is separate |
|---|---|---|
| `METHODS_IMPLEMENTED` | 10 | answered by `mcpHandle` or `mcpHandleModern` |
| `METHODS_UNIMPLEMENTED` | 13 | spec **requests** this server answers `-32601` to — a nonzero count is a client asking for a capability that is not here |
| `METHODS_NOTIFICATIONS` | 12 | spec notifications; ignoring one is correct protocol behaviour, not a gap, so these are never reported as missing |

Anything outside all three becomes `(other)`. The ceiling is therefore fixed at
35 names plus `(other)` and `(invalid)`. Error codes are a closed set too:
JSON-RPC's five, plus 2026-07-28's `-32020`, `-32021` and `-32022`.

`initialize` and `ping` count as implemented although a 2026-07-28 request for
either answers 404 `-32601`: the method name is counted, not the era.

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
