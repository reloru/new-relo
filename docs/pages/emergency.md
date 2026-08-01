# `/emergency` — emergency resources

A bilingual directory of official emergency contacts for Crosby / NE Harris
County. Pure static content — **zero data loading**.

| | |
|---|---|
| **Handlers** | `emergencyHtml(lang)` / `emergencyMarkdown(lang)` — `src/index.js` |
| **Content** | `EMERGENCY` / `EMERGENCY_ES` objects, `{h, p, links}` shape |
| **Route** | `_fetch` → `page === "/emergency"` |
| **Spanish** | `/es/emergency` |
| **Cache** | `public, max-age=3600` |
| **Negotiation** | `Accept: text/markdown` or `?format=md`; `Vary: Accept` |
| **Nav label** | "Emergency" / "Emergencias" (`m-only`, under More) |

## Content blocks

All sections come from the `EMERGENCY` / `EMERGENCY_ES` objects — there is no
live data on this page and it cannot fail.

| Section | Contents |
|---|---|
| Emergency numbers | 911, HCSO non-emergency, Poison Control, 988, 211, plus a note that **Houston 311 does not cover unincorporated Crosby** |
| Official alert channels | ReadyHarris, NWS HGX |
| Flood tools | Harris County FWS, the FEMT address-level floodplain lookup, HCFCD, FloodSmart/NFIP 30-day-wait basics, our `/water` |
| Roads | TranStar, DriveTexas |
| Utilities | CenterPoint outage and gas-leak reporting |
| Industrial | East Harris County **CAER** incident line, 281-476-2237 / ehcma.org — Crosby has plants of its own |
| Shelters & recovery | Red Cross, DisasterAssistance.gov |
| Hurricane prep | H-GAC Zip-Zone evacuation maps; Crosby is outside the surge zones |

Phone numbers are `tel:` links.

**Every external link and phone number was curl-verified before shipping.**
Findings worth keeping: `texaspoison.com` is a parked domain now, so poison
numbers point at poison.org; `ready.gov`, `disasterassistance.gov` and
`ehcma.org` WAF-block datacenter curl but are canonical and correct.

## Canonical & sitemap

- Canonical `https://crosbynews.com/emergency` · Spanish `/es/emergency`
- `hreflangTags("/emergency")`
- In `PAGE_PATHS` → `Link: rel="canonical"`
- `sitemap.xml`: yes — `changefreq: monthly`, `priority: 0.5`, no `lastmod`

## Meta

- Title from `EMERGENCY.title` — Crosby, TX — crosbynews.com
- Description from `EMERGENCY.description`
- OG title/description/type/url + `OG_COMMON`
- JSON-LD: `JSONLD_SITE` + `jsonldEmergency(lang)` (`WebPage`)
- `<link rel="manifest">`, favicon

## CSP

No inline script.

## Locale

Fully translated — `EMERGENCY_ES` is a parallel content object, not a
machine translation, so both languages are hand-written. Agency names and phone
numbers are identical in both.

## Inbound links

Linked prominently from `/alerts` (the intro row directly under the status
panel, in both languages and in the markdown), from the shared footer
("Emergency" / "Emergencias"), from `/sitemap`, and from `llms.txt`. It is kept
off the flat desktop topbar deliberately, to avoid re-wrapping it.
