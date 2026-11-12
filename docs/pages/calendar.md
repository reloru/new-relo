# `/calendar` — Crosby ISD school calendar

Upcoming district events grouped by month, plus one-tap subscribe links.

| | |
|---|---|
| **Handlers** | `calendarHtml(data, lang)` / `calendarMarkdown(data, lang)` — `src/features/calendar.js` |
| **Route** | `PAGE_HANDLERS["/calendar"]` (`src/router.js`) |
| **Spanish** | `/es/calendar` |
| **Cache** | `public, max-age=1800` |
| **Negotiation** | `Accept: text/markdown` or `?format=md`; `Vary: Accept` |
| **Nav label** | "School Calendar" / "Calendario escolar" |

## Content blocks

| Block | Source |
|---|---|
| Upcoming events grouped by month | `calendar` KV, via `upcomingEvents()` (soonest first, capped 60) |
| Subscribe row (`calendarSubscribe`) — `webcal://`, Google Calendar, `.ics` for the whole district | `CISD_FEED_ALL_*` constants |
| Per-campus subscribe links | `CISD_CAMPUSES` → `campusWebcal(id)` |
| District academic calendar link | `calendar_350.ics` |

## Data

Cron + KV, key `calendar`, cron-owned, throttled to ~24h — it changes rarely
(this is not the mechanism for same-day closure announcements; those aren't
published to this calendar feed at all), and unlike Google News the Worker
**can** reach `crosbyisd.org`.

`fetchCalendar()` reads the district's combined "All Calendars" iCal feed
(`feedID=BB92BE3D…`), which is the union of every campus. A tiny hand-rolled
`parseIcs()` reads it — no dependency; the feed carries no `RRULE`.
`loadCalendar()` cold-warms on a missing or stale-shaped entry.

Times are floating Central wall-clock: timed events as zone-less local ISO,
all-day events as plain dates. The `calDow` / `calDayNum` / `calTime` / `calMonth`
helpers deliberately format with `timeZone: "UTC"` so a floating time is
displayed exactly as the district published it, without a zone shift.

On throw: `renderError`, 502.

## Canonical & sitemap

- Canonical `https://crosbynews.com/calendar` · Spanish `/es/calendar`
- `hreflangTags("/calendar")`
- In `PAGE_PATHS` → `Link: rel="canonical"`
- `sitemap.xml`: yes — `changefreq: daily`, `priority: 0.6`, no `lastmod`

## Meta

- Per-language title and description built in `calendarHtml`
- OG title/description/type/url
- JSON-LD: `JSONLD_SITE` **plus `jsonldEvents(events, lang)`** — real
  schema.org `Event` nodes, an honest type (unlike a forecast).
  **Every Event carries a `location`** — the feed's venue, else Crosby ISD /
  Crosby, TX. Google requires the field; without it the Rich Results Test flags
  every event "A value for the location field is required."
- `sharedHead(lang)` (`src/seo.js`): viewport, `theme-color` `#0b3d61`, `og:site_name`, absolute `og:image` (`/og-image.png`, 512×512 PNG with type/width/height/alt), `twitter:card`, PNG tab icons, inline 180px PNG `apple-touch-icon`, `<link rel="manifest">`

## CSP

No inline script. The JSON-LD is a `<script type="application/ld+json">` data
block, not executable, so `script-src` does not apply and it needs no hash.

## Locale

Page chrome via `T()`; month, weekday and time formatting via the `cal*` helpers
with `lang`. **Event titles stay in the district's official English**, with a
small `ES_EVENT` dictionary for common recurring titles and an English fallback
for everything else — the same policy as NWS text.

## Key dates

A "Key dates" box above the event list (and a `## Key dates` section in the
Markdown) lists, from today on, the dates a family plans around:

| Kind | Pattern on the event title (`KEY_RULES` in `src/features/calendar.js`) |
|---|---|
| No school / named break | `no school`, `student holiday`, `(winter|spring|thanksgiving|fall|christmas) break` |
| Early release | `early release`, `early dismissal` |
| End of grading period | `end of (the) grading period`, `end of semester` |
| First / last day | `first day of school/classes`, `last day of school/classes` |

Look-alikes are tested not to match ("12 Days of Christmas", "Winter Field
Trip", observances such as Veteran's Day). An all-day DTEND is exclusive
(RFC 5545). Days of one kind collapse; consecutive no-school days merge into
one range, named after the break the district named in it. Nothing is
inferred: a weekend inside a break is part of the range only if the district
listed it. The box ends with the feed's last posted date ("currently runs
through …") and says unposted dates are not listed. The district's feed drops
past events, so this is upcoming-only by construction. Spanish labels are
hand-written. Tested by `scripts/test-calendar-keys.mjs` ("Check calendar key
dates" in CI).
