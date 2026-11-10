# 2026-11-10: who uses plain HTTP on this zone, and the two open items it closes

Follows `docs/audit/2026-11-09-hsts-preload.md`, whose log section left two items
open: whether anything of the owner's uses a `crosbynews.com` name over plain
HTTP, and whether the burn-ban feed's long-unchanged content was stale. Both are
closed here. The audit stays as written.

**Result.** Nothing of the owner's uses plain HTTP on this zone. About 4% of the
site's traffic does arrive over plain HTTP, but it comes from scanners, crawlers
and clients with no user agent, and all of it is redirected to HTTPS. The
burn-ban content was correct: the ban really has been in force since 2026-09-17.
Neither finding changes the decision not to preload HSTS.

## What was checked

**Configuration**, through the Cloudflare API. Every web hostname on the zone is
proxied, so no name can be reached over plain HTTP without passing through the
redirect. The one record that is not proxied is the DKIM mail-signing record,
which points at the mail provider and is not a website. "Always Use HTTPS",
HSTS (no `preload`) and the host-scoped redirect rule were all as recorded in
`docs/ops/domain.md`.

**Traffic**, through Cloudflare's GraphQL analytics, for the 30 days the plan
allows per request and a year of daily totals:

- Zone-wide, Cloudflare's aggregated daily totals show 11,121 of 264,527
  requests (about 4%) unencrypted in the last 30 days.
- To the apex and `www`: at least 550 distinct client IPs in the sampled data. By user agent, the
  traffic is empty-UA clients, crawlers, vulnerability scanners (for example
  `/wp-admin/…` probes), a smaller share of browser-like user agents, and a few
  uptime monitors. All of it was answered with a 301 to HTTPS.
- To the two non-Worker subdomains, which belong to the owner's other projects:
  only the session's own verification requests on 2026-11-09, Cloudflare
  Security Center's scanner, and Cloudflare-internal rows (see below).
- From the machine that runs those projects, identified by its tunnel
  connector's public IP: no real plain-HTTP requests. Its traffic to its own
  subdomains was HTTPS.

**Outside Cloudflare's view.** Anything on a local network that never reaches
Cloudflare. The owner's home network is a Wi-Fi router and a phone. The phone
reaches the site through Cloudflare like any visitor, and the router has no
reason to use one of these names, so nothing falls outside the check.

## Reading the analytics correctly

The Free plan does not expose `clientRequestScheme`, the field that records
whether a request was HTTP or HTTPS. This check used `clientSSLProtocol`
instead, whose value `none` means no TLS handshake took place between client and
Cloudflare. That is **not** the same as plain HTTP. Three things inflate it:

- **Early Hints.** The zone has Early Hints on. Rows with the user agents
  `fl2 early hints` or `nginx-ssl early hints` and a 504 status are consistent
  with requests Cloudflare generates for that feature. They are not client
  traffic. They appear to carry the IP of the client whose request they
  accompany, which would explain why two of them carry the IP of the machine
  running the other projects.
- **Clients on Cloudflare's network.** MCP-directory bots (ProofBench,
  MCPCensus, AgentToolIndex and others) show `none` on `/mcp`, yet received 200
  and 202 from the Worker. Real plain HTTP to the apex is always redirected
  before it reaches the Worker, so these were HTTPS requests with no recorded
  client handshake. The likeliest reason is that those bots run on Cloudflare's
  own network. That last step is an inference; the field that would confirm it
  is not on this plan.
- **Sampling.** The per-request data is adaptively sampled, at about 1 in 10
  here. It shows what kinds of traffic arrive, not every request; the
  aggregated daily totals are the better count.

"Streamable HTTP", the name of the MCP transport, plays no part in any of this.
The server is published as `https://crosbynews.com/mcp`, and Cloudflare
classifies requests by their connection, not by protocol names.

The visitor that requested `/` on all four hostnames, with a desktop-Chrome user
agent ending in `+https://developers.cloudflare.com/security-center/`, is
Cloudflare's own scanner. It scans the account's own hostnames, which would
explain how it knew names that do not appear in certificate-transparency logs.

## The burn-ban item

The audit's post-deploy check flagged `hoursSinceChange` 1264.6 on the `burnban`
feed and could not compare it with the Texas A&M Forest Service upstream from
the session. `/api/burn-ban` reports Harris County's ban as active since
2026-09-17, and 1264.6 hours is 52.7 days back from 2026-11-09. The owner
confirmed the ban has been in force for roughly 53 days. So the feed was serving
a correct status that had simply not changed.

## What this means for preload

Nothing new. Preload is enforced only by browsers, so it would not affect the
plain-HTTP traffic measured here, which is overwhelmingly non-browser. The check
did remove a possible obstacle, any internal plain-HTTP use, but not the reasons
under "Weighing it" in the audit. Preloading stays an owner decision, and the
recommendation is still not to.
