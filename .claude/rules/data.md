---
paths:
  - "src/cron.js"
  - "src/record.js"
  - "src/features/**/*.js"
  - "src/mcp/history-tools.js"
  - "migrations/**"
  - "scripts/seed-burnban-periods.mjs"
  - "scripts/backfill-nws-events.mjs"
  - "scripts/lib/**"
  - "scripts/fixtures/**"
---

# Data: the cache and the record

## KV holds now

- The 15-minute cron writes one key per feed. `load*()` cold-warms a missing
  or stale-shaped entry. A fetcher throws rather than store a partial
  snapshot, so an outage keeps the last good data.
- `news` is written out-of-band by a routine, because Google News blocks
  Worker IPs (`docs/ops/news-pipeline.md`).
- Keys, owners and cadence are in `.claude/skills/kv/SKILL.md`.

## D1 `crosby-record` (`env.DB`) holds everything after

- Record only what a source published or the site observed, and print the
  limits wherever the data is shown.
- `src/record.js` files each tick's observations with idempotent upserts,
  after the cache writes and isolated from them (`record.ok` on
  `/api/health`).
- `migrations/` is additive only. The deploy job applies it before the Worker
  ships, while the previous Worker is still serving.
- Pages built on D1 compute every count at request time.
- Crests are compared only with today's flood stages, and the page says so.
  Old-datum crests are never compared. A crest NOAA dates without a time
  stays a calendar date.
- USGS's annual peak flow (`gauge_peaks`) shows beside a crest only when the
  dates match. Both agencies' flows are shown, never merged.
- River flood warnings are filed live from NWS's own flood products: the
  hydrologic VTEC line names the gauge's NWS LID, which the alert API does
  not carry. Before 2026-11-12 they come from the IEM archive.
- Hand-entered rows (past burn bans) go through a committed script that
  dry-runs by default (`scripts/seed-burnban-periods.mjs`), and every date
  must be sourced. An open row would be closed by the cron.
- Tables, scopes, the archive backfill and hand-entered rows:
  `docs/ops/record.md`.

## Testing against data

Tests run the real Worker against `scripts/fixtures/kv/` and a real SQLite D1
with the migrations applied (`scripts/lib/harness.mjs`, `d1-stub.mjs`).
