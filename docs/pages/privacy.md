# `/privacy` — privacy policy

No cookies, no trackers, no personal data. Details on logging, third-party data
sources, analytics, and push notifications.

| | |
|---|---|
| **Handlers** | `privacyHtml(lang)` / `privacyMarkdown(lang)` — `src/pages/privacy.js` |
| **Content** | `PRIVACY` / `PRIVACY_ES` objects |
| **Route** | `routeRequest` (`src/router.js`) → `page === "/privacy"` |
| **Spanish** | `/es/privacy` |
| **Cache** | `public, max-age=3600` |
| **Negotiation** | `Accept: text/markdown` or `?format=md`; `Vary: Accept` |

The content objects and the renderers now live together in `src/pages/privacy.js`.
They were split across the old file — the objects filed inside the About-page
region, hundreds of lines from the renderers reading them — which the
decomposition reunited.

## Content blocks

Static, from the `PRIVACY` object. Sections cover:

- No cookies, no trackers, no accounts, no personal data collected
- Third-party data sources — requests go to *us*, and we fetch upstream
  server-side, so the visitor's browser never contacts NWS, EPA, USGS, TranStar
  or the rest
- Analytics posture — **there is no analytics script at all.** Cloudflare Web
  Analytics was auto-injected at the zone edge until 2026-08-19, when the site
  was deleted; the CSP no longer allows `static.cloudflareinsights.com` or
  `cloudflareinsights.com`. The section says so, and names Cloudflare's ordinary
  server-side request logging as the one thing that remains. Full detail in
  `docs/ops/analytics.md`. Adding analytics back means changing this section, the
  matching `/about` block, and the CSP together — the claim and the code must
  move as one
- **Push notifications** — only an anonymous push subscription is stored, no
  message content travels through it, and it is deletable at any time

The push section must stay accurate against the actual storage: one KV entry per
subscription under the `push:` prefix, value `{endpoint, keys, added}`, keyed by
a hash of the endpoint. The wake-up the cron sends is **payload-less** — the
service worker composes the notification locally from `/api/weather` — so no
message content is transmitted, which is exactly what the policy claims.

## Canonical & sitemap

- Canonical `https://crosbynews.com/privacy` · Spanish `/es/privacy`
- `hreflangTags("/privacy")`
- In `PAGE_PATHS` → `Link: rel="canonical"`
- `sitemap.xml`: yes — `changefreq: monthly`, `priority: 0.3`, no `lastmod`

## Meta

- Title from `PRIVACY.title` — Crosby, TX Weather / Clima de Crosby, TX
- Description from `PRIVACY.description`
- OG title/description/type/url + `OG_COMMON`
- JSON-LD: `JSONLD_SITE` + `jsonldPrivacy(lang)` (`WebPage`)
- `<link rel="manifest">`, favicon

## CSP

No inline script. As of 2026-08-19 the sitewide policy allows **no third-party
script origin at all** — the `static.cloudflareinsights.com` / `cloudflareinsights.com`
allowances were removed when Web Analytics was deleted at the zone.

## Locale

Fully translated via `PRIVACY_ES`, hand-written. Both objects must stay
structurally parallel.

## Inbound links

Not in the topbar. Linked from `/about`, the shared footer, `/sitemap`, and
`llms.txt`.
