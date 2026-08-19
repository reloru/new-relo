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

## HSTS

`max-age=63072000` with `includeSubDomains`, set at the zone edge *and* by the
Worker (`src/index.js`); Cloudflare de-dupes to a single header.

If HSTS preload is ever turned on, the Worker's own header string must carry
`preload` too — otherwise whichever copy survives de-duplication may lack the
directive and hstspreload.org will reject the submission. Confirm with
`curl -sI https://crosbynews.com/ | grep -i strict` before submitting. Preload is
close to irreversible: removal takes months to reach released browsers, and it
commits every present and future subdomain to HTTPS permanently.

## Certificate Transparency Monitoring

Emails whenever any CA issues a certificate for the domain — the only signal that
would surface a mis-issued or attacker-obtained certificate. Routine renewal
notices a few times a quarter are expected and are not alerts.
