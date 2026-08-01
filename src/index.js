// crosbynews.com — Crosby, TX weather, served from the edge.
//
// scheduled(): every 15 min, pull the NWS forecast (daily + hourly) and active
//   alerts and cache the result as JSON in KV under "weather".
// fetch(): render that cached JSON as HTML. On a cold cache (before the first
//   cron run) it fetches live, renders, and warms the cache.

// Inline assets live in src/assets/ — see that directory's note on why their
// bytes must never be reformatted.
import { FAVICON_SVG, ICON_SVG, APPLE_TOUCH_ICON_B64, MANIFEST } from "./assets/icons.js";
import { SW_SCRIPT } from "./assets/sw-script.js";
import { BASE_CSS } from "./assets/base-css.js";
import { HOME_SCRIPT, NEWS_ADMIN_SCRIPT, PUSH_CLIENT_SCRIPT } from "./assets/client-scripts.js";
import { LAT, LON, NWS_HEADERS, KV_KEY, TZ, SITE } from "./config.js";
import {
  T, esPath, canonicalFor, hreflangTags,
  translateConditions, translatePeriodName, translateWind, translateDir,
  ES_NWS_NOTE,
} from "./i18n.js";
import { esc, nl2br, iconUrl, fmt, fullTime, clockTime, hourLabel, dayLabel, capFirst, relTime, rssDate } from "./lib/format.js";
import { pop, feelsLikeRawF, feelsLikeF, currentHourly, sunTimesForCtDate } from "./lib/derived.js";
import { topbar, footer } from "./chrome.js";
import { JSONLD_SITE, JSONLD_DATASET, OG_COMMON, ORG_ID, WEBSITE_ID } from "./seo.js";
import {
  fetchUv, uvCurrent, uvPeakToday, uvCategory,
  fetchAqi, fetchNearbyOzone, aqiCategory, aqiDominantLabel,
  aqiSourceTag, aqiSourceNote, aqiApiObject,
  aqiHealth, airHtml, airMarkdown, apiAir,
} from "./features/air.js";
import { linkHeader, conditional } from "./lib/http.js";
import {
  fetchWeather, loadWeather, renderHtml, renderMarkdown, apiWeather, badgeSvg,
} from "./features/weather.js";
import { aboutHtml, aboutMarkdown } from "./pages/about.js";
import { developersHtml, developersMarkdown } from "./pages/developers.js";
import { privacyHtml, privacyMarkdown } from "./pages/privacy.js";
import { contactHtml, contactMarkdown } from "./pages/contact.js";
import { emergencyHtml, emergencyMarkdown, EMERGENCY } from "./pages/emergency.js";
import { sitemapPageHtml, sitemapPageMarkdown } from "./pages/sitemap.js";
import { radarHtml, radarMarkdown } from "./features/radar.js";
import { hourlyHtml, hourlyMarkdown } from "./features/hourly.js";
import { alertsHtml, alertsMarkdown } from "./features/alerts.js";
import { loadNews, isAdmin, newsHtml, newsMarkdown, newsRss, apiNews, newsList, newsDate, NEWS_BLOCKLIST_KV_KEY } from "./features/news.js";
import { fetchCalendar, loadCalendar, calendarHtml, calendarMarkdown, apiCalendar, upcomingEvents, translateEvent, calTime, CALENDAR_KV_KEY } from "./features/calendar.js";
import { fetchWater, loadWater, waterHtml, waterMarkdown, apiWater, waterState, waterCatLabel, waterCatClass, WATER_FLOOD_CATS, WATER_CAT_ORDER, WATER_KV_KEY } from "./features/water.js";
import { fetchFishing, loadFishing, fishingHtml, fishingMarkdown, apiFishing, FISHING_KV_KEY } from "./features/fishing.js";
import { fetchTropics, loadTropics, tropicsHtml, tropicsMarkdown, apiTropics, tropicsStormLine, tropicsClassLabel, TROPICS_KV_KEY } from "./features/tropics.js";
import { fetchTraffic, loadTraffic, trafficHtml, trafficMarkdown, apiTraffic, trafficTypeLabel, TRAFFIC_KV_KEY } from "./features/traffic.js";
import { fetchPollen, loadPollen, pollenHtml, pollenMarkdown, apiPollen, pollenCatLabel, pollenCatRank, pollenGroupLabel, pollenDateLabel, POLLEN_GROUPS, POLLEN_KV_KEY } from "./features/pollen.js";
import { homeHtml, homeMarkdown, renderError } from "./features/home.js";
import { MCP_CORS, mcpHandle, mcpJson, rpcError, mcpServerCard, mcpInfoHtml, mcpInfoMarkdown, mcpTools } from "./mcp/server.js";
import { apiCatalog, openApiSpec } from "./api/openapi.js";
import { llmsTxt, robotsTxt, sitemapXml, CROSBY_WEATHER_SKILL, contentSecurityPolicy, agentSkillsIndex } from "./discovery.js";
import { alertsRss } from "./features/alerts.js";
import { pushSevereAlerts, pushEndpointAllowed, pushKeyFor } from "./push.js";



async function _fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

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
      return new Response(sitemapXml(), {
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
    // Serve the favicon as a real file. Browsers and crawlers auto-request
    // /favicon.ico; serving it (as SVG) avoids needless 404s in crawl stats.
    if (path === "/favicon.ico" || path === "/favicon.svg") {
      return new Response(FAVICON_SVG, {
        headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=604800, immutable" },
      });
    }
    // PWA surface: manifest + app icon + service worker (see the constants up
    // top). The SW gets `no-cache` so a deploy's new worker is picked up on
    // the next visit rather than after a stale-cache window.
    if (path === "/manifest.json") {
      return new Response(JSON.stringify(MANIFEST, null, 2), {
        headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "public, max-age=3600" },
      });
    }
    if (path === "/icon.svg") {
      return new Response(ICON_SVG, {
        headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=604800, immutable" },
      });
    }
    // Raster app icon for iOS "Add to Home Screen" (apple-touch-icon). Also
    // served at the well-known root path so iOS finds it by convention on pages
    // that don't link the manifest (the admin /news view). Decodes the inline
    // base64 PNG to bytes.
    if (path === "/apple-touch-icon.png" || path === "/apple-touch-icon-precomposed.png") {
      const bytes = Uint8Array.from(atob(APPLE_TOUCH_ICON_B64), (c) => c.charCodeAt(0));
      return new Response(bytes, {
        headers: { "content-type": "image/png", "cache-control": "public, max-age=604800, immutable" },
      });
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
        const r = await mcpHandle(m, env);
        if (r) out.push(r);
      }
      if (out.length === 0) return new Response(null, { status: 202, headers: MCP_CORS });
      return mcpJson(batch ? out : out[0], 200);
    }

    if (path === "/api/health") {
      let updated = null;
      try {
        const cached = await env.WEATHER.get(KV_KEY, "json");
        updated = cached?.updated ?? null;
      } catch {}
      return new Response(JSON.stringify({ status: "ok", updated }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*",
          "cache-control": "no-store",
        },
      });
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

    if (path === "/api/weather") {
      try {
        const { data, cache } = await loadWeather(env);
        // Seed includes the CT calendar date because `sun` in the body
        // changes with it even when the cache stamp doesn't.
        const ctDate = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
        return conditional(request, `${data.updated ?? "none"}|${ctDate}`, () => JSON.stringify(apiWeather(data)), {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*",
          "cache-control": "public, max-age=300",
          link: `<${SITE}/openapi.json>; rel="service-desc"; type="application/json"`,
          "x-cache": cache,
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "upstream_unavailable", message: err && err.message }), {
          status: 502,
          headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" },
        });
      }
    }

    // Local news as JSON — same read-only KV data the /news page renders.
    if (path === "/api/news") {
      try {
        const data = await loadNews(env);
        return conditional(request, data.updated ?? "none", () => JSON.stringify(apiNews(data)), {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*",
          "cache-control": "public, max-age=900",
          link: `<${SITE}/openapi.json>; rel="service-desc"; type="application/json"`,
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "unavailable", message: err && err.message }), {
          status: 502,
          headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" },
        });
      }
    }

    // Water levels as JSON — same cron-owned KV data as /water.
    if (path === "/api/water") {
      try {
        const data = await loadWater(env);
        return conditional(request, data.updated ?? "none", () => JSON.stringify(apiWater(data)), {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*",
          "cache-control": "public, max-age=300",
          link: `<${SITE}/openapi.json>; rel="service-desc"; type="application/json"`,
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "unavailable", message: err && err.message }), {
          status: 502,
          headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" },
        });
      }
    }

    // Fishing conditions as JSON — same cron-owned KV data as /fishing.
    if (path === "/api/fishing") {
      try {
        const data = await loadFishing(env);
        return conditional(request, data.updated ?? "none", () => JSON.stringify(apiFishing(data)), {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*",
          "cache-control": "public, max-age=300",
          link: `<${SITE}/openapi.json>; rel="service-desc"; type="application/json"`,
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "unavailable", message: err && err.message }), {
          status: 502,
          headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" },
        });
      }
    }

    // Atlantic tropical outlook as JSON — same cron-owned KV data as /tropics.
    // An empty storms array is the normal quiet-basin state.
    if (path === "/api/tropics") {
      try {
        const data = await loadTropics(env);
        return conditional(request, data.updated ?? "none", () => JSON.stringify(apiTropics(data)), {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*",
          "cache-control": "public, max-age=900",
          link: `<${SITE}/openapi.json>; rel="service-desc"; type="application/json"`,
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "unavailable", message: err && err.message }), {
          status: 502,
          headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" },
        });
      }
    }

    // Crosby-area road incidents and lane closures as JSON — same cron-owned
    // KV data as /traffic. Empty arrays are quiet roads; null means that feed
    // was unreachable at the last refresh.
    if (path === "/api/traffic") {
      try {
        const data = await loadTraffic(env);
        return conditional(request, data.updated ?? "none", () => JSON.stringify(apiTraffic(data)), {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*",
          "cache-control": "public, max-age=300",
          link: `<${SITE}/openapi.json>; rel="service-desc"; type="application/json"`,
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "unavailable", message: err && err.message }), {
          status: 502,
          headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" },
        });
      }
    }

    // Houston Health Department pollen & mold count as JSON — same cron-owned
    // KV data as /pollen. countDate is the CT calendar day the count is for
    // (weekday mornings only; weekends serve Friday's count).
    if (path === "/api/pollen") {
      try {
        const data = await loadPollen(env);
        return conditional(request, `${data.countDate ?? "none"}|${data.updated ?? "none"}`, () => JSON.stringify(apiPollen(data)), {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*",
          "cache-control": "public, max-age=1800",
          link: `<${SITE}/openapi.json>; rel="service-desc"; type="application/json"`,
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "unavailable", message: err && err.message }), {
          status: 502,
          headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" },
        });
      }
    }

    // Air quality as JSON — the measured AQI from the weather cache (AirNow /
    // Open-Meteo fallback). ETag keys on the weather refresh stamp.
    if (path === "/api/air") {
      try {
        const { data } = await loadWeather(env);
        return conditional(request, `${data.updated ?? "none"}|${data.aqi?.measured ? "m" : "o"}`, () => JSON.stringify(apiAir(data)), {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*",
          "cache-control": "public, max-age=600",
          link: `<${SITE}/openapi.json>; rel="service-desc"; type="application/json"`,
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "unavailable", message: err && err.message }), {
          status: 502,
          headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" },
        });
      }
    }

    // Crosby ISD school calendar as JSON — same cron-owned KV data as /calendar.
    // The `upcomingEvents` cutoff moves with time, so the seed carries the CT
    // date to stay honest across day boundaries.
    if (path === "/api/calendar") {
      try {
        const data = await loadCalendar(env);
        const ctDate = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
        return conditional(request, `${data.updated ?? "none"}|${ctDate}`, () => JSON.stringify(apiCalendar(data)), {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*",
          "cache-control": "public, max-age=1800",
          link: `<${SITE}/openapi.json>; rel="service-desc"; type="application/json"`,
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "unavailable", message: err && err.message }), {
          status: 502,
          headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" },
        });
      }
    }

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
        return new Response("Icon unavailable", { status: res.status === 404 ? 404 : 502 });
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

    // About page — content-negotiated like the homepage (HTML, or Markdown for
    // agents via Accept: text/markdown / ?format=md). Static, so cache longer.
    if (page === "/about") {
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
      if (wantsMarkdown) {
        return new Response(aboutMarkdown(lang), {
          headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=3600", vary: "Accept" },
        });
      }
      return new Response(aboutHtml(lang), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600", vary: "Accept" },
      });
    }

    // Developers & agents page — the API/MCP/feeds detail that used to live on
    // /about. Same static content-negotiated treatment.
    if (page === "/developers") {
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
      if (wantsMarkdown) {
        return new Response(developersMarkdown(lang), {
          headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=3600", vary: "Accept" },
        });
      }
      return new Response(developersHtml(lang), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600", vary: "Accept" },
      });
    }

    // Emergency resources page — a static directory of official emergency
    // contacts (911, outages, flooding, shelters, recovery). Same static
    // content-negotiated treatment as /about.
    if (page === "/emergency") {
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
      if (wantsMarkdown) {
        return new Response(emergencyMarkdown(lang), {
          headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=3600", vary: "Accept" },
        });
      }
      return new Response(emergencyHtml(lang), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600", vary: "Accept" },
      });
    }

    // Radar page — the radar image is a separate proxy; loadWeather() is a
    // cheap KV read so the footer can show the same freshness line as the
    // other weather pages.
    if (page === "/radar") {
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
      try {
        const { data } = await loadWeather(env);
        const bodyText = wantsMarkdown ? radarMarkdown(lang) : radarHtml(lang, data);
        return new Response(bodyText, {
          headers: {
            "content-type": `${wantsMarkdown ? "text/markdown" : "text/html"}; charset=utf-8`,
            "cache-control": "public, max-age=3600",
            vary: "Accept",
          },
        });
      } catch (err) {
        return new Response(wantsMarkdown ? radarMarkdown(lang) : radarHtml(lang), {
          headers: {
            "content-type": `${wantsMarkdown ? "text/markdown" : "text/html"}; charset=utf-8`,
            "cache-control": "public, max-age=3600",
            vary: "Accept",
          },
        });
      }
    }

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

    // Hourly forecast page — full multi-day table from the cached NWS data.
    if (page === "/hourly") {
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
      try {
        const { data } = await loadWeather(env);
        const bodyText = wantsMarkdown ? hourlyMarkdown(data, lang) : hourlyHtml(data, lang);
        return new Response(bodyText, {
          headers: {
            "content-type": `${wantsMarkdown ? "text/markdown" : "text/html"}; charset=utf-8`,
            "cache-control": "public, max-age=300",
            vary: "Accept",
          },
        });
      } catch (err) {
        return new Response(renderError(err, "the National Weather Service"), { status: 502, headers: { "content-type": "text/html; charset=utf-8" } });
      }
    }

    // Alerts hub — active NWS alerts plus an evergreen severe-weather guide.
    if (page === "/alerts") {
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
      try {
        const { data } = await loadWeather(env);
        const bodyText = wantsMarkdown ? alertsMarkdown(data, lang) : alertsHtml(data, lang);
        return new Response(bodyText, {
          headers: {
            "content-type": `${wantsMarkdown ? "text/markdown" : "text/html"}; charset=utf-8`,
            "cache-control": "public, max-age=300",
            vary: "Accept",
          },
        });
      } catch (err) {
        return new Response(renderError(err, "the National Weather Service"), { status: 502, headers: { "content-type": "text/html; charset=utf-8" } });
      }
    }

    // Local news — aggregated + relevance-filtered headlines about Crosby, TX.
    if (page === "/news") {
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
      // Admin nuke view: a valid ?admin=<secret> shows every article (blocked
      // ones dimmed) with Hide/Restore buttons. HTML only, never cached.
      const adminOn = !wantsMarkdown && isAdmin(env, url.searchParams.get("admin"));
      try {
        const data = await loadNews(env, adminOn ? { includeBlocked: true } : undefined);
        const bodyText = wantsMarkdown ? newsMarkdown(data, lang) : newsHtml(data, lang, adminOn);
        return new Response(bodyText, {
          headers: {
            "content-type": `${wantsMarkdown ? "text/markdown" : "text/html"}; charset=utf-8`,
            "cache-control": adminOn ? "private, no-store" : "public, max-age=900",
            vary: "Accept",
          },
        });
      } catch (err) {
        return new Response(renderError(err, "our news source"), { status: 502, headers: { "content-type": "text/html; charset=utf-8" } });
      }
    }

    // Crosby ISD school calendar — rendered from the cached iCal feed.
    if (page === "/water") {
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
      try {
        const data = await loadWater(env);
        const bodyText = wantsMarkdown ? waterMarkdown(data, lang) : waterHtml(data, lang);
        return new Response(bodyText, {
          headers: {
            "content-type": `${wantsMarkdown ? "text/markdown" : "text/html"}; charset=utf-8`,
            "cache-control": "public, max-age=300",
            vary: "Accept",
          },
        });
      } catch (err) {
        return new Response(renderError(err, "NOAA's river gauges"), { status: 502, headers: { "content-type": "text/html; charset=utf-8" } });
      }
    }

    // Fishing conditions — cron + KV like /water; USGS real-time water quality
    // for the waters people fish near Crosby.
    if (page === "/fishing") {
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
      try {
        const data = await loadFishing(env);
        const bodyText = wantsMarkdown ? fishingMarkdown(data, lang) : fishingHtml(data, lang);
        return new Response(bodyText, {
          headers: {
            "content-type": `${wantsMarkdown ? "text/markdown" : "text/html"}; charset=utf-8`,
            "cache-control": "public, max-age=300",
            vary: "Accept",
          },
        });
      } catch (err) {
        return new Response(renderError(err, "the U.S. Geological Survey"), { status: 502, headers: { "content-type": "text/html; charset=utf-8" } });
      }
    }

    // Atlantic tropical outlook — cron + KV like /water; shows storm cards
    // only when something is active, an all-clear panel otherwise.
    if (page === "/tropics") {
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
      try {
        const data = await loadTropics(env);
        const bodyText = wantsMarkdown ? tropicsMarkdown(data, lang) : tropicsHtml(data, lang);
        return new Response(bodyText, {
          headers: {
            "content-type": `${wantsMarkdown ? "text/markdown" : "text/html"}; charset=utf-8`,
            "cache-control": "public, max-age=900",
            vary: "Accept",
          },
        });
      } catch (err) {
        return new Response(renderError(err, "the National Hurricane Center"), { status: 502, headers: { "content-type": "text/html; charset=utf-8" } });
      }
    }

    // Roads & traffic — cron + KV like /water; incidents on the Crosby
    // corridors from Houston TranStar, with an evergreen high-water guide.
    if (page === "/traffic") {
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
      try {
        const data = await loadTraffic(env);
        const bodyText = wantsMarkdown ? trafficMarkdown(data, lang) : trafficHtml(data, lang);
        return new Response(bodyText, {
          headers: {
            "content-type": `${wantsMarkdown ? "text/markdown" : "text/html"}; charset=utf-8`,
            "cache-control": "public, max-age=300",
            vary: "Accept",
          },
        });
      } catch (err) {
        return new Response(renderError(err, "Houston TranStar"), { status: 502, headers: { "content-type": "text/html; charset=utf-8" } });
      }
    }

    // Pollen & mold — cron + KV like /tropics; the Houston Health Department's
    // measured daily count with an evergreen allergy guide.
    if (page === "/pollen") {
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
      try {
        const data = await loadPollen(env);
        const bodyText = wantsMarkdown ? pollenMarkdown(data, lang) : pollenHtml(data, lang);
        return new Response(bodyText, {
          headers: {
            "content-type": `${wantsMarkdown ? "text/markdown" : "text/html"}; charset=utf-8`,
            "cache-control": "public, max-age=1800",
            vary: "Accept",
          },
        });
      } catch (err) {
        return new Response(renderError(err, "the Houston Health Department"), { status: 502, headers: { "content-type": "text/html; charset=utf-8" } });
      }
    }

    // Air quality — renders the AQI folded into the weather cache (AirNow
    // measured / Open-Meteo modeled fallback); no separate KV key.
    if (page === "/air") {
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
      try {
        const { data } = await loadWeather(env);
        const bodyText = wantsMarkdown ? airMarkdown(data, lang) : airHtml(data, lang);
        return new Response(bodyText, {
          headers: {
            "content-type": `${wantsMarkdown ? "text/markdown" : "text/html"}; charset=utf-8`,
            "cache-control": "public, max-age=600",
            vary: "Accept",
          },
        });
      } catch (err) {
        return new Response(renderError(err, "the air-quality monitors"), { status: 502, headers: { "content-type": "text/html; charset=utf-8" } });
      }
    }

    if (page === "/calendar") {
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
      try {
        const data = await loadCalendar(env);
        const bodyText = wantsMarkdown ? calendarMarkdown(data, lang) : calendarHtml(data, lang);
        return new Response(bodyText, {
          headers: {
            "content-type": `${wantsMarkdown ? "text/markdown" : "text/html"}; charset=utf-8`,
            "cache-control": "public, max-age=1800",
            vary: "Accept",
          },
        });
      } catch (err) {
        return new Response(renderError(err, "the Crosby ISD calendar"), { status: 502, headers: { "content-type": "text/html; charset=utf-8" } });
      }
    }

    if (page === "/privacy") {
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
      if (wantsMarkdown) {
        return new Response(privacyMarkdown(lang), {
          headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=3600", vary: "Accept" },
        });
      }
      return new Response(privacyHtml(lang), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600", vary: "Accept" },
      });
    }

    if (page === "/contact") {
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
      if (wantsMarkdown) {
        return new Response(contactMarkdown(lang), {
          headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=3600", vary: "Accept" },
        });
      }
      return new Response(contactHtml(lang), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600", vary: "Accept" },
      });
    }

    if (page === "/sitemap") {
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
      if (wantsMarkdown) {
        return new Response(sitemapPageMarkdown(lang), {
          headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=3600", vary: "Accept" },
        });
      }
      return new Response(sitemapPageHtml(lang), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600", vary: "Accept" },
      });
    }

    // The full forecast — what the root used to serve, now at its own URL so
    // the root can be a hub. Content-negotiated like every content page.
    if (page === "/weather") {
      try {
        const { data, cache } = await loadWeather(env);
        const accept = (request.headers.get("accept") || "").toLowerCase();
        const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
        if (wantsMarkdown) {
          const md = renderMarkdown(data, lang);
          return new Response(md, {
            headers: {
              "content-type": "text/markdown; charset=utf-8",
              "cache-control": "public, max-age=300",
              vary: "Accept",
              link: linkHeader("/weather", lang),
              "x-markdown-tokens": String(Math.ceil(md.length / 4)),
              "x-cache": cache,
            },
          });
        }
        return new Response(renderHtml(data, lang), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300", vary: "Accept", link: linkHeader("/weather", lang), "x-cache": cache },
        });
      } catch (err) {
        return new Response(renderError(err, "the National Weather Service"), { status: 502, headers: { "content-type": "text/html; charset=utf-8" } });
      }
    }

    // Otherwise only the root (and its /es counterpart) serves the hub.
    if (page !== "/") {
      return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
    }

    try {
      // The hub summarizes every section, so it loads all four datasets — in
      // parallel, so one slow source can't serially block the front page. Each
      // loader self-heals on a cold cache; a rejected one shouldn't blank the
      // whole page, so failures degrade to an empty shape.
      const [wRes, water, news, cal, tropics] = await Promise.all([
        loadWeather(env).catch(() => ({ data: { hourly: [], periods: [], alerts: [], updated: null }, cache: "miss-warmfail" })),
        loadWater(env).catch(() => ({ gauges: [] })),
        loadNews(env).catch(() => ({ items: [] })),
        loadCalendar(env).catch(() => ({ events: [] })),
        loadTropics(env).catch(() => ({ storms: [] })),
      ]);
      const weather = wRes.data;

      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";

      if (wantsMarkdown) {
        const md = homeMarkdown(weather, water, news, cal, tropics, lang);
        return new Response(md, {
          headers: {
            "content-type": "text/markdown; charset=utf-8",
            "cache-control": "public, max-age=300",
            vary: "Accept",
            link: linkHeader("/", lang),
            "x-markdown-tokens": String(Math.ceil(md.length / 4)),
            "x-cache": wRes.cache,
          },
        });
      }

      return new Response(homeHtml(weather, water, news, cal, tropics, lang), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=300",
          vary: "Accept",
          link: linkHeader("/", lang),
          "x-cache": wRes.cache,
        },
      });
    } catch (err) {
      return new Response(renderError(err, "a data source"), {
        status: 502,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
}


// The content pages, each its own canonical URL. Their responses get an HTTP
// `Link: rel="canonical"` header in the wrapper below, so the content-negotiated
// `?format=md` variants — and the http→https pair — consolidate onto one URL for
// crawlers that read the HTTP layer (reinforces the in-HTML <link rel="canonical">).
const PAGE_PATHS = new Set([
  "/", "/weather", "/hourly", "/radar", "/alerts", "/water", "/fishing", "/tropics", "/pollen", "/air", "/traffic", "/news", "/calendar", "/emergency", "/about", "/developers", "/privacy", "/contact", "/sitemap",
  "/es", "/es/weather", "/es/hourly", "/es/radar", "/es/alerts", "/es/water", "/es/fishing", "/es/tropics", "/es/pollen", "/es/air", "/es/traffic", "/es/news", "/es/calendar", "/es/emergency", "/es/about", "/es/developers", "/es/privacy", "/es/contact", "/es/sitemap",
]);

export default {
  async fetch(request, env, ctx) {
    const resp = await _fetch(request, env, ctx);
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

  async scheduled(event, env, ctx) {
    // Refresh the weather cache. News is NOT fetched here — it's written to the
    // KV "news" key out-of-band by scripts/fetch-news.mjs (a Claude routine),
    // because Google News blocks Worker IPs. The Worker only renders that key.
    try {
      const data = await fetchWeather(env);
      await env.WEATHER.put(KV_KEY, JSON.stringify(data));
      // After a fresh forecast, wake push subscribers for any NEW severe
      // warning. Independent of the writes below; a push failure is logged and
      // never blocks the cache refresh (own try/catch inside).
      try {
        await pushSevereAlerts(env, data.alerts);
      } catch (e) {
        console.error("Cron push dispatch failed:", e && e.stack);
      }
    } catch (e) {
      console.error("Cron weather refresh failed:", e && e.stack);
    }
    // Refresh the Crosby ISD school calendar at most ~every 6h (it changes
    // rarely and the Worker CAN reach crosbyisd.org). Independent try/catch so a
    // calendar hiccup never affects the weather refresh above.
    try {
      const cur = await env.WEATHER.get(CALENDAR_KV_KEY, "json");
      const age = cur?.updated ? Date.now() - new Date(cur.updated).getTime() : Infinity;
      if (!cur || !Array.isArray(cur.events) || age > 6 * 3600 * 1000) {
        await env.WEATHER.put(CALENDAR_KV_KEY, JSON.stringify(await fetchCalendar()));
      }
    } catch (e) {
      console.error("Cron calendar refresh failed:", e && e.stack);
    }
    // Refresh river/bayou levels every tick (levels move fast in a flood).
    // fetchWater() throws on a total NWPS outage, so we skip the write and the
    // last good snapshot survives. Independent try/catch from the above.
    try {
      await env.WEATHER.put(WATER_KV_KEY, JSON.stringify(await fetchWater()));
    } catch (e) {
      console.error("Cron water refresh failed:", e && e.stack);
    }
    // Refresh fishing conditions every tick (USGS IV posts ~every 15-30 min).
    // fetchFishing() throws on a total USGS outage, so a hiccup keeps the last
    // snapshot. Independent try/catch from the above.
    try {
      await env.WEATHER.put(FISHING_KV_KEY, JSON.stringify(await fetchFishing()));
    } catch (e) {
      console.error("Cron fishing refresh failed:", e && e.stack);
    }
    // Refresh the Atlantic tropical outlook at most ~hourly (NHC advisories
    // update every 2-6h). fetchTropics() throws on failure, so a transient
    // NHC outage skips the write and the last snapshot survives.
    try {
      const cur = await env.WEATHER.get(TROPICS_KV_KEY, "json");
      const age = cur?.updated ? Date.now() - new Date(cur.updated).getTime() : Infinity;
      if (!cur || !Array.isArray(cur.storms) || age > 3600 * 1000) {
        await env.WEATHER.put(TROPICS_KV_KEY, JSON.stringify(await fetchTropics()));
      }
    } catch (e) {
      console.error("Cron tropics refresh failed:", e && e.stack);
    }
    // Refresh Crosby-corridor traffic every tick (TranStar updates the feeds
    // about once a minute; incidents and high-water reports move fast).
    // fetchTraffic() throws only when BOTH feeds fail, so a total TranStar
    // outage skips the write and the last snapshot survives.
    try {
      await env.WEATHER.put(TRAFFIC_KV_KEY, JSON.stringify(await fetchTraffic()));
    } catch (e) {
      console.error("Cron traffic refresh failed:", e && e.stack);
    }
    // Refresh the pollen & mold count at most ~every 2h — HHD publishes one
    // count per weekday morning, so this catches a new count within a couple
    // of hours without hammering a city Drupal site. fetchPollen() throws on
    // failure OR an unparseable layout, so the last good count survives.
    try {
      const cur = await env.WEATHER.get(POLLEN_KV_KEY, "json");
      const age = cur?.updated ? Date.now() - new Date(cur.updated).getTime() : Infinity;
      if (!cur || !cur.groups || !cur.countDate || age > 2 * 3600 * 1000) {
        await env.WEATHER.put(POLLEN_KV_KEY, JSON.stringify(await fetchPollen()));
      }
    } catch (e) {
      console.error("Cron pollen refresh failed:", e && e.stack);
    }
  },
};
