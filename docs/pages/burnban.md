# `/burn-ban` — Harris County burn ban status

Current outdoor-burning ban status for Harris County, TX (which includes
Crosby) from the Texas A&M Forest Service.

| | |
|---|---|
| **Handlers** | `burnbanHtml(data, lang)` / `burnbanMarkdown(data, lang)` — `src/features/burnban.js` |
| **Route** | `routeRequest` (`src/router.js`) → `page === "/burn-ban"` |
| **Spanish** | `/es/burn-ban` |
| **Cache** | `public, max-age=1800` |
| **Negotiation** | `Accept: text/markdown` or `?format=md`; `Vary: Accept` |
| **Nav label** | "Burn Ban" / "Prohibición de quemas" (`m-only`, under Weather) |

## Content blocks

| Block | Source |
|---|---|
| Status panel — green "no ban" / orange "ban in effect" (with the effective date) / gray "status unavailable" | `burnban` KV |
| "What a burn ban means" evergreen guide — countywide scope, why bans get issued, links to the official TFS tracker and `/emergency` | static |

**Countywide only, always.** TFS has no sub-county resolution, so the page
never implies a Crosby-specific status — every string that names a place says
"Harris County," never "Crosby."

## Data

Cron + KV, key `burnban`, cron-owned, throttled to ~12h. TFS's feed updates
roughly daily (a county judge's order, not a fixed schedule), so a flat 12h
gate catches a change within half a day without hammering the feed.

`fetchBurnBan()` queries TFS's public ArcGIS FeatureServer
(`gis.tfs.tamu.edu/.../EOC/BurnBan/FeatureServer/0/query`) filtered to
`County='Harris'`. Response quirks handled explicitly:

- `BurnBan` is the **string** `"Yes"`/`"No"`, not a boolean.
- `StartDate` is **epoch milliseconds** (or `null` with no active ban), not ISO.
- `FIPS` is space-padded to 10 characters by Esri convention.
- The endpoint can return **HTTP 200 with a JSON error body** on a malformed
  query — `fetchBurnBan()` checks for that shape (`json.error`) before
  trusting `features`.
- The response is matched to the Harris County feature explicitly (not just
  `features[0]`), so a future change to the query that widens the result set
  can't silently return the wrong county's status.

`fetchBurnBan()` **throws** on any of the above going wrong — a non-200, the
error-body shape, a missing Harris County feature, or an unrecognized status
string — so a transient TFS outage never wipes the last good status.
`loadBurnBan()` cold-warms, degrading to `{ status: null }` on total failure.

Worker reachability to `gis.tfs.tamu.edu` was canary-verified from the
deployed runtime — a temporary debug route, a real 200 with a real body
(observed: `BurnBan: "No"`, `FIPS: "201       "`), then removed — before any
feature code was written against it.

On throw: `renderError`, 502.

## Canonical & sitemap

- Canonical `https://crosbynews.com/burn-ban` · Spanish `/es/burn-ban`
- `hreflangTags("/burn-ban")`
- In `PAGE_PATHS` → `Link: rel="canonical"`
- `sitemap.xml`: yes — `changefreq: daily`, `priority: 0.5`, no `lastmod`

## Meta

- Per-language title and description built in `burnbanHtml`
- OG title/description/type/url + `OG_COMMON`
- JSON-LD: `JSONLD_SITE` only
- `<link rel="manifest">`, favicon

## CSP

No inline script.

## Locale

All copy on this page is site-authored editorial text (not live third-party
prose), so it's fully translated via `T()` — unlike NWS forecast/alert text,
there's no "stay in official English" exception here. "Harris County" and
"Crosby" are proper nouns and stay as-is in Spanish.
