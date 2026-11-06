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

The script holds all the filtering logic (plus the Workers AI layer below):
- relevance gate `areaTier`: core Crosby incl. Barrett Station vs. nearby
  towns w/ TX context
- `REJECT` for famous "Crosby" people / other-state Crosbys
- `GEO_REJECT` (word-boundary matched, so "uk" can't fire on
  "truck"/"Duke") for other-place Crosbys that otherwise rank straight in
  — Crosby in Merseyside/Liverpool/Sefton, England (UK); the Crosby
  district of Scunthorpe, Lincolnshire (UK); Crosby High
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

Incidents are capped at `MAX_INCIDENTS` (3) AND limited to one per (tier,
crime "family") — `crimeFamily()`: violence > vehicle > hazard > other; tier:
core Crosby vs nearby town — so the page shows a few DISTINCT events and one
case's many reworded headlines collapse to a single slot. Core incidents sort
before nearby ones, so a nearby-town incident takes a slot only if one is free.
`/news` leans community, not crime-blotter. Tone knobs: `MAX_INCIDENTS`, the
`crimeFamily()` buckets, and the `CRIME_WORDS`/`CRIME_STEMS`/`AFTERMATH` lists.

## Workers AI layer (`scripts/news-ai.mjs`)

Two **preview** models, called over REST with the routine's existing
`CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` (the same value as the deploy
token; confirmed to have Workers AI access from a session — **not yet confirmed
inside the routine's own environment**, see Failure behaviour). Cost is about
$0.0001 per headline (~560 input tokens at $0.24/M), roughly a cent per run;
output tokens are free.

- **`@cf/cloudflare/clef`** answers three yes/no questions per headline —
  `crosby_tx` (about Crosby, TX, not the other Crosbys), `nearby_tx` (about
  Huffman/Highlands/Baytown/Atascocita/Channelview/Kingwood/Dayton), `is_story`
  (a single story, not an index/gallery/schedule/listing/obituary page) — and
  returns a probability for each. `aiDecision()` applies `THRESH`:

  | Item | Kept when |
  |---|---|
  | regex-accepted (`core`/`near`) | `is_story >= 0.5` (veto index pages) |
  | `core` | also `crosby_tx >= 0.5` (vetoes e.g. St. Louis "Barrett Station Road") |
  | `near` | also `max(nearby_tx, crosby_tx) >= 0.5` |
  | `near` **incident** | also `nearby_tx >= 0.95` and `is_story >= 0.8` |
  | `maybeCore` / `maybeNear` (**rescue**) | `is_story >= 0.8` and `crosby_tx >= 0.8` / `nearby_tx >= 0.9`; a rescued incident in a nearby town also needs `nearby_tx >= 0.95` |

  `maybeCore`/`maybeNear` (`areaCandidate()` in `fetch-news.mjs`) are headlines
  that name Crosby or a nearby town and pass every hard reject but carry no Texas
  context in the text. The hard rejects (`REJECT`, `GEO_REJECT`, `SOFT_DROP`,
  `BLOTTER_RE`, `AFTERMATH`, listings) run first and **no model overrides them**.
  Veto is deliberately more lenient than rescue: the model may remove what the
  regex let in at 0.5, but may add only at 0.8-0.95.
- **`@cf/cloudflare/clairic`** reads the date a headline's announced event takes
  place (`reference_date` = the item's publish date), so numeric dates ("5/12"),
  weekdays ("this Saturday") and relative dates ("next Tuesday") are understood.
  `staleEventIndexes()` drops an item only if the date is confident
  (`confidence >= 0.9`, `p_null <= 0.1`) AND `pubTs < eventTs < now` AND the
  headline has an event/scheduling cue (`hasEventCue`) — the same three
  safeguards as `stalePastEvent()`, which still runs first.

The AI pass runs after the freshness/regex-stale gates and **before** de-dup, so a
vetoed index page cannot suppress a real story via the Jaccard check.

**Failure behaviour.** Any HTTP error, timeout (20 s), retry-exhausted 429/5xx or
malformed answer yields "no verdict" for that headline, and the regex result
stands — except that nothing is rescued and nearby-town incidents are dropped
without a verdict. The run never aborts or writes a partial snapshot because of
the models. If the routine's token lacks Workers AI access, every headline gets
"no verdict" and the page degrades to the pre-AI behaviour (plus the 3-slot
incident cap); the run prints `with no verdict` in its summary line.
`NEWS_AI=0` disables the layer (use it for a before/after diff with `DRY_RUN=1`).
`node scripts/test-news-ai.mjs` pins all of this offline (CI: "Check news AI layer").

**Measured when written (2026-11-06), 77 live headlines + 18 synthetic:** the 11
synthetic leaks (Merseyside, Scunthorpe, Crosbyton, Crosby MN/ND, Waterbury CT,
Sidney/Maxx/David Crosby, Crosby County) all scored `crosby_tx <= 0.08`; real
Crosby stories scored `>= 0.77`; index/gallery/obituary pages scored `is_story
<= 0.28`. Not measured: accuracy against hand-labelled ground truth, and clef
vs clef-omni are NOT interchangeable (they disagreed on 17 of 77 headlines at
0.5; clef-omni is looser), so keep `clef`.

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
