#!/usr/bin/env node
// Publish the DNS-AID (DNS for AI Discovery) entry point for crosbynews.com.
//
// This is NOT part of the Worker — DNS records live in Cloudflare, not the
// Worker runtime — so it's run out-of-band with a token that has Zone:DNS:Edit
// (the deploy token does not need this):
//
//   CLOUDFLARE_API_TOKEN=... node scripts/dns-aid.mjs
//
// It publishes an SVCB ServiceMode record at _index._agents.crosbynews.com
// (the org-level agent registry entry point per draft-mozleywilliams-dnsop-
// dnsaid) pointing at the site, which serves the discovery docs
// (/.well-known/api-catalog and /openapi.json). The zone has DNSSEC active, so
// the record resolves authenticated. Safe to re-run: it updates in place.

const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) {
  console.error("Set CLOUDFLARE_API_TOKEN (needs Zone:DNS:Edit).");
  process.exit(1);
}

const NAME = "_index._agents.crosbynews.com";
const RECORD = {
  type: "SVCB",
  name: NAME,
  ttl: 3600,
  data: { priority: 1, target: "crosbynews.com", value: 'alpn="h2,h3" port=443' },
  comment: "DNS-AID agent discovery entry point",
};

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

const existing = await cf(`/zones/${zone}/dns_records?type=SVCB&name=${encodeURIComponent(NAME)}`);
const hit = existing.result?.[0];
const res = hit
  ? await cf(`/zones/${zone}/dns_records/${hit.id}`, { method: "PUT", body: JSON.stringify(RECORD) })
  : await cf(`/zones/${zone}/dns_records`, { method: "POST", body: JSON.stringify(RECORD) });

if (!res.success) {
  console.error((hit ? "update" : "create") + " failed:", JSON.stringify(res.errors));
  process.exit(1);
}
console.log(`${hit ? "updated" : "created"} ${res.result.type} ${res.result.name}`);
console.log("content:", res.result.content);
