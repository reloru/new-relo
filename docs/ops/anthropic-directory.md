# Anthropic connector directory (submission packet)

Current expected state of the `/mcp` server's readiness for, and listing in,
Anthropic's Claude connector directory. Overwritten in place — no history; see
`docs/README.md`. The official MCP Registry listing is a separate thing —
`docs/ops/mcp-registry.md`.

**Status: ready to submit, not yet submitted.** Submitting needs the owner's
paid Claude account (Pro, Max, Ultra, Team or Enterprise — free accounts
cannot submit) at **https://claude.ai/directory/manage → Submit new → MCP
connector**. A session cannot do it. Every portal field is pre-filled below.

Sources for the requirements (re-read them before relying on a detail — they
move): the submission guide `https://claude.com/docs/connectors/building/submission`,
review criteria `…/building/review-criteria`, testing `…/building/testing`,
authentication `…/building/authentication`, and the Anthropic Software
Directory Policy (support.claude.com article 13145358). Escalations:
`mcp-review@anthropic.com`.

## How the server meets the technical checklist

| Requirement | State | Where |
|---|---|---|
| Remote, public HTTPS, Streamable HTTP | yes — stateless JSON-RPC at `https://crosbynews.com/mcp`; no SSE stream (GET with `Accept: text/event-stream` → 405, per spec) | `src/router.js`, `docs/endpoints/mcp.md` |
| Auth | **none** (authless) — OAuth is only required for servers that require authentication | — |
| Every tool has `title` + the applicable hint | yes — all 14 carry `title`, `annotations.title` (the field the directory reads; added v1.7.3 after its review flagged "Missing title annotation" on all 14), `readOnlyHint: true`, `destructiveHint: false` (`MCP_READ_ONLY`) | `mcpTools()`; pinned by `scripts/test-mcp-server.mjs` |
| Tool names ≤ 64 chars | yes (longest: `get_emergency_contacts`, 22) | pinned by the same test |
| No mixed read/write tool | yes — every tool is a read | — |
| Narrow, accurate descriptions; no prompt-injection patterns | yes — descriptions state what the data is; the two schema/result strings that read as instructions to the model were rephrased as statements of fact (v1.7.1) | `mcpTools()`, `get_tropical_outlook` |
| Validate inputs, actionable errors (no bare "Bad Request") | yes — `validateToolArgs()` returns an `isError` result naming the allowed range and what omitting the argument does; load failures name the feed and the page | `src/mcp/server.js`; pinned by the test |
| Response size (claude.ai cap ~150,000 chars; Claude Code 25,000 tokens) | largest results measured live: `get_radar` ~44 KB (inline GIF), `get_forecast` with `hours: 48` ~30 KB, the rest under 11 KB | — |
| Reachable from Anthropic's egress `160.79.104.0/21` | yes — verified by real use as a Claude connector. Consequence to remember: any zone WAF, bot or rate-limit rule that challenges that range, and any `Origin` allow-list on `/mcp`, breaks the connector (Anthropic's testing guide names strict `Origin` checks and firewalls as the causes of `initialize` timeouts) | — |
| No conversation data collected | yes — aggregate counts only, no arguments stored | `docs/ops/analytics.md`, `/privacy` |
| Privacy policy covering the remote service | yes — `/privacy` "MCP server for AI assistants" section (receives, counts, retention, sharing, contact), both languages | `src/pages/privacy.js` |
| Support contact | `contact@crosbynews.com`; security `security@crosbynews.com` (also in `/.well-known/security.txt`) | `/contact` |
| Public documentation | `https://crosbynews.com/mcp` — tools, connect steps incl. Claude, example prompts, privacy & support | `mcpInfoHtml()` |
| ≥ 3 working example prompts | seven, in `MCP_EXAMPLE_PROMPTS`, each mapped to real tools | shown on `/mcp`; pinned by the test |

## Portal fields

### 1. Connection
- Server URL: `https://crosbynews.com/mcp` — the universal-URL option.

### 2. Tools
- Synced from the server. Expect 14, all in the read-only group, none flagged.

### 3. Listing
- **Server name** (≤ 100): `Crosby, TX Weather` — matches `serverInfo.title`
  and the MCP Registry title. Renaming after publication requires re-review.
- **One-liner** (≤ 200; this one is 158):
  `Live weather, alerts, air quality, pollen, flood levels, tropics, traffic, burn bans, local news and school calendar for Crosby, Texas, from official sources.`
- **Description** (≤ 2,000; this one is 1,076):

  > Live local data for Crosby, Texas and northeast Harris County, drawn from
  > official public sources and kept fresh every 15 minutes. Ask for current
  > conditions, the 7-day or hourly forecast, and active alerts from the U.S.
  > National Weather Service; the measured air-quality index from EPA/AirNow;
  > the Houston Health Department's daily pollen and mold count; the National
  > Hurricane Center's Atlantic outlook, including unnamed areas being watched;
  > river and bayou levels against NWS flood stages; USGS water conditions for
  > nearby fishing waters; Houston TranStar road incidents and lane closures;
  > the Harris County burn-ban status from the Texas A&M Forest Service; recent
  > local news headlines; the Crosby ISD school calendar; an emergency-contacts
  > directory; and the latest NWS radar image. Every tool is read-only and
  > answers with both a plain-language summary and structured data. No account,
  > no key, no personal data: the server keeps only aggregate call counts.
  > Alerts and other National Weather Service text are passed through in
  > official English, never machine-translated.

- **Categories** (1–5): pick from the portal's list — closest fits are
  weather, local / community, news, and data / reference.
- **Documentation URL**: `https://crosbynews.com/mcp`
- **Privacy policy URL**: `https://crosbynews.com/privacy`
- **Support contact**: `contact@crosbynews.com`
- **Icon**: `https://crosbynews.com/icon-512.png` (512×512 PNG; download it
  and upload). Never an SVG — see `.claude/rules/assets.md`, "No icon is an SVG".
- **URL slug**: recommended `crosby-tx-weather`. **Permanent once published.**

### 4. Use cases
- Primary use cases: the seven `MCP_EXAMPLE_PROMPTS`, verbatim from `/mcp`:
  1. "Is there any severe weather or flooding risk in Crosby, TX right now?" — `get_alerts`, `get_river_levels`
  2. "What's the hourly forecast for Crosby tomorrow afternoon?" — `get_forecast`
  3. "Is anything brewing in the Atlantic or the Gulf this week?" — `get_tropical_outlook`
  4. "How bad is the pollen in Crosby today, and is the air quality okay for a run?" — `get_pollen`, `get_air_quality`
  5. "Is there a burn ban in Harris County right now?" — `get_burn_ban`
  6. "Any wrecks or lane closures on US-90 or FM-2100 near Crosby?" — `get_traffic`
  7. "When is the next no-school day for Crosby ISD?" — `get_school_events`
- Prerequisites: none — no account, plan or setup.
- Reads / writes: **reads only**.

### 5. Company
- Company name: `crosbynews.com` (the `Organization` name in the site's JSON-LD).
- Website: `https://crosbynews.com`
- Primary contact for review updates: the owner's own address (portal-only;
  not recorded in this public repo).

### 6. Authentication
- No authentication. If the portal offers only "Always required" / "Required
  when the server asks", neither applies — no tool ever asks for sign-in.

### 7. Data handling — the owner's call
Facts for the "whose API is it" question:
- The MCP server is crosbynews.com's own service. Tools read crosbynews.com's
  own cache (Workers KV), which crosbynews.com's cron fills from public
  sources; the same data is crosbynews.com's own public REST API (`/api/*`).
- One tool calls an upstream live: `get_radar` fetches the NWS radar still
  from `radar.weather.gov` (U.S. government, public domain).
- The upstream sources are mostly U.S. government (NWS, NHC, EPA/AirNow, USGS)
  plus state/local public bodies (Houston Health Department, Texas A&M Forest
  Service, Crosby ISD's public iCal, Houston TranStar's public RSS) and
  Open-Meteo as a modeled air-quality fallback.
- **The one a reviewer might question: local news.** Headlines and links come
  from Google News RSS via an out-of-band routine (`docs/ops/news-pipeline.md`);
  only titles, source names, dates and links are returned, never article text.

On these facts "your own API" is the accurate answer. **Note to paste into the
submission** (portal note field, or the reviewer instructions if there is none):

> `get_crosby_news` returns headlines from crosbynews.com's own cache. The cache
> is filled by crosbynews.com's own out-of-band routine, which reads public
> Google News RSS search results for Crosby, TX and filters them for local
> relevance and duplicates. Only each headline's title, publisher name,
> publication date and link are returned, never article text, so the tool
> points readers to the publishers' own pages. Every other tool reads the same
> crosbynews.com cache, filled from official public sources. Personal health data: **no** (pollen
and AQI are environmental readings, not about a person). Sponsored content:
**no**.

### 8. Test & launch
- Test account: **not applicable** — authless. Reviewer instructions: "Add
  `https://crosbynews.com/mcp` as a custom connector with no authentication;
  every tool works immediately. Data refreshes every 15 minutes."
- "I ran every tool": exercised against the live v1.7.1 deploy — see
  *Verification* below.

### 9. Compliance — the owner ticks these
Seven acknowledgments. The facts behind each:
- Directory guidelines — this file.
- First-party API usage — see section 7.
- Financial transactions — none.
- AI media generation — none. `get_radar` returns an NWS radar image; it does
  not generate one.
- Prompt injection — descriptions describe the data. Local news headlines are
  third-party text, returned as data fields and never as instructions.
- Conversation data collection — none; aggregate counts only.
- Public documentation — `https://crosbynews.com/mcp`.

## Verification (re-run before submitting)

```bash
npx -y @modelcontextprotocol/inspector --cli https://crosbynews.com/mcp --transport http --method tools/list --strict
```

Expected: 16 tools, and `--strict` (schema-portability checks) reporting
**0 warnings**. Nullable `outputSchema` fields are `anyOf`
branches (`{anyOf: [{type: "string"}, {type: "null"}]}`), never
`type: ["string","null"]` — a type array is legal JSON Schema, but dialects
such as Gemini's cannot express it. `mcpTools()` guarantees this by running
every `outputSchema` through `portableSchema()` (`src/mcp/server.js`), so write
nullable fields in either form; `node scripts/test-mcp-server.mjs` fails on any
array `type`. (Before v1.7.2 the output was "0 errors, 65 warnings".)

Plus one call per tool through a Claude custom connector, and one deliberately
bad argument (e.g. `get_forecast` with `hours: 500`), which must return an
`isError` result naming the 1–48 range.

## After publication

- **Policy 3H:** notify Anthropic of any material change to tools, tool
  descriptions, data practices or the endpoint — it may trigger re-review.
  Treat a `server.json` version bump as the cue.
- Health in the portal: "Healthy" is ≤ 2% request errors over 30 days. Our
  own view of the same thing is `/api/mcp-usage` (`toolErrors`, `rpcErrors`).
- After publishing, record the listing URL and its Community/Verified label
  here, and change **Status** above.
