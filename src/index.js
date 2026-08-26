// crosbynews.com — Crosby, TX weather, served from the edge.
//
// This file is the entry point wrangler.jsonc resolves via `main`. It holds
// only the two Worker handlers and the response wrapper: the route table is
// src/router.js and the cron is src/cron.js.
//
// fetch():     dispatch, then stamp every response with the security headers
//              and — for the 42 content paths — the canonical Link header.
// scheduled(): refresh the cron-owned KV keys.

import { SITE } from "./config.js";
import { contentSecurityPolicy } from "./discovery.js";
import { routeRequest } from "./router.js";
import { scheduled } from "./cron.js";

// `Link: rel="canonical"` header in the wrapper below, so the content-negotiated
// `?format=md` variants — and the http→https pair — consolidate onto one URL for
// crawlers that read the HTTP layer (reinforces the in-HTML <link rel="canonical">).
export const PAGE_PATHS = new Set([
  "/", "/weather", "/hourly", "/radar", "/alerts", "/water", "/fishing", "/tropics", "/pollen", "/air", "/traffic", "/news", "/calendar", "/burn-ban", "/emergency", "/about", "/developers", "/privacy", "/contact", "/sitemap", "/mcp",
  "/es", "/es/weather", "/es/hourly", "/es/radar", "/es/alerts", "/es/water", "/es/fishing", "/es/tropics", "/es/pollen", "/es/air", "/es/traffic", "/es/news", "/es/calendar", "/es/burn-ban", "/es/emergency", "/es/about", "/es/developers", "/es/privacy", "/es/contact", "/es/sitemap", "/es/mcp",
]);

// The two `/mcp` paths live in PAGE_PATHS for the canonical Link header, but
// they are NOT read-only documents and keep their own method handling in the
// router: POST /mcp is the JSON-RPC protocol itself, and /es/mcp answers
// anything other than GET/HEAD with a 404 that /developers documents in both
// languages. Everything else in PAGE_PATHS is a document — see below.
const MCP_PATHS = new Set(["/mcp", "/es/mcp"]);

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    // Content pages are documents: they read KV and render, and no method other
    // than GET/HEAD means anything to them. They used to answer PUT/DELETE/PATCH
    // with a 200 and the full page, while /icons/* already 405ed — same site,
    // two answers. Nothing was at risk (no page mutates state, and Cloudflare
    // does not cache a non-GET), so this is about saying so honestly.
    const readOnly = request.method === "GET" || request.method === "HEAD";
    const resp = PAGE_PATHS.has(pathname) && !MCP_PATHS.has(pathname) && !readOnly
      ? new Response("Method Not Allowed", {
          status: 405,
          headers: { allow: "GET, HEAD", "content-type": "text/plain; charset=utf-8" },
        })
      : await routeRequest(request, env, ctx);
    const r = new Response(resp.body, resp);
    // `preload` is a CONSENT MARKER, not a behaviour: no browser acts on it. What
    // browsers act on is a list compiled into the binary, maintained by the
    // Chromium project at hstspreload.org and ingested by Firefox/Safari/Edge too.
    // Cloudflare does NOT submit for you — its zone-level Preload switch only adds
    // this same word to the header. So this line is inert until crosbynews.com is
    // submitted there and accepted, and removing it later is free until then.
    // The zone edge also sets HSTS and Cloudflare de-dupes to one header; which
    // copy survives is recorded in docs/ops/cloudflare-zone.md.
    r.headers.set("strict-transport-security", "max-age=63072000; includeSubDomains; preload");
    r.headers.set("x-frame-options", "SAMEORIGIN");
    r.headers.set("content-security-policy", await contentSecurityPolicy());
    r.headers.set("cross-origin-opener-policy", "same-origin");
    // Every response declares its content-type accurately, so forbid sniffing.
    r.headers.set("x-content-type-options", "nosniff");
    r.headers.set("referrer-policy", "strict-origin-when-cross-origin");
    // No page uses these browser features; browsing-topics opts out of the
    // Topics API, matching the site's no-trackers stance.
    r.headers.set("permissions-policy", "geolocation=(), camera=(), microphone=(), browsing-topics=()");
    // Reinforce the https canonical at the HTTP layer for the content pages, so
    // ?format=md variants (and any http→https confusion) consolidate onto one URL.
    if (PAGE_PATHS.has(pathname)) {
      const canonical = `<${SITE}${pathname}>; rel="canonical"`;
      const existing = r.headers.get("link");
      r.headers.set("link", existing ? `${existing}, ${canonical}` : canonical);
    }
    return r;
  },

  scheduled,
};
