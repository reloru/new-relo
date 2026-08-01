# `GET /api/calendar`

The same KV data behind `/calendar`, as public JSON.

Shared contract: `docs/endpoints/api/README.md`.

| | |
|---|---|
| **Builder** | `apiCalendar(data)` (`src/features/calendar.js`) |
| **Loader** | `loadCalendar(env)` → `calendar` KV |
| **Cache** | `public, max-age=1800` |
| **ETag seed** | `data.updated` |

## Response

Upcoming Crosby ISD events, soonest first, capped at 60. Floating Central wall-clock: timed events as zone-less local ISO, all-day events as plain dates — the same convention as the `Event` JSON-LD on `/calendar`.

## Page

`docs/pages/calendar.md` documents the data source, refresh cadence, and failure
mode in full — this endpoint renders exactly the same snapshot.
