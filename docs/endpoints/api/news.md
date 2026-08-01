# `GET /api/news`

The same KV data behind `/news`, as public JSON.

Shared contract: `docs/endpoints/api/README.md`.

| | |
|---|---|
| **Builder** | `apiNews(data)` (`src/features/news.js`) |
| **Loader** | `loadNews(env)` → `news` KV |
| **Cache** | `public, max-age=900` |
| **ETag seed** | `data.updated` |

## Response

Local news items — title, link, source, published ISO, and `category` (`community` \| `incident`, folding the pipeline's internal crime flag). Blocklist-filtered, so an article hidden via the admin nuke is gone here too.

## Page

`docs/pages/news.md` documents the data source, refresh cadence, and failure
mode in full — this endpoint renders exactly the same snapshot.
