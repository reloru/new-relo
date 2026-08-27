# Content and design audit — 2026-08-27

Wording and visual audit of the live site at commit `87880c3`, run against
`https://crosbynews.com` between 23:00 and 23:45 CT on 2026-08-26.

This is a reading-and-looking audit, not a correctness one: every claim comes
from the rendered page — text pulled from the live HTML, or the page rendered in
Chromium 141 and measured. Where a cause is named, it was traced back to source
and confirmed. Nothing here was changed. Recommendations are in section (f).

- Covered: all 21 content pages in both languages (42 URLs), each one's
  `?format=md` view, the mobile menu, `/badge.svg`, and dark mode
- Widths measured: 390 px (phone), 768 px (tablet), 1280 px (desktop)
- Predecessor: `docs/audit/2026-08-26-live-site.md` (routes, headers, APIs, MCP)

Nothing found here breaks a page. The pattern across the findings is that the
site's careful work is unevenly applied: a rule is set on one page and not the
next, a colour is checked in light mode and not dark, a tap target is sized
right in one place and nowhere else.

---

## (a) Wording

### a.1 — The homepage explains two numbers it isn't showing

`glanceExplainers()` (`src/features/home.js:206`) renders all five "About …"
blocks every time. The rows above them are conditional. At 23:00 the glance card
showed High tomorrow, Low, Rain chance, Wind, Humidity, Dew point and Air
quality — no feels-like row and no UV row — under these two headings:

> ⓘ About feels-like temperature
> ⓘ About the UV index

**UV is orphaned every night.** The row is gated on `uvPeakToday() > 0`
(`home.js:160`), which is 0 after dark by design, so from sunset to sunrise the
page carries an explainer for a number that is nowhere on it.

**Feels-like is worse than orphaned.** The row is gated on
`feelsMax >= dayP.temperature` (`home.js:154`). When it drops out, the only
feels-like number left on the page is the hero's "Feels like 91°" — which is the
*current* hour (`home.js:254`, `feelsLikeF(now)`). The explainer says:

> This is the highest “feels like” expected for the rest of today — the peak,
> not an average.

So a reader who opens it is told the hero number is a daily peak. It isn't.

Both languages.

### a.2 — Four English pages carry a note written for Spanish readers

| Page | Sentence shown to English readers |
| --- | --- |
| `/tropics` | "Storm advisories and names stay in NHC's official English." |
| `/traffic` | "Lane and schedule details are shown in TranStar's official English." |
| `/calendar` | "event titles are shown in the district's original English" |
| `/alerts` (push box) | "Detailed alert text stays in official NWS English." |

Each sits inside the English half of a `T(lang, en, es)` pair —
`tropics.js:591`, `traffic.js:353`, the calendar disclaimer, and
`alerts.js:224` — so it renders on the English page as well as the Spanish one.
Telling an English reader that the English text is in English is noise at best;
on `/traffic` it is in the page's opening paragraph.

The correct pattern is already in the repo twice: `hourly.js:128` and
`weather.js:202` gate the same kind of note with `lang === "es"`.

### a.3 — A life-safety sentence is parked at the end of a link row

`/alerts`, directly under the status panel, one paragraph:

> ← Back to the forecast · Radar · **Emergency resources** · Official source:
> NWS Houston/Galveston. In an emergency, call 911.

Three navigation links, then a source credit, then a complete safety
instruction, all joined by `·`. At 1280 px it wraps mid-sentence, so the second
line reads "emergency, call 911." in 15 px grey. The most important sentence on
the page is the tail of a breadcrumb.

### a.4 — Fishing condition hints read like assembled parts, because they are

`fishingHint()` builds a list of lowercase clauses and joins them with `"; "`
(`fishing.js:152`). Each clause already contains its own em dash. Live:

> oxygen is moderate — fish may hold deeper or near moving water; warm at 89°F —
> try deeper, shaded water midday; clear water — go lighter and more natural

No capital, no full stop, three em dashes and two semicolons doing one job. It
appears under every station on `/fishing` and `/es/fishing`.

### a.5 — `/water` shows a status it never defines and a gap it never explains

The "San Jacinto River at Lake Houston" card carries a blue **MONITORED** badge
where the other five say NORMAL, shows only "42.09 ft · 24,200 cfs · as of 9:30
PM CT", and has no flood-stage line at all. The page never says what "Monitored"
means or why that gauge has no stages.

The reason is real and good — NWS publishes no flood categories for that
reservoir gauge, and `waterState()` refuses to invent one (`water.js:60-69`) —
but it lives only in a code comment. `waterThresholdLine()` returns an empty
string and nothing takes its place (`water.js:151-158`).

`/fishing` has the same shape of gap and does explain it, in the reader's words:
"Only water level is monitored here — no water-quality sensor at this station."

### a.6 — "Each link goes to the original outlet" — they go to Google News

`/news` says it twice, and `/developers` a third time:

> Links open the original source.
> crosbynews.com isn't the publisher — each link goes to the original outlet.
> news headlines link to their original publishers

All ten headline links point at `news.google.com/rss/articles/CBMi…`, which
answers 302 and forwards from there. Each card is captioned with the outlet's
name ("FOX 26 Houston · Aug 25, 2026"), so nothing signals the hop.

This is upstream-shaped — Google News RSS hands out redirect URLs — but the
sentence as written is not what the link does.

### a.7 — The last news headline is out of date order, and the page can't say why

The community list ran Aug 25, Aug 19, Aug 7, Aug 5, Aug 5, Jul 24, Jul 20, then
**Jul 26**. Cause: `scripts/fetch-news.mjs:318` sorts on `crime`, then `near`,
then date — so a nearby-community story sorts below every Crosby-proper story
regardless of when it ran. Correct behaviour, invisible on the page: eight
identical cards, dated newest-first except the last one.

The section below it *is* labelled ("Public safety & incidents"), which makes the
unlabelled list above it look like the whole story rather than one of two groups.

### a.8 — `/calendar` offers the district calendar twice, once mislabelled

> Want only the district holiday & first/last-day calendar?
> [Subscribe to the District calendar].
> Or subscribe to a specific campus:
> [District] [Crosby High School] [Crosby Middle School] …

Both links are `webcal://www.crosbyisd.org/calendar/calendar_350.ics`. The second
is the first item in a row introduced as "a specific campus", which the district
is not.

### a.9 — Three pages repeat the footer disclaimer in their own body

`/contact` ("About this project"), `/developers` ("Terms & attribution") and
`/about` ("Disclaimer", `about.js:63`) each end with a version of:

> crosbynews.com is an independent project and is not affiliated with the
> National Weather Service, NOAA, Crosby ISD, or any government agency.

The footer repeats the same sentence 130 px later on all three. On `/contact` —
a short page — both copies are on screen at once.

### a.10 — `/privacy`'s first source bullet carries three sources

Every other bullet in "Third-party data sources" is one source with its domain.
The first is:

> U.S. National Weather Service (api.weather.gov) — public-domain forecasts,
> conditions, and alerts for Crosby, TX; and the U.S. EPA (UV index) and NOAA
> (river/bayou levels, tropical outlook).

EPA and NOAA get no domain and no line of their own; they're appended to
someone else's.

### a.11 — `/sitemap` claims to list every page and omits itself

> Every page and endpoint on crosbynews.com, organized by category.

Twenty of the twenty-one content pages are listed. The missing one is
`/sitemap`. ("XML Sitemap" under For Developers & Agents is `/sitemap.xml`, a
different route.)

### a.12 — Literal backticks render on `/mcp`

> Returns the 7-day day/night forecast, or upcoming hourly periods if `` `hours` ``
> is given (up to 48 — through about two days out).

The backticks are Markdown that never got converted; they're printed as
characters on the HTML page. `/mcp` and `/es/mcp`. It's the only Markdown
artifact left anywhere — the 21 `?format=md` views are clean of HTML in the
other direction too.

### a.13 — `/air` uses three date formats, none of them the site's

| Where | What it shows |
| --- | --- |
| AQI banner | `2026-08-26 23:00 CDT` |
| Channelview tile | `Updated Aug 26, 10:00 PM CDT` |
| Everywhere else on the site | `Aug 26, 2026, 11:15 PM CT` |

The banner string is AirNow's raw fields concatenated (`air.js:158`) and printed
unmodified (`air.js:501`) — an ISO-style date and a 24-hour clock, neither of
which the site uses anywhere else.

### a.14 — Pollutant tiles: "PM10", "PM2.5", "ozone"

Three identical tiles in a row, two labelled with uppercase abbreviations and the
third with a lowercase word. In the sub-tiles it reads "ozone"; in the banner
above, the same pollutant is "PM10" (uppercase) — so the row looks like a typo
rather than a choice.

### a.15 — Apostrophes and quotation marks are inconsistent

Counted across all 42 pages: **103 straight apostrophes, 3 curly.** The three
curly ones are `alerts.js:236` and `news.js:158`, which use `&rsquo;`.

Quotation marks split the same way, and the same phrase lands on both sides:

| Phrase | `/home`, `/hourly` | `/about` |
| --- | --- | --- |
| feels like | “feels like” (curly) | "feels like" (straight) |

Curly on `/alerts`, `/burn-ban`, `/home`, `/hourly`; straight on `/about`,
`/privacy`, `/developers`, `/mcp`. (Straight quotes inside the `/developers`
`<img src="…">` sample are correct — that's code.)

### a.16 — `/badge.svg` always draws a sun

The badge's glyph is a hard-coded yellow circle and grey ellipse
(`weather.js:358-359`) with no branch on time of day or conditions. At 23:00 on a
partly cloudy night, the badge read "84°F Partly Cloudy" beside a sun. It will
also show a sun during a thunderstorm.

Separately, the condition string is cut at 19 characters (`weather.js:343`), so
"Chance Showers And Thunderstorms" becomes "Chance Showers And…" — the truncation
lands on a conjunction.

### a.17 — `/burn-ban` uses the site's only long-form date

> No ban in any check since we began tracking on August 24, 2026.

Everywhere else the site writes "Aug 26, 2026" — including the line directly
above this one ("Checked Aug 26, 2026, 9:45 PM CT.").

### a.18 — `/mcp`'s tool list is machine text on a page for people

The tool descriptions are the MCP schema strings verbatim: "Returns an empty list
when none are active", "Measured by EPA/AirNow monitors when available
(`measured:true`)", "a quiet CurrentStorms list does not by itself mean a quiet
basin". The page's own opening says it "just explains what it is" to a person, so
the register doesn't match its stated audience. Defensible — the audience is
agent developers — but worth a decision rather than a default.

### a.19 — Calendar event locations come through raw and inconsistent

Three formats on adjacent rows of the same page:

- `CMS Auditorium`
- `Crosby Middle School, 14703 FM 2100, Crosby, TX 77532, USA`
- `BARBERS HILL MIDDLE SCHOOL SOUTH, 9600 Eagle Dr, Mont Belvieu, TX 77523, USA`

All three are exactly what Crosby ISD publishes. `calendar.js:212` prints the
field straight through, so a ", USA" the reader does not need and a venue in
capitals both survive to the page.

Event titles have the same shape of problem and are not ours to fix: "CHS School
Pictures Grades" is truncated in the district's own feed, and "BES Big Kahuna
Fundraiser 8/27" repeats its own date. The page's disclaimer covers those.

### a.20 — Four away games are published as taking place in Crosby

Not visible on the page, but published from it. Each event's JSON-LD hard-codes
the address (`calendar.js:167-171`):

```
address: { addressLocality: "Crosby", addressRegion: "TX", addressCountry: "US" }
```

The comment above it justifies this as a fallback for venue-less all-day events,
which is fair — those really are Crosby ISD dates in Crosby. But the same fixed
address is also attached to venue names that name a different town. Of the 25
events carrying structured data during this audit, **four disagree with
themselves**:

| Event | Venue says | Published as |
| --- | --- | --- |
| CMS 7th Grade Football @ Barbers Hill South MS | Mont Belvieu | Crosby |
| CMS 8th Grade Volleyball @ Barbers Hill South | Mont Belvieu | Crosby |
| CMS 7th Grade Volleyball @ White Oak MS | Porter | Crosby |
| Varsity Football @ Dayton | Dayton | Crosby |

All four are away games. A search engine reading this page is told a parent can
drive to Crosby for a game in Dayton.


---

## (b) Layout and spacing

### b.1 — The desktop nav reads as one continuous string

At 1280 px, measured:

| | px |
| --- | --- |
| Gap between two nav links | **5** |
| Space inside "Water Levels" | **4.6** |

The two are indistinguishable, so the bar reads:

> Home Weather Radar Alerts Water Levels News School Calendar About

**Cause.** `.topbar nav` sets `gap:0.5rem 1rem` (`base-css.js:22`), and both
`.nav-menu` and `.nav-links` are `display:contents` so the anchors should become
that flex container's items. They don't: Chromium inserts a `::details-content`
box between `<details>` and its children, and `display:contents` does not flatten
through it. The anchors end up as inline children of that block, separated by the
whitespace between tags.

Verified: injecting `.nav-menu::details-content { display: contents }` at runtime
moves every gap from 5 px to 16 px.

CLAUDE.md already documents `::details-content` as the reason the desktop nav
needs `content-visibility: visible` to appear at all. It eats the gap too.

**Spanish is worse** — same 5 px against a 4.6 px word space, but three of the
eight labels are multi-word:

> Inicio Clima Radar Alertas Niveles de agua Noticias Calendario escolar Acerca de

### b.2 — The phone gets nine more destinations than the desktop

Nine links are marked `m-only` (`chrome.js:30`) and hidden from the flat bar:
Hourly, Fishing, Tropics, Pollen, Air Quality, Burn Ban, Traffic, Emergency,
Developers. Desktop nav: 8 links. Phone menu: 17, grouped under WEATHER /
COMMUNITY / MORE with rules between the groups.

The phone menu is the better piece of design on the site, and it is the one a
desktop visitor never sees.

### b.3 — Homepage cards stretch, and the wider the screen the emptier it gets

`.hub-grid` is `repeat(auto-fill, minmax(240px, 1fr))` with the default
`align-items: stretch`, so every card in a row is as tall as the tallest — and
"Today at a Glance" is 525 px because of the five explainers from a.1.

Measured empty space inside each card at 1280 px:

| Card | Height | Empty |
| --- | --- | --- |
| Today at a Glance | 525 | 14 |
| Weather | 525 | **365** |
| Alerts | 525 | **395** |
| Water Levels | 266 | **162** |
| Burn Ban | 266 | **162** |
| Local News | 266 | 14 |
| School Calendar | 199 | 14 |

The Alerts card is 75 % empty. "School Calendar" then sits alone in a three-wide
row with two empty columns beside it. Roughly 1,080 px of blank card on a
1,015 px-tall grid.

At 768 px one card carries 349 px of slack. **At 390 px every card is 14 px —
the phone layout is exactly right.** The problem is desktop-only and grows with
width.

### b.4 — `/water` titles wrap under their badges

The status badge is pinned to the top-right of each card, so the heading gets
roughly 60 % of the first line and the rest wraps beneath it: "Cedar Bayou near /
Crosby", "San Jacinto / River at Lake / Houston" (three lines). Combined with the
missing stage line from a.5, the Lake Houston card is a three-line title over two
lines of content in a card stretched to 220 px.

### b.5 — `/fishing` station names break mid-phrase

Same cause, more visible because the names are shorter:

> Jack's / Ditch  ·  Union / Pacific RR / bridge  ·  near / Humble  ·  FM 1960 / bridge

"Jack's Ditch" is twelve characters and takes two lines. "near Humble" is a
location qualifier being used as a card heading, so it reads as a fragment.

### b.6 — The radar image is stretched past its own resolution

`/radar-image` is 600 px wide. `.radar-wrap img { width:100% }` with no
`max-width` (`radar.js:39`) displays it at **862 px** on desktop — a 1.44×
upscale. The NWS caption text baked into the image is visibly soft, and so are
the city labels.

At 390 px it renders at ~358 px and is sharp, so this is desktop-only.

Separately: **Crosby is not marked on the radar.** The frame spans Victoria to
Lake Charles and labels Houston, Galveston, Beaumont, Bryan, Lufkin and Lake
Charles. On a page titled "Crosby, TX Weather Radar", the reader has no way to
find Crosby on the image.

### b.7 — Weather icons are under-resolution, and opaque

| Where | Requested | Natural | Displayed | Ratio |
| --- | --- | --- | --- | --- |
| `/weather` hero | large | 134 px | 128 px | **1.05×** |
| `/` hero | large | 134 px | 104 px | 1.29× |
| `/weather` day cards | medium | 86 px | 52 px | 1.65× |
| `/hourly` rows | small | 56 px | 32 px | 1.75× |

134 px is the largest NWS serves. The `/weather` hero at 128 CSS px is therefore
half the pixels a 2× phone needs and a third of what a 3× phone needs — it is
soft on essentially every phone sold.

The icons also have no transparency (RGB / palette, no alpha), so at night they
render as hard black tiles: one 104 px black square inside the homepage's blue
hero, and a column of ~24 black squares down `/hourly` in light mode.

### b.8 — `/hourly`'s Rain and Wind columns nearly touch

Gaps between the actual text of adjacent cells in one row, at 1280 px:

> 32 · 61 · 78 · 55 · **16**

Rain is right-aligned and Wind is left-aligned, so "4%" and "10 mph S" end up
16 px apart while every other pair sits 32–78 px apart. Still 16 px at 700 px
wide. The CSS adds explicit gutters below 600 px (`hourly.js:113`), not above.

### b.9 — At the end of a day, `/hourly` opens with a table header for one row

At 23:00 the first section was a full card — day heading, sunrise/sunset, and a
six-column header — over a single 11 PM row. Every evening the page opens with
more table furniture than table.

### b.10 — Single cards sit alone in wide rows

Three pages put one card in a grid sized for three: `/tropics` (one watched
area), `/air` (the nearby-monitor card), `/fishing` (any river with one station).
The card holds its ~290 px column and the remaining 600 px is empty.

### b.11 — `/air`'s Channelview tile is too narrow for its own content

Two bad breaks in one 230 px card:

> Channelview C15 ·
> ozone
> …
> Updated Aug 26, 10:00 PM
> CDT

The separator "·" ends a line, and the time zone drops to a line by itself.

---

## (c) Colour and contrast

All figures are WCAG 2.1 contrast ratios. Where text sits on a gradient, the
number was taken from the **rendered pixels** under that text, not from the CSS.
AA needs 4.5:1 for normal text and 3:1 for text ≥24 px (or ≥18.66 px bold).

### c.1 — The green "all clear" panel fails in both sizes

`.status-ok` is `linear-gradient(135deg, #1f8b4c, #2eb86a)` with white text.

| Element | Size | Measured | Needs |
| --- | --- | --- | --- |
| "All clear" | 27.2 px bold | **2.68** | 3.0 |
| Body sentence | 16 px | **2.62** | 4.5 |

This panel is the dominant element on `/alerts`, `/water`, `/traffic` and
`/burn-ban`, in both languages — eight pages. It is also the panel that carries
the reassuring message, so it is what a worried visitor reads first.

### c.2 — The AQI banner is the worst on the site, and it's systematic

Live (Moderate band): the category word measured **2.53** against a 3.0
requirement, the detail line **2.52** against 4.5. The big number scraped by at
3.02.

Every band, white text, worst case at the light end of each gradient:

| Band | Dark stop | Light stop | Normal text (4.5) | Large text (3.0) |
| --- | --- | --- | --- | --- |
| Good | 4.32 | 2.57 | fail | fail |
| Moderate | 3.21 | 2.25 | fail | fail |
| Unhealthy for Sensitive Groups | 4.30 | 3.09 | fail | pass |
| Unhealthy | 5.46 | 4.10 | fail | pass |
| Very Unhealthy | 5.85 | 4.10 | fail | pass |
| Hazardous | 10.92 | 7.77 | pass | pass |

Five of six bands fail for normal text. The only band that passes cleanly is the
one nobody in Crosby will see most years.

### c.3 — The green status pills fail by a small, consistent margin

`#1f8b4c` with white text is **4.32** against a 4.5 requirement — the homepage
"All normal" and "None" badges (14.4 px), `/water`'s NORMAL badges (11.5 px), and
`/fishing`'s "Healthy oxygen" badges (11.5 px).

`/fishing`'s "Moderate oxygen" pill is `#b8860b` with white text: **3.25**.

The fix already exists three lines away in the same file. `fishing.js:254-257`
sets four badge colours; the first three are hard-coded hex, and the fourth is
`background: var(--btn)`:

| Badge | Colour | White text |
| --- | --- | --- |
| Healthy oxygen | `#1f8b4c` | 4.32 — fails |
| Moderate oxygen | `#b8860b` | 3.25 — fails |
| Low oxygen | `#b5301f` | 6.16 — passes |
| Water level only | `var(--btn)` `#256d9e` | 5.59 — passes |

`--btn` is the token that exists specifically to carry white text, and the CI
gate checks it every run. The one badge that uses it passes. Of the three that
picked their own hex instead, two fail.

### c.4 — Dark mode: two pollen categories go dim

`.pcat` colours are hard-coded hex with no dark-mode variant
(`pollen.js:310-314`), so colours chosen against a white card are reused on
`#1a2430`. At 21.6 px bold (needs 3.0):

| Category | On white | On dark card |
| --- | --- | --- |
| None | 5.80 | **2.70** |
| Low | 4.32 | 3.63 |
| Medium | 4.31 | 3.64 |
| Heavy | 4.30 | 3.65 |
| Extremely Heavy | 5.46 | **2.87** |

The two failures are the extremes of the scale — including the one that means
"stay indoors". "None" was live and visibly grey during this audit; "Extremely
Heavy" will only show on the days it matters most.

### c.5 — Why the existing gate didn't catch any of this

`scripts/test-contrast.mjs` runs in CI as "Check colour contrast" and does
exactly what it says. It reads the palette out of `BASE_CSS` and checks
`--link`, `--ink` and `--muted` against `--bg` and `--card` in both themes, white
text on `--btn`, and `--btn` as a discernible shape. It then scans every file
under `src/` — but only for `color: var(--accent)`, to keep the decoration token
off body text.

Every colour in c.1–c.4 is a hard-coded hex inside a feature module's own
`<style>` block — `air.js`, `pollen.js`, `water.js`, `fishing.js`, `home.js` —
and none is `--accent`. The gate never looks at them. The file's own opening
comment says why this matters: "a contrast regression is INVISIBLE to every
other gate … it is only unreadable for the people who most need to read it."
That reasoning applies to the hard-coded colours too; the check just doesn't
reach them yet.

---

## (d) Tap targets

WCAG 2.2 asks for 24×24 CSS px; Apple's guidance is 44 pt. Measured at 390 px.

### d.1 — The footer link row, on every page

Eight links, **19 px tall**, wrapping to two rows **24 px apart** — so there is
**5 px of clear space** between "Home" on the first row and "Privacy" on the
second. Two rows of under-size targets, that close together, is where mis-taps
come from.

### d.2 — Everything else that's under 24 px

| Control | Size |
| --- | --- |
| `/air` "ⓘ" tooltip | **18 × 18** |
| `/calendar` campus links | 16 px tall |
| Homepage "About …" summaries | 20 px tall |
| `/water` gauge title links | 19 px tall |
| Español / English toggle | 70 × 23 |
| `/burn-ban` FAQ summaries | 23 px tall |

### d.3 — The one control that was sized properly

The hamburger is 44 × 44, with a comment in `base-css.js:46-51` explaining
exactly why 2.2 rem was not enough and why it must stay ≥ 2.75 rem. That
reasoning was applied once. The Español toggle immediately beside it is 23 px
tall.

---

## (e) Spanish

The Spanish is genuinely good, and better than a translation: `/es/emergency`
adds "oprime 2 para español" to the 988 line, "con intérpretes en español" to
Poison Control, "(en inglés)" to the CAER line, and points at FloodSmart's
Spanish page. That is localisation, not translation. Five things break the
pattern.

### e.1 — "Turn around, don't drown" is translated two different ways

| Spanish | Meaning | Where |
| --- | --- | --- |
| "da la vuelta, no te **arriesgues**" | turn around, don't take the risk | `/es/alerts`, `/es/fishing`, `/es/traffic` (×2), `/es/water` |
| "da la vuelta, no te **ahogues**" | turn around, don't drown | `/es/emergency` only |

Five uses of the weaker paraphrase, one of the faithful one. The English is a
national public-safety slogan and names the consequence; "don't take the risk"
doesn't. The one page that gets it right is the one nobody reads before a flood.

### e.2 — Two Spanish pages print English with no note explaining it

`ES_NWS_NOTE` — "las alertas … se muestran en su idioma oficial (inglés)" — is
rendered on `/es/weather` (`weather.js:202`) and `/es/hourly` (`hourly.js:128`),
and `/es/about` says the same thing in its own words.

It is **not** rendered on:

- **`/es`**, which prints the NWS `detailedForecast` in English
  (`home.js:283`). Live: "Esta noche: Partly cloudy, with a low around 80. Heat
  index values as high as 106…" — an English paragraph in the middle of an
  otherwise fully Spanish page, unexplained.
- **`/es/alerts`**, which renders `a.headline`, `a.description` and
  `a.instruction` untranslated (`alerts.js:132-134`). No alerts were active
  during this audit, so this only shows during severe weather — the worst moment
  to discover it.

### e.3 — `/es/air` says "GMT-5" where the rest of the site says "CT"

> Actualizado 26 ago, 9:00 p.m. **GMT-5**

`air.js:384` and `air.js:564` format with `timeZoneName: "short"`. Reproduced
independently of the site:

```
en-US → Aug 26, 9:00 PM CDT
es-MX → 26 ago, 9:00 p.m. GMT-5
```

`es-MX` has no short name for US Central, so it falls back to a raw offset.
Every other Spanish page writes "CT".

### e.4 — `/es/traffic` switches language mid-sentence

> Closed daily from 9:00 AM to 4:00 PM through Friday, August 28 · **Carriles
> afectados**: 1 Outside Lane(s)

The label is Spanish, the value English, in one line. The page's note covers the
policy, but the code-switch inside a single sentence still reads as broken rather
than deliberate. ("1 Outside Lane(s)" is TranStar's own wording.)

### e.5 — Spanish quotation marks are split two ways

«Guillemets» on `/es/alerts`, `/es/burn-ban`, `/es/developers`, `/es/privacy`.
Straight quotes on `/es/about` ("modelado", "sensación térmica") and `/es/mcp`.

---

## (f) Recommendations

No site changes were made. In rough order of how much a visitor is affected.

**Fix first — a visitor is misled or can't read something**

1. **Give the all-clear panel and the AQI banner enough contrast** (c.1, c.2).
   Two routes, both computed against the current colours:

   *Keep white text, darken the gradient.* Each of these clears 4.5:1 with white
   and keeps the hue:

   | Where | Now | Would need |
   | --- | --- | --- |
   | `.status-ok` / `.a-good` light stop | `#2eb86a` | `#22874e` |
   | `.a-mod` light stop | `#d4a716` | `#91720f` |
   | `.a-mod` **dark** stop | `#b58900` | `#957100` |
   | `.a-usg` light stop | `#f06a2e` | `#c25625` |
   | `.a-unh` light stop | `#e63e3e` | `#d93b3b` |
   | `.a-vunh` light stop | `#9a55ff` | `#9250f1` |
   | green badge (c.3) | `#1f8b4c` | `#1e884a` |
   | `.f-fair` badge (c.3) | `#b8860b` | `#996f09` |

   Moderate is the one that needs both stops moved, and `#91720f` is far enough
   from the AQI's own yellow to be worth a second look.

   *Or flip the text on the light bands.* `--ink` (`#16222e`) on the yellow
   measures **5.02** on the dark stop and **7.17** on the light one, and on the
   green light stop **6.28** — comfortably AA without touching the palette, and
   it is what published AQI charts do at that lightness.
2. **Extend `scripts/test-contrast.mjs` past `BASE_CSS`** (c.5). It should pull
   the hard-coded hex out of the `<style>` blocks in `src/features/*.js`, pair
   each with the text colour set on it, and handle `linear-gradient(...)` by
   testing the lightest stop. Without this, the fixes above go stale the next
   time someone adds a colour.
3. **Add a dark-mode variant for the five `.pcat` colours** (c.4). "Extremely
   Heavy" is the one that must be legible.
4. **Give `/es` and `/es/alerts` the note the other Spanish pages have** (e.2) —
   the same `lang === "es"` line already used in `weather.js` and `hourly.js`.
5. **Settle on "no te ahogues" everywhere** (e.1). One word, five places, and it
   is the wording of the campaign the English is quoting.
6. **Fix the `/es/air` timestamps** (e.3) — the site already knows how to say
   "CT"; use the same helper rather than `timeZoneName: "short"`.

**Fix next — the page contradicts itself or reads as broken**

7. **Render the glance explainers only for rows that exist** (a.1), and either
   re-word the feels-like explainer to cover the hero's current-hour number or
   keep it tied to the row.
8. **Give the desktop nav its gap back** (b.1). `.nav-menu::details-content {
   display: contents }` restores the intended 16 px — measured, one line. Worth a
   note in `base-css.js` beside the existing `content-visibility` comment, since
   it is the same trap.
9. **Gate the four "official English" notes on `lang === "es"`** (a.2).
10. **Split the `/alerts` link row** (a.3) — "In an emergency, call 911." belongs
    on its own line, not after a `·`.
11. **Cap the radar image at its native width** (b.6): `max-width: 600px`. Then
    decide whether to mark Crosby on the frame or say plainly where it is.
12. **Explain "Monitored" on `/water`** (a.5) — one sentence, in the same place
    and voice `/fishing` already uses for its equivalent gap.
13. **Say what the link does on `/news`** (a.6), or resolve the redirect. "Opens
    the story at its outlet (via Google News)" is honest and costs nothing.
14. **Remove the duplicate "District" chip on `/calendar`** (a.8).
15. **Strip the backticks on `/mcp`** (a.12).

**Layout and polish**

16. **Stop the homepage cards stretching** (b.3): `align-items: start` on
    `.hub-grid` lets each card be its own height. Fixing a.1 also shortens the
    tallest card. Worth reviewing whether seven cards at three-across is the right
    shape at 1280 px at all — the phone layout is better.
17. **Let card titles have their own line** (b.4, b.5) — move the badge below the
    heading, or let the heading take the full width and the badge sit under it.
18. **Give the footer links room** (d.1): `padding: 0.35rem 0` plus a larger row
    gap gets them past 24 px without changing how the row looks.
19. **Size the `/air` ⓘ, the language toggle, and the campus links like the
    hamburger** (d.2, d.3) — the reasoning in `base-css.js:46-51` already applies
    to all of them.
20. **Add a gutter between Rain and Wind on `/hourly`** above 600 px (b.8).
21. **Fix `/air`'s narrow tile** (b.11) — a wider min-width, or `white-space:
    nowrap` on the "Channelview C15 · ozone" pair and the timestamp.
22. **Decide what to do about icon sharpness** (b.7). 134 px is the ceiling NWS
    serves, so the only lever inside the current setup is to render the heroes
    smaller — 64–72 px would be crisp at 2×. Anything sharper at the current size
    means an icon set that isn't NWS's.
23. **Decide about the night icons** (b.7). Opaque black tiles against the blue
    hero and down a white table are the single most visually jarring thing on the
    site.
24. **Give `/badge.svg` a night glyph** (a.16), and truncate the condition on a
    word boundary rather than at 19 characters.

**Consistency — small, cheap, and the kind of thing that rots**

25. **Pick one apostrophe and one quote style per language** (a.15, e.5) —
    straight-and-curly is currently 103 to 3, so straight is the cheaper
    convention to adopt; Spanish should be guillemets throughout.
26. **Route `/air`'s AirNow timestamp through the site's own formatter** (a.13).
27. **Capitalise "Ozone" to match "PM10" and "PM2.5"** (a.14).
28. **Use "Aug 24, 2026" on `/burn-ban`** (a.17).
29. **Trim ", USA" and normalise all-caps in calendar locations** (a.19), and
    **stop publishing away games as Crosby addresses** (a.20) — keep the district
    fallback for venue-less events, but drop `address` (or parse the town out of
    the venue string) when the feed names a real venue.
30. **Label the news community list**, the way "Public safety & incidents" is
    labelled, and consider showing the Crosby / nearby split that the sort already
    makes (a.7).
31. **Sentence-case the fishing hints and end them with a period** (a.4).
32. **Give `/privacy`'s EPA and NOAA their own bullets** (a.10); **list `/sitemap`
    on `/sitemap`** (a.11); **drop the body-copy disclaimer from `/contact` and
    `/developers`** (a.9) since the footer already carries it on every page.
33. **Decide whether `/mcp`'s tool descriptions should be rewritten for people or
    left as schema text** (a.18) — either is defensible; drifting is not.

**Worth a decision, not a fix**

34. **The desktop nav shows 8 of 17 destinations** (b.2). Leaning the bar out is a
    real choice, but it means a desktop visitor never sees Pollen, Air Quality,
    Burn Ban, Tropics, Traffic, Fishing, Hourly, Emergency or Developers in the
    nav at all — and the phone's grouped menu is the better design of the two.
    Reusing the grouped menu on desktop, or adding a "More" dropdown, would give
    the wide screen at least what the narrow one has.

---

## (g) Checked and clean

Recorded because "we looked and it was fine" is what rots quietly.

**Nothing overflows and nothing is clipped.** All 21 pages at 390, 768 and
1280 px: `document.scrollWidth` never exceeds `clientWidth`. The three elements
that extend past the viewport — `/weather`'s hour strip, `/pollen`'s and
`/air`'s scale tables — all sit inside a deliberate `overflow-x: auto` wrapper.
A separate sweep for text clipped by `overflow: hidden` found nothing on any
page at any of the three widths.

**Heading structure is correct on all 21 pages.** No level is skipped anywhere.

**Every image has an `alt` attribute.** All 21 pages.

**The `?format=md` views are clean.** No HTML tags and no character entities
(`&mdash;`, `&middot;`, `&nbsp;`, `&rsquo;`, numeric) leaked into any of the 21
Markdown renderings. `/mcp`'s backticks (a.12) leak the other way, into HTML.

**The phone layout is better than the desktop one.** Single-column grid, zero
card slack, the hamburger at a proper 44 px, a grouped menu with section rules
that fits an iPhone screen without scrolling (715 px of an 844 px viewport).

**The 920 px nav breakpoint is correctly placed.** At exactly 921 px the longer
Spanish labels still fit on one row without wrapping or colliding with the brand.

**`/badge.svg` contrast passes throughout** — 5.85 to 11.32 against its own
background on every text element, including both alert states.

**Dark mode works on all 21 pages** — no unstyled surfaces, no light-mode colour
left stranded, apart from the pollen categories in c.4.

**The `/alerts` guide cards align correctly.** The wide gap after "Do" reads as
ragged, but the labels are right-aligned in a fixed column: label edge at 261 px
and text start at 265 px for both "Means" and "Do", in all five cards.

**`/hourly`'s duplicated feels-like column is deliberate and correct.** The
"Feels" column and the "(91°)" inside the Temp cell are a responsive swap —
`.feels-col` is hidden below 600 px and `.feels-inline` shown, with `.feels-note`
explaining it only on phones. Reading the HTML alone suggests a bug; the CSS
settles it.

**`/burn-ban`'s resource list is not run together.** `.link-note` is
`display: block` (`burnban.js:585`), so each note sits on its own line under its
link. It is a different pattern from the "Label — note" the other pages use, but
it is not a defect.

---

## (h) Method

Each of the 42 content-page URLs and 21 Markdown views was fetched with `curl`
and converted to plain text for the wording pass, with entities decoded so
`&mdash;` and `&#9776;` were not mistaken for defects.

The visual pass ran the live site in Chromium 141 via Playwright. Because the
session proxy resets the browser's own connections, a small local HTTP mirror
served the live pages to `127.0.0.1` and the browser rendered from there — same
bytes, same headers, no proxy in the path. Full-page screenshots at 390 / 768 /
1280 px in light and dark mode, plus scripted measurement of overflow, clipping,
heading order, `alt` attributes, element geometry and computed styles.

Contrast on flat backgrounds was computed from the CSS colours. **On gradients it
was measured from rendered pixels**: the text was set to `transparent`, the
element's box screenshotted, and the lightest pixel under the text taken as the
worst case. That is why c.1 and c.2 report 2.5–2.7 rather than a gradient
mid-point.

Three claims were dropped after checking, following CLAUDE.md's rule that a check
reusing the code under test cannot falsify it:

- `/hourly` appearing to print the feels-like number twice per row — it is a
  responsive swap (see (g)).
- `/burn-ban`'s resource links appearing to run into their notes — an artifact of
  flattening HTML to text; `.link-note` is `display: block`.
- `/alerts`'s "Means"/"Do" labels appearing misaligned — measurement showed a
  right-aligned label column, correct in all five cards.

The nav-gap cause in b.1 was confirmed by experiment rather than inference:
gaps measured at 5 px, `.nav-menu::details-content { display: contents }`
injected, gaps re-measured at 16 px. The `/es/air` "GMT-5" in e.3 was reproduced
in a bare `node -e` Intl call, independent of any site code.
