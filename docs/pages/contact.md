# `/contact` — contact

General and security contact addresses.

| | |
|---|---|
| **Handlers** | `contactHtml(lang)` / `contactMarkdown(lang)` — `src/pages/contact.js` |
| **Content** | `CONTACT` / `CONTACT_ES` objects |
| **Route** | `_fetch` → `page === "/contact"` |
| **Spanish** | `/es/contact` |
| **Cache** | `public, max-age=3600` |
| **Negotiation** | `Accept: text/markdown` or `?format=md`; `Vary: Accept` |

The content objects and the renderers now live together in `src/pages/contact.js`.
They were split across the old file — the objects filed inside the About-page
region, hundreds of lines from the renderers reading them — which the
decomposition reunited.

## Content blocks

Static, from the `CONTACT` object:

- `contact@crosbynews.com` — general
- `security@crosbynews.com` — security reporting

## The two addresses are load-bearing outside the Worker

- `security@crosbynews.com` is the address published in
  `/.well-known/security.txt` (RFC 9116). The two must agree.
- It is also a `rua` recipient on the domain's DMARC record, so **it must stay a
  real iCloud mailbox or catch-all** — otherwise half the aggregate reports are
  silently lost.
- Mail is received via iCloud Custom Email Domain; the Worker sends no email.
  DMARC is at `p=reject` as of 2026-07-28, so mail spoofing either address is
  hard-rejected by receivers.

Changing an address here means changing `security.txt`, the DMARC `rua`, and the
iCloud mailbox — not just this page.

## Canonical & sitemap

- Canonical `https://crosbynews.com/contact` · Spanish `/es/contact`
- `hreflangTags("/contact")`
- In `PAGE_PATHS` → `Link: rel="canonical"`
- `sitemap.xml`: yes — `changefreq: monthly`, `priority: 0.3`, no `lastmod`

## Meta

- Title from `CONTACT.title` — Crosby, TX Weather / Clima de Crosby, TX
- Description from `CONTACT.description`
- OG title/description/type/url + `OG_COMMON`
- JSON-LD: `JSONLD_SITE` + `jsonldContact(lang)` (`ContactPage`)
- `<link rel="manifest">`, favicon

## CSP

No inline script.

## Locale

Fully translated via `CONTACT_ES`. Email addresses identical in both.

## Inbound links

Not in the topbar. Linked from `/about`, the shared footer, `/sitemap`, and
`llms.txt`.
