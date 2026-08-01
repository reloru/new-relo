# `GET /news.xml`

Curated Crosby-area headlines as an RSS 2.0 feed.

| | |
|---|---|
| **Builder** | `newsRss(data)` |
| **Loader** | `loadNews(env)` → `news` KV, blocklist-filtered |
| **Content-type** | `application/rss+xml; charset=utf-8` |
| **Cache** | `public, max-age=900` |
| **Conditional GET** | `conditional()`, seed `data.updated` |
| **Language** | English-only. No `/es` variant. |

## Feed shape

- `guid` = the article link
- `<category>` = `community` or `incident`
- `ttl` 60

## Blocklist

Because it goes through `loadNews()`, an article hidden via the `/news?admin=`
nuke is absent here too, immediately. There is no separate filtering path to keep
in sync.

## Errors

A throw returns **502** with the plain-text body `Feed temporarily unavailable`.

Note that `loadNews()` does not guard the `news` KV read against a corrupt value
the way `loadWeather()` does, so a malformed key 502s this feed rather than
serving an empty one. Recorded as finding 2 in
`docs/audit/2026-07-30-state.md`.

## Advertised by

`<link rel="alternate" type="application/rss+xml">` on `/news` in both languages,
`llms.txt`'s `## Optional` section, and the `/sitemap` page.
