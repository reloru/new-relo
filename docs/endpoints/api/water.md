# `GET /api/water`

The same KV data behind `/water`, as public JSON.

Shared contract: `docs/endpoints/api/README.md`.

| | |
|---|---|
| **Builder** | `apiWater(data)` (`src/features/water.js`) |
| **Loader** | `loadWater(env)` → `water` KV |
| **Cache** | `public, max-age=300` |
| **ETag seed** | `data.updated` |

## Response

Per-gauge `id`, `name`, `usgsId`, observed stage (ft) and flow (cfs), NWPS `category`, the NWS `thresholds` object, and `officialUrl`. Reading and thresholds share one gauge datum, so they are directly comparable.

## Page

`docs/pages/water.md` documents the data source, refresh cadence, and failure
mode in full — this endpoint renders exactly the same snapshot.
