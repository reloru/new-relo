#!/usr/bin/env node
// Publish / update the DMARC policy record for crosbynews.com.
//
// Email DNS lives in Cloudflare, not the Worker, so this runs out-of-band like
// scripts/dns-aid.mjs. The MX (mx01/mx02.mail.icloud.com), SPF
// (v=spf1 include:icloud.com ~all) and DKIM (sig1._domainkey CNAME → iCloud)
// records are all managed by iCloud Custom Email Domain — this script does NOT
// touch those. It owns only the one record we control: the DMARC policy at
// _dmarc.crosbynews.com. (The Worker itself sends no email.)
//
// The token needs Zone:DNS:Edit to write, plus Zone:Zone:Read to look up the
// zone id by name — or set CLOUDFLARE_ZONE_ID and a DNS:Edit-only token is
// enough (the deploy token does not need any of this):
//
//   CLOUDFLARE_API_TOKEN=... node scripts/dmarc.mjs                      # p=none (default)
//   CLOUDFLARE_API_TOKEN=... DMARC_POLICY=quarantine node scripts/dmarc.mjs
//   CLOUDFLARE_API_TOKEN=... DMARC_POLICY=reject node scripts/dmarc.mjs
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ZONE_ID=... node scripts/dmarc.mjs  # DNS:Edit only
//
// Rollout: start at p=none and read the aggregate (rua) reports that arrive at
// security@crosbynews.com for ~1-2 weeks; once iCloud mail shows aligned pass
// and nothing legitimate is failing, re-run with DMARC_POLICY=quarantine, then
// =reject. Safe to re-run: it updates the record in place.

const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) {
  console.error("Set CLOUDFLARE_API_TOKEN (needs Zone:DNS:Edit).");
  process.exit(1);
}

const POLICY = process.env.DMARC_POLICY || "none";
if (!["none", "quarantine", "reject"].includes(POLICY)) {
  console.error(`Invalid DMARC_POLICY "${POLICY}" (use none | quarantine | reject).`);
  process.exit(1);
}

const RUA = "mailto:security@crosbynews.com"; // aggregate-report mailbox (must be a real iCloud alias/catch-all)
const record = {
  type: "TXT",
  name: "_dmarc.crosbynews.com",
  content: `v=DMARC1; p=${POLICY}; rua=${RUA}`,
  ttl: 3600,
  comment: `DMARC policy (p=${POLICY}); aggregate reports to security@`,
};

const cf = (path, init) =>
  fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init?.headers },
  }).then((r) => r.json());

// Prefer an explicit CLOUDFLARE_ZONE_ID so a token scoped to only Zone:DNS:Edit
// works. The /zones?name= lookup below additionally needs Zone:Zone:Read, and
// without it returns an empty list (success, not an error).
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

const existing = await cf(`/zones/${zone}/dns_records?type=TXT&name=${encodeURIComponent(record.name)}`);
if (!existing.success) {
  console.error("lookup failed:", JSON.stringify(existing.errors));
  process.exit(1);
}
const hit = existing.result?.[0];
const res = hit
  ? await cf(`/zones/${zone}/dns_records/${hit.id}`, { method: "PUT", body: JSON.stringify(record) })
  : await cf(`/zones/${zone}/dns_records`, { method: "POST", body: JSON.stringify(record) });
if (!res.success) {
  console.error(`${hit ? "update" : "create"} failed:`, JSON.stringify(res.errors));
  process.exit(1);
}
console.log(`${hit ? "updated" : "created"} ${res.result.type} ${res.result.name} -> ${res.result.content}`);
