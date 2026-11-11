# Analytics

Current expected state of measurement for crosbynews.com. Overwritten in
place — no history; see `docs/README.md`.

**No script of any kind runs in a reader's browser to count or profile them, and
nothing identifies a visitor.** The server keeps two sets of aggregate totals:
page requests (below) and MCP protocol calls (further down).

## What the site ships

- **No analytics script of any kind.** No third-party service, no pixel, no
  beacon, and nothing loaded into the reader's browser to count or profile them.
- The CSP allows **no third-party script origin at all**
  (`contentSecurityPolicy()`, `src/discovery.js`). `script-src` is same-origin
  plus three inline hashes; `connect-src` is `'self'`. Adding any analytics
  vendor means widening both — treat that as the signal to re-read this file.
- `/privacy` and `/about` state this in both languages. **The claim and the code
  must move together**: `PRIVACY`/`PRIVACY_ES` (`src/pages/privacy.js`),
  `ABOUT`/`ABOUT_ES` (`src/pages/about.js`), and the CSP are one change, not
  four.

## Page-request counts — added 2026-11-11

Owner decision, 2026-11-11: count page requests in aggregate, server-side, so
the search work has something to be measured against. Search Console and Bing
had too little data to report anything, and Cloudflare withholds the referrer
field on this zone's plan, so before this nothing could say whether anyone
arrived from a search result.

`src/metrics.js` adds one to a total for every GET/HEAD response. The total is
keyed by exactly these, in the D1 table `hits` (`migrations/0001_hits.sql`):

| Column | Values |
|---|---|
| `day` | Central calendar day |
| `path` | a registered page or listed endpoint, else a bucket: `(other)`, `(api-other)`, `(well-known)`, `(icons)`. A request path is never stored as written — most 404s are probes for `/.env` and the like |
| `agent` | `browser`, a named crawler (`googlebot`, `bingbot`, `oai-searchbot`, `claudebot`, …), `script`, or `unknown` |
| `verified` | for a named crawler: `2` Cloudflare's verified-bot signal was on the request, `1` the request came from a network that operator crawls from (Google AS15169, Microsoft AS8075, Apple AS714/AS6185), `0` the name is only what the user agent claims |
| `ref` | a referrer category — `google`, `bing`, `duckduckgo`, `chatgpt`, `perplexity`, `claude`, `gemini`, `facebook`, `nextdoor`, …, `other-site`, `internal`, `none`. Read from the `Referer` host or a `utm_source` that names an existing category |
| `status` | HTTP status |
| `n` | the count |

**Not stored, ever:** IP addresses, user-agent strings, referring URLs or hosts,
search terms, query strings, cookies, any identifier, or any row describing a
single request. The user agent, the network number and the `Referer` header are
read once to pick a label. Every label comes from a closed set, so nothing a
caller sends can add a new value.

**Why `verified` exists.** In the 30 days before this shipped, most requests
carrying a crawler's name were scanners probing for secrets under a borrowed
user agent. An unverified `googlebot` is not Google; only `verified >= 1` rows
say anything about a search engine.

Mechanics: each isolate batches a few seconds of counts and writes them with
`n = n + ?` upserts in `ctx.waitUntil`, so the response never waits and there is
no read on the request path. A failed write is put back and carried by the next
flush. The cron deletes totals older than `RETAIN_DAYS` (400) once a day.
`SITE_METRICS` in `wrangler.jsonc` is the kill switch: anything but `"on"` and
nothing is counted.

Read it with `GET /api/site-usage?key=<ADMIN_KEY>` (add `&format=txt` for a
phone, `&days=N` for the window) — see `docs/endpoints/api/site-usage.md`.

`/privacy` describes all of this under **"Analytics and page counts"**, in both
languages, including the 13-month retention. **That section is a claim about
`src/metrics.js` and the `hits` table.** `scripts/test-site-metrics.mjs` pins
it: it pushes an address header, a full user agent, a referring URL with a
search term and a probe path through the real Worker and fails if any of them
can be read back from the table, and it fails if the table's columns change.
A new column means re-reading the privacy text.

## MCP usage counters — added 2026-09-20

`POST /mcp` keeps aggregate counts of its own traffic. This is not visitor
analytics and is not a browser tracker: it measures an agent-facing JSON-RPC
endpoint, runs entirely server-side, loads nothing into anyone's browser, sets
no cookie, and touches no CSP directive.

**Counted:** the JSON-RPC method, the tool name for `tools/call`, an outcome
class (ok / notification / rpc_error / tool_error), elapsed ms per tool, the
`clientInfo.name` an MCP client sends at `initialize`, and two volume counters
(messages, and POSTs).

**Not counted, ever:** IP addresses, User-Agent, tool arguments, request or
response bodies, any cross-request identifier, or any timestamp finer than the
Central calendar day. The stored record holds counts, not events — no per-call
row exists
even transiently, so there is nothing to correlate back to a caller.

Every stored name is allow-listed first, because `method` and `params.name`
arrive from the caller: methods outside the MCP spec's fixed 25 collapse to
`(other)`, unknown tools to `(unknown)`, and client names are sanitised,
truncated and capped at 100 distinct values. Without that, a loop of random
method names would grow the record without bound. The method list covers the
whole spec rather than only what this server implements, so a client asking for
a capability we lack is visible by name instead of buried in `(other)`.

Read it with `GET /api/mcp-usage?key=<ADMIN_KEY>` — see
`docs/endpoints/api/mcp-usage.md` for the full contract, storage layout and the
kill switch (`MCP_METRICS` in `wrangler.jsonc`).

### How /privacy discloses them

`/privacy` has a dedicated **"MCP server for AI assistants"** section, in both
languages: what the server receives (the tool request only; arguments never
stored), exactly what is counted, the retention (shards expire within 6h, daily
totals kept 90 days, then folded into monthly totals), that nothing is shared,
and that the assistant's own handling of the conversation falls under its
provider's policy. It was added when the server was prepared for Anthropic's
connector directory, whose policy requires a privacy policy explaining the
remote service's collection, usage and retention
(`docs/ops/anthropic-directory.md`).

`/about` still says, truthfully, that there is no analytics script and nothing
loads in the reader's browser to count them.

The precedent behind keeping these in lockstep: the Cloudflare beacon below ran
for months while `/privacy` denied it. **The MCP section is now a claim about
the code** — if the counters ever gain a field, change `RETAIN_DAYS` or the
shard TTL in `src/mcp/metrics.js`, or start identifying a caller, change that
section in the same PR, in both languages.

## Cloudflare Web Analytics — removed 2026-08-19

The zone previously ran Cloudflare Web Analytics with **automatic injection**.
Cloudflare inserted this at the edge, *after* the Worker had produced the
response, so it never appeared anywhere in this repo:

```html
<!-- Cloudflare Web Analytics --><script type='module'
  src='https://static.cloudflareinsights.com/beacon.min.js'
  data-cf-beacon='{"token": "..."}'></script><!-- End Cloudflare Web Analytics -->
```

It was **deleted** (not merely disabled) on 2026-08-19, along with its ~3 months
of collected data. The site config, its `site_tag` and its token are gone;
`GET /accounts/{account_id}/rum/site_info/list` returns zero sites. Re-enabling
means creating a **new** Web Analytics site with a new token.

Why it was removed: `/about` and `/privacy` claimed "no third-party analytics
scripts… on any page" while the beacon was loading on every page, and Safari's
Privacy Report listed `cloudflare.com` as a tracker contacted by crosbynews.com.
Safari was blocking it anyway, so the counts already excluded Safari visitors —
the site was paying the credibility cost of a tracker for data it wasn't fully
getting.

### The gotcha, if this is ever revisited

The beacon is **invisible to a plain `curl`**. Cloudflare only injects it for
requests that look like a browser, so:

```bash
curl -s https://crosbynews.com/ | grep -c cloudflareinsights            # 0
curl -s -A "Mozilla/5.0 (iPhone; …) Safari/604.1" \
     -H 'Accept: text/html' https://crosbynews.com/ | grep -c cloudflareinsights  # 1
```

Checking for edge-injected scripts with a default user-agent proves nothing. Use
a real browser UA **and** an HTML `Accept` header.

### Turning it off is not one switch

Three settings look like they'd stop injection. Only the last one did:

| Change | API | Result |
|---|---|---|
| `auto_install: false` | `PUT /rum/site_info/{site_tag}` | Dashboard flipped to "Enable with JS Snippet installation". **Beacon still injected.** |
| Rule `is_paused: true` | `PUT /rum/v2/{ruleset_id}/rule/{rule_id}` | Accepted. **Beacon still injected.** |
| Site disabled, then deleted | dashboard | Beacon gone; confirmed 0 hits across `/`, `/es`, `/weather`, `/alerts`, `/news`. |

Note `PUT /accounts/{account_id}/rum/v2/{ruleset_id}` returns
`10001 Unable to authenticate request` for both `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ZONE_API_TOKEN` — that path is outside their scope. The RUM API is
also aggressively rate-limited (`971 Please wait and consider throttling`);
back off rather than retrying tight.

## What still observes traffic

The page-request counts and the `/mcp` usage counters above, and Cloudflare's
own aggregate server-side request logs, kept as part of serving the site the way any host does. That is not a browser-side tracker, carries no analytics
identifier, and is disclosed in the `/privacy` "Analytics and page counts" section. Zone analytics
in the Cloudflare dashboard are derived from those logs and need no script.

## Workers Logs — off since 2026-10-07

`observability.enabled` is `false` in `wrangler.jsonc`. Until then the Worker
persisted Workers Logs with invocation logs on, so every request URL was
recorded **with its query string** (`redact_query_string` was `false`) — which on
`/news?admin=`, `/api/mcp-usage?key=` and `/api/site-usage?key=` is the `ADMIN_KEY`. Retention was 3 days
on Free and 7 on Paid.

This is the Worker's own log persistence, separate from the zone-level request
logs above, and nothing depends on it:

- the MCP usage counters live in KV (`mcp_metrics`, `mcpm:*`);
- the page-request counts live in D1 (`hits`);
- `/api/health` reads the `cron_status` KV key.

What it costs is diagnostics. Every `console.error` in the Worker (the cron's
per-feed failures, the MCP flush and rollup failures) now goes nowhere. A failing
MCP rollup is visible only as `rollup.ok` on `/api/mcp-usage`, and a failing cron
feed only through `/api/health`. To get logs back, set `enabled` to `true` and
redeploy.

Disabling stops new logs. Entries already stored age out on their own retention
window rather than being deleted.
