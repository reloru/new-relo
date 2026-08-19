# Domain

Current expected state of DNS attachment, routing, and canonicalization for
crosbynews.com. Overwritten in place — no history; see `docs/README.md`.

- Live on crosbynews.com (apex + www) and the *.workers.dev URL.
- **Preview URLs are OFF on purpose** — only `previews_enabled` is false;
  production `enabled` stays `true` for the `*.workers.dev` URL above. Both
  at `/accounts/{account_id}/workers/scripts/crosbynews/subdomain`.
- Attachment (verified via API, added out-of-band — dashboard/API, not
  wrangler): apex `crosbynews.com` is a **Custom Domain**;
  `www.crosbynews.com/*` is a **Workers Route**. Both bind to the
  `crosbynews` worker.
- These are intentionally NOT in wrangler.jsonc. `wrangler deploy` with a
  route-silent config leaves existing routes/custom-domains untouched
  (verified: repeated deploys never disturbed routing). Keeping
  custom-domain management out of the config also avoids deploy-time
  domain-reconciliation surprises. Inspect with
  `/zones/{id}/workers/routes` and `/accounts/{id}/workers/domains`.
- Hard canonicalization is on via a single Cloudflare Redirect rule (Single
  Redirects), so every variant reaches `https://crosbynews.com/` in ONE
  hop:
  - expression: `(not ssl) or (http.host eq "www.crosbynews.com")`
  - target: `concat("https://crosbynews.com", http.request.uri.path)`,
    301, preserve query string.
  - `https://crosbynews.com` matches neither clause → serves 200, no loop.
  **The `(not ssl)` clause is load-bearing** — it upgrades http directly,
  so even http://www reaches the apex in ONE hop. Don't remove it. Lives
  in the zone/dashboard, not wrangler.jsonc or fetch(); it matches
  `<link rel="canonical">` and the sitemap `<loc>`.
- "Always Use HTTPS" (SSL/TLS → Edge Certificates) is **ON**. Redundant
  with the Redirect rule but harmless: Cloudflare runs Single Redirects
  first, so the rule's `(not ssl)` clause always wins and there's no
  double hop. Either state is fine as long as that clause stays; ON is a
  safety net if it ever doesn't.
- HSTS is enabled at the Cloudflare **zone edge** (SSL/TLS → Edge
  Certificates → HSTS: `max-age=63072000; includeSubDomains`, no preload)
  so the header lands on edge-generated responses too — notably the `www`
  → apex 301, which the Worker never sees (the redirect rule runs before
  it) and so can't stamp HSTS on. The Worker ALSO sets HSTS on its own
  (apex) responses; Cloudflare de-dupes, leaving a single header.
  Zone/dashboard config, not wrangler.jsonc.
  The Worker's copy carries `preload` and the zone's does not, so the live
  header now reveals which one survives de-duplication — see
  `docs/ops/cloudflare-zone.md`. The directive is inert until the domain is
  submitted to hstspreload.org, which Cloudflare does **not** do for you.
