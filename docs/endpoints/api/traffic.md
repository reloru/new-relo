# `GET /api/traffic`

The same KV data behind `/traffic`, as public JSON.

Shared contract: `docs/endpoints/api/README.md`.

| | |
|---|---|
| **Builder** | `apiTraffic(data)` (`src/features/traffic.js`) |
| **Loader** | `loadTraffic(env)` → `traffic` KV |
| **Cache** | `public, max-age=300` |
| **ETag seed** | `data.updated` |

## Response

`incidents` (location, type, status, lanesAffected) and `laneClosures` (location, schedule, lanesAffected, status) — **each `null` when that feed was unreachable at the last refresh, versus `[]` meaning quiet roads.** Plus the static `cameras` catalog (name, roadway, lat, lon, `pageUrl` to TranStar's own camera pages on `traffic.houstontranstar.org` — never image URLs, per TxDOT's no-hotlinking terms) and `liveMapUrl`.

## Page

`docs/pages/traffic.md` documents the data source, refresh cadence, and failure
mode in full — this endpoint renders exactly the same snapshot.
