# `GET /api/air`

The air-quality object standalone. Same data as the `airQuality` field of
`/api/weather`.

Shared contract: `docs/endpoints/api/README.md`.

| | |
|---|---|
| **Builder** | `apiAir(data)` → `aqiApiObject(data.aqi)` (`src/features/air.js`) |
| **Loader** | `loadWeather(env)` — **no KV key of its own**; the AQI is folded into the `weather` cache by `fetchAqi()` |
| **Cache** | `public, max-age=600` |
| **ETag seed** | `` `${data.updated}|${data.aqi?.measured ? "m" : "o"}` `` |

## Why the seed carries the measured flag

A fallback from AirNow to Open-Meteo changes the body's meaning — measured
becomes modeled, and the monitor names disappear — without necessarily changing
the weather refresh stamp. Folding the flag into the seed makes that transition
visible to a conditional GET.

## Shared builder

`aqiApiObject()` is called by both this endpoint and `/api/weather`, so the two
representations **cannot drift**. Changing the shape changes both.

## Response

Top level: `location`, `updated`, and the `airQuality` object.

Inside `airQuality`:

| Field | Notes |
|---|---|
| `usAqi`, `category` | overall US AQI = max of the pollutant NowCast sub-indices |
| `dominantPollutant` | the pollutant at that max |
| `subIndices` | per-pollutant `pm25` / `ozone` / `pm10` |
| `measured` | `true` = AirNow monitors, `false` = Open-Meteo modeled |
| `modeled` | `!measured`, kept for backward compatibility |
| `dominantMonitor`, `monitors` | monitor site names, per pollutant. AirNow path only. |
| `reportingAgency`, `reportingArea`, `observed`, `source` | provenance |
| `pm2_5`, `pm10`, `ozone`, `concentrationUnit` | raw concentrations — **Open-Meteo only**, `null` on the AirNow path |
| `nearbyMonitor` | `{site, distanceMi, aqi, agency, observedIso}` for Channelview C15 ozone. Present only when both it and the headline AQI resolved; dropped entirely on any error or reporting gap. |

`airQuality` is `null` when both AirNow and Open-Meteo failed.

Verified against the live response 2026-08-01: `usAqi: 38`, `category: "Good"`,
`dominantPollutant: "PM2.5"`, `monitors: {pm25: "Baytown C148", ozone: "Baytown
Garth C1017", pm10: "Clinton C403"}`, `measured: true`.

## Honest labeling

Measured-vs-modeled is never implicit. It is exposed as a field here, as a short
tag (`aqiSourceTag`) and a full sentence (`aqiSourceNote`) on the pages, and is
disclosed on `/about`. A consumer that ignores `measured` will present a CAMS
model output as a monitor reading.

## Page

`docs/pages/air.md` — the AirNow-first / Open-Meteo-fallback chain, why monitors
are selected per pollutant, and the September 2026 AirNow endpoint retirement
that is already handled.
