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
  **Known defect: `(not ssl)` is not host-scoped.** The zone also serves
  subdomains that are not this Worker, and a plain-HTTP request to any of
  them is sent to the apex with the same path, not upgraded on its own host
  (`http://<sub>.crosbynews.com/x` → `https://crosbynews.com/x`). Browsers
  holding the apex's HSTS policy never send that request, so it bites
  non-browser HTTP clients and first visits. The fix keeps the one-hop
  `http://www` behaviour and leaves other hosts to "Always Use HTTPS"
  (same-host upgrade): expression
  `(http.host eq "www.crosbynews.com") or (not ssl and http.host eq "crosbynews.com")`,
  same target. Not yet applied — it changes production redirects for hosts
  outside this repo, so it waits on the owner.
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
  **The zone's copy wins** — measured 2026-08-19 and again 2026-11-09 with
  the Worker sending `preload` and the zone not: the directive never
  appeared, on any route. So the Worker's HSTS line is a fallback for "zone
  HSTS switched off", not the live value; it now carries the same value as
  the zone. Change HSTS at the zone.
  **Not on the HSTS preload list, by decision (2026-11-09):** no `preload`
  at the zone or in the Worker, and no submission to hstspreload.org — whose
  maintainers now advise against preloading. Reasons, and what would change
  the decision, in `docs/ops/cloudflare-zone.md`. Turning preload on is an
  owner decision, not a session's.
