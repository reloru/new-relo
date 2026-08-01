# `/traffic` — roads & traffic

Incidents and lane closures on the Crosby-area corridors, from Houston TranStar.

| | |
|---|---|
| **Handlers** | `trafficHtml(data, lang)` / `trafficMarkdown(data, lang)` — `src/features/traffic.js` |
| **Route** | `_fetch` → `page === "/traffic"` |
| **Spanish** | `/es/traffic` |
| **Cache** | `public, max-age=300` |
| **Negotiation** | `Accept: text/markdown` or `?format=md`; `Vary: Accept` |
| **Nav label** | "Traffic" / "Tráfico" (`m-only`, under Community) |

## Content blocks

| Block | Source |
|---|---|
| Incident cards — road, location, type, status, lanes affected | `traffic` KV `incidents` |
| **High-water incidents render red** (`trafficIsWater`) | type matching `/high water\|flood/i` |
| Lane-closure cards — location, schedule, lanes, status | `traffic` KV `closures` |
| Camera links (`TRAFFIC_CAMERAS` → `transtarCameraPage`) | static catalog → TranStar's own per-roadway camera pages |
| Live map link | `TRANSTAR_MAP_URL` |
| Quiet-roads all-clear + evergreen "when water covers the road" guide | static |

**Camera images are never embedded or proxied.** TxDOT's terms prohibit
hotlinking and framing, so the page links TranStar's per-roadway camera pages
and the live map instead. Only RSS facts — road, location, status, lanes — are
republished, with attribution. Same model as `/news`.

Those camera pages live on **`traffic.houstontranstar.org`**
(`/cctv/transtar/by_roadway.aspx?mnu=freeway&rd=US-90` or `IH-10_East`) — the
same host as the RSS feeds, the live map and the closures page. The `www.` host
404s for this path (its `/cctv/` serves a PDF); only the plain attribution link
in the page footer points at `www.houstontranstar.org/`.

## Relevance matching

The RSS feeds carry **no coordinates**, so relevance is text matching
(`trafficRelevant`):

- Titles starting `US-90` — but **never** `US-90 Alternate` or `US-90A`, a
  different road southwest of here
- `IH-10 East`, gated on Crosby-stretch cross streets (`TRAFFIC_I10E_XSTREETS`:
  Crosby, Lynchburg, Sheldon, San Jacinto River, Cedar Bayou, Garth, Sjolander,
  Monmouth)
- Crosby-area tokens anywhere (`TRAFFIC_AREA_TOKENS`: Crosby, Runneburg, Janacek,
  Krenek, Kernohan, Barrett Station, Huffman, FM-2100, FM-1942)

Cleared incidents are dropped.

## Data

Cron + KV, key `traffic`, cron-owned, refreshed **every tick** (TranStar updates
about once a minute; incidents and high-water reports move fast).

`fetchTraffic()` reads two public RSS feeds —
`traffic.houstontranstar.org/data/rss/incidents_rss.xml` and
`laneclosures_rss.xml` — parsed by the hand-rolled `parseRssItems`.

**Each feed side is independently failure-tolerant, and the distinction is
load-bearing: `null` means that feed was unreachable at the last refresh, `[]`
means quiet roads.** `fetchTraffic()` throws only when *both* fail, so a total
TranStar outage keeps the last snapshot.

TranStar's richer JSON API (speeds, flood-warning sensors) requires a data-use
agreement and 403s without one. If that is ever obtained, the swap is localized
to `fetchTraffic()`.

Worker reachability was canary-verified from the deployed runtime on 2026-07-16 —
200 with live XML. The same canary showed **`www.drivetexas.org` times out from
Worker egress IPs**, which is why DriveTexas is link-only.

On throw: `renderError`, 502.

## Canonical & sitemap

- Canonical `https://crosbynews.com/traffic` · Spanish `/es/traffic`
- `hreflangTags("/traffic")`
- In `PAGE_PATHS` → `Link: rel="canonical"`
- `sitemap.xml`: yes — `changefreq: hourly`, `priority: 0.6`, no `lastmod`

## Meta

- Per-language title and description built in `trafficHtml`
- OG title/description/type/url + `OG_COMMON`
- JSON-LD: `JSONLD_SITE` only
- `<link rel="manifest">`, favicon

## CSP

No inline script.

## Locale

Incident types via `TRAFFIC_TYPE_ES`, statuses via `trafficStatusLabel`, guide
copy via `T()`. **Free-form lane and schedule text stays in TranStar's official
English** — the NWS-text policy.

## Related surface

Pairs with `/water` during storms: high-water incidents are the payoff for having
both.
