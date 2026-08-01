// Response plumbing shared across routes: the discovery Link header and the
// conditional-GET wrapper the machine-polled endpoints go through.

import { SITE } from "../config.js";
import { esPath } from "../i18n.js";

// Shared cache + discovery headers for the homepage in either representation.
// Homepage discovery headers: markdown alternate, sitemap, API catalog, and
// the OpenAPI service description (RFC 8288 Link relations).
export function linkHeader(enPath, lang) {
  const alt = SITE + (lang === "es" ? esPath(enPath) : enPath);
  return (
    `<${alt}>; rel="alternate"; type="text/markdown", ` +
    `<${SITE}/sitemap.xml>; rel="sitemap", ` +
    `<${SITE}/.well-known/api-catalog>; rel="api-catalog", ` +
    `<${SITE}/openapi.json>; rel="service-desc"; type="application/json"`
  );
}

// Conditional GET for the machine-polled endpoints (API + feeds): a weak ETag
// derived from the cached data's freshness stamp, so a poller that already
// has the current snapshot gets a body-less 304. `seed` must change whenever
// the body would; `make` builds the body only on a miss. Last-Modified rides
// along when the stamp is a date (informational; only If-None-Match is
// evaluated, which is the header ETag-aware clients send).
export function conditional(request, seed, make, headers) {
  const etag = `W/"${String(seed).replace(/"/g, "")}"`;
  const h = { ...headers, etag };
  const d = new Date(seed);
  if (!isNaN(d.getTime())) h["last-modified"] = d.toUTCString();
  const inm = request.headers.get("if-none-match");
  if (inm && (inm.trim() === "*" || inm.split(",").map((s) => s.trim()).includes(etag))) {
    return new Response(null, { status: 304, headers: h });
  }
  return new Response(make(), { headers: h });
}
