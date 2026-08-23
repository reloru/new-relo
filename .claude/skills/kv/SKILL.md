---
name: kv
description: Inspect and (carefully) edit the production WEATHER KV namespace — the cache behind crosbynews.com. Always uses `--remote` so it reads real production state, not local miniflare. Knows the nine content keys, `weather` + `calendar` + `water` + `fishing` + `tropics` + `pollen` + `traffic` + `burnban` (cron-owned) and `news` (routine-owned). Use to check cache freshness or debug /news, /calendar, /water, /fishing, /tropics, /pollen, /traffic, /burn-ban, and the weather pages.
argument-hint: "[list | get <key> | put <key> <json> | delete <key>]  (key = weather | calendar | water | fishing | tropics | pollen | traffic | burnban | news)"
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

**And local state PERSISTS across runs.** It lives in `.wrangler/state/v3/kv/`
(gitignored) and survives `wrangler dev` restarts, reboots, and days of elapsed
time — so "a fresh local dev server" is not a cold cache. A local run cold-warms
KV once and every later run reads that same snapshot back, however old it is.

This is not academic: a `wrangler dev` session on 2026-08-05 was served a
`weather` value written on 2026-08-01, whose 48 hourly periods had all elapsed
two days earlier — and it was briefly misread as an empty cache, because "local
dev must be cold" is the intuitive assumption and it is wrong. To get a
genuinely cold local cache, delete the state:

```bash
rm -rf .wrangler/state          # next `wrangler dev` starts truly empty
```

## The nine content keys (different owners, different risk)
- **`weather`** — NWS forecast + active alerts, shape
  `{ updated, place, periods, hourly, alerts }` (`hourly` is the array
  `loadWeather()` checks to decide the cache is fresh). Written by the cron
  (`*/15 * * * *`) and warmed by `loadWeather()` on a cold cache. Inspecting is
  safe; a bad or deleted value self-heals within 15 min (or on the next
  request). Low risk.
- **`calendar`** — Crosby ISD school calendar, shape
  `{ updated, events: [{ summary, location, start, allDay, end }] }` (`events`
  is the array `loadCalendar()` checks for freshness). Written by the same cron
  (throttled to ~24h — Crosby ISD's calendar changes rarely) and warmed by
  `loadCalendar()` on a cold cache. Like `weather`, a bad/deleted value
  self-heals on the next cron or request. Low risk.
- **`water`** — river/bayou gauges, shape `{ updated, gauges: [...] }` (`gauges`
  is what `loadWater()` checks). Written by the same cron every tick; cold-warms
  on read. Self-heals like `weather`. Low risk.
- **`fishing`** — USGS real-time water conditions for the waters people fish,
  shape `{ updated, stations: [{ id, params:{tempC,do,ph,turb,gageFt}, observed }] }`
  (`stations` is what `loadFishing()` checks). Written by the same cron every
  tick; cold-warms on read. Self-heals like `water`. Low risk.
- **`tropics`** — Atlantic tropical outlook from NHC CurrentStorms.json, shape
  `{ updated, storms: [...] }` (`storms` is what `loadTropics()` checks; an
  empty array is the normal quiet-basin state, NOT an error). Written by the
  same cron, throttled ~1h June-November (Atlantic hurricane season, Central
  time) and ~24h the rest of the year; cold-warms on read. Self-heals. Low risk.
- **`pollen`** — the Houston Health Department's measured daily pollen & mold
  count, shape `{ updated, countDate, url, groups: {tree,weed,grass,mold},
  species }` (`loadPollen()` checks `groups` + `countDate`; `countDate` is the
  CT calendar day the count is for — weekends carry Friday's, that's normal).
  Written by the same cron, skipped entirely on Sat/Sun (Central time) and on
  weekdays only when the cached `countDate` isn't today's date yet — HHD
  publishes one count per weekday morning, so this is "have we got today's
  count" rather than a flat age throttle; cold-warms on read. Self-heals. Low risk.
- **`burnban`** — Harris County outdoor-burning ban status from the Texas A&M
  Forest Service, shape `{ updated, status, startDate }` (`loadBurnBan()`
  checks `status` is `"Yes"` or `"No"`; `startDate` is ISO or null). Written by
  the same cron, throttled ~12h (TFS's feed updates roughly daily, on a county
  judge's order rather than a schedule); cold-warms on read. Self-heals. Low risk.
- **`traffic`** — Crosby-corridor road incidents + lane closures from Houston
  TranStar's public RSS feeds, shape `{ updated, incidents, closures }`
  (`loadTraffic()` checks that `incidents` is PRESENT — either side is `null`
  when that feed was unreachable at the last refresh, vs `[]` = quiet roads,
  the normal state). Written by the same cron every tick; cold-warms on read.
  Self-heals. Low risk.
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

Also present (health, cron-owned): **`cron_status`** — `{at, feeds:{<name>:
{at, ok, error?, changedAt, hash}}}`, written by the cron at the END of every
tick and read only by `/api/health`. Two independent things live in each entry:
`at`/`ok`/`error` are the last refresh **attempt** (a throttled tick records
nothing and its previous attempt is carried forward), while `changedAt`/`hash`
track when the cached CONTENT last actually changed — the cron fingerprints
every feed key each tick, including routine-owned `news`, so a feed that keeps
refreshing successfully while serving frozen data is visible. Deleting the key
is harmless: every field reports `null` until the next tick rewrites it and the
change stamps re-seed. Never hand-edit it — a fabricated `ok:true` would mask a
genuinely failing upstream.

Also present (editorial, worker-owned): **`news_blocklist`** — `{articleLink:
blockedAtMs}` of news articles the owner hid via the `/news?admin=<ADMIN_KEY>`
nuke (written by `/api/news/delete` + `/api/news/restore`, read by `loadNews()`
and the news routine). Deleting it just un-hides every article; it self-prunes
past 60 days. Safe to inspect; deleting is low-risk (only un-hides).

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
CI=1 npx wrangler kv key get fishing  --binding WEATHER --remote | python3 -m json.tool | head -40
CI=1 npx wrangler kv key get tropics  --binding WEATHER --remote | python3 -m json.tool | head -40
CI=1 npx wrangler kv key get pollen   --binding WEATHER --remote | python3 -m json.tool | head -40
CI=1 npx wrangler kv key get traffic  --binding WEATHER --remote | python3 -m json.tool | head -40
CI=1 npx wrangler kv key get burnban  --binding WEATHER --remote | python3 -m json.tool | head -40
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
- Deleting `weather`, `calendar`, `water`, `fishing`, `tropics`, `pollen`,
  `traffic`, or `burnban` is recoverable (next request/cron re-warms it).
- To repopulate `news` properly, re-run the pipeline instead of hand-writing it:
  `CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node scripts/fetch-news.mjs`.

## Default (no args)
List the keys, then report the `updated` / freshness of `weather`, `calendar`,
`water`, `fishing`, `tropics`, `pollen`, `traffic`, `burnban`, and `news`.
