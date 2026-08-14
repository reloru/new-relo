# News pipeline (runs OUTSIDE the Worker)

Current expected state of the out-of-band news pipeline that feeds the
`news` KV key. Overwritten in place — no history; see `docs/README.md`.

## Why it runs out-of-band

Google News RSS is the only source with real Crosby coverage, but it
hard-blocks Cloudflare Worker datacenter IPs (503). Bing News RSS + outlet
feeds ARE reachable from the Worker but are too sparse. So news is fetched
out-of-band: `scripts/fetch-news.mjs` runs on a **Claude routine** (whose
environment is NOT IP-blocked), queries Google News for Crosby + nearby
towns, filters, and writes the result straight to the WEATHER KV `news`
key via the Cloudflare KV API. The Worker only renders that key
(`loadNews()` is read-only).

## Filtering logic

The script holds all the filtering logic:
- relevance gate `areaTier`: core Crosby incl. Barrett Station vs. nearby
  towns w/ TX context
- `REJECT` for famous "Crosby" people / other-state Crosbys
- `GEO_REJECT` (word-boundary matched, so "uk" can't fire on
  "truck"/"Duke") for other-place Crosbys that otherwise rank straight in
  — Crosby in Merseyside/Liverpool/Sefton, England (UK); Crosby High
  School in **Waterbury, CT** (matches the `crosby high` relevance token);
  and **Crosbyton, TX**
- real-estate + obituary drops
- `BLOTTER_RE` drops police-blotter / report-index boilerplate ("For
  Reports Between <date> & <date>" digests, "police blotter" roundups —
  index pages, not stories)
- `AFTERMATH` drops grief/aftermath follow-ups (vigil / "family mourns"
  rewrites) so one death doesn't spawn a string of them
- `CRIME_WORDS`/`CRIME_STEMS` for down-ranking (word-boundary matched, so
  e.g. "dead" doesn't tag "deadline")
- 45-day freshness
- `stalePastEvent()` drops "upcoming event" announcements whose date has
  passed (only when an explicit month-name date parses AND
  `pubDate < eventDate < now` AND an event/scheduling cue is present — so
  crime reports citing a past date, next-year announcements,
  retrospectives, and policy stories that merely mention a date are all
  spared)
- aggressive fuzzy de-dup (Jaccard > 0.35)

Incidents are capped at 2 AND limited to one per crime "family"
(`crimeFamily()`: violence > vehicle > hazard > other), so the page shows a
couple of DISTINCT events and one case's many reworded headlines collapse
to a single slot — `/news` leans community, not crime-blotter. Tone knobs:
the incident cap (`incidents.length >= 2`), the `crimeFamily()` buckets,
and the `CRIME_WORDS`/`CRIME_STEMS`/`AFTERMATH` lists.

## Running it

Run manually: `CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node
scripts/fetch-news.mjs` (add `DRY_RUN=1` to print the would-be payload
without writing KV — handy for testing the filters against live Google
News). The routine just needs Bash (to run node) — NOT git write. If the
routine stops, items age out at 45 days and `/news` shows an honest "no
recent news" (never errors). If a run hits a total upstream failure (every
Google query empty), it aborts WITHOUT writing, so a transient block can't
wipe the last good snapshot.

## Firing on demand

No laptop needed: the routine has an **API trigger**, so a `POST` to its
fire endpoint starts a run immediately (handy to apply a filter change now
instead of waiting for the daily schedule). The per-routine token + URL
live in the cloud-environment env vars `ROUTINE_FIRE_TOKEN` (secret,
`sk-ant-oat01-…`) and `ROUTINE_FIRE_URL`
(`https://api.anthropic.com/v1/claude_code/routines/trig_<id>/fire`). The
request MUST send `Authorization: Bearer $ROUTINE_FIRE_TOKEN` (NOT
`x-api-key`) AND `anthropic-beta: experimental-cc-routine-2026-04-01`
(omitting the beta header 400s):

```
curl -X POST "$ROUTINE_FIRE_URL" \
  -H "Authorization: Bearer $ROUTINE_FIRE_TOKEN" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: experimental-cc-routine-2026-04-01" \
  -H "Content-Type: application/json" -d '{"text":"manual news refresh"}'
```

It returns a `claude_code_session_url` and the run rewrites the `news` KV
key a few minutes later (the routine is NOT IP-blocked, unlike the
Worker). The real fire URL (with the `trig_` id) is intentionally kept in
the env var, not committed here, since this repo is public; the token is
generated/rotated in the routine's API-trigger settings at
claude.ai/code/routines (shown once — regenerating revokes the old token).
