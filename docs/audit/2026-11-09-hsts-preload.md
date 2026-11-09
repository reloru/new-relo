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

## Log: what happened after the write-up, and why

*Appended 2026-11-09 at the owner's request, then rewritten the same day at the
owner's direction because its first version (PR #255, kept in git history)
contained three inaccurate statements. Corrections to that first version are
listed at the end of this section. Everything above this heading is the
original write-up, unchanged.*

### Timeline (UTC, 2026-11-09)

| Time | Event |
|---|---|
| 14:20 | PR #253 squash-merged (`93bb87c`): the write-up above, plus the Worker header change |
| 14:21 | CI deployed `93bb87c` |
| 15:15 | Redirect rule changed at the zone through the Cloudflare API (ruleset version 2 → 3), after the owner approved it |
| 15:18 | PR #254 squash-merged (`371700c`): docs updated to match the new rule; CI deployed it |
| 21:20 | PR #255 squash-merged (`75f198a`): the first version of this log |

### The preload decision

**What happened.** Nothing was turned on and nothing was submitted. The zone's
HSTS setting was not touched, its Preload switch stays off, and crosbynews.com
was not submitted to hstspreload.org. The one code change was the Worker's
fallback HSTS header, which dropped `; preload` and now matches the zone's
value.

**Why.** The reasons for not preloading are under "Weighing it" above. The
Worker token was removed because hstspreload.org treats a header carrying
`preload` as the site's request for inclusion, which anyone may then submit. The
token was dormant only because the zone's header copy overrides the Worker's,
and it would have become a live request the day zone HSTS was switched off.

**How it was checked after the deploy.**

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

### The redirect-rule fix

**What was wrong.** The zone's canonicalization rule was meant for
`crosbynews.com` and `www`. Its plain-HTTP clause, a bare `(not ssl)`, matched
every host on the zone. The zone also carries two subdomains that belong to the
owner's other projects and are served through a Cloudflare Tunnel, not this
Worker. A plain-HTTP request to either of them was redirected to
`https://crosbynews.com` with the same path, instead of to the same subdomain
over HTTPS. This was observed on both subdomains before the fix.

**How much it mattered: very little.** Two kinds of client could have hit it:

- a browser that had never loaded crosbynews.com, so held no HSTS policy for it,
  and does not upgrade plain-HTTP navigations by itself (the maintainers' text
  quoted above says Chrome and Safari do upgrade them);
- any non-browser client given an `http://` URL for one of those subdomains.

Either one also needed the subdomain's name. The certificate names only the apex
and the wildcard, so those names don't appear in public certificate-transparency
logs. When it did happen, the result was wrong but visible, never silently
passed through to the intended app. The request went to this site at the same
path, which served this site's page where one exists at that path and a 404
otherwise. The subdomain's root, for example, would have redirected to this
site's homepage. That last case follows from the rule's target; it was not
requested during the audit.

**Why it was fixed anyway.** The owner was told the impact was negligible, asked
whether the fix needed changes to the other projects, and approved it. It needed
none: the change lives entirely in this zone's rule. It is a one-condition
change with no effect on the apex or `www`. It makes the rule do what its
documentation says, and it removed a standing "known defect" note from
`CLAUDE.md` and `docs/ops/domain.md`.

**What changed.** Only the rule's expression; the rule's description was
updated to match:

```
before: (not ssl) or (http.host eq "www.crosbynews.com")
after:  (http.host eq "www.crosbynews.com") or (not ssl and http.host eq "crosbynews.com")
```

The target (`concat("https://crosbynews.com", http.request.uri.path)`), the 301
status and query-string preservation are unchanged. If a rollback is ever
needed, set the expression back to the "before" line.

**A setting that now matters.** "Always Use HTTPS" is now load-bearing. The rule
no longer matches the other subdomains, so that setting is what upgrades them on
their own host. It must stay on, and `docs/ops/domain.md` says so (PR #254).

**How it was checked.** Four sampling rounds, all agreeing, and again after the
#254 deploy:

| Request | Result |
|---|---|
| `http://<sub>.crosbynews.com/x` (both subdomains) | 301 → `https://<sub>.crosbynews.com/x` |
| `http://crosbynews.com/weather?q=1` | 301 → `https://crosbynews.com/weather?q=1` |
| `https://www.crosbynews.com/weather?q=1` | 301 → `https://crosbynews.com/weather?q=1` |
| `http://www.crosbynews.com/weather?q=1` | 301 → `https://crosbynews.com/weather?q=1` (one hop) |
| `https://crosbynews.com/` | 200, no redirect |

HTTPS requests to the other subdomains never matched either version of the rule,
so they were unaffected throughout. The tunnel's own last hop, plain HTTP to
localhost on the machine that runs those projects, was never in scope either:
HSTS and the redirect rule act only on requests arriving at Cloudflare's edge.

### Why the other projects are not named here

That was a choice made in this audit, not an existing practice. Those subdomains
are newer than most of this repo's documentation; the first was created
2026-09-05. So no earlier document had any reason to mention them. The choice
follows the public-repo rule in `docs/ops/cloudflare-zone.md`: this repo records
consequences, not the zone's inventory. These names in particular are not
published elsewhere, because the certificate does not list them. Writing them
here would be the main public record of them. The live list is one request to
the zone's DNS API.

### Open items

- **Owner's answer on internal use.** Asked whether any `crosbynews.com` name is
  used internally, on a LAN, or otherwise over plain HTTP, the owner said they
  don't think so. If that holds, nothing internal would block preload if the
  decision were ever revisited. It does not change the decision; the reasons
  under "Weighing it" stand.
- **Burn-ban freshness, unverified (unrelated to HSTS).** `/api/health` showed
  the burn-ban content unchanged for about 53 days (`hoursSinceChange` 1264.6),
  while refreshes kept succeeding (`ok: true`, last attempt 2.1 hours earlier). A
  long-unchanged burn-ban status is plausible. It could not be compared against
  the Texas A&M Forest Service upstream from the session, because that ArcGIS
  endpoint failed certificate verification there ("unable to get local issuer
  certificate"). The deployed Worker reaches it fine. Left open.

### Corrections to the write-up and to this log's first version

To the original write-up above:

- **"Found, not changed" is superseded.** That defect was fixed the same day;
  `docs/ops/domain.md` is the current-state record.
- **It overstated the defect.** "Browsers that hold the apex's HSTS policy never
  send that request. Non-browser clients do" left out first-visit browsers that
  don't upgrade on their own. "A real failure for an API" described the
  mechanism accurately but implied a likely scenario. The accurate scope is under
  "How much it mattered" above.
- **One quote in "Changed in this PR" is a paraphrase.** The old `src/index.js`
  comment did not contain the words "free to remove until then". It said the line
  was "inert until crosbynews.com is submitted there and accepted, and removing
  it later is free until then". The point stands either way.

To this log's first version (PR #255):

- **It said "only a client explicitly configured with an `http://` URL would
  have hit it."** That was too narrow: it left out first-visit browsers that
  don't upgrade plain-HTTP navigations themselves.
- **It said the defect "would have failed visibly (a 404 from this site)."** A
  404 resulted only where this site has no page at that path; elsewhere the
  request landed on one of this site's pages.
- **It recorded the owner's answer on internal use as a fact.** The owner's
  words were "I don't think so", and it is recorded above as their belief.
