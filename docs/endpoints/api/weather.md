# `GET /api/weather`

The full weather payload. The most-consumed endpoint on the site.

Shared contract: `docs/endpoints/api/README.md`.

| | |
|---|---|
| **Builder** | `apiWeather(data)` (`src/features/weather.js`) |
| **Loader** | `loadWeather(env)` → `weather` KV |
| **Cache** | `public, max-age=300` |
| **ETag seed** | `` `${data.updated}|${ctDate}` `` — the CT calendar date is in the seed because `sun` changes with it even when the cache stamp does not |
| **Extra header** | `x-cache: hit \| miss-warmed \| miss-warmfail` |
| **Error code** | `upstream_unavailable` (not `unavailable`) |

## Response

| Field | Notes |
|---|---|
| `location`, `coordinates` | `data.place` or "Crosby, TX"; `{lat: 29.9119, lon: -95.0608}` |
| `source` | `"U.S. National Weather Service (api.weather.gov)"` |
| `updated` | KV refresh stamp — when *we* refreshed, not a period start |
| `sun` | `{sunrise, sunset}` ISO, from `sunTimesForCtDate()`. Derived in-Worker, not an NWS field. |
| `uv` | `{current, currentCategory, peakToday, peakCategory, source}`. EPA-sourced, so it is a separate object rather than folded into `current`. `null` when the EPA fetch failed or the current hour is outside the product's ~6am–8pm window. Raw `0`s are kept. |
| `airQuality` | `aqiApiObject(data.aqi)` — shared with `/api/air`, so the two cannot drift. `null` when both AirNow and Open-Meteo failed. |
| `current` | `currentHourly(data)` with `feelsLike` added. **Never `hourly[0]`** — see below. |
| `hourly` | `data.hourly.slice(0, 12)`, each with `feelsLike` |
| `forecast` | `data.periods` — NWS 7-day, verbatim |
| `alerts` | `data.alerts` — verbatim NWS products |

`feelsLike` comes from `feelsLikeRawF()` (unconditional), not the gated
`feelsLikeF()` used on prominent single-value spots. It is `null` when neither
heat index nor wind chill applies.

## The `current` invariant

`current` is the hourly period covering `Date.now()`, not `hourly[0]`. NWS's
`forecastHourly` first period is the product's *generation* hour and can lag the
wall clock by an hour or more even with a fresh cache. This was a real
user-visible bug — the hero read 5:00 PM at 6:19 PM — and `currentHourly()` is
the fix, shared by this endpoint, both heroes, both markdown renderings, and the
MCP tools.

## Consumers

The service worker's `push` handler fetches this endpoint to compose severe-alert
notifications locally, because the Worker sends a payload-less wake-up. The
homepage's WebMCP tools are backed by it too. Changing the `alerts` shape affects
both.
