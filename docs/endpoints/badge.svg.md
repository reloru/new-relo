# `GET /badge.svg`

A hotlinkable live-weather badge other local sites can embed with a plain
`<img>`.

| | |
|---|---|
| **Builder** | `badgeSvg(data)` (`src/features/weather.js`) |
| **Loader** | `loadWeather(env)` |
| **Content-type** | `image/svg+xml; charset=utf-8` |
| **Cache** | `public, max-age=300, s-maxage=900` — roughly the cron cadence, so hotlinks cost almost nothing |
| **CORS** | `*` |
| **Language** | English-only. An asset, not a page. |

## Contents

300×80, brand-styled, with the favicon's sun-and-cloud at left:

- Current temperature and condition (truncated to fit)
- Feels-like, gated the same way as the heroes (`feelsLikeF`, ≥ 3°F difference)
- A status flag — **"✓ NO ALERTS" green** or **"⚠ N ALERTS" red**

Text rows use `tspan` flow, so variable-width values never need manual collision
math and never overlap. System fonts only — an `<img>` context cannot fetch
webfonts anyway.

## Failure mode

On a `loadWeather` throw it serves `badgeSvg(null)` — a neutral "unavailable"
badge — with `max-age=60` instead of a broken image.

**It carries no alert flag in that state.** We do not know whether an alert is
active, so we do not claim either way. A green "NO ALERTS" badge served from
stale or absent data would be actively dangerous.

## Not a page

No `PAGE_PATHS` entry and no `sitemap.xml` entry, mirroring `/radar-image`.

## Documented in

`/developers` ("Embeddable weather badge", with a copy-paste `<img>` snippet),
the `/sitemap` developer list, and `llms.txt`'s `## Optional` section.
