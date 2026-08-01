# `GET /robots.txt`

RFC 9309 crawl rules.

| | |
|---|---|
| **Builder** | `robotsTxt()` (`src/discovery.js`) |
| **Content-type** | `text/plain; charset=utf-8` |
| **Cache** | `public, max-age=3600` |

## Policy: open by design

`User-agent: * / Allow: /`. This is public-domain NWS data and the site wants to
be found by agents.

AI crawlers are then **explicitly** allowed by name rather than left to the
wildcard — GPTBot, OAI-SearchBot, ChatGPT-User, Claude-Web, ClaudeBot,
Claude-User, Claude-SearchBot, anthropic-ai, Google-Extended, PerplexityBot,
CCBot, cohere-ai. Naming them is a deliberate signal, since some operators treat
an unlisted agent conservatively.

Ends with `Sitemap: https://crosbynews.com/sitemap.xml`.

## No `Content-Signal` line

Intentionally omitted — it confused some crawlers when present. Do not re-add it
without re-testing.
