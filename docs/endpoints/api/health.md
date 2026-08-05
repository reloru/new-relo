# `GET /api/health`

Service health as a **monitoring contract**, not a liveness ping.

| | |
|---|---|
| **Builder** | `healthReport(env)` (`src/api/health.js`) |
| **Loader** | reads KV **directly** — deliberately not the `load*()` helpers |
| **Cache** | `no-store` |
| **CORS** | `*` |
| **Conditional GET** | none — no ETag; the report is generated per request |
| **Status codes** | `200` = ok **or** degraded · `503` = unhealthy |

## Why it is not a ping

The previous version returned the literal string `"ok"` on every path. A KV
outage, a corrupt value, and a six-hour-stale cache were indistinguishable — and
because this endpoint is the `status` relation of **every**
`/.well-known/api-catalog` entry, anything monitoring the site through the
catalog was monitoring a constant.

Two rules shape the current design.

**No live upstream probes.** It evaluates exactly the cached state the public
endpoints serve. It does *not* call `loadWeather()` and friends, because those
cold-warm on a miss — which would turn a health check into an NWS/USGS/TranStar
fetch and make a monitor's polling interval into an upstream request rate.

**Usefulness, not reachability.** "The Worker answered" is the least interesting
thing it can report; the response arriving proves it. The question worth
answering is whether the data being served is still worth serving.

## States

| `status` | HTTP | Meaning |
|---|---|---|
| `ok` | 200 | Every feed readable, well-shaped, and fresh for its own cadence. |
| `degraded` | 200 | Still serving useful data. Something is stale, a last refresh attempt failed, or a **non-critical** feed is broken. |
| `unhealthy` | 503 | A **critical** feed is unreadable, malformed, or expired. |

`503` is reserved for critical failures so that a monitor's default
"non-2xx = down" rule fires for outages and not for a stale pollen count.
`degraded` is deliberately a `200` with the detail in the body.

## Critical vs non-critical

**`weather` is the only critical feed.** It backs `/`, `/weather`, `/hourly`,
`/alerts`, `/air`, `/radar`'s footer, `/api/weather`, `/api/air`, `/badge.svg`,
`/alerts.xml` and most MCP tools — losing it is losing the site.

Every other feed backs one section page. `/fishing` being stale is a bad fishing
page, not a broken weather site, and paging someone at 3am for it would be the
wrong call.

## Per-feed checks

Each entry under `feeds` reports:

| Field | Notes |
|---|---|
| `kv` | `ok` / `missing` / `unreadable`. **Storage-level, kept separate from data-level:** `unreadable` is a KV or JSON-parse failure, `missing` is a cold cache, and neither is the same as stale. |
| `updated`, `ageSeconds` | from the cached entry's own refresh stamp |
| `freshness` | `fresh` / `stale` / `expired` / `unknown`, judged against **this feed's** thresholds |
| `thresholds` | the two numbers used, so the verdict is auditable rather than magic |
| `shape` | `ok` / `invalid` — does the entry contain *usable* data |
| `lastRefresh` | result of the last refresh **attempt**, where tracked |
| `data` | per-feed counts and sub-signals (gauge count, active storms, measured vs modeled AQI, …) |
| `critical`, `cadence`, `serves`, `problems` | context for whoever is reading at 3am |

### Freshness thresholds

Per-feed, because the cadences differ by two orders of magnitude. One global
threshold would either scream about the school calendar or stay silent while the
forecast went cold.

| Feed | Cadence | fresh ≤ | expired > |
|---|---|---|---|
| `weather` | every 15 min | 30 min | 2 h |
| `water` | every 15 min | 30 min | 2 h |
| `traffic` | every 15 min | 30 min | 2 h |
| `fishing` | every 15 min (USGS posts every 15–30) | 1 h | 4 h |
| `tropics` | ~1 h, throttled | 2 h | 6 h |
| `pollen` | ~2 h, throttled | 3 h | 12 h |
| `calendar` | ~6 h, throttled | 8 h | 48 h |
| `news` | ~daily, out-of-band routine | 36 h | 7 d |

### Shape checks

These catch a *successful* fetch that returned unusable data — the failure mode
a status code cannot see:

- `weather` — non-empty `hourly[]` and `periods[]`, `alerts[]` present, and the
  hourly **window has not fully elapsed**. That last one cannot be written as
  `!currentHourly(d)`: `currentHourly()` deliberately falls back to the last
  already-started period rather than returning null, so the hero degrades to the
  most recent known hour instead of going blank. Good for rendering, useless as
  a probe.
- `water` — non-empty `gauges[]` · `fishing` — non-empty `stations[]`
- `traffic` — `incidents` and `closures` **keys present**. `null` is a valid
  value here (that feed was unreachable at the last refresh) and is reported in
  `data`; an *absent* key means a malformed snapshot.
- `pollen` — `groups{}` and `countDate`
- `tropics` — `storms[]` present; **empty is the normal quiet-basin state**
- `news` — `items[]` present; empty is acceptable, since `/news` renders an
  honest "no recent news" rather than an error
- `calendar` — non-empty `events[]`

### `lastRefresh`

Answers "did the last refresh **attempt** succeed?", which staleness alone
cannot: an upstream that started failing five minutes ago still has fresh data.
A failed attempt degrades the service even while the data is fine — that is the
early warning that precedes staleness.

Sourced from the `cron_status` KV key, written by the cron at the end of every
tick. Three outcomes: `ok`, `failed` (with the error message), and `skipped`
(a throttled feed that was not due). **`skipped` is not reported as a success** —
conflating them would hide a feed that had quietly stopped refreshing.

`news` reports `tracked: false`: it is written out-of-band by the news routine,
so the cron has no outcome to record for it.

## Worker section

- `runtime` — always `"responding"`. Reaching the response *is* the check;
  measuring it from inside would be theatre.
- `version` — `{id, tag, timestamp}` from the `CF_VERSION_METADATA` binding, so
  a symptom can be tied to a release. `null` when the binding is absent (local
  dev, or a deploy predating it); `wrangler dev` binds it but leaves the fields
  blank, which is normalised to `null` rather than reported as a real identity.
- `bindings` — **presence only, never values.** `WEATHER` is `bound`/`MISSING`;
  each optional secret is `set`/`unset`. An unset secret is not an error (each
  feature degrades on its own) but it explains behavior — no `AIRNOW_API_KEY`
  means a modeled AQI rather than a measured one.

A missing `WEATHER` binding short-circuits the whole report to `unhealthy`,
because every feed would otherwise report an identical misleading `missing`.

## Backward compatibility

The top-level `{status, updated}` pair is preserved: `status` is still `"ok"` in
the healthy case, and `updated` is still the weather cache's stamp. Anything
reading only those two fields keeps working.

## Failure of the health check itself

Wrapped in the route. If `healthReport()` throws, the response is a `503` with
`status: "unhealthy"` and the error in `summary.problems` — never a `500`, which
a monitor would report as "site down" for what is a bug in the reporter.

## Tested

`scripts/test-health.mjs` drives the state machine off stubbed KV — unreadable,
missing, malformed, stale, expired, refresh-failed, critical vs non-critical,
binding missing — and asserts the verdicts differ. It runs in CI inside the
required `Syntax check` job. A health endpoint that regresses to always-"ok" is
invisible by construction, so it gets a test rather than a smoke check.
