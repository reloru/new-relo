# DNS-AID (lives in Cloudflare DNS, not the Worker)

Current expected state of the site's DNS-AID (agent-discovery) records.
Overwritten in place — no history; see `docs/README.md`.

- Published as SVCB records `_index._agents.crosbynews.com` (org-level
  entry point) and `_mcp._agents.crosbynews.com` (MCP server), each
  `1 crosbynews.com. alpn="h2,h3" port=443`. Zone DNSSEC is active, so they
  resolve authenticated (AD=true).
- Reproduce with `node scripts/dns-aid.mjs`. The token needs
  **`Zone:DNS:Edit`** to write the records AND **`Zone:Zone:Read`** to
  look up the zone id by name — DNS:Edit alone makes the `/zones?name=`
  lookup return an empty list (success, not an error), so the script
  fails with "could not resolve zone id". Either widen the token, or set
  `CLOUDFLARE_ZONE_ID=09de1864babbf541c26590b0fe42f25f` and a DNS:Edit-only
  token suffices. (Both `CLOUDFLARE_ZONE_ID` and the token are already set
  in the cloud environment; if the default token is ever short a scope,
  the env also carries `CLOUDFLARE_ZONE_API_TOKEN` with wider zone
  permissions.) Note the account-owned token can't call
  `/user/tokens/verify` (returns "Invalid API Token") even when it's valid
  for zone/DNS calls — sanity-check it with a resource call, not `verify`.
- Intentionally skipped: OAuth/OIDC, oauth-protected-resource, and
  auth.md — the site has no protected APIs to authenticate against.
