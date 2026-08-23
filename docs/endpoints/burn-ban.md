# `GET /api/burn-ban`

The same KV data behind `/burn-ban`, as public JSON.

Shared contract: `docs/endpoints/api/README.md`.

| | |
|---|---|
| **Builder** | `apiBurnBan(data)` (`src/features/burnban.js`) |
| **Loader** | `loadBurnBan(env)` → `burnban` KV |
| **Cache** | `public, max-age=1800` |
| **ETag seed** | `` `${data.status}|${data.updated}` `` |

## Response

`county` (always `"Harris"`), `status` (`"Yes"` / `"No"` / `null` when
unavailable), `startDate` (ISO, `null` with no active ban), `lastChecked`
(ISO — the same instant as the KV entry's internal `updated` write-stamp,
renamed here for a clearer public field name), and `officialUrl` (the TFS
tracker).

**Countywide only.** There is no sub-county resolution — this is Harris
County's status, not a Crosby-specific one.

## Page

`docs/pages/burnban.md` documents the data source (including the response
quirks `fetchBurnBan()` handles: `BurnBan` as a string, `StartDate` as epoch
ms, the 200-with-error-body shape), refresh cadence, and failure mode in
full — this endpoint renders exactly the same snapshot.
