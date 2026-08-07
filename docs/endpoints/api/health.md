# `GET /api/health`

Three facts, and nothing else.

| | |
|---|---|
| **Builder** | `healthReport(env)` (`src/api/health.js`) |
| **Loader** | reads the single `cron_status` KV key — no feed keys, no `load*()` helpers, no upstreams |
| **Cache** | `no-store` |
| **CORS** | `*` |
| **Conditional GET** | none — the report is generated per request |
| **Status codes** | `200`, always |

## What it answers

1. **Is the site live?** Reaching the response is the answer.
2. **When did each feed last TRY to fetch new data, and did it work?**
3. **When did the data being shown on the pages actually change?**

Anything else — is that fresh *enough*, is this feed important, does this
warrant paging someone — is the caller's judgment, made from these timestamps.
The endpoint reports facts and does not grade them.

## Shape

```json
{
  "site": "live",
  "checkedAt": "2026-08-07T18:22:05.123Z",
  "cronLastRun": "2026-08-07T18:15:04.008Z",
  "feeds": {
    "weather": { "lastAttempt": "2026-08-07T18:15:02.311Z", "ok": true,  "dataChangedAt": "2026-08-07T18:15:02.311Z" },
    "water":   { "lastAttempt": "2026-08-07T18:15:03.114Z", "ok": false, "error": "NWPS 503", "dataChangedAt": "2026-08-07T17:45:01.882Z" },
    "pollen":  { "lastAttempt": "2026-08-07T17:00:02.640Z", "ok": true,  "dataChangedAt": "2026-08-07T12:00:03.417Z" },
    "news":    { "lastAttempt": null, "ok": null, "dataChangedAt": "2026-08-07T09:02:11.000Z" }
  }
}
```

| Field | Notes |
|---|---|
| `site` | always `"live"` |
| `checkedAt` | when this report was generated |
| `cronLastRun` | when the refresh loop last completed a tick. `null` until the first tick after a deploy. If this stops moving, the cron itself is dead — which no per-feed field would show. |
| `feeds.<name>.lastAttempt` | when this feed last **tried** to fetch |
| `feeds.<name>.ok` | whether that attempt succeeded — `null` when none has been recorded |
| `feeds.<name>.error` | present **only** when the last attempt failed |
| `feeds.<name>.dataChangedAt` | when the cached content itself last **changed** |
| `error` | top level, present only when the refresh record could not be read at all (e.g. the KV binding is missing). Still a `200`. |

## `lastAttempt` is an attempt, not a tick

Three feeds are throttled — `calendar` ~6h, `tropics` ~1h, `pollen` ~2h — so
most cron ticks skip them. A skipped tick is **not** an attempt: it records
nothing, and `recordCronRun()` carries the previous attempt forward. "The last
time it tried" would be worthless if a tick that did nothing reset it.

`news` reports `lastAttempt: null, ok: null` permanently. Google News blocks
Worker IPs, so that key is written out-of-band by a Claude routine; nothing in
the Worker ever attempts that fetch, and reporting a fabricated attempt would be
worse than reporting none. Its **content** is still tracked — see below.

## `dataChangedAt` is the one that catches real failures

`lastAttempt` and `dataChangedAt` answer different questions, and the gap
between them is where this site's actual failure mode lives.

`/pollen` served the same count for three business days in Aug 2026 while HHD
published new ones (root cause: our URL matchers had stopped recognizing HHD's
slugs — fixed in #158). Every refresh succeeded. Every write succeeded. The KV
entry's `updated` stamp advanced every two hours the whole time. **Anything that
judges a feed by when it was last written calls that healthy** — and the
previous version of this endpoint did exactly that, reporting `fresh` / `ok`
throughout. The owner noticed, not the monitoring.

So the cron fingerprints each cached entry every tick (FNV-1a over the JSON with
the entry's own `updated` write-stamp removed) and stamps `changedAt` only when
the fingerprint moves. A successful refresh that re-stores identical content
leaves `dataChangedAt` alone. That closes issue #156 generically — for all eight
feeds at once, rather than as a per-feed content-stamp check.

Three details worth knowing:

- **The stamp is the content's own `updated`, not the tick time.** When a change
  is detected, `changedAt` is taken from the entry that carries it, so an
  out-of-band write is stamped when it landed, not when the cron noticed.
- **`news` is covered too.** The fingerprint is taken from whatever is in KV,
  regardless of who put it there — which is the only signal that a stalled news
  routine produces at all. Detection is up to one tick (15 min) late.
- **The first record after a deploy seeds from the entry's `updated`.** There is
  no prior fingerprint to compare against, so the initial value is the best
  available approximation and becomes exact from the next change onward.

A feed whose payload embeds an upstream timestamp that moves on every fetch will
show a change on every fetch. That is still meaningfully better than "when we
last wrote the key", which is unconditionally now.

## Always 200

The previous version answered `503` whenever a critical feed was stale or
malformed, which made it useless as a liveness check and required a documented
warning not to point a monitor at it. It no longer grades anything, so there is
no verdict to encode in a status code: **`200` whenever the Worker is
answering**, including when the KV binding is missing (reported as `error`) and
when the reporter itself throws (caught in the route, same shape).

This makes it a valid liveness probe again. `/robots.txt` is still the cheaper
one if liveness is *all* you want — no KV read at all.

## Cost

One KV read per request (down from nine), and never an upstream fetch — so
polling this cannot turn a monitor's interval into an upstream request rate.

## The `cron_status` key

Written by `recordCronRun()` at the end of every tick, read only here:

```json
{ "at": "<tick>", "feeds": { "<name>": { "at": "…", "ok": true, "error": "…", "changedAt": "…", "hash": "1f3a9c02" } } }
```

`hash` is internal bookkeeping — the fingerprint the next tick compares against —
and is not exposed in the response. Deleting the key is harmless: every field
reports `null` until the next tick rewrites it, and the change stamps re-seed.
Never hand-edit it; a fabricated `ok: true` would mask a genuinely failing
upstream.

## Backward compatibility

**Deliberately broken.** The old top-level `{status, updated}` pair is gone,
along with `worker`, `summary`, and the per-feed `kv` / `freshness` /
`thresholds` / `shape` / `lastRefresh` / `data` fields. Nothing outside this repo
is known to consume them, and keeping a grading vocabulary the endpoint no
longer computes would be worse than removing it.

## Tested

`scripts/test-health.mjs` drives the real recorder, the real writer and the real
reporter against a stubbed KV: the live/no-binding paths, a successful and a
failed attempt, a throttled tick carrying its previous attempt forward, `news`
tracking content without ever recording an attempt, a corrupt entry leaving the
last change stamp alone — and, centrally, **a successful refresh that re-stores
identical content must not move `dataChangedAt`**. It also walks a real report
against the published `/openapi.json` schema, so the spec cannot drift from what
is emitted. Runs in CI inside the required `Syntax check` job.
