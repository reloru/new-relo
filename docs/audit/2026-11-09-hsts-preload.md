# HSTS preload audit — 2026-11-09

Question asked: should crosbynews.com turn on the HSTS `preload` directive, and
should it be submitted to the HSTS preload list at hstspreload.org? Checked the
repo, the Cloudflare zone through its API, the live headers, and hstspreload.org
itself.

**Result: no on both.** The site already meets every technical requirement for
the list except the directive itself, so this is a decision, not a gap. The list's
own maintainers now advise against preloading. What it would add for this site is
narrow, and what it would cost cannot easily be undone. The Worker's dormant
`preload` token was removed in the same PR, because hstspreload.org treats that
word as a standing request for inclusion. The current-state record is
`docs/ops/cloudflare-zone.md` ("HSTS is on; the preload list is deliberately
not").

## What is live

| Check | Result |
|---|---|
| `Strict-Transport-Security` on `https://crosbynews.com/` (3 samples) | `max-age=63072000; includeSubDomains` every time |
| Same header on the `https://www` → apex 301 | present, same value (edge-generated, the Worker never sees it) |
| `http://crosbynews.com/` | 301 → `https://crosbynews.com/` (same host) |
| Zone setting `security_header` | HSTS enabled, `max_age` 63072000, `include_subdomains` true, `preload` false |
| Worker header before this PR | `max-age=63072000; includeSubDomains; preload` — overwritten at the edge, never served |
| Certificate | apex + `*.crosbynews.com`, valid; no certificate covers a second subdomain level |
| Zone's other web hostnames | two proxied subdomains served through a Cloudflare Tunnel, not this Worker; both answer over HTTPS with the wildcard certificate and carry the zone's HSTS header |
| Cookies | none set anywhere in `src/` |

That the zone's header copy beats the Worker's is the 2026-08-19 finding, and it
still holds: the Worker was sending `preload` throughout and the directive never
appeared.

## What hstspreload.org says

`GET https://hstspreload.org/api/v2/status?domain=crosbynews.com`:

```json
{ "name": "crosbynews.com", "status": "unknown", "bulk": false, "preloadedDomain": "" }
```

`GET https://hstspreload.org/api/v2/preloadable?domain=crosbynews.com`:

```json
{ "errors": [ { "code": "header.preloadable.preload.missing",
                "summary": "No preload directive" } ], "warnings": [] }
```

So the domain is not on the list or pending, and the missing directive is the
only failing check. The certificate, the same-host HTTP → HTTPS redirect, the
one-year `max-age` minimum, `includeSubDomains`, and HSTS on the redirect all
pass.

The page's own guidance, read the same day:

> Many browsers (Chrome, Safari) will automatically upgrade all HTTP navigations
> to HTTPS, regardless of the domain's HSTS policy. HSTS preloading only provides
> value when these upgrades fail in the presence of an active attacker. The
> benefits provided by HSTS preloading are minimal compared to the benefits
> provided by HSTS. While HSTS is recommended, HSTS preloading is not recommended.

> If a site sends the preload directive in an HSTS header, it is considered to be
> requesting inclusion in the preload list and may be submitted via the form on
> this site.

## Weighing it

**What preload would add.** The header already covers every browser that has
loaded the site once, and every subdomain through `includeSubDomains`, for two
years. Preload would extend that to a browser's very first visit. Per the
maintainers, that matters only when an on-path attacker blocks HTTPS so the
browser's automatic upgrade falls back to plain HTTP. The site sets no cookies and
has no sessions, so the remaining exposure is that one first-visit request. That
covers the content shown to that visitor, and the admin secret if it were ever
typed into a plain-`http://` URL on a browser that had never loaded the site.

**What preload would cost.** Acceptance commits every current and future name
under `crosbynews.com` to a valid certificate in every browser that ships the
list, with no click-through on a certificate error. That includes nested and
internal-only names. The zone's certificates stop at one wildcard level, and the
zone already hosts subdomains outside this repo, so the namespace is in use for
more than this site. Removal takes months to reach Chrome users, with no
guarantee for other browsers.

A small, already-mitigated first-visit gap does not justify a commitment that is
hard to reverse and that the list's maintainers recommend against.

## Changed in this PR

- `src/index.js` — the fallback HSTS header dropped `; preload` and now matches
  the zone's value. The old comment called the directive inert and "free to
  remove until then". The quote above contradicts that: it was a standing request
  that would have taken effect the day zone HSTS was switched off.
- `docs/ops/cloudflare-zone.md` — HSTS section rewritten around the decision.
- `docs/ops/domain.md`, `docs/endpoints/README.md`, `CLAUDE.md` — updated to
  match.

## Found, not changed

**The canonicalization redirect rule sends other subdomains' HTTP traffic to the
apex.** Its `(not ssl)` clause matches every host on the zone, so
`http://<sub>.crosbynews.com/x` 301s to `https://crosbynews.com/x` (observed on
both tunnel subdomains) instead of being upgraded on its own host. Browsers that
hold the apex's HSTS policy never send that request. Non-browser clients do, and
a POST turned into a GET at another host's 301 is a real failure for an API. The
scoped expression is
`(http.host eq "www.crosbynews.com") or (not ssl and http.host eq "crosbynews.com")`,
with the same target. Hosts outside that expression fall through to "Always Use
HTTPS", which is already on and upgrades on the same host. It keeps the one-hop
`http://www` → apex behaviour. It is not applied here: it changes production
redirects for hosts this repo does not own, so it waits on the owner. Recorded as
a known defect in `docs/ops/domain.md`.
