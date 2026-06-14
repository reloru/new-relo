#!/usr/bin/env node
// Publish the DNS-AID (DNS for AI Discovery) entry points for crosbynews.com.
//
// DNS records live in Cloudflare, not the Worker, so this runs out-of-band. The
// token needs Zone:DNS:Edit to write the records, plus Zone:Zone:Read to look up
// the zone id by name — or set CLOUDFLARE_ZONE_ID and a DNS:Edit-only token is
// enough (the deploy token does not need any of this):
//
//   CLOUDFLARE_API_TOKEN=... node scripts/dns-aid.mjs
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ZONE_ID=... node scripts/dns-aid.mjs  # DNS:Edit only
//
// Publishes SVCB ServiceMode records under _agents.crosbynews.com per
// draft-mozleywilliams-dnsop-dnsaid, pointing at the site (which serves the
// discovery docs: /.well-known/api-catalog, /openapi.json, and the MCP server
// card at /.well-known/mcp/server-card.json). Zone DNSSEC is active, so the
// records resolve authenticated. Safe to re-run: it updates in place.

const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) {
  console.error("Set CLOUDFLARE_API_TOKEN (needs Zone:DNS:Edit).");
  process.exit(1);
}

// SVCB ServiceMode → crosbynews.com over HTTPS (h2/h3). The exact service
// endpoint paths are advertised by the discovery docs the site serves.
const svcb = (comment) => ({
  type: "SVCB",
  ttl: 3600,
  data: { priority: 1, target: "crosbynews.com", value: 'alpn="h2,h3" port=443' },
  comment,
});
const RECORDS = [
  { name: "_index._agents.crosbynews.com", ...svcb("DNS-AID org-level agent discovery entry point") },
  { name: "_mcp._agents.crosbynews.com", ...svcb("DNS-AID MCP server discovery (see /.well-known/mcp/server-card.json)") },
];

const cf = (path, init) =>
  fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init?.headers },
  }).then((r) => r.json());

// Prefer an explicit CLOUDFLARE_ZONE_ID so a token scoped to only Zone:DNS:Edit
// works. The /zones?name= lookup below additionally needs Zone:Zone:Read, and
// without it returns an empty list (success, not an error) — which otherwise
// surfaces as a confusing "could not resolve zone id".
let zone = process.env.CLOUDFLARE_ZONE_ID;
if (!zone) {
  const zones = await cf(`/zones?name=crosbynews.com`);
  zone = zones.result?.[0]?.id;
  if (!zone) {
    console.error(
      "Could not resolve zone id for crosbynews.com. Set CLOUDFLARE_ZONE_ID, or give the" +
        " token Zone:Zone:Read (Zone:DNS:Edit alone can't list zones):",
      JSON.stringify(zones.errors)
    );
    process.exit(1);
  }
}

for (const rec of RECORDS) {
  const existing = await cf(`/zones/${zone}/dns_records?type=SVCB&name=${encodeURIComponent(rec.name)}`);
  const hit = existing.result?.[0];
  const res = hit
    ? await cf(`/zones/${zone}/dns_records/${hit.id}`, { method: "PUT", body: JSON.stringify(rec) })
    : await cf(`/zones/${zone}/dns_records`, { method: "POST", body: JSON.stringify(rec) });
  if (!res.success) {
    console.error(`${hit ? "update" : "create"} failed for ${rec.name}:`, JSON.stringify(res.errors));
    process.exit(1);
  }
  console.log(`${hit ? "updated" : "created"} ${res.result.type} ${res.result.name} -> ${res.result.content}`);
}
