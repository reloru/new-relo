// The route table. Dispatch order matters and is not alphabetical:
//
//   1. Non-page routes match on the raw `path` — API, MCP, feeds, assets,
//      .well-known. They never carry an /es prefix and are structurally out of
//      reach of the mapping below.
//   2. The /es mapping then rewrites `path` to an English `page` + a lang flag,
//      so ONE set of handlers serves both languages and they cannot drift.
//   3. Content pages are looked up in PAGE_HANDLERS and served by servePage().
//   4. Anything else 404s.
//
// Which pages exist is decided by registry.js; PAGE_HANDLERS says how each is
// loaded and rendered, and the module refuses to load if the two disagree.
// The security headers and the canonical Link header are added by the fetch
// wrapper in index.js, not here.

import { ICON_ASSET_PATHS, ICON_ALIASES, MANIFEST } from "./assets/icons.js";
import { SW_SCRIPT } from "./assets/sw-script.js";
import { TZ, SITE } from "./config.js";
import { linkHeader, conditional } from "./lib/http.js";
import { centralStamp } from "./lib/format.js";
import { airHtml, airMarkdown, apiAir } from "./features/air.js";
import { loadWeather, renderHtml, renderMarkdown, apiWeather, badgeSvg } from "./features/weather.js";
import { aboutHtml, aboutMarkdown } from "./pages/about.js";
import { developersHtml, developersMarkdown } from "./pages/developers.js";
import { privacyHtml, privacyMarkdown } from "./pages/privacy.js";
import { contactHtml, contactMarkdown } from "./pages/contact.js";
import { methodsHtml, methodsMarkdown } from "./pages/methods.js";
import { emergencyHtml, emergencyMarkdown } from "./pages/emergency.js";
import { sitemapPageHtml, sitemapPageMarkdown } from "./pages/sitemap.js";
import { radarHtml, radarMarkdown } from "./features/radar.js";
import { hourlyHtml, hourlyMarkdown } from "./features/hourly.js";
import { alertsHtml, alertsMarkdown, alertsRss } from "./features/alerts.js";
import { loadNews, isAdmin, newsHtml, newsMarkdown, newsRss, apiNews, NEWS_BLOCKLIST_KV_KEY } from "./features/news.js";
import { loadCalendar, calendarHtml, calendarMarkdown, apiCalendar } from "./features/calendar.js";
import { loadWater, waterHtml, waterMarkdown, apiWater } from "./features/water.js";
import { loadGaugePage, gaugeHtml, gaugeMarkdown, gaugeLastmod } from "./features/gauge.js";
import { loadHistory, historyHtml, historyMarkdown, historyLastmod } from "./features/history.js";
import { loadRain, rainHtml, rainMarkdown, rainLastmod } from "./features/rain.js";
import { loadFishing, fishingHtml, fishingMarkdown, apiFishing } from "./features/fishing.js";
import { loadWaterSamples } from "./features/waterquality.js";
import { loadTropics, tropicsHtml, tropicsMarkdown, apiTropics } from "./features/tropics.js";
import { loadTraffic, trafficHtml, trafficMarkdown, apiTraffic } from "./features/traffic.js";
import { loadPollen, pollenHtml, pollenMarkdown, apiPollen } from "./features/pollen.js";
import { loadBurnBan, loadBurnBanPeriods, burnbanHtml, burnbanMarkdown, apiBurnBan } from "./features/burnban.js";
import { homeHtml, homeMarkdown, renderError } from "./features/home.js";
import { MCP_CORS, mcpHandle, mcpJson, rpcError, mcpServerCard, mcpInfoHtml, mcpInfoMarkdown } from "./mcp/server.js";
import { mcpRecord, mcpBatchRecorded, mcpUsageReport, mcpUsageText } from "./mcp/metrics.js";
import { apiCatalog, openApiSpec } from "./api/openapi.js";
import { healthReport, CRON_STATUS_KV_KEY } from "./api/health.js";
import { llmsTxt, robotsTxt, sitemapXml, CROSBY_WEATHER_SKILL, agentSkillsIndex } from "./discovery.js";
import { pushEndpointAllowed, pushKeyFor } from "./push.js";
import { PAGES, pageFor } from "./registry.js";
import { siteUsageReport, siteUsageText } from "./metrics.js";

export async function routeRequest(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.length > 1 && path.endsWith("/")) {
      const trimmed = path.replace(/\/+$/, "") || "/";
      return Response.redirect(new URL(trimmed + url.search, url).toString(), 301);
    }

    if (path === "/robots.txt") {
      return new Response(robotsTxt(), {
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
      });
    }
    if (path === "/llms.txt") {
      return new Response(llmsTxt(), {
        headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=3600" },
      });
    }
    if (path === "/sitemap.xml") {
      const cronStatus = await env.WEATHER.get(CRON_STATUS_KV_KEY, "json").catch(() => null);
      // Pages whose handler knows its own last-change instant (the gauge pages)
      // are dated by it; a failed lookup leaves that page undated, never guessed.
      const dates = {};
      await Promise.all(
        PAGES.filter((p) => PAGE_HANDLERS[p.path]?.lastmod).map(async (p) => {
          dates[p.path] = await PAGE_HANDLERS[p.path].lastmod(env).catch(() => null);
        }),
      );
      return new Response(sitemapXml(cronStatus, dates), {
        headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" },
      });
    }
    // RSS feeds — rendered from the same KV data as the HTML pages.
    if (path === "/alerts.xml") {
      try {
        const { data } = await loadWeather(env);
        return conditional(request, data.updated ?? "none", () => alertsRss(data), {
          "content-type": "application/rss+xml; charset=utf-8",
          "cache-control": "public, max-age=300",
        });
      } catch (err) {
        return new Response("Feed temporarily unavailable", { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
      }
    }
    if (path === "/news.xml") {
      try {
        const data = await loadNews(env);
        return conditional(request, data.updated ?? "none", () => newsRss(data), {
          "content-type": "application/rss+xml; charset=utf-8",
          "cache-control": "public, max-age=900",
        });
      } catch (err) {
        return new Response("Feed temporarily unavailable", { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
      }
    }
    // RFC 9116 security contact. Expires is computed ~1 year out on each request,
    // so the file never goes stale on this self-maintaining site.
    if (path === "/.well-known/security.txt") {
      const body = [
        "# Security contact for crosbynews.com",
        "Contact: mailto:security@crosbynews.com",
        `Expires: ${new Date(Date.now() + 365 * 86400000).toISOString()}`,
        "Preferred-Languages: en",
        `Canonical: ${SITE}/.well-known/security.txt`,
        "",
      ].join("\n");
      return new Response(body, {
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400" },
      });
    }
    // Hotlinkable live-weather badge — see /developers ("Embeddable weather
    // badge"). Same KV cache as the pages; edge-cached near the cron cadence
    // so hotlinks are nearly free. On total data failure serves the neutral
    // "unavailable" badge with a short cache instead of a broken image.
    if (path === "/badge.svg") {
      try {
        const { data } = await loadWeather(env);
        return new Response(badgeSvg(data), {
          headers: {
            "content-type": "image/svg+xml; charset=utf-8",
            "cache-control": "public, max-age=300, s-maxage=900",
            "access-control-allow-origin": "*",
          },
        });
      } catch (err) {
        console.error("badge render failed:", err && err.stack);
        return new Response(badgeSvg(null), {
          headers: {
            "content-type": "image/svg+xml; charset=utf-8",
            "cache-control": "public, max-age=60",
            "access-control-allow-origin": "*",
          },
        });
      }
    }
    // PWA surface: manifest + icons + service worker. The icons are PNG files
    // in public/, served by Workers static assets; run_worker_first sends every
    // request here first, so they pass through the fetch wrapper's security
    // headers like everything else. The SW gets `no-cache` so a deploy's new
    // worker is picked up on the next visit rather than after a stale-cache
    // window.
    if (path === "/manifest.json") {
      return new Response(JSON.stringify(MANIFEST, null, 2), {
        headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "public, max-age=3600" },
      });
    }
    if (ICON_ASSET_PATHS.has(path) || Object.hasOwn(ICON_ALIASES, path)) {
      const target = new URL(ICON_ALIASES[path] ?? path, url);
      const asset = await env.ASSETS.fetch(new Request(target, request));
      const r = new Response(asset.body, asset);
      // A week, not `immutable`: the URLs carry no content hash, so a redrawn
      // icon has to be able to replace the old one.
      if (asset.ok) r.headers.set("cache-control", "public, max-age=604800");
      return r;
    }
    if (path === "/sw.js") {
      return new Response(SW_SCRIPT, {
        headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" },
      });
    }
    // CORS preflight for the public API.
    if (request.method === "OPTIONS" && path.startsWith("/api/")) {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, OPTIONS",
          "access-control-max-age": "86400",
        },
      });
    }

    if (path === "/.well-known/api-catalog") {
      return new Response(JSON.stringify(apiCatalog(), null, 2), {
        headers: {
          "content-type": "application/linkset+json; charset=utf-8",
          "cache-control": "public, max-age=3600",
          "access-control-allow-origin": "*",
        },
      });
    }

    if (path === "/openapi.json") {
      return new Response(JSON.stringify(openApiSpec(), null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "public, max-age=3600",
          "access-control-allow-origin": "*",
        },
      });
    }

    if (path === "/.well-known/agent-skills/index.json") {
      return new Response(JSON.stringify(await agentSkillsIndex(), null, 2), {
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" },
      });
    }
    if (path === "/.well-known/agent-skills/crosby-weather/SKILL.md") {
      return new Response(CROSBY_WEATHER_SKILL, {
        headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" },
      });
    }

    if (path === "/.well-known/mcp/server-card.json") {
      return new Response(JSON.stringify(mcpServerCard(), null, 2), {
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" },
      });
    }

    // Spanish HUMAN explainer for the MCP server (GET/HEAD only). The protocol
    // itself is English-only and lives at /mcp — this page describes it in
    // Spanish and tells readers to connect to /mcp, not /es/mcp. It is NOT an
    // MCP endpoint, so anything other than GET/HEAD 404s.
    if (path === "/es/mcp") {
      if (request.method === "GET" || request.method === "HEAD") {
        const accept = (request.headers.get("accept") || "").toLowerCase();
        const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
        return new Response(wantsMarkdown ? mcpInfoMarkdown("es") : mcpInfoHtml("es"), {
          status: 200,
          headers: {
            "content-type": `${wantsMarkdown ? "text/markdown" : "text/html"}; charset=utf-8`,
            "cache-control": "public, max-age=3600",
            vary: "Accept",
          },
        });
      }
      return new Response("Not Found", { status: 404 });
    }

    if (path === "/mcp") {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: MCP_CORS });
      // The MCP protocol itself uses POST. A strict MCP client opening the
      // optional SSE stream sends GET with `Accept: text/event-stream`; we
      // don't offer that stream, so 405 per the Streamable HTTP spec (checked
      // first, so it wins over markdown for a combined Accept; its Allow
      // deliberately omits GET — it's the spec's "no SSE here" signal). Every
      // other GET (browsers, plain curl) gets the human-friendly explainer,
      // markdown-negotiated like the content pages. HEAD is treated as GET —
      // the runtime strips the body — so `curl -I /mcp` mirrors GET instead
      // of 405ing.
      if (request.method === "GET" || request.method === "HEAD") {
        const accept = (request.headers.get("accept") || "").toLowerCase();
        if (accept.includes("text/event-stream")) {
          return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST, OPTIONS", ...MCP_CORS } });
        }
        const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
        return new Response(wantsMarkdown ? mcpInfoMarkdown() : mcpInfoHtml(), {
          status: 200,
          headers: {
            "content-type": `${wantsMarkdown ? "text/markdown" : "text/html"}; charset=utf-8`,
            "cache-control": "public, max-age=3600",
            vary: "Accept",
            allow: "GET, HEAD, POST, OPTIONS",
            ...MCP_CORS,
          },
        });
      }
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD, POST, OPTIONS", ...MCP_CORS } });
      }
      let body;
      try {
        body = await request.json();
      } catch {
        return mcpJson(rpcError(null, -32700, "Parse error"), 400);
      }
      const batch = Array.isArray(body);
      const out = [];
      for (const m of batch ? body : [body]) {
        // Elapsed time around mcpHandle only. Workers freeze Date.now() between
        // I/O operations, so a method that does none (ping, tools/list) reads 0
        // by construction — this measures a tool's KV/upstream cost, not latency.
        const t0 = Date.now();
        const r = await mcpHandle(m, env);
        // Aggregate counters. Deliberately not awaited and cannot throw: the
        // protocol response must not wait on, or be affected by, bookkeeping.
        mcpRecord(env, ctx, m, r, Date.now() - t0);
        if (r) out.push(r);
      }
      mcpBatchRecorded(env, ctx);
      if (out.length === 0) return new Response(null, { status: 202, headers: MCP_CORS });
      return mcpJson(batch ? out : out[0], 200);
    }

    // Service health: the site is live (this response proves it), when each
    // feed last tried to fetch and whether it worked, and when the data on the
    // page actually changed. Reads one KV key, never an upstream. Always 200 —
    // "is the data fresh enough" is the caller's judgment, made from the
    // timestamps in the body.
    if (path === "/api/health") {
      let report;
      try {
        report = await healthReport(env);
      } catch (err) {
        // Still a 200: the site IS live, which is this endpoint's first
        // question, and the reporter's own failure is reported as a fact
        // rather than as an outage.
        console.error("health report failed:", err && err.stack);
        report = {
          httpStatus: 200,
          body: { site: "live", checkedAt: centralStamp(new Date().toISOString()), feeds: {}, error: `health check itself failed: ${(err && err.message) || err}` },
        };
      }
      return new Response(JSON.stringify(report.body, null, 2), {
        status: report.httpStatus,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*",
          "cache-control": "no-store",
        },
      });
    }

    // Aggregate MCP usage — owner-only, and the only reason this endpoint is
    // gated at all. The numbers themselves identify nobody: they are counts by
    // JSON-RPC method, tool name and outcome, with no addresses, user agents,
    // tool arguments or request contents anywhere in the record. What is
    // private is the business fact of how much the server is used.
    //
    // Reads KV and never writes, so polling it cannot disturb the rollup. It
    // merges the shards the cron has not folded yet, so the answer is current
    // rather than up to a quarter-hour behind.
    if (path === "/api/mcp-usage") {
      const jsonRes = (obj, status) =>
        new Response(JSON.stringify(obj, null, 2), {
          status: status || 200,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" },
        });
      // No secret configured means the feature is inert, matching the news
      // admin endpoints rather than failing open.
      if (!env.ADMIN_KEY) return jsonRes({ error: "admin_unavailable" }, 503);
      if (!isAdmin(env, url.searchParams.get("key"))) return jsonRes({ error: "unauthorized" }, 401);

      let report;
      try {
        report = await mcpUsageReport(env);
      } catch (err) {
        // The detail goes to the log, never to the response: an exception
        // message can carry internals, and this is the house shape for the
        // secret-gated routes (see `store_failed` below). CodeQL flagged the
        // echoed message on this line as information exposure (alert #9).
        console.error("MCP usage report failed:", err && err.stack);
        return jsonRes({ error: "read_failed" }, 500);
      }

      // Deliberately no access-control-allow-origin: same-origin only, like the
      // other secret-gated routes.
      if (url.searchParams.get("format") === "txt") {
        return new Response(mcpUsageText(report), {
          headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" },
        });
      }
      return jsonRes(report);
    }

    // Aggregate page-request counts — owner-only, same gate and same shape as
    // /api/mcp-usage. The numbers identify nobody (see src/metrics.js); what
    // is private is how much the site is used. Reads D1, never writes.
    if (path === "/api/site-usage") {
      const jsonRes = (obj, status) =>
        new Response(JSON.stringify(obj, null, 2), {
          status: status || 200,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" },
        });
      if (!env.ADMIN_KEY) return jsonRes({ error: "admin_unavailable" }, 503);
      if (!isAdmin(env, url.searchParams.get("key"))) return jsonRes({ error: "unauthorized" }, 401);
      if (!env.DB) return jsonRes({ error: "database_unavailable" }, 503);
      let report;
      try {
        report = await siteUsageReport(env, url.searchParams.get("days"));
      } catch (err) {
        console.error("site usage report failed:", err && err.stack);
        return jsonRes({ error: "read_failed" }, 500);
      }
      if (url.searchParams.get("format") === "txt") {
        return new Response(siteUsageText(report), {
          headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" },
        });
      }
      return jsonRes(report);
    }

    // --- Severe-alert Web Push endpoints ---
    // Public VAPID key so the browser can subscribe. null when unconfigured, so
    // the client hides the opt-in UI.
    if (path === "/api/push/vapid-key") {
      return new Response(JSON.stringify({ key: env.VAPID_PUBLIC_KEY || null }), {
        headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=3600" },
      });
    }
    // Store a subscription. Body: a PushSubscription JSON ({endpoint, keys}).
    // Endpoint is allowlisted to real push hosts (SSRF guard). Idempotent:
    // keyed by a hash of the endpoint.
    if (path === "/api/push/subscribe" && request.method === "POST") {
      if (!env.VAPID_PRIVATE_KEY) return new Response(JSON.stringify({ error: "push_unavailable" }), { status: 503, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
      let sub = null;
      try { sub = await request.json(); } catch {}
      if (!sub || typeof sub.endpoint !== "string" || !pushEndpointAllowed(sub.endpoint)) {
        return new Response(JSON.stringify({ error: "invalid_subscription" }), { status: 400, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
      }
      const record = { endpoint: sub.endpoint, keys: sub.keys || null, added: new Date().toISOString() };
      try {
        await env.WEATHER.put(await pushKeyFor(sub.endpoint), JSON.stringify(record));
      } catch (e) {
        return new Response(JSON.stringify({ error: "store_failed" }), { status: 500, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
      }
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
    }
    // Remove a subscription. Body: {endpoint}.
    if (path === "/api/push/unsubscribe" && request.method === "POST") {
      let body = null;
      try { body = await request.json(); } catch {}
      if (!body || typeof body.endpoint !== "string") {
        return new Response(JSON.stringify({ error: "invalid_request" }), { status: 400, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
      }
      try { await env.WEATHER.delete(await pushKeyFor(body.endpoint)); } catch {}
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
    }

    // Admin nuke: hide (or restore) a news article site-wide. Same-origin only
    // (no CORS header), gated on the ADMIN_KEY secret. Body: {link, key}. Writes
    // the worker-owned `news_blocklist` key; `loadNews` filters against it so
    // the change is instant, and the news routine reads it so it stays gone.
    if ((path === "/api/news/delete" || path === "/api/news/restore") && request.method === "POST") {
      const jsonRes = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { "content-type": "application/json" } });
      if (!env.ADMIN_KEY) return jsonRes({ error: "admin_unavailable" }, 503);
      let body = null;
      try { body = await request.json(); } catch {}
      if (!body || !isAdmin(env, body.key)) return jsonRes({ error: "unauthorized" }, 401);
      if (typeof body.link !== "string" || !body.link) return jsonRes({ error: "invalid_request" }, 400);
      const restoring = path === "/api/news/restore";
      try {
        const cur = (await env.WEATHER.get(NEWS_BLOCKLIST_KV_KEY, "json")) || {};
        if (restoring) delete cur[body.link];
        else cur[body.link] = Date.now();
        // Prune entries past the 60-day mark — an article older than the news
        // routine's 45-day freshness gate can't reappear, so its block can go.
        const cutoff = Date.now() - 60 * 864e5;
        for (const k of Object.keys(cur)) if (!(cur[k] > cutoff)) delete cur[k];
        await env.WEATHER.put(NEWS_BLOCKLIST_KV_KEY, JSON.stringify(cur));
      } catch (e) {
        return jsonRes({ error: "store_failed" }, 500);
      }
      return jsonRes({ ok: true, blocked: !restoring });
    }

    // The public JSON API: the same KV data the pages render.
    if (Object.hasOwn(API_ROUTES, path)) return serveApi(API_ROUTES[path], request, env);

    // Proxy NWS weather icons through our (crawlable) origin. NWS's robots.txt
    // disallows all crawling, so hotlinked icons can't be indexed; serving them
    // here makes them crawlable and edge-cacheable. Locked to /icons/ only, so
    // it can never become an open proxy.
    if (path.startsWith("/icons/")) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
      }
      const upstream = `https://api.weather.gov${path}${url.search}`;
      let res;
      try {
        res = await fetch(upstream, {
          headers: { "User-Agent": "crosbynews.com", Accept: "image/png,image/*" },
          cf: { cacheTtl: 604800, cacheEverything: true },
        });
      } catch {
        return new Response("Icon unavailable", { status: 502 });
      }
      if (!res.ok) {
        // Any upstream 4xx means the CALLER asked for an icon that isn't there,
        // so answer 404 — not 502, which claims our upstream is broken. Only
        // literal 404s were mapped before, and api.weather.gov answers a
        // malformed icon path with a different 4xx, so `/icons/land/day/skc.png`
        // (a real icon, with an extension NWS paths don't carry) surfaced as a
        // gateway error. 5xx and anything else stays 502: that one IS upstream.
        const clientError = res.status >= 400 && res.status < 500;
        return new Response("Icon unavailable", { status: clientError ? 404 : 502 });
      }
      const headers = new Headers();
      headers.set("content-type", res.headers.get("content-type") || "image/png");
      // Cache hard at the edge and in the browser; icons are effectively static.
      headers.set("cache-control", "public, max-age=86400, s-maxage=604800, immutable");
      return new Response(res.body, { status: 200, headers });
    }

    // Content pages are served in English at the root and in Mexican Spanish
    // under /es. Map an /es request to its English path + a lang flag, then let
    // the shared handlers below render either language. Non-page routes above
    // (API, assets, well-known) never carry an /es prefix, so they're untouched.
    const isEs = path === "/es" || path.startsWith("/es/");
    const lang = isEs ? "es" : "en";
    const page = isEs ? (path === "/es" || path === "/es/" ? "/" : path.slice(3)) : path;

    // Proxy the NWS KHGX radar loop through our origin so it's crawlable and
    // edge-cached. Locked to two fixed upstream images (not an open proxy):
    // the animated loop, or — with ?still=1 — the latest single frame, for
    // users who prefer a non-animated image (reduced motion).
    if (path === "/radar-image") {
      const still = url.searchParams.get("still") === "1";
      let res;
      try {
        res = await fetch(`https://radar.weather.gov/ridge/standard/${still ? "KHGX_0.gif" : "KHGX_loop.gif"}`, {
          headers: { "User-Agent": "crosbynews.com", Accept: "image/gif,image/*" },
          cf: { cacheTtl: 180, cacheEverything: true },
        });
      } catch {
        return new Response("Radar unavailable", { status: 502 });
      }
      if (!res.ok) return new Response("Radar unavailable", { status: 502 });
      const headers = new Headers();
      headers.set("content-type", res.headers.get("content-type") || "image/gif");
      // Radar updates every few minutes; cache briefly at the edge and browser.
      headers.set("cache-control", "public, max-age=120, s-maxage=180");
      return new Response(res.body, { status: 200, headers });
    }

    const handler = Object.hasOwn(PAGE_HANDLERS, page) ? PAGE_HANDLERS[page] : null;
    if (!handler) {
      return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    return servePage(pageFor(page), handler, { request, env, url, lang, md: wantsMarkdown(request, url) });
}

// Markdown is negotiated on every content page: `Accept: text/markdown` or
// `?format=md`.
function wantsMarkdown(request, url) {
  const accept = (request.headers.get("accept") || "").toLowerCase();
  return accept.includes("text/markdown") || url.searchParams.get("format") === "md";
}

// --- content pages ----------------------------------------------------------
//
// One entry per registry page. `c` is the request context
// { request, env, url, lang, md }.
//
//   load(c)            Optional. Returns the data the renderers take. A throw
//                      becomes a 502 error page naming `source`.
//   html(data, lang, c), md(data, lang, c)
//                      The two representations of the same content.
//   source             Who to name on the error page when load() throws.
//   headers(data, c, body)
//                      Optional extra response headers.
//   cacheControl(c)    Optional override of the registry's max-age.
//   lastmod(env)       Optional. The page's last-change instant for
//                      /sitemap.xml, for a page not dated by its registry feeds.
const weatherData = async (c) => (await loadWeather(c.env)).data;
const NO_BAN = () => ({ status: null });

// / and /weather advertise the Markdown alternate and the API in a Link
// header, report whether the weather cache was warm, and size the Markdown.
const hubHeaders = (enPath) => (data, c, body) => ({
  link: linkHeader(enPath, c.lang),
  ...(c.md ? { "x-markdown-tokens": String(Math.ceil(body.length / 4)) } : {}),
  "x-cache": data.cache,
});

const PAGE_HANDLERS = {
  // The hub summarizes every section, so it loads all six datasets — in
  // parallel, so one slow source can't serially block the front page. Each
  // loader self-heals on a cold cache; a rejected one shouldn't blank the
  // whole page, so failures degrade to an empty shape.
  "/": {
    source: "a data source",
    load: async ({ env }) => {
      const [wRes, water, news, cal, tropics, burnban] = await Promise.all([
        loadWeather(env).catch(() => ({ data: { hourly: [], periods: [], alerts: [], updated: null }, cache: "miss-warmfail" })),
        loadWater(env).catch(() => ({ gauges: [] })),
        loadNews(env).catch(() => ({ items: [] })),
        loadCalendar(env).catch(() => ({ events: [] })),
        loadTropics(env).catch(() => ({ storms: [] })),
        loadBurnBan(env).catch(NO_BAN),
      ]);
      return { weather: wRes.data, cache: wRes.cache, water, news, cal, tropics, burnban };
    },
    html: (d, lang) => homeHtml(d.weather, d.water, d.news, d.cal, d.tropics, d.burnban, lang),
    md: (d, lang) => homeMarkdown(d.weather, d.water, d.news, d.cal, d.tropics, d.burnban, lang),
    headers: hubHeaders("/"),
  },
  "/weather": {
    source: "the National Weather Service",
    load: async ({ env }) => {
      const [{ data, cache }, burnban] = await Promise.all([loadWeather(env), loadBurnBan(env).catch(NO_BAN)]);
      return { data, cache, burnban };
    },
    html: (d, lang) => renderHtml(d.data, lang, d.burnban),
    md: (d, lang) => renderMarkdown(d.data, lang, d.burnban),
    headers: hubHeaders("/weather"),
  },
  "/hourly": { source: "the National Weather Service", load: weatherData, html: hourlyHtml, md: hourlyMarkdown },
  // The radar image is a separate proxy; the weather cache only feeds the
  // footer's freshness line, so the page renders without it rather than 502.
  "/radar": {
    load: (c) => weatherData(c).catch(() => undefined),
    html: (data, lang) => radarHtml(lang, data),
    md: (data, lang) => radarMarkdown(lang),
  },
  "/alerts": {
    source: "the National Weather Service",
    load: async ({ env }) => {
      const [{ data }, burnban] = await Promise.all([loadWeather(env), loadBurnBan(env).catch(NO_BAN)]);
      return { data, burnban };
    },
    html: (d, lang) => alertsHtml(d.data, lang, d.burnban),
    md: (d, lang) => alertsMarkdown(d.data, lang, d.burnban),
  },
  // Computed from the record at request time; a D1 failure is a 502.
  "/history": { source: "the site's record", load: ({ env }) => loadHistory(env), html: historyHtml, md: historyMarkdown, lastmod: historyLastmod },
  // Measured rain, summed from D1 at request time; a D1 failure is a 502.
  "/rain": { source: "the site's rain record", load: ({ env }) => loadRain(env), html: rainHtml, md: rainMarkdown, lastmod: rainLastmod },
  "/water": { source: "NOAA's river gauges", load: ({ env }) => loadWater(env), html: waterHtml, md: waterMarkdown },
  // Live conditions first: TCEQ's water samples come from D1 and are read
  // failure-tolerant, so a D1 error drops only that section (like /burn-ban).
  "/fishing": {
    source: "the U.S. Geological Survey",
    load: async ({ env }) => {
      const [data, samples] = await Promise.all([loadFishing(env), loadWaterSamples(env).catch(() => null)]);
      return { data, samples };
    },
    html: (d, lang) => fishingHtml(d.data, lang, d.samples),
    md: (d, lang) => fishingMarkdown(d.data, lang, d.samples),
  },
  "/tropics": { source: "the National Hurricane Center", load: ({ env }) => loadTropics(env), html: tropicsHtml, md: tropicsMarkdown },
  "/pollen": { source: "the Houston Health Department", load: ({ env }) => loadPollen(env), html: pollenHtml, md: pollenMarkdown },
  // The AQI is folded into the weather cache (AirNow measured / Open-Meteo
  // modeled fallback); there is no separate KV key.
  "/air": { source: "the air-quality monitors", load: weatherData, html: airHtml, md: airMarkdown },
  "/burn-ban": {
    source: "the Texas A&M Forest Service",
    // Weather rides along failure-tolerant: it only ever ADDS the "right now"
    // strip, so a weather-cache hiccup must degrade this page to its
    // county-status form rather than 502 it.
    // The ban history is read failure-tolerant too (null on a D1 error).
    load: async ({ env }) => {
      const [data, wx, periods] = await Promise.all([loadBurnBan(env), loadWeather(env).then((r) => r.data).catch(() => null), loadBurnBanPeriods(env)]);
      return { data, wx, periods };
    },
    html: (d, lang) => burnbanHtml(d.data, lang, d.wx, d.periods),
    md: (d, lang) => burnbanMarkdown(d.data, lang, d.wx, d.periods),
  },
  "/news": {
    source: "our news source",
    // Admin nuke view: a valid ?admin=<secret> shows every article (blocked
    // ones dimmed) with Hide/Restore buttons. HTML only, never cached.
    load: (c) => {
      c.admin = !c.md && isAdmin(c.env, c.url.searchParams.get("admin"));
      return loadNews(c.env, c.admin ? { includeBlocked: true } : undefined);
    },
    html: (data, lang, c) => newsHtml(data, lang, c.admin),
    md: newsMarkdown,
    cacheControl: (c) => (c.admin ? "private, no-store" : null),
  },
  "/traffic": { source: "Houston TranStar", load: ({ env }) => loadTraffic(env), html: trafficHtml, md: trafficMarkdown },
  "/calendar": { source: "the Crosby ISD calendar", load: ({ env }) => loadCalendar(env), html: calendarHtml, md: calendarMarkdown },
  "/emergency": { html: (_, lang) => emergencyHtml(lang), md: (_, lang) => emergencyMarkdown(lang) },
  "/about": { html: (_, lang) => aboutHtml(lang), md: (_, lang) => aboutMarkdown(lang) },
  "/privacy": { html: (_, lang) => privacyHtml(lang), md: (_, lang) => privacyMarkdown(lang) },
  "/contact": { html: (_, lang) => contactHtml(lang), md: (_, lang) => contactMarkdown(lang) },
  "/methods": { html: (_, lang) => methodsHtml(lang), md: (_, lang) => methodsMarkdown(lang) },
  "/sitemap": { html: (_, lang) => sitemapPageHtml(lang), md: (_, lang) => sitemapPageMarkdown(lang) },
  "/developers": { html: (_, lang) => developersHtml(lang), md: (_, lang) => developersMarkdown(lang) },
};

// One handler serves every river-gauge page; the registry says which gauges
// have one. A D1 failure is a 502 naming the record, not a page with its
// history silently missing.
for (const p of PAGES) {
  if (!p.gauge) continue;
  PAGE_HANDLERS[p.path] = {
    source: "the site's flood record",
    load: ({ env }) => loadGaugePage(env, p.gauge, { samples: true }),
    html: gaugeHtml,
    md: gaugeMarkdown,
    lastmod: (env) => gaugeLastmod(env, p.gauge),
  };
}

// The registry and the handler table must describe the same pages. Checked
// when the module loads, so a page added to one and not the other fails every
// test and the dry-run build's import, not a single URL in production.
for (const p of PAGES) {
  if (!p.custom && !PAGE_HANDLERS[p.path]) throw new Error(`registry page ${p.path} has no handler in router.js`);
}
for (const path of Object.keys(PAGE_HANDLERS)) {
  if (!pageFor(path) || pageFor(path).custom) throw new Error(`router.js handles ${path}, which registry.js does not list as a shared-handler page`);
}

async function servePage(page, handler, c) {
  let data;
  try {
    data = handler.load ? await handler.load(c) : undefined;
  } catch (err) {
    return new Response(renderError(err, handler.source), { status: 502, headers: { "content-type": "text/html; charset=utf-8" } });
  }
  let body;
  try {
    body = c.md ? handler.md(data, c.lang, c) : handler.html(data, c.lang, c);
  } catch (err) {
    return new Response(renderError(err, handler.source || "a data source"), { status: 502, headers: { "content-type": "text/html; charset=utf-8" } });
  }
  const headers = {
    "content-type": `${c.md ? "text/markdown" : "text/html"}; charset=utf-8`,
    "cache-control": (handler.cacheControl && handler.cacheControl(c)) || `public, max-age=${page.maxAge}`,
    vary: "Accept",
    ...(handler.headers ? handler.headers(data, c, body) : {}),
  };
  // An admin view is private and never revalidated.
  if (c.admin) return new Response(body, { headers });

  // Conditional GET. The validator is a digest of the bytes about to be sent,
  // so it is right by construction for every page and both representations —
  // nothing has to remember which inputs a page depends on. A crawler that
  // still holds the current copy gets a body-less 304.
  headers.etag = await bodyEtag(body);
  // Last-Modified only where a real instant exists: the refresh time of the
  // data the page shows. A static page sends none rather than a guess.
  const modified = Date.parse(pageUpdated(data) ?? "");
  if (Number.isFinite(modified)) headers["last-modified"] = new Date(modified).toUTCString();

  const inm = c.request.headers.get("if-none-match");
  if (inm && (inm.trim() === "*" || inm.split(",").map((x) => x.trim()).includes(headers.etag))) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, { headers });
}

async function bodyEtag(body) {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(body));
  return `W/"${btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/=+$/, "")}"`;
}

// The newest `updated` stamp among the datasets a handler loaded. Handlers
// return either one dataset or an object holding several.
function pageUpdated(data) {
  if (!data || typeof data !== "object") return null;
  const stamps = [data.updated, ...Object.values(data).map((v) => v && typeof v === "object" && v.updated)].filter((x) => typeof x === "string");
  return stamps.length ? stamps.sort().at(-1) : null;
}

// --- JSON API ---------------------------------------------------------------
//
// Each route reads the same cached data as its page and answers a conditional
// GET. `seed` must change whenever the body would: it becomes the ETag.
const ctDate = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
const stamp = (d) => d.updated ?? "none";

const API_ROUTES = {
  "/api/weather": {
    maxAge: 300, error: "upstream_unavailable",
    load: (env) => loadWeather(env),
    // The CT calendar date is in the seed because `sun` in the body changes
    // with it even when the cache stamp doesn't.
    seed: (r) => `${stamp(r.data)}|${ctDate()}`,
    body: (r) => apiWeather(r.data),
    headers: (r) => ({ "x-cache": r.cache }),
  },
  "/api/news": { maxAge: 900, load: (env) => loadNews(env), seed: stamp, body: apiNews },
  "/api/water": { maxAge: 300, load: (env) => loadWater(env), seed: stamp, body: apiWater },
  "/api/fishing": { maxAge: 300, load: (env) => loadFishing(env), seed: stamp, body: apiFishing },
  // An empty storms array is the normal quiet-basin state.
  "/api/tropics": { maxAge: 900, load: (env) => loadTropics(env), seed: stamp, body: apiTropics },
  // Empty arrays are quiet roads; null means that feed was unreachable.
  "/api/traffic": { maxAge: 300, load: (env) => loadTraffic(env), seed: stamp, body: apiTraffic },
  // countDate is the CT calendar day the count is for (weekday mornings only;
  // weekends serve Friday's count).
  "/api/pollen": { maxAge: 1800, load: (env) => loadPollen(env), seed: (d) => `${d.countDate ?? "none"}|${stamp(d)}`, body: apiPollen },
  "/api/burn-ban": { maxAge: 1800, load: (env) => loadBurnBan(env), seed: (d) => `${d.status ?? "none"}|${stamp(d)}`, body: apiBurnBan },
  "/api/air": {
    maxAge: 600,
    load: async (env) => (await loadWeather(env)).data,
    seed: (d) => `${stamp(d)}|${d.aqi?.measured ? "m" : "o"}`,
    body: apiAir,
  },
  // `upcomingEvents` moves with time, so the seed carries the CT date to stay
  // honest across day boundaries.
  "/api/calendar": { maxAge: 1800, load: (env) => loadCalendar(env), seed: (d) => `${stamp(d)}|${ctDate()}`, body: apiCalendar },
};

async function serveApi(route, request, env) {
  try {
    const data = await route.load(env);
    return conditional(request, route.seed(data), () => JSON.stringify(route.body(data)), {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": `public, max-age=${route.maxAge}`,
      link: `<${SITE}/openapi.json>; rel="service-desc"; type="application/json"`,
      ...(route.headers ? route.headers(data) : {}),
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: route.error || "unavailable", message: err && err.message }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" },
    });
  }
}
