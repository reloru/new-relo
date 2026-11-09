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

## Log: implementation, corrections and follow-ups

*Appended 2026-11-09 at the owner's request. Everything above this heading is
the original write-up, unchanged.*

### Timeline (UTC)

| Time | Event |
|---|---|
| 14:20 | PR #253 squash-merged (`93bb87c`): Worker fallback HSTS header without `preload`, decision recorded in the docs |
| 14:21 | CI deploy for `93bb87c` succeeded |
| 15:15 | Redirect rule changed at the zone through the Rulesets API (ruleset version 2 → 3), on the owner's go-ahead |
| 15:18 | PR #254 squash-merged (`371700c`): docs updated to the new rule; CI deploy succeeded |

### What was implemented

**1. HSTS stays un-preloaded (PR #253).** The change is described under
"Changed in this PR" above. Verified after the deploy:

- The live `Strict-Transport-Security` on `/` was
  `max-age=63072000; includeSubDomains` in 8 of 8 samples, and the same on the
  `www` 301. That is unchanged, as intended, because the zone's copy is the one
  served.
- The CSP header and `/sw.js` hashed identically before and after the deploy, so
  nothing else in the shipped output moved.
- hstspreload.org's preloadable check still returns only
  `header.preloadable.preload.missing`, which is the intended end state.
- `/verify-site` passed: all 42 content pages (both languages) returned 200 and
  were substantive, all 35 non-page routes returned 200, and the security
  headers, one-hop canonicalization, markdown negotiation, 404s, method guards
  and `POST /mcp` all passed.
- The zone's HSTS setting was not touched, its Preload switch stays off, and
  nothing was submitted to hstspreload.org.

**2. Redirect rule scoped to the site's own hosts (zone change + PR #254).** The
defect under "Found, not changed" above was fixed the same day. Only the rule's
expression changed:

```
before: (not ssl) or (http.host eq "www.crosbynews.com")
after:  (http.host eq "www.crosbynews.com") or (not ssl and http.host eq "crosbynews.com")
```

The target (`concat("https://crosbynews.com", http.request.uri.path)`), the 301
status and query-string preservation are unchanged. The rule's description was
updated to match. If a rollback is ever needed, set the expression back to the
"before" line.

Verified in four sampling rounds, all agreeing, and again after the #254 deploy:

| Request | Result |
|---|---|
| `http://<sub>.crosbynews.com/x` (both non-Worker subdomains) | 301 → `https://<sub>.crosbynews.com/x` |
| `http://crosbynews.com/weather?q=1` | 301 → `https://crosbynews.com/weather?q=1` |
| `https://www.crosbynews.com/weather?q=1` | 301 → `https://crosbynews.com/weather?q=1` |
| `http://www.crosbynews.com/weather?q=1` | 301 → `https://crosbynews.com/weather?q=1` (one hop) |
| `https://crosbynews.com/` | 200, no redirect |

HTTPS requests to the other subdomains never matched either version of the rule.
The fix needed no change to those subdomains' applications, their tunnel
configuration, or the machine they run on.

PR #254 updated `CLAUDE.md` and `docs/ops/domain.md`. It removed the known-defect
notes and recorded that "Always Use HTTPS" is now load-bearing. The rule no
longer matches the other subdomains, so that setting is what upgrades them on
their own host.

### Corrections and clarifications to the write-up above

- **"Found, not changed" is superseded.** The redirect defect it describes was
  fixed the same day (item 2 above). `docs/ops/domain.md` is the current-state
  record.
- **That section overstated how much the defect mattered.** "A POST turned into
  a GET at another host's 301 is a real failure for an API" is accurate about the
  mechanism, but it implies a likely scenario, and there wasn't one:
  - Browsers holding the apex's HSTS policy never send the plain-HTTP request.
  - Per the maintainers' text quoted above, Chrome and Safari upgrade HTTP
    navigations anyway.
  - The subdomain names don't appear in public certificate-transparency logs,
    because the certificate names only the apex and the wildcard.

  Only a client explicitly configured with an `http://` URL would have hit it,
  and it would have failed visibly (a 404 from this site), not silently. It was
  fixed because the change was trivial and makes the rule do what its
  documentation says, not because of real exposure.
- **The tunnel's own plain-HTTP hop was never in scope.** Those subdomains reach
  their applications through a Cloudflare Tunnel whose last hop, on the host
  machine, is plain HTTP to localhost. Neither HSTS nor the redirect rule touches
  that hop; both act only on requests arriving at Cloudflare's edge.
- **One quote in "Changed in this PR" is a paraphrase.** The old `src/index.js`
  comment did not contain the words "free to remove until then". It said the line
  was "inert until crosbynews.com is submitted there and accepted, and removing
  it later is free until then". The point stands either way.

### Also recorded

- **Owner's answer on internal use:** no `crosbynews.com` name is used
  internally, on a LAN, or otherwise over plain HTTP. So nothing internal would
  block preload if the decision were ever revisited. That does not change the
  decision; the reasons under "Weighing it" stand.
- **Unverified during the post-deploy check (unrelated to HSTS):** `/api/health`
  showed the burn-ban content unchanged for about 53 days (`hoursSinceChange`
  1264.6), while refreshes kept succeeding (`ok: true`, last attempt 2.1 hours
  earlier). A long-unchanged burn-ban status is plausible. It could not be
  compared against the Texas A&M Forest Service upstream from the session,
  because that ArcGIS endpoint failed certificate verification there ("unable to
  get local issuer certificate"). The deployed Worker reaches it fine. Left open.
