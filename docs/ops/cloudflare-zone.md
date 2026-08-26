# Cloudflare zone — intent, not inventory

**This is deliberately not a settings dump, and deliberately does not record the
zone's current security posture.** Live state is queryable with the API token in
seconds, so copying it here would only create a second source of truth that rots
— and this repo is public, so a tidy summary of which protections are or aren't
active is free reconnaissance. Individually those facts are discoverable in one
request; aggregated into a list they are a gift, and the site has a secret-guarded
admin surface (`/api/news/delete`, `/api/news/restore`).

So this file records only what the API *cannot* tell you: which things look like
cruft but are load-bearing, and which changes would break documented behaviour.
Consequences, not configuration. Check current state with the token.

## Do not delete: the `_acme-challenge` TXT records

The zone carries `_acme-challenge` TXT records with short TTLs and opaque base64
values. They look exactly like leftovers from a one-off certificate issuance.
**They are not.** The certificate packs on this zone use
`validation_method: txt`, so those records are the domain-control proof for the
apex and the wildcard. Delete them and renewal fails — silently, and only weeks
later when the current certificate expires.

Confirm before ever touching them:

```
GET /zones/{zone_id}/ssl/certificate_packs?status=all   → validation_method
```

## Changes that would break documented behaviour

Do not make these, and re-read this list before "improving" the zone's security
settings — each would take out something the site publicly offers.

- **Bot fight mode** challenges non-browser traffic. That is the public JSON API,
  the MCP endpoint, both RSS feeds, and agent-skills discovery — the entire
  agent-facing surface this site exists to provide. Its `JS Detections`
  sub-setting can read as "On" in the dashboard while Bot fight mode itself is
  not active; that combination injects nothing. Verify by diffing a page fetched
  with a browser UA against the same page fetched with `curl` — they must be
  byte-identical, with no `cdn-cgi/challenge-platform` script.
- **AI Labyrinth** works by injecting AI-generated nofollow links into pages.
  This site publishes public-safety data and pins the SHA-256 of its own inline
  scripts in the CSP. Edge-injected content is precisely what it must never have.
- **Hotlink Protection** breaks `/badge.svg`, which `llms.txt` and `/developers`
  advertise as a *hotlinkable* live badge.
- **Cloudflare's "Manage your robots.txt"**, set to anything other than disabled.
  `robotsTxt()` (`src/discovery.js`) deliberately omits a Content-Signal line and
  is the only intended source. Never select *Instruct AI bots to not scrape
  content*: this site's robots.txt explicitly **allows** GPTBot, ClaudeBot,
  PerplexityBot, CCBot and Google-Extended, and the MCP server exists to be
  consumed by agents.

Regression check for the last one — these must agree:

```bash
diff <(node -e 'import("./src/discovery.js").then(m=>process.stdout.write(m.robotsTxt()))') \
     <(curl -s https://crosbynews.com/robots.txt)
```

## Edge features can rewrite a response after the Worker returns it

**Nothing in this repo can see an edge-injected change.** That is not
hypothetical: Cloudflare Web Analytics injected a tracker into every page for
months while `/privacy` claimed there were no third-party analytics scripts (see
`docs/ops/analytics.md`).

The trap that hid it: **Cloudflare only injects for browser-looking requests, so a
default-UA `curl` sees nothing.** Any check for edge injection must send a real
browser User-Agent *and* an HTML `Accept` header:

```bash
curl -s -A "Mozilla/5.0 (iPhone; …) Safari/604.1" -H 'Accept: text/html' \
  https://crosbynews.com/ | grep -c cloudflareinsights
```

Several Cloudflare features rewrite HTML bodies or add headers by design — email
obfuscation, HTTPS rewrites, JS-library replacement, script monitoring. Audit
them by *bytes*, never by reading the toggles. Email obfuscation in particular
would corrupt the `"email"` field in the homepage JSON-LD, so re-check it if
structured data ever looks wrong.

### Speed Brain is ON, and adds a header this repo does not set

Every response carries a header the Worker never wrote:

```
speculation-rules: "/cdn-cgi/speculation"
```

`/cdn-cgi/speculation` is served by the edge, not by `routeRequest`, and returns
a prefetch ruleset that makes visitors' browsers speculatively prefetch
same-origin links:

```json
{"tag":"cf-speed-brain","prefetch":[{"eagerness":"conservative","source":"document",
 "where":{"and":[{"href_matches":"/*","relative_to":"document"}]}}]}
```

Found by the 2026-08-26 audit; it had never been recorded here. What it is and
is not:

- **It does not contradict `/privacy`.** Nothing third-party is loaded, no script
  is injected, and the HTML body is byte-identical between a real browser UA and
  a plain `curl` (checked both ways, 26104 bytes each). The
  no-third-party-analytics claim on `/privacy` and `/about` still holds.
- **It does mean page views are not visits.** `conservative` eagerness fires on
  hover/pointerdown, so the origin sees GETs for pages nobody opened. Nothing
  reads those today, but any future traffic counting must account for it.
- **CSP does not block it.** The ruleset is same-origin, which `script-src 'self'`
  allows. Tightening `script-src` away from `'self'` would break it.

Turning it off is a zone-dashboard action (Speed → Optimization), not something a
session can do.

## HSTS and the preload list

`max-age=63072000` with `includeSubDomains`, set at the zone edge *and* by the
Worker (`src/index.js`); Cloudflare de-dupes to a single header.

**The zone's copy wins. The Worker's `strict-transport-security` line is
overwritten at the edge and never reaches a browser.**

Measured 2026-08-19, after deploying a Worker header carrying `preload` while the
zone setting had preload off. Across 18 samples of `/`, plus `/alerts`, plus the
`www` → apex 301, the live header was `max-age=63072000; includeSubDomains` every
time — the zone's value, never the Worker's:

```bash
curl -sI https://crosbynews.com/ | grep -i strict-transport
```

Two consequences:

- **Editing the HSTS string in `src/index.js` does nothing while the zone setting
  is enabled.** Anyone changing it and expecting an effect will be misled. Keep
  the line — it is the fallback if zone HSTS is ever switched off — but change
  HSTS at the zone.
- **Preload requires the zone-level Preload switch.** Adding `preload` in the
  Worker was necessary groundwork but is not sufficient on its own.

Two things about `preload` that are easy to get wrong:

- **It is a consent marker, not a behaviour.** No browser acts on the word. What
  browsers act on is a list compiled into the binary. The directive is therefore
  inert on its own, and safe to ship before any decision is final.
- **Cloudflare does not submit the domain for you.** The list is maintained by
  the Chromium project at hstspreload.org and ingested by Firefox, Safari and
  Edge; submission there is a separate manual step. Cloudflare's Preload switch
  only adds the same word to the header.

Do not submit lightly. Removal means getting off a list baked into shipped
browser binaries and waiting out release cycles — months — and acceptance
permanently commits every present and future subdomain to HTTPS.

Also note the zone's HSTS dialog offers a **max-age dropdown that can be blank**
(`Select…`) while the zone already serves a longer value. Saving that form without
explicitly choosing a duration risks lowering `max-age`; preload requires at least
one year.

## CAA — do not narrow it, and do not "clean up" the extra entries

CAA records restrict which certificate authorities may issue for the domain. Added
2026-08-19; before that any publicly-trusted CA could issue.

**Two CAs are load-bearing and must always be permitted**: `pki.goog` (Google
Trust Services — the advanced pack and the backup) and `letsencrypt.org` (the
universal pack). Removing either breaks renewal.

**`issuewild` entries are mandatory**, not optional garnish: the zone's
certificate covers `*.crosbynews.com`, and a CAA set with only `issue` blocks
wildcard issuance.

**Cloudflare silently adds more CAs than you write.** Nine records were created by
hand; **thirteen** publish. Cloudflare backfilled `comodoca.com` and
`digicert.com` on its own — these do not appear in the dashboard and are visible
only over DNS. They are correct. Do not delete them as cruft; they exist so a
Cloudflare CA rotation does not break issuance. (This automatic backfill is
documented as *not* applying to Advanced Certificate Manager. This zone is Free
plan with no ACM subscription, so it does apply here — if ACM is ever purchased,
re-check that the backfill still covers the CAs in use.)

**Never follow the common scanner advice** to "restrict the issue tag to your
actual certificate provider." Cloudflare rotates among several partner CAs, and
its own documentation says the list "is not exhaustive, and other CAs might be
added or removed for operational reasons." Narrowing to the CA currently issuing
is the exact change that kills renewal weeks later.

Verify over DNS, never from the dashboard, and confirm both load-bearing CAs
survive any edit:

```bash
curl -s 'https://dns.google/resolve?name=crosbynews.com&type=CAA' \
  | python3 -c "import json,sys; [print(a['data']) for a in json.load(sys.stdin).get('Answer',[])]"
```

The `iodef` entry points at `security@crosbynews.com` — already published in
`/.well-known/security.txt`, so it adds no new address to public DNS, and
delivery to the owner's mailbox was verified before it was set. A conforming CA
reports blocked issuance attempts there, which is the warning that a CAA edit has
broken renewal *before* the certificate expires.

## Certificate Transparency Monitoring

Emails whenever any CA issues a certificate for the domain — the only signal that
would surface a mis-issued or attacker-obtained certificate. Routine renewal
notices a few times a quarter are expected and are not alerts.
