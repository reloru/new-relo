# `GET /api/fishing`

The same KV data behind `/fishing`, as public JSON.

Shared contract: `docs/endpoints/api/README.md`.

| | |
|---|---|
| **Builder** | `apiFishing(data)` |
| **Loader** | `loadFishing(env)` → `fishing` KV |
| **Cache** | `public, max-age=300` |
| **ETag seed** | `data.updated` |

## Response

Per-station id, name, water body, the measured `params` (`tempC`, `do`, `ph`, `turb`, `gageFt` — any of which may be null), the observation timestamp, and the USGS monitoring-location URL.

## Page

`docs/pages/fishing.md` documents the data source, refresh cadence, and failure
mode in full — this endpoint renders exactly the same snapshot.
