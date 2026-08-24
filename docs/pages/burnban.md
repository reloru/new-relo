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
| Safety caveat, shown **only on the all-clear** — "a county ban is not the only thing that decides whether you can burn" | static |
| "Before you burn" checklist (6 items) | `burnbanChecklist(lang)` |
| "What a burn ban means" evergreen guide — issuing authority, unincorporated scope, Class C penalty, TFS-is-not-the-authority | static |
| "Common questions" FAQ (4 `<details>`) | `burnbanFaq(lang)` |
| Related-links row | `burnbanRelated(lang)` |

`burnbanChecklist` / `burnbanFaq` / `burnbanRelated` are **shared content
objects**: the HTML and Markdown renderers both consume them, per the
site-wide one-object-per-page rule, so the two representations cannot drift.
Each entry carries either a `path` (an English internal path each renderer
localizes its own way — relative for HTML, `canonicalFor` for Markdown) or an
absolute external `url`.

## Safety framing — the load-bearing part

This page is a search landing page for "is there a burn ban," so the green
panel is the most misreadable element on the site. Two claims must not blur:

- **"No ban" ≠ "you may burn."** Texas prohibits outdoor burning statewide
  (30 TAC 111.201) and then allows specific exceptions; the county's status is
  one condition among several. The caveat paragraph under the green panel
  exists solely to say this.
- **Household trash is effectively never burnable in Crosby.** The
  domestic-waste exception applies only where local government does **not**
  provide garbage collection. Crosby has collection. The page's first version
  listed "trash burning" as an example of what a *ban* prohibits, which
  implied it was fine the rest of the year — **do not reintroduce that
  framing.**
- **Scope is the unincorporated county.** A Harris County ban is issued by the
  county judge / Commissioners Court and covers unincorporated Harris County —
  where Crosby is. Cities inside the county set their own rules, so "anywhere
  in the county" is wrong.

The concrete numbers in the checklist (wind 6–23 mph, one hour after sunrise
to one hour before sunset, 300 ft from neighbouring structures, the never-burn
material list) are the actual requirements of **30 TAC 111.219**, not general
advice. Verify against the rule before editing any of them.

## Official sources linked

| Constant | URL | Role |
|---|---|---|
| `BURNBAN_OFFICIAL_URL` | `tfsweb.tamu.edu/…/burn-bans-and-information/` | TFS statewide tracker — the data source, **not** the issuing authority |
| `BURNBAN_COUNTY_URL` | `hcfmo.net/Resources/Wildfire-Burn-Bans` | Harris County Fire Marshal — the local authority and the order's exceptions |
| `BURNBAN_STATE_RULES_URL` | `tceq.texas.gov/goto/rg-049` | TCEQ "Outdoor Burning in Texas" (RG-049) — the statewide rules |

All three were verified to return 200 when the page shipped. A dead link on a
safety page is a real defect — recheck them when touching this section.

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

The Spanish checklist keeps the official English alert names in parentheses
("Alerta de Bandera Roja (Red Flag Warning)") — a reader scanning for a
warning will see the English term on NWS products, so the Spanish page teaches
both, the same convention `ALERT_GUIDE_ES` uses on `/alerts`.

## Snippet control

The checklist, guide, and FAQ sit inside `data-nosnippet`. That is deliberate:
the page ranks for "crosby texas burn ban", and the snippet that should win is
the **live status**, not evergreen reference copy. The intro and the status
panel are left snippet-able. Revisit only with search-result evidence.
