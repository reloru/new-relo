# `/calendar` — Crosby ISD school calendar

Upcoming district events grouped by month, plus one-tap subscribe links.

| | |
|---|---|
| **Handlers** | `calendarHtml(data, lang)` / `calendarMarkdown(data, lang)` — `src/index.js` |
| **Route** | `_fetch` → `page === "/calendar"` |
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

Cron + KV, key `calendar`, cron-owned, throttled to ~6h — it changes rarely, and
unlike Google News the Worker **can** reach `crosbyisd.org`.

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
- OG title/description/type/url + `OG_COMMON`
- JSON-LD: `JSONLD_SITE` **plus `jsonldEvents(events, lang)`** — real
  schema.org `Event` nodes, an honest type (unlike a forecast).
  **Every Event carries a `location`** — the feed's venue, else Crosby ISD /
  Crosby, TX. Google requires the field; without it the Rich Results Test flags
  every event "A value for the location field is required."
- `<link rel="manifest">`, favicon

## CSP

No inline script. The JSON-LD is a `<script type="application/ld+json">` data
block, not executable, so `script-src` does not apply and it needs no hash.

## Locale

Page chrome via `T()`; month, weekday and time formatting via the `cal*` helpers
with `lang`. **Event titles stay in the district's official English**, with a
small `ES_EVENT` dictionary for common recurring titles and an English fallback
for everything else — the same policy as NWS text.
