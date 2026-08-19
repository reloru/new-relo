// crosbynews.com — Crosby, TX weather, served from the edge.
//
// This file is the entry point wrangler.jsonc resolves via `main`. It holds
// only the two Worker handlers and the response wrapper: the route table is
// src/router.js and the cron is src/cron.js.
//
// fetch():     dispatch, then stamp every response with the security headers
//              and — for the 40 content paths — the canonical Link header.
// scheduled(): refresh the cron-owned KV keys.

import { SITE } from "./config.js";
import { contentSecurityPolicy } from "./discovery.js";
import { routeRequest } from "./router.js";
import { scheduled } from "./cron.js";

// `Link: rel="canonical"` header in the wrapper below, so the content-negotiated
// `?format=md` variants — and the http→https pair — consolidate onto one URL for
// crawlers that read the HTTP layer (reinforces the in-HTML <link rel="canonical">).
export const PAGE_PATHS = new Set([
  "/", "/weather", "/hourly", "/radar", "/alerts", "/water", "/fishing", "/tropics", "/pollen", "/air", "/traffic", "/news", "/calendar", "/emergency", "/about", "/developers", "/privacy", "/contact", "/sitemap", "/mcp",
  "/es", "/es/weather", "/es/hourly", "/es/radar", "/es/alerts", "/es/water", "/es/fishing", "/es/tropics", "/es/pollen", "/es/air", "/es/traffic", "/es/news", "/es/calendar", "/es/emergency", "/es/about", "/es/developers", "/es/privacy", "/es/contact", "/es/sitemap", "/es/mcp",
]);

export default {
  async fetch(request, env, ctx) {
    const resp = await routeRequest(request, env, ctx);
    const r = new Response(resp.body, resp);
    r.headers.set("strict-transport-security", "max-age=63072000; includeSubDomains");
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
    const { pathname } = new URL(request.url);
    if (PAGE_PATHS.has(pathname)) {
      const canonical = `<${SITE}${pathname}>; rel="canonical"`;
      const existing = r.headers.get("link");
      r.headers.set("link", existing ? `${existing}, ${canonical}` : canonical);
    }
    return r;
  },

  scheduled,
};
