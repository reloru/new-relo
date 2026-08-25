# `/alerts` — active alerts + severe-weather guide

Active NWS alerts for Crosby, plus an evergreen plain-language guide so the page
stays substantial when nothing is active (it is quiet most of the year, and a
bare "no alerts" page is thin content).

| | |
|---|---|
| **Handlers** | `alertsHtml(data, lang)` / `alertsMarkdown(data, lang)` — `src/features/alerts.js` |
| **Route** | `routeRequest` (`src/router.js`) → `page === "/alerts"` |
| **Spanish** | `/es/alerts` |
| **Cache** | `public, max-age=300` |
| **Negotiation** | `Accept: text/markdown` or `?format=md`; `Vary: Accept` |

## Content blocks

| Block | Source |
|---|---|
| Status panel — active count, or an all-clear | `weather` KV `alerts` |
| Emergency-resources row, directly under the status panel | static, links `/emergency` |
| Full alert products — event, headline, description, instruction, effective/expires | `weather` KV `alerts`, verbatim NWS |
| **Severe-alert push opt-in** (`#push-optin`) | `/api/push/vapid-key`; hidden without support or a key |
| Evergreen severe-weather guide (`ALERT_GUIDE` / `ALERT_GUIDE_ES`) — watch vs warning, what each product means, what to do | static |
| RSS discovery link | `/alerts.xml` |

This module also **owns the compact banner other pages show** —
`alertsBanner()` plus `ALERT_BANNER_CSS`, `alertRank` and `alertSummaryLine`.
It lived in `home.js` as `hubAlertsBanner` while the hub was its only caller;
once `/weather` needed it too, a weather page importing the hub's component was
backwards, and alerts are this module's domain. Both callers share one function
and one CSS constant so they cannot drift, and the banner is deliberately the
same red as this page's status panel — a reader who follows the link should
land somewhere that looks like where they came from.

**This page is the only place full alert products render.** Everywhere else
gets count + worst type + one summary line and a link here.

## Push opt-in

Progressive enhancement, driven by `PUSH_CLIENT_SCRIPT`. Stays hidden when the
browser lacks push support or `/api/push/vapid-key` returns `null` — **except on
iPhone Safari tabs**, where it shows an add-to-Home-Screen hint (`data-ios`)
instead, because iOS exposes Web Push only to Home-Screen web apps and a
plain-tab visitor would otherwise never learn the feature exists.

Two Safari behaviors are baked into the click handler and must not be
"tidied up":

1. `Notification.requestPermission()` must be the **first** await in the tap
   handler — Safari only honors the prompt during the tap's transient activation.
2. base64url → bytes padding uses the plain `while (s.length % 4) s += "="` loop.
   A slicker closed-form pad expression shipped broken once: `atob` threw on
   every subscribe attempt, in every browser.

Only life-threatening **warnings** push (`SEVERE_PUSH_EVENTS` in `src/push.js`: Tornado, Flash
Flood, Hurricane, Hurricane Force Wind, Extreme Wind, Tropical Storm) — never
watches or advisories, to avoid alert fatigue. Verified live: an active Special
Weather Statement correctly did not push.

## Data

`loadWeather(env)` → `weather` KV `alerts`. On throw: `renderError`, 502.

## Canonical & sitemap

- Canonical `https://crosbynews.com/alerts` · Spanish `/es/alerts`
- `hreflangTags("/alerts")`
- In `PAGE_PATHS` → `Link: rel="canonical"`
- `sitemap.xml`: yes — `changefreq: hourly`, `priority: 0.7`, no `lastmod`
- Precached by the service worker (`/alerts` and `/es/alerts`) — storm-critical

## Meta

- Title "Crosby, TX Weather Alerts" / "Alertas meteorológicas de Crosby, TX"
- Per-language description covering alerts, warnings, watches and the guide
- `<link rel="alternate" type="application/rss+xml">` → `/alerts.xml`
- OG title/description/type/url + `OG_COMMON`
- JSON-LD: `JSONLD_SITE` only
- `<link rel="manifest">`, favicon

## CSP

Inlines `PUSH_CLIENT_SCRIPT` (`src/assets/client-scripts.js`), hash-allow-listed by `contentSecurityPolicy()`.
The script's bytes are **language-agnostic** — every user-facing string is read
from `data-*` attributes on `#push-optin` — so one hash serves both languages.
This is the only page that carries it.

## Locale

Page chrome and the severe-weather guide are translated (`ALERT_GUIDE_ES`).
**Alert text itself stays in NWS's official English**, in both languages. Same
reasoning as `/weather`: NWS publishes no Spanish alert API, and a mistranslated
warning is a safety problem, not a copy problem.
