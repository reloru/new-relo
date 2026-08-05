# `GET /api/fishing`

The same KV data behind `/fishing`, as public JSON.

Shared contract: `docs/endpoints/api/README.md`.

| | |
|---|---|
| **Builder** | `apiFishing(data)` (`src/features/fishing.js`) |
| **Loader** | `loadFishing(env)` → `fishing` KV |
| **Cache** | `public, max-age=300` |
| **ETag seed** | `data.updated` |

## Response

`location`, `source`, `note`, `updated`, and a `stations` array.

**Each station is flattened and unit-converted on the way out — it is NOT the KV
shape.** The `fishing` KV entry stores `params: {tempC, do, ph, turb, gageFt}`;
`apiFishing()` emits:

| Field | Notes |
|---|---|
| `id` | USGS site number |
| `water`, `spot`, `knownFor` | which water, where on it, what it's fished for — editorial, not USGS |
| `temperatureF` | converted from the USGS Celsius reading |
| `dissolvedOxygenMgL`, `ph`, `turbidityFNU` | as measured; any may be `null` |
| `waterLevelFt` | gauge height — level-only stations report this and nothing else |
| `conditions` | one-line plain-language read, derived in-Worker. **English only, even on `/es`** |
| `observed` | when USGS observed it (station-local offset), distinct from the top-level `updated`, which is when we fetched |
| `officialUrl` | the station's USGS monitoring-location page |

Read the API names from `apiFishing()`, not from the KV entry — every measured
field is renamed between them. Fully documented in `/openapi.json` as the
`Fishing` and `FishingStation` components.

## Page

`docs/pages/fishing.md` documents the data source, refresh cadence, and failure
mode in full — this endpoint renders exactly the same snapshot.
