# `GET /api/tropics`

The same KV data behind `/tropics`, as public JSON.

Shared contract: `docs/endpoints/api/README.md`.

| | |
|---|---|
| **Builder** | `apiTropics(data)` (`src/features/tropics.js`) |
| **Loader** | `loadTropics(env)` → `tropics` KV |
| **Cache** | `public, max-age=900` |
| **ETag seed** | `data.updated` |

## Response

Per-storm `id`, `name`, `classification` + human `classificationLabel`, `windMph` (converted from NHC knots, rounded to 5), `intensityKt`, `pressureMb`, position, `movementDirection` (compass only — `movementSpeed`'s unit is not clearly documented upstream), and `advisoryUrl`. **An empty `storms` array is the normal quiet-basin state, not an error.**

## Page

`docs/pages/tropics.md` documents the data source, refresh cadence, and failure
mode in full — this endpoint renders exactly the same snapshot.
