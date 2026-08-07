---
name: verify-site
description: Health-check the live crosbynews.com deploy with curl — every content page in BOTH languages returns 200 and is substantive, security headers present, canonical redirects are one hop, markdown negotiation works, unknown paths 404. Run after a deploy.
argument-hint: "[base-url]  (optional, defaults to https://crosbynews.com)"
allowed-tools: Bash(curl *)
---

# Verify the live site

Confirm the deployed site is healthy. Use the base URL in `$ARGUMENTS` if one was
given, otherwise `https://crosbynews.com`. Run the checks below with `curl`, then
report a compact PASS/FAIL table. For anything that FAILs, quote the actual
status/header so it's actionable.

**Deploys land in ~10–40s but take 1–2 minutes to reach every edge.** A single
curl can be served by a colo still running the PREVIOUS Worker version, and a
`?cb=` cache-buster does NOT help — this is version propagation, not caching.
When checking that a specific change went live, sample ~8 times and require
agreement before reporting either way:

```bash
for i in $(seq 1 8); do curl -s "$BASE$PATH?cb=$RANDOM-$i" | grep -c "$MARKER"; done
```

Measured 2026-08-05: 7/8 new, 1/8 old, persisting ~2 minutes past a green deploy
job. Report a mixed sample as "still propagating", never as a failure.

## 1. Routes return 200 — **both languages, every page**

**Sweep all 20 content pages in BOTH languages. Not a spot-check.** Roughly half
the site's render branches never execute under `lang="en"`, so an English-only
pass proves nothing about `/es`. This is not hypothetical: `/es/hourly` served a
502 in production across two deploys because `features/hourly.js` referenced
`ES_NWS_NOTE`, which only the Spanish branch reaches, and the checklist here said
"`/es` (Spanish spot-check)" — so `/es` was green while `/es/hourly` was down.

English pages: `/`, `/weather`, `/hourly`, `/radar`, `/alerts`, `/water`,
`/fishing`, `/tropics`, `/pollen`, `/air`, `/traffic`, `/news`, `/calendar`,
`/emergency`, `/about`, `/developers`, `/privacy`, `/contact`, `/sitemap`, `/mcp`.

Spanish: the same 20 under `/es` — `/es`, `/es/weather`, … `/es/sitemap`,
`/es/mcp`. (`/es` is the hub, not `/es/`.)

Non-page routes: `/robots.txt`, `/sitemap.xml`, `/llms.txt`,
`/api/weather`, `/api/health`, `/api/news`, `/api/calendar`, `/api/water`,
`/api/fishing`, `/api/tropics`, `/api/pollen`, `/api/air`, `/api/traffic`,
`/alerts.xml`, `/news.xml`, `/badge.svg`,
`/manifest.json`, `/icon.svg`, `/sw.js`, `/favicon.svg`, `/favicon.ico`,
`/apple-touch-icon.png`, `/radar-image`,
`/.well-known/api-catalog`, `/openapi.json`, `/.well-known/security.txt`,
`/.well-known/mcp/server-card.json`, `/.well-known/agent-skills/index.json`,
`/.well-known/agent-skills/crosby-weather/SKILL.md`.

`/mcp` matters more than its position suggests — it is the published MCP Registry
listing, the most externally depended-on route on the site. `SKILL.md` matters
because `/.well-known/agent-skills/index.json` publishes its SHA-256; a
regression there breaks a documented digest silently.

```bash
for p in / /weather /hourly … /es /es/weather /es/hourly … ; do
  printf "%s  %s\n" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE$p")" "$p"
done | grep -v '^200' || echo "all 200"
```

**`/api/health` always returns 200** — it reports facts, not a verdict, so its
status code says only that the Worker answered. The findings are in the body:

```bash
curl -s "$BASE/api/health" | python3 -m json.tool
```

Read each feed's three fields and report anything off:

- `ok: false` — that upstream failed at its last refresh attempt. The `error`
  field says why.
- `lastAttempt` far behind `cronLastRun` — for `weather`/`water`/`fishing`/
  `traffic` (every tick) that means the feed stopped being attempted at all.
  `calendar`/`tropics`/`pollen` are throttled (~6h/~1h/~2h), so lagging is
  normal for them; `news` is `null` by design (written out-of-band).
- **`dataChangedAt` far behind `lastAttempt`** — the important one. It means
  refreshes are succeeding while the content sits frozen, which is exactly how
  `/pollen` served a three-day-old count with every other signal green. Judge it
  against how often that feed's data genuinely moves: hours for weather/water/
  traffic, a day for pollen, longer for calendar and a quiet tropics basin.
- `cronLastRun` not within ~15 minutes — the cron itself has stopped.

**Also assert each page is substantive, not just 200.** A page that renders but
lost its data reads as healthy on status alone:

```bash
curl -s "$BASE$p" | wc -c    # content pages are >2KB; a bare error page is far smaller
```

## 2. Security + negotiation headers on `/`
`curl -sI "$BASE/"` and confirm each header is present:
- `strict-transport-security`
- `x-frame-options`
- `content-security-policy`
- `x-content-type-options: nosniff`
- `referrer-policy`
- `permissions-policy`
- `vary: Accept`
- `link:` (advertises the markdown alternate, sitemap, api-catalog, openapi)

## 3. Canonicalization — ONE hop each
Without following redirects (`curl -sI`), each variant must `301` straight to the
apex `https://crosbynews.com/...` (query string preserved) in a single hop. Read
the `location:` header:
- `http://crosbynews.com/`      → `https://crosbynews.com/`
- `https://www.crosbynews.com/` → `https://crosbynews.com/`
- `http://www.crosbynews.com/`  → `https://crosbynews.com/`  (still one hop)

`https://crosbynews.com/` itself must NOT redirect (expect `200`).

**`http://www` false-fails from a session.** Plain-HTTP requests to
`www.crosbynews.com` intermittently return a `503` with no `cf-ray`/`server:
cloudflare` header — that's the sandbox's outbound proxy failing to relay, not
the site (measured 2026-07-28: ~6 of 8 attempts, while `http://` apex was 12/12
and `https://www` 6/6 clean, and a GET that does get through returns
Cloudflare's real `301` page). Don't report it as a redirect regression. Re-run,
confirm the same path over `https://www`, or check from outside the sandbox.

**Parsing gotcha in this environment:** `curl -sI` here returns an extra
`HTTP/1.1 200 Connection Established` CONNECT line before the real response
(the session's outbound HTTPS proxy inserts it), so naively taking the first
`HTTP/...` line reads that CONNECT line's `200`, not the actual status — a
real `301` can misread as `200`. Skip it explicitly:
`grep "^HTTP" | grep -v "Connection Established" | head -1`. Also strip the
header value's trailing `\r` before an exact string comparison (`| tr -d
'\r'`) — curl includes it raw, so `[ "$location" = "..." ]` silently fails
even when the printed values look identical. Simplest fix: prefer
`curl -s -o /dev/null -w "%{http_code}"` (as in check 1) over parsing `-sI`
output when you only need the status code — it isn't affected by the CONNECT
line at all.

## 4. Markdown content-negotiation
`/` should return markdown (not HTML) when asked two ways:
- `curl -s "$BASE/?format=md" | head`
- `curl -s -H "Accept: text/markdown" "$BASE/" | head`

## 5. Unknown path 404s
```bash
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/this-path-does-not-exist"   # expect 404
```

When everything passes, say so plainly. Otherwise list only the failures with the
observed value next to the expected one.
