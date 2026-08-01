# `GET /alerts.xml`

Active NWS alerts as an RSS 2.0 feed. The no-accounts, no-tracking notification
channel: a feed reader gets storm alerts without the site knowing who they are.

| | |
|---|---|
| **Builder** | `alertsRss(data)` |
| **Loader** | `loadWeather(env)` → `weather` KV |
| **Content-type** | `application/rss+xml; charset=utf-8` |
| **Cache** | `public, max-age=300` |
| **Conditional GET** | `conditional()`, seed `data.updated` — weak ETag + `Last-Modified` |
| **Language** | English-only, like the API. No `/es` variant. |

## Feed shape

- `guid` = the NWS alert URN, so a reader dedupes on the alert's own identity
- `ttl` 15, matching the cron cadence
- **An empty channel is the normal all-clear state**, not an error. The feed
  always renders; it just has no items.

## Errors

A `loadWeather` throw returns **502** with the plain-text body
`Feed temporarily unavailable` — not an RSS document. Feed readers treat a 502
as retry-later, which is the intended behavior.

## Advertised by

`<link rel="alternate" type="application/rss+xml">` on `/alerts` in both
languages, `llms.txt`'s `## Optional` section, and the `/sitemap` page.
