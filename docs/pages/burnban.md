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
| Status panel — green "no ban" / orange "ban in effect" / gray "status unavailable" | `burnban` KV |
| "Checked \<time\> CT." freshness line, directly under the panel | `data.updated` |
| Status-history line, directly under the freshness line | `burnbanSince(data, lang)` |
| "Right now in Crosby" fire-weather strip — wind/gusts/humidity/rain chance, plus any Red Flag Warning or Fire Weather Watch | `burnbanFireWeather(weather, lang)` from the `weather` KV |
| "Before you burn" — a lead paragraph, then the 6-item checklist | `burnbanLead(data, lang)` + `burnbanChecklist(lang)` |
| "What a burn ban means" evergreen guide — issuing authority, unincorporated scope, Class C penalty, TFS-is-not-the-authority | static |
| "Frequently asked questions" (5 `<details>`) | `burnbanFaq(lang)` |
| "Resources" section | `burnbanResources(lang)` |

The Resources list renders as **rows, not bullets** (`.links` / `.link-note`):
the label carries the colour and weight, the note sits under it in `--muted`,
and a `--line` rule separates each entry. As `label &mdash; note` on one
0.92rem line it was eight identically-coloured links stacked with nothing
between them — unscannable, and the first thing a reader reported.

`burnbanLead` / `burnbanChecklist` / `burnbanFaq` / `burnbanResources` are **shared content
objects**: the HTML and Markdown renderers both consume them, per the
site-wide one-object-per-page rule, so the two representations cannot drift.
Each entry carries either a `path` (an English internal path each renderer
localizes its own way — relative for HTML, `canonicalFor` for Markdown) or an
absolute external `url`.

## Safety framing — the load-bearing part

This page is a search landing page for "is there a burn ban," so the green
panel is the most misreadable element on the site. Two claims must not blur:

- **"No ban" ≠ "you may burn."** Texas has rules that always apply — about
  what may be burned and when — so the county's status is one condition among
  several. `burnbanLead()` exists solely to say this, and it heads the
  checklist rather than floating under the status panel (as a boxed callout
  there it read as a detached cut-out and left the checklist looking
  unrelated).

  **Phrasing trap:** an earlier version said Texas "restricts outdoor burning
  statewide whether or not a ban is in effect." Readers took that as a
  standing never-burn-anything order. "Texas has its own rules about what
  you're allowed to burn and when" is the same fact without the false
  implication. Don't regress it.

- **Everyday words only.** This page is read mid-decision by people who are
  not lawyers. "The order in force is what controls", "permitted under",
  "the material is allowed" — all replaced. Checklist headings are
  instructions ("Make sure…", "Check…"), not noun labels.
- **Household trash is effectively never burnable in Crosby.** The
  domestic-waste exception applies only where local government does **not**
  provide garbage collection. Crosby has collection. The page's first version
  listed "trash burning" as an example of what a *ban* prohibits, which
  implied it was fine the rest of the year — **do not reintroduce that
  framing.** This now lives in the FAQ ("Can you burn trash in Crosby?")
  rather than the checklist: squeezed into a checklist item it referenced
  "that exception" before defining it, which read as gibberish.
- **Scope is the unincorporated county.** A Harris County ban is issued by the
  county judge / Commissioners Court and covers unincorporated Harris County —
  where Crosby is. Cities inside the county set their own rules, so "anywhere
  in the county" is wrong.

The concrete numbers in the checklist (wind 6–23 mph, one hour after sunrise
to one hour before sunset, 300 ft from neighbouring structures, the never-burn
material list) are the actual requirements of **30 TAC 111.219**, not general
advice. Verify against the rule before editing any of them.

## Status history — two stamps, and why

The KV entry carries **two** history stamps, and conflating them makes the
page assert something false:

| Field | Meaning | Moves when |
|---|---|---|
| `trackingSince` | first observation ever recorded | never |
| `statusSince` | first observation of the **current** status | only on a real status flip |

`burnbanHistory(prev, next)` (pure, shared by the cron and `loadBurnBan`'s
cold-warm) carries them forward; **`burnbanSince(data, lang)` is the only
thing allowed to turn them into a sentence.**

The trap: when the two are **equal**, no change has ever been witnessed, so
the honest line is *"No ban in any check since we began tracking on X"*.
Rendering `statusSince` directly would instead say *"No ban reported since
X"*, which a reader takes as **"a ban ended on X"** — invented, on a page
people use to decide whether to light a fire. An active ban prefers TFS's own
`startDate`, which is authoritative rather than inferred from our polling.

`scripts/test-burnban-history.mjs` pins this (wired into CI as **"Check
burn-ban logic"**). Its assertions are mostly about what the page
must *not* say; it was mutation-checked by inverting the equality test, which
turns 5 assertions red.

## Fire weather — negative verdicts only

`burnbanFireWeather(weather, lang)` reads the shared `weather` KV cache and is
**asymmetric on purpose**: it may report that conditions are *not* permitted —
wind wholly outside the 6–23 mph window, gusts over 23, an active Red Flag
Warning or Fire Weather Watch — but it must **never** signal that burning *is*
permitted. A positive verdict would read as legal permission, and legality
depends on the county order, the material, the time of day, and local
restrictions no weather feed can see. **Only add negative signals to that
function.**

A wind range that straddles a boundary ("5 to 10 mph") deliberately produces
no verdict at all; flagging it as too calm would be wrong half the time.

The same test file pins this, including a sweep of every string the function
can emit in both languages for anything readable as permission. Both
invariants were mutation-checked: flagging a straddling range turns 1
assertion red, and leaking a positive verdict turns 3 red.

The strip is loaded failure-tolerantly in the router — a weather-cache miss
degrades `/burn-ban` to its county-status form rather than 502ing it, and
`burnbanFireWeather` returns `null` (strip hidden) when there is nothing to
say.

Resolution is bounded by the refresh cadence, which is why the copy says "in
our checks" rather than claiming the hour a county order actually changed.

## Official sources linked

| Constant | URL | Role |
|---|---|---|
| `BURNBAN_OFFICIAL_URL` | `tfsweb.tamu.edu/…/burn-bans-and-information/` | TFS statewide tracker — the data source, **not** the issuing authority |
| `BURNBAN_COUNTY_URL` | `hcfmo.net/Resources/Wildfire-Burn-Bans` | Harris County Fire Marshal — the local authority and the order's exceptions |
| `BURNBAN_STATE_RULES_URL` | `tceq.texas.gov/goto/rg-049` | TCEQ "Outdoor Burning in Texas" (RG-049) — the statewide rules |
| `BURNBAN_MAP_URL` | `tfsfrp.tamu.edu/wildfires/DecBan.png` | TFS statewide burn-ban map |
| `BURNBAN_DROUGHT_URL` | `droughtmonitor.unl.edu/…?fips_48201` | US Drought Monitor, Harris County |

The last two are **linked, never embedded.** Embedding either would need an
origin proxy (the CSP allows no external image host) *and* would trigger the
Drought Monitor's reproduction-attribution requirement — too much cost for a
statewide graphic on a county page. Linking incurs neither.

All three were verified to return 200 when the page shipped. A dead link on a
safety page is a real defect — recheck them when touching this section.

## Data

Cron + KV, key `burnban`, cron-owned, throttled to ~4h (was 12h; tightened
2026-08-26 so a status change during active fire weather doesn't sit stale for
half a day). TFS's feed updates roughly daily (a county judge's order, not a
fixed schedule), so 4h still doesn't hammer the feed.

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

## Freshness — its own line, not a trailing clause

`data.updated` used to render as the last clause of the long intro sentence
("...rechecked about every 12 hours. Checked 1:15 AM CT."), where a reader
reported missing it entirely. It's now its own bold line directly under the
status panel, ahead of the status-history line — "is this still true right
now" is the first question on a page read mid-decision, before "how long has
it been true." Same `.checked`/`.since` bold/`--ink` treatment so the two read
as one voice; HTML and Markdown carry it identically.

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
