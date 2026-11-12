---
paths:
  - "src/registry.js"
  - "src/router.js"
  - "src/index.js"
  - "src/discovery.js"
  - "src/pages/**/*.js"
  - "src/features/**/*.js"
  - "src/api/**/*.js"
---

# Pages and routes

- `src/registry.js` is the one list of pages and endpoints. Nav, footer,
  `/sitemap.xml`, `/sitemap`, llms.txt and the canonical set follow from it.
- Adding a page: one `PAGES` entry in `src/registry.js`, a handler in
  `PAGE_HANDLERS` (the router throws at load if the two disagree), a renderer
  whose `<head>` calls `sharedHead(lang)`, and `docs/pages/<page>.md`. Gauge
  pages are `PAGES` entries with a `gauge:` field and share one handler.
- Adding a public endpoint: the route, an `ENDPOINTS` entry, `openApiSpec()`,
  `apiCatalog()`, `README.md`, `/developers` and `docs/endpoints/`.
  `test-routes` cross-checks the specs.
- `/es` is the same handler set with a `lang` flag, not a second site. A
  Spanish page links only Spanish pages (`test-routes` enforces; exceptions
  are in `ES_LINK_ALLOW`). API, MCP, assets and `.well-known` are
  English-only. `/es/mcp` is a human explainer and answers a POST with 404.
- Every content page is Markdown-negotiated (`Accept: text/markdown` or
  `?format=md`, `Vary: Accept`) from the same content as its HTML.
- Pages are GET/HEAD only (405 otherwise). Unknown paths 404. A trailing
  slash 301s to the slash-less path. www → apex and http → https belong to a
  Cloudflare Redirect rule in the zone, not the Worker (`docs/ops/domain.md`).
- `src/index.js` stays thin: dispatch, then security headers and the
  canonical `Link` header.
- Pages built on D1 (`/history`, `/water/<gauge>`) answer 502 on a D1 failure
  rather than render with their history missing. `/burn-ban` is the
  exception: it is live status first, so a D1 failure drops only its
  past-bans table.
