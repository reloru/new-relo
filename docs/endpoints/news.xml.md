# `GET /news.xml`

Curated Crosby-area headlines as an RSS 2.0 feed.

| | |
|---|---|
| **Builder** | `newsRss(data)` (`src/features/news.js`) |
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

`loadNews()` guards the `news` KV read against a corrupt value, so a malformed
key degrades to an empty feed rather than 502ing it. That matters more here than
for the cron-owned keys: `news` is written out-of-band, so the Worker has no
fetch path to self-heal with.

## Advertised by

`<link rel="alternate" type="application/rss+xml">` on `/news` in both languages,
`llms.txt`'s `## Optional` section, and the `/sitemap` page.
