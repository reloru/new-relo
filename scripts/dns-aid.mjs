#!/usr/bin/env node
// Publish the DNS-AID (DNS for AI Discovery) entry points for crosbynews.com.
//
// DNS records live in Cloudflare, not the Worker, so this runs out-of-band with
// a token that has Zone:DNS:Edit (the deploy token does not need this):
//
//   CLOUDFLARE_API_TOKEN=... node scripts/dns-aid.mjs
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

const zones = await cf(`/zones?name=crosbynews.com`);
const zone = zones.result?.[0]?.id;
if (!zone) {
  console.error("Could not resolve zone id for crosbynews.com:", JSON.stringify(zones.errors));
  process.exit(1);
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
