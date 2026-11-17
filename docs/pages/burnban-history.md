# `/burn-ban/history` — past Harris County burn bans

Every past Harris County burn ban this site has found, with the source of
each date. Dates and records only: no explanation of how bans work (the owner,
2026-11-17: the page should give the dates and records, not commentary).
One level below `/burn-ban`, which stays a live status page.

| | |
|---|---|
| **Handlers** | `burnbanHistoryHtml(periods, lang)` / `burnbanHistoryMarkdown(periods, lang)` — `src/features/burnban-history.js` |
| **Route** | `PAGE_HANDLERS["/burn-ban/history"]` (`src/router.js`) |
| **Spanish** | `/es/burn-ban/history` |
| **Cache** | `public, max-age=3600` |
| **Negotiation** | `Accept: text/markdown` or `?format=md`; `Vary: Accept` |
| **Nav** | none; linked from `/burn-ban` ("Every past Harris County burn ban, with its sources") and listed in the sitemaps |
| **D1 failure** | 502 (`loadBurnBanPeriods` returns null and the handler throws), never a table with rows missing |
| **Sitemap date** | none: no `feeds`, no `lastmod` |

## Content blocks

| Block | Source |
|---|---|
| Breadcrumb "Burn Ban Status › Past Harris County Burn Bans", with `BreadcrumbList` JSON-LD | static |
| "Every ban found" table and the note under it | D1 `burnban_periods` via `banHistoryRows` / `banHistoryNote` (`burnban.js`) |
| "Drought and the law" links: Fire Marshal's burn-ban page, U.S. Drought Monitor, Texas burn ban map, Local Government Code §352.081 | `historyLinks(lang)` |

An end no source dates shows "Not found", or "By <day>" when a source bounds
it (`end_unknown = 1`, `ended_by`; migration 0007). Those rows are 2005 (lifted
by 2005-07-27, per the Houston Chronicle story of that date), June 2009 and
October 2010. The note names the 2003 ban, which has no dated source at all.

No `data-nosnippet`: everything here is the record.

## The table

The table (and its Markdown form) lists every
row of D1 `burnban_periods`, newest first: start, end ("in effect" while
open), length in days, and where each date came from. Loaded by
`loadBurnBanPeriods()`; a D1 error answers 502.

| Row kind | Start source | End source |
|---|---|---|
| Cron-observed (2026-09-17 onward) | `tfs` (Forest Service's own start date) or `observed` | `observed` (first tick seen lifted) |
| Hand-entered (`scripts/seed-burnban-periods.mjs`) | `order`: the Commissioners Court record that adopted it (Legistar), URL in `url`; or, before 2021, `news`: "Start as reported by Outlet (url)" in `note` | `order`: the court record that terminated it, URL in `end_url`; or `news` when no termination exists, outlet and URL in `note` |

Source: Harris County Commissioners Court records on Legistar
(`harriscountytx.legistar.com`), online from February 2021. Every item whose
title mentions "burn" was listed through the public API
(`webapi.legistar.com/v1/harriscountytx/matters`) on 2026-11-15. Each link is
the record's canonical `LegislationDetail.aspx?ID=…&GUID=…` page, resolved
from the API's `MatterId` through `gateway.aspx?M=L&ID=<MatterId>`. The API's
own ID does not open the page, so never build a link from it.

| Ban | Adopted | Terminated |
|---|---|---|
| 2009-02-10 → 2009-05-06 | fmo: Harris County Fire Marshal's Office release, Feb. 10, 2009 | news: Houston Chronicle (lifted by the Fire Marshal's Office) |
| 2011-04-19 → 2011-12-21 | news: Houston Chronicle | news: ABC13, Dec. 20, 2011, effective Dec. 21 (dateline as displayed; not in the page's markup) |
| 2013-07-09 → 2013-07-23 | news: Houston Chronicle | news: Houston Chronicle (the same article, published 2013-07-23) |
| 2015-08-11 → 2015-08-25 | news: Houston Public Media | news: Houston Public Media, Houston Chronicle |
| 2022-06-28 → 2022-08-23 | 22-4024 | 22-5227 |
| 2022-10-25 → 2022-11-15 | 22-6919 | 22-7239 |
| 2023-08-08 → 2023-10-10 | 23-4616 | 23-5855 |
| 2024-10-08 → 2024-11-25 | 24-6503 | none: end date from Community Impact |
| 2025-10-16 → 2025-12-05 | 25-6399 | none: end date from Community Impact |
| 2026-09-17 → 2026-11-16 | 26-5864 (row opened by the cron, start from the Forest Service map) | fmo: Fire Marshal's Office announcement on hcfmo.net; closed by hand in the seed script because the map still listed a ban on 2026-11-17 |

Every order since 2022 runs "until the earlier of 90 days after the date of
adoption or a determination is made by the Texas Forest Service that drought
conditions no longer exist" (§352.081(e)(1)), so it can end without a court
vote. The 2022 and 2023 bans were still ended by one. The court's online
records hold no item ending the 2024, 2025 or 2026 ban (Legistar API searched
2026-11-17; the court's last meeting before the 2026 lift was Nov. 12). The
Fire Marshal's Office announced each of those lifts, and its posts say "the
Harris County Commissioners Court lifted the burn ban" for 2024 and 2025, so
the page claims neither a vote nor its absence: it says the court's online
records hold none and that the Fire Marshal's Office announced each lift. Not
entered, and the page says so: bans reported in 2003, 2005, June 2009 and
2010, which the sources found on 2026-11-15 and the owner's sources read on
2026-11-17 do not date at both ends. Issue #275 lists, for each, the dated end
and what is missing.

Before 2021 a start can also be the Harris County Fire Marshal's Office's own
release (`start_source = 'fmo'`, the release's URL in `url`), and any end can
be a Fire Marshal's announcement (`end_source = 'fmo'`, URL in `end_url`).
Both render as "Fire Marshal's Office announcement". Its releases are on harriscountycitizencorps.com,
the county's archive. The 2005 and February 2009 bans were lifted by the Fire
Marshal's Office itself, with no court vote ("The fire marshal made the call
and acted alone on this", Houston Chronicle, July 27, 2005), and the page says
so. (Earlier leads:
North East Newsroom, June 2003; Houston Chronicle, July 13, 2005, which says
the 2003 ban was lifted in June 2003 and the 2005 one enacted in late June;
Lone Star College advisory, June 24, 2009; Star-Courier, Oct. 26, 2010;
Houston Public Media, April 19, 2011, "re-institute"). Add one only with a
dated source for both ends. A news-sourced end is read from the note's
"Lift date ... as reported by Outlet (url)", a start from "Start as reported
by Outlet (url)". Tested by
`scripts/test-burnban-bans.mjs` ("Check burn-ban history table" in CI).
