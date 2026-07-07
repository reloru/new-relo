---
name: kv
description: Inspect and (carefully) edit the production WEATHER KV namespace — the cache behind crosbynews.com. Always uses `--remote` so it reads real production state, not local miniflare. Knows the five keys, `weather` + `calendar` + `water` + `tropics` (cron-owned) and `news` (routine-owned). Use to check cache freshness or debug /news, /calendar, /water, /tropics, and the weather pages.
argument-hint: "[list | get <key> | put <key> <json> | delete <key>]  (key = weather | calendar | water | tropics | news)"
allowed-tools: Bash(npx wrangler kv key list *), Bash(npx wrangler kv key get *)
---

# WEATHER KV

Read and manage the `WEATHER` KV namespace. Run from the repo root so wrangler
resolves `--binding WEATHER` from `wrangler.jsonc` (namespace id
`da96de7daed84b69b32778058b374d5f` is the fallback via `--namespace-id`).

## The one rule: always `--remote`
`wrangler kv key ...` defaults to **local miniflare** state. Without `--remote`,
a `get` reports "Value not found" even though production has the key. Every
command below passes `--remote` — keep it.

## The five keys (different owners, different risk)
- **`weather`** — NWS forecast + active alerts, shape
  `{ updated, place, periods, hourly, alerts }` (`hourly` is the array
  `loadWeather()` checks to decide the cache is fresh). Written by the cron
  (`*/15 * * * *`) and warmed by `loadWeather()` on a cold cache. Inspecting is
  safe; a bad or deleted value self-heals within 15 min (or on the next
  request). Low risk.
- **`calendar`** — Crosby ISD school calendar, shape
  `{ updated, events: [{ summary, location, start, allDay, end }] }` (`events`
  is the array `loadCalendar()` checks for freshness). Written by the same cron
  (throttled to ~6h) and warmed by `loadCalendar()` on a cold cache. Like
  `weather`, a bad/deleted value self-heals on the next cron or request. Low risk.
- **`water`** — river/bayou gauges, shape `{ updated, gauges: [...] }` (`gauges`
  is what `loadWater()` checks). Written by the same cron every tick; cold-warms
  on read. Self-heals like `weather`. Low risk.
- **`tropics`** — Atlantic tropical outlook from NHC CurrentStorms.json, shape
  `{ updated, storms: [...] }` (`storms` is what `loadTropics()` checks; an
  empty array is the normal quiet-basin state, NOT an error). Written by the
  same cron throttled ~1h; cold-warms on read. Self-heals. Low risk.
- **`news`** — local news, shape `{ updated, items: [...], source }`. Written
  ONLY out-of-band by `scripts/fetch-news.mjs` (a Claude routine); the Worker
  just renders it. **Overwriting or deleting `news` loses the snapshot until the
  next routine run (up to ~a day).** Treat writes/deletes here as destructive.

Also present (Web Push, don't hand-edit): `push_notified` (cron dedupe list of
already-pushed alert IDs — first created when a severe warning actually pushes,
so it's absent until then; that's the normal quiet state, not a bug) and one
entry per subscriber under the `push:` prefix (anonymous push subscriptions).
Deleting a `push:` entry just unsubscribes that device; deleting
`push_notified` re-notifies every active severe warning next tick. `list`
shows these alongside the content keys.

## Read (safe)
List keys:
```bash
npx wrangler kv key list --binding WEATHER --remote
```
Get a key. **Prefix `CI=1`** — wrangler prints a one-line "Cloudflare agent
skills are available" banner to *stdout* that otherwise corrupts a JSON pipe;
`CI=1` suppresses it (so does `... | grep -v 'agent skills'`). The `weather`
value is large (~48 hourly periods), so pipe through a formatter (`python3 -m
json.tool`, or `head -c 800` if `python3` is unavailable):
```bash
CI=1 npx wrangler kv key get weather  --binding WEATHER --remote | python3 -m json.tool | head -40
CI=1 npx wrangler kv key get calendar --binding WEATHER --remote | python3 -m json.tool | head -40
CI=1 npx wrangler kv key get water    --binding WEATHER --remote | python3 -m json.tool | head -40
CI=1 npx wrangler kv key get tropics  --binding WEATHER --remote | python3 -m json.tool | head -40
CI=1 npx wrangler kv key get news     --binding WEATHER --remote | python3 -m json.tool | head -40
```
For freshness, read the `updated` field rather than eyeballing the blob.

## Write / delete (guarded — confirm first)
These are intentionally NOT pre-authorized, so they trigger a permission prompt.
A value is read back with `.get(key, "json")`, so it **must be valid JSON in the
expected shape** or the page that renders it breaks. State which key and why
before running; for `news`, confirm the user accepts losing the current snapshot
until the routine reruns.
```bash
npx wrangler kv key put    <key> '<json>' --binding WEATHER --remote
npx wrangler kv key delete <key>          --binding WEATHER --remote
```
- Deleting `weather`, `calendar`, `water`, or `tropics` is recoverable (next
  request/cron re-warms it).
- To repopulate `news` properly, re-run the pipeline instead of hand-writing it:
  `CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node scripts/fetch-news.mjs`.

## Default (no args)
List the keys, then report the `updated` / freshness of `weather`, `calendar`,
`water`, `tropics`, and `news`.
