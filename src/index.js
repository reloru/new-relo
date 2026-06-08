// crosbynews.com — Crosby, TX weather, served from the edge.
//
// scheduled(): every 15 min, pull the NWS forecast (daily + hourly) and active
//   alerts and cache the result as JSON in KV under "weather".
// fetch(): render that cached JSON as HTML. On a cold cache (before the first
//   cron run) it fetches live, renders, and warms the cache.

const LAT = 29.9119;
const LON = -95.0608;

// NWS requires a descriptive User-Agent on every request.
const NWS_HEADERS = {
  "User-Agent": "crosbynews.com",
  Accept: "application/geo+json",
};

const KV_KEY = "weather";
const TZ = "America/Chicago";
// Canonical origin — used for robots.txt, sitemap, canonical link, and Link
// headers so everything consolidates to the brand domain.
const SITE = "https://crosbynews.com";

// Brand favicon (a small sun behind a cloud). Served as a real file at
// /favicon.ico and /favicon.svg, and inlined as a data URI in the page <head>.
const FAVICON_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>" +
  "<circle cx='13' cy='15' r='8' fill='#f5b301'/>" +
  "<ellipse cx='19' cy='20' rx='10' ry='6' fill='#dfe7ee'/></svg>";

async function getJson(url) {
  const res = await fetch(url, { headers: NWS_HEADERS });
  if (!res.ok) {
    throw new Error(`NWS request failed: ${res.status} ${res.statusText} (${url})`);
  }
  return res.json();
}

// Pull the daily + hourly forecast and active alerts for Crosby, TX.
async function fetchWeather() {
  // 1. Resolve the point to its forecast endpoints.
  const points = await getJson(`https://api.weather.gov/points/${LAT},${LON}`);
  const { forecast: forecastUrl, forecastHourly: hourlyUrl } = points.properties;
  const place = points.properties.relativeLocation?.properties;

  // 2. Daily forecast, hourly forecast, and active alerts are independent.
  const [forecast, hourly, alertsData] = await Promise.all([
    getJson(forecastUrl),
    getJson(hourlyUrl),
    getJson(`https://api.weather.gov/alerts/active?point=${LAT},${LON}`),
  ]);

  return {
    updated: new Date().toISOString(),
    place: place ? `${place.city}, ${place.state}` : "Crosby, TX",
    periods: forecast.properties.periods ?? [],
    hourly: (hourly.properties.periods ?? []).slice(0, 12),
    alerts: (alertsData.features ?? []).map((f) => f.properties),
  };
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function nl2br(value) {
  return esc(value).replace(/\n/g, "<br>");
}

// Probability of precipitation as a whole number (NWS gives {value:null|number}).
function pop(period) {
  const v = period?.probabilityOfPrecipitation?.value;
  return typeof v === "number" ? Math.round(v) : 0;
}

// NWS icon URLs carry a ?size= param; bump it for crisper rendering, and
// rewrite api.weather.gov hotlinks to our own /icons proxy. NWS's robots.txt
// disallows all crawling, so hotlinked images are uncrawlable (and slower) —
// serving them from our origin makes them indexable and edge-cacheable.
function iconUrl(url, size) {
  if (!url) return "";
  const sized = url.replace(/size=\w+/, `size=${size}`);
  return esc(sized.replace("https://api.weather.gov/icons/", "/icons/"));
}

function fmt(iso, opts) {
  try {
    return new Date(iso).toLocaleString("en-US", { timeZone: TZ, ...opts });
  } catch {
    return "";
  }
}
const fullTime = (iso) => fmt(iso, { dateStyle: "medium", timeStyle: "short" });
const clockTime = (iso) => fmt(iso, { hour: "numeric", minute: "2-digit" });
const hourLabel = (iso) => fmt(iso, { hour: "numeric" });

function renderAlerts(alerts) {
  if (!alerts.length) return "";
  const cards = alerts
    .map(
      (a) => `
      <article class="alert">
        <h3>&#9888; ${esc(a.event)}</h3>
        ${a.headline ? `<p class="headline">${esc(a.headline)}</p>` : ""}
        ${a.description ? `<p>${nl2br(a.description)}</p>` : ""}
        ${a.instruction ? `<p class="instruction"><strong>What to do:</strong> ${nl2br(a.instruction)}</p>` : ""}
        ${a.expires ? `<p class="meta">In effect until ${esc(fullTime(a.expires))}</p>` : ""}
      </article>`
    )
    .join("");
  return `<section class="alerts" aria-label="Active weather alerts">${cards}</section>`;
}

function renderHero(data) {
  const now = data.hourly?.[0];
  const lead = data.periods?.[0];
  if (!now) return "";
  return `
    <section class="hero">
      ${now.icon ? `<img class="hero-icon" src="${iconUrl(now.icon, "large")}" alt="${esc(now.shortForecast)}" width="128" height="128" fetchpriority="high">` : ""}
      <div class="hero-now">
        <p class="hero-temp">${esc(now.temperature)}&deg;<span>${esc(now.temperatureUnit)}</span></p>
        <p class="hero-cond">${esc(now.shortForecast)}</p>
        <p class="hero-meta">${esc(data.place)} &middot; as of ${esc(clockTime(now.startTime))} CT${pop(now) ? ` &middot; ${pop(now)}% precip` : ""}</p>
      </div>
    </section>
    ${lead ? `<p class="lead"><strong>${esc(lead.name)}:</strong> ${esc(lead.detailedForecast)}</p>` : ""}`;
}

function renderHourly(hourly) {
  if (!hourly?.length) return "";
  const cells = hourly
    .map(
      (h) => `
      <div class="hour">
        <span class="hour-time">${esc(hourLabel(h.startTime))}</span>
        ${h.icon ? `<img src="${iconUrl(h.icon, "small")}" alt="${esc(h.shortForecast)}" width="44" height="44" loading="lazy">` : ""}
        <span class="hour-temp">${esc(h.temperature)}&deg;</span>
        <span class="hour-pop${pop(h) >= 30 ? " wet" : ""}">${pop(h)}%</span>
      </div>`
    )
    .join("");
  return `<section class="card">
    <h2>Next 12 hours</h2>
    <div class="hourly">${cells}</div>
  </section>`;
}

function renderDaily(periods) {
  if (!periods.length) return `<p class="none">No forecast available.</p>`;
  const cards = periods
    .map(
      (p) => `
      <article class="period ${p.isDaytime ? "day" : "night"}">
        <div class="period-head">
          <h3>${esc(p.name)}</h3>
          ${p.icon ? `<img src="${iconUrl(p.icon, "medium")}" alt="${esc(p.shortForecast)}" width="52" height="52" loading="lazy">` : ""}
        </div>
        <p class="temp">${p.isDaytime ? "High" : "Low"} ${esc(p.temperature)}&deg;${esc(p.temperatureUnit)}</p>
        <p class="short">${esc(p.shortForecast)}</p>
        <p class="meta">${pop(p) ? `${pop(p)}% precip &middot; ` : ""}Wind ${esc(p.windSpeed)} ${esc(p.windDirection)}</p>
        <p class="detail">${esc(p.detailedForecast)}</p>
      </article>`
    )
    .join("");
  return `<section class="daily-sec">
    <h2>7-Day Forecast</h2>
    <div class="periods">${cards}</div>
  </section>`;
}

function renderHtml(data) {
  const hasAlerts = (data.alerts ?? []).length > 0;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Crosby, TX Weather &mdash; crosbynews.com</title>
<meta name="description" content="Live weather forecast and active alerts for Crosby, Texas, refreshed every 15 minutes from the U.S. National Weather Service.">
<meta name="theme-color" content="#0b3d61">
<meta name="msvalidate.01" content="71B0F51AEDA395D9136070A67436D4F9">
<meta property="og:title" content="Crosby, TX Weather">
<meta property="og:description" content="Live forecast and active alerts for Crosby, Texas.">
<meta property="og:type" content="website">
<link rel="canonical" href="${SITE}/">
<meta http-equiv="refresh" content="900">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>
  :root { color-scheme: light dark; --blue:#0b3d61; --accent:#2c7fb8; --sun:#f5b301; --bg:#eef2f6; --card:#fff; --ink:#16222e; --muted:#5a6b7b; --line:#d8dee5; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0f1620; --card:#1a2430; --ink:#e6ebf1; --muted:#94a3b2; --line:#2a3744; }
  }
  * { box-sizing: border-box; }
  body { margin:0; font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; line-height:1.5; background:var(--bg); color:var(--ink); }
  .topbar { display:flex; justify-content:space-between; align-items:center; gap:1rem; background:var(--blue); color:#fff; padding:0.7rem 1rem; }
  .topbar .brand { font-weight:700; letter-spacing:0.02em; }
  .topbar .loc { opacity:0.85; font-size:0.9rem; }
  main { max-width:920px; margin:0 auto; padding:1rem; }
  h2 { font-size:1.1rem; margin:1.4rem 0 0.6rem; }
  .none { color:var(--muted); font-style:italic; }

  .hero { display:flex; align-items:center; gap:1rem; background:linear-gradient(135deg,var(--blue),var(--accent)); color:#fff; border-radius:16px; padding:1.1rem 1.3rem; margin-top:0.5rem; }
  .hero-icon { border-radius:12px; background:rgba(255,255,255,0.12); flex:none; }
  .hero-temp { margin:0; font-size:3.4rem; font-weight:800; line-height:1; }
  .hero-temp span { font-size:1.2rem; font-weight:600; vertical-align:super; opacity:0.85; }
  .hero-cond { margin:0.2rem 0 0; font-size:1.2rem; font-weight:600; }
  .hero-meta { margin:0.35rem 0 0; font-size:0.85rem; opacity:0.85; }
  .lead { margin:0.8rem 0 0; color:var(--muted); }

  .card { background:var(--card); border-radius:12px; padding:0.8rem 1rem; margin-top:1rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); }
  .card h2 { margin:0 0 0.6rem; }
  .hourly { display:flex; gap:0.4rem; overflow-x:auto; padding-bottom:0.3rem; }
  .hour { flex:0 0 auto; width:62px; display:flex; flex-direction:column; align-items:center; gap:0.15rem; text-align:center; }
  .hour-time { font-size:0.8rem; color:var(--muted); }
  .hour-temp { font-weight:700; }
  .hour-pop { font-size:0.75rem; color:var(--muted); }
  .hour-pop.wet { color:var(--accent); font-weight:700; }

  .periods { display:grid; gap:0.75rem; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); }
  .period { background:var(--card); border-radius:12px; padding:0.85rem 1rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); }
  .period.night { background:color-mix(in srgb,var(--card) 92%, var(--blue)); }
  .period-head { display:flex; justify-content:space-between; align-items:center; gap:0.5rem; }
  .period-head h3 { margin:0; font-size:1.02rem; }
  .period .temp { margin:0.2rem 0; font-size:1.5rem; font-weight:800; color:var(--accent); }
  .period .short { margin:0.2rem 0; font-weight:600; }
  .period .meta { margin:0.2rem 0; font-size:0.82rem; color:var(--muted); }
  .period .detail { margin:0.5rem 0 0; font-size:0.9rem; }

  .alerts { display:grid; gap:0.6rem; margin-top:0.5rem; }
  .alert { background:#fff4f3; border-left:5px solid #c0392b; border-radius:10px; padding:0.8rem 1rem; }
  .alert h3 { margin:0 0 0.3rem; color:#a3271b; }
  .alert .headline { font-weight:700; }
  .alert .instruction { background:rgba(255,255,255,0.65); border-radius:6px; padding:0.5rem 0.7rem; }
  .alert .meta { font-size:0.8rem; color:var(--muted); }
  @media (prefers-color-scheme: dark) { .alert { background:#2a1715; } .alert .instruction { background:rgba(0,0,0,0.25); } }

  footer { max-width:920px; margin:1rem auto; padding:0 1rem 2rem; font-size:0.8rem; color:var(--muted); text-align:center; }
  footer a { color:inherit; }
</style>
</head>
<body>
<header class="topbar">
  <span class="brand">crosbynews.com</span>
  <span class="loc">${esc(data.place)}</span>
</header>
<main>
  ${renderAlerts(data.alerts ?? [])}
  ${renderHero(data)}
  ${renderHourly(data.hourly ?? [])}
  ${renderDaily(data.periods ?? [])}
</main>
<footer>
  ${hasAlerts ? "" : "No active weather alerts. "}Data from the U.S. National Weather Service (<a href="https://weather.gov">weather.gov</a>).<br>
  Updated ${esc(fullTime(data.updated))} CT &middot; refreshes every 15 minutes.
</footer>
<script>
// WebMCP: expose Crosby weather as in-browser agent tools. Progressive
// enhancement — a no-op in browsers without navigator.modelContext.
(function () {
  var mc = navigator.modelContext;
  if (!mc) return;
  async function weather() { return (await fetch("/api/weather")).json(); }
  var tools = [
    {
      name: "get_crosby_forecast",
      description: "Current conditions and forecast for Crosby, TX.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: async function () {
        var w = await weather(), c = w.current;
        var text = c ? "Crosby, TX: " + c.temperature + "°" + c.temperatureUnit + ", " + c.shortForecast : "unavailable";
        return { content: [{ type: "text", text: text }] };
      },
    },
    {
      name: "get_crosby_alerts",
      description: "Active NWS weather alerts for Crosby, TX.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: async function () {
        var w = await weather();
        var text = (w.alerts && w.alerts.length) ? w.alerts.map(function (a) { return a.event; }).join(", ") : "No active weather alerts.";
        return { content: [{ type: "text", text: text }] };
      },
    },
  ];
  try {
    if (typeof mc.provideContext === "function") mc.provideContext({ tools: tools });
    else if (typeof mc.registerTool === "function") tools.forEach(function (t) { mc.registerTool(t); });
  } catch (e) {}
})();
</script>
</body>
</html>`;
}

function renderError(err) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Crosby, TX Weather &mdash; temporarily unavailable</title></head>
<body style="font-family:system-ui,sans-serif;max-width:640px;margin:3rem auto;padding:0 1rem">
<h1>Weather temporarily unavailable</h1>
<p>We couldn't reach the National Weather Service just now. Please try again shortly.</p>
<pre style="background:#f4f6f8;padding:1rem;border-radius:6px;overflow:auto">${esc(err && err.message)}</pre>
</body></html>`;
}

// /robots.txt — RFC 9309 crawl rules, AI-crawler entries, Content Signals,
// and a sitemap reference. Open by design: this is public-domain NWS data and
// the site wants to be discoverable by agents.
function robotsTxt() {
  return `# crosbynews.com — robots.txt (RFC 9309)
# Crosby, TX weather, derived from the U.S. National Weather Service
# (public-domain data). Crawlers and AI agents are welcome.

User-agent: *
Content-Signal: search=yes, ai-input=yes, ai-train=yes
Allow: /

# AI crawlers and agents — explicitly allowed.
User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: Claude-Web
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Claude-User
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: CCBot
Allow: /

Sitemap: ${SITE}/sitemap.xml
`;
}

// /sitemap.xml — single canonical URL (the page is one document).
function sitemapXml() {
  const today = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>hourly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;
}

// Markdown rendering of the same data, served when an agent sends
// `Accept: text/markdown` (or ?format=md).
function renderMarkdown(data) {
  const cell = (s) => String(s ?? "").replace(/\|/g, "/").replace(/\s*\n\s*/g, " ");
  const now = data.hourly?.[0];
  const lead = data.periods?.[0];
  const out = [];
  out.push(`# ${data.place || "Crosby, TX"} Weather`, "");
  out.push(`_Updated ${fullTime(data.updated)} CT — source: U.S. National Weather Service (weather.gov)_`, "");

  if (now) {
    out.push("## Now");
    out.push(`**${now.temperature}°${now.temperatureUnit}** — ${now.shortForecast} (as of ${clockTime(now.startTime)} CT)${pop(now) ? ` · ${pop(now)}% precip` : ""}`, "");
  }
  if (lead) out.push(`**${lead.name}:** ${lead.detailedForecast}`, "");

  out.push("## Active alerts");
  const alerts = data.alerts ?? [];
  if (alerts.length) {
    for (const a of alerts) {
      out.push(`- **${a.event}**${a.headline ? ` — ${a.headline}` : ""}${a.expires ? ` (until ${fullTime(a.expires)} CT)` : ""}`);
      if (a.instruction) out.push(`  - What to do: ${cell(a.instruction)}`);
    }
  } else {
    out.push("None.");
  }
  out.push("");

  const hourly = data.hourly ?? [];
  if (hourly.length) {
    out.push("## Next 12 hours", "| Time | Temp | Conditions | Precip |", "| --- | --- | --- | --- |");
    for (const h of hourly) {
      out.push(`| ${cell(hourLabel(h.startTime))} | ${h.temperature}°${h.temperatureUnit} | ${cell(h.shortForecast)} | ${pop(h)}% |`);
    }
    out.push("");
  }

  out.push("## 7-day forecast");
  for (const p of data.periods ?? []) {
    out.push(`### ${p.name}`);
    out.push(`${p.isDaytime ? "High" : "Low"} ${p.temperature}°${p.temperatureUnit} — ${p.shortForecast}. Wind ${p.windSpeed} ${p.windDirection}.${pop(p) ? ` ${pop(p)}% precip.` : ""}`, "");
    out.push(p.detailedForecast, "");
  }

  out.push("---", `[crosbynews.com](${SITE}/) · data from the National Weather Service`);
  return out.join("\n");
}

// Shared cache + discovery headers for the homepage in either representation.
// Homepage discovery headers: markdown alternate, sitemap, API catalog, and
// the OpenAPI service description (RFC 8288 Link relations).
const LINK_HEADER =
  `<${SITE}/>; rel="alternate"; type="text/markdown", ` +
  `<${SITE}/sitemap.xml>; rel="sitemap", ` +
  `<${SITE}/.well-known/api-catalog>; rel="api-catalog", ` +
  `<${SITE}/openapi.json>; rel="service-desc"; type="application/json"`;

// Shared loader: cached weather, refreshing on a missing or stale-shaped entry.
async function loadWeather(env) {
  let cache = "hit";
  let data = await env.WEATHER.get(KV_KEY, "json");
  if (!data || !Array.isArray(data.hourly)) {
    data = await fetchWeather();
    try {
      await env.WEATHER.put(KV_KEY, JSON.stringify(data));
      cache = "miss-warmed";
    } catch (e) {
      console.error("KV warm failed:", e && e.stack);
      cache = "miss-warmfail";
    }
  }
  return { data, cache };
}

// JSON shape served at /api/weather.
function apiWeather(data) {
  return {
    location: data.place || "Crosby, TX",
    coordinates: { lat: LAT, lon: LON },
    source: "U.S. National Weather Service (api.weather.gov)",
    updated: data.updated ?? null,
    current: data.hourly?.[0] ?? null,
    hourly: data.hourly ?? [],
    forecast: data.periods ?? [],
    alerts: data.alerts ?? [],
  };
}

// RFC 9727 / RFC 9264 API catalog (application/linkset+json).
function apiCatalog() {
  return {
    linkset: [
      {
        anchor: `${SITE}/api/weather`,
        "service-desc": [{ href: `${SITE}/openapi.json`, type: "application/json" }],
        "service-doc": [{ href: `${SITE}/`, type: "text/html" }],
        status: [{ href: `${SITE}/api/health`, type: "application/json" }],
      },
    ],
  };
}

// OpenAPI 3.1 description of the weather API.
function openApiSpec() {
  const HourlyPeriod = {
    type: "object",
    properties: {
      startTime: { type: "string", format: "date-time" },
      isDaytime: { type: "boolean" },
      temperature: { type: "number" },
      temperatureUnit: { type: "string" },
      shortForecast: { type: "string" },
      icon: { type: "string", format: "uri" },
    },
  };
  const Period = {
    type: "object",
    properties: {
      name: { type: "string" },
      isDaytime: { type: "boolean" },
      temperature: { type: "number" },
      temperatureUnit: { type: "string" },
      shortForecast: { type: "string" },
      detailedForecast: { type: "string" },
      windSpeed: { type: "string" },
      windDirection: { type: "string" },
      icon: { type: "string", format: "uri" },
    },
  };
  const Alert = {
    type: "object",
    properties: {
      event: { type: "string" },
      headline: { type: "string" },
      severity: { type: "string" },
      description: { type: "string" },
      instruction: { type: "string" },
      expires: { type: "string", format: "date-time" },
    },
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "crosbynews.com Weather API",
      version: "1.0.0",
      description:
        "Current conditions, hourly and 7-day forecast, and active alerts for Crosby, Texas, sourced from the U.S. National Weather Service. Public, no authentication.",
      contact: { url: `${SITE}/` },
      license: { name: "Public domain (NWS source data)", url: "https://www.weather.gov/disclaimer" },
    },
    servers: [{ url: SITE }],
    paths: {
      "/api/weather": {
        get: {
          operationId: "getWeather",
          summary: "Current conditions, forecast, and alerts for Crosby, TX",
          responses: {
            "200": {
              description: "Weather snapshot",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Weather" } } },
            },
            "502": { description: "Upstream (NWS) unavailable" },
          },
        },
      },
      "/api/health": {
        get: {
          operationId: "getHealth",
          summary: "Service health and cache freshness",
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { status: { type: "string" }, updated: { type: ["string", "null"], format: "date-time" } },
                    required: ["status"],
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Weather: {
          type: "object",
          properties: {
            location: { type: "string" },
            coordinates: { type: "object", properties: { lat: { type: "number" }, lon: { type: "number" } } },
            source: { type: "string" },
            updated: { type: "string", format: "date-time" },
            current: HourlyPeriod,
            hourly: { type: "array", items: HourlyPeriod },
            forecast: { type: "array", items: Period },
            alerts: { type: "array", items: Alert },
          },
        },
        HourlyPeriod,
        Period,
        Alert,
      },
    },
  };
}

// --- MCP server (Streamable HTTP transport) -------------------------------
// A stateless Model Context Protocol server exposing the weather as callable
// tools. Single endpoint at /mcp: POST a JSON-RPC message, get one back.
const MCP_PROTOCOL_VERSION = "2025-06-18";
const MCP_SERVER_INFO = { name: "crosbynews-weather", version: "1.0.0", title: "Crosby, TX Weather" };
const MCP_CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, mcp-protocol-version, mcp-session-id, authorization",
  "access-control-max-age": "86400",
};

const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

function mcpJson(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", "mcp-protocol-version": MCP_PROTOCOL_VERSION, ...MCP_CORS },
  });
}

function mcpTools() {
  return [
    {
      name: "get_current_conditions",
      title: "Current conditions",
      description: "Current weather for Crosby, TX: temperature, sky, and precip chance.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "get_forecast",
      title: "Forecast",
      description:
        "Forecast for Crosby, TX from the U.S. National Weather Service. Returns the 7-day day/night forecast, or upcoming hourly periods if `hours` is given.",
      inputSchema: {
        type: "object",
        properties: {
          hours: { type: "integer", minimum: 1, maximum: 12, description: "Return this many upcoming hourly periods instead of the daily forecast." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "get_alerts",
      title: "Active alerts",
      description: "Active NWS weather alerts for Crosby, TX. Returns an empty list when none are active.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
  ];
}

function mcpServerCard() {
  return {
    serverInfo: MCP_SERVER_INFO,
    protocolVersion: MCP_PROTOCOL_VERSION,
    description:
      "Live weather for Crosby, Texas (U.S. National Weather Service): current conditions, forecast, and active alerts.",
    transport: { type: "streamable-http", endpoint: `${SITE}/mcp` },
    capabilities: { tools: { listChanged: false } },
    tools: mcpTools().map((t) => ({ name: t.name, title: t.title, description: t.description })),
    documentation: `${SITE}/`,
  };
}

async function mcpCallTool(name, args, env) {
  const { data } = await loadWeather(env);
  if (name === "get_current_conditions") {
    const now = data.hourly?.[0] ?? null;
    const text = now
      ? `Crosby, TX: ${now.temperature}°${now.temperatureUnit}, ${now.shortForecast}` +
        `${pop(now) ? `, ${pop(now)}% precip` : ""} (as of ${clockTime(now.startTime)} CT).`
      : "Current conditions are unavailable.";
    return { content: [{ type: "text", text }], structuredContent: { location: data.place, updated: data.updated, current: now } };
  }
  if (name === "get_forecast") {
    const hours = Number(args?.hours) || 0;
    if (hours > 0) {
      const slice = (data.hourly ?? []).slice(0, Math.min(hours, 12));
      const text =
        slice.map((h) => `${hourLabel(h.startTime)}: ${h.temperature}°${h.temperatureUnit}, ${h.shortForecast}${pop(h) ? `, ${pop(h)}% precip` : ""}`).join("\n") ||
        "No hourly data.";
      return { content: [{ type: "text", text }], structuredContent: { location: data.place, hourly: slice } };
    }
    const text =
      (data.periods ?? [])
        .map((p) => `${p.name}: ${p.isDaytime ? "High" : "Low"} ${p.temperature}°${p.temperatureUnit}, ${p.shortForecast}. ${p.detailedForecast}`)
        .join("\n\n") || "No forecast data.";
    return { content: [{ type: "text", text }], structuredContent: { location: data.place, forecast: data.periods ?? [] } };
  }
  if (name === "get_alerts") {
    const alerts = data.alerts ?? [];
    const text = alerts.length
      ? alerts.map((a) => `${a.event}${a.headline ? ` — ${a.headline}` : ""}${a.expires ? ` (until ${fullTime(a.expires)} CT)` : ""}`).join("\n")
      : "No active weather alerts for Crosby, TX.";
    return { content: [{ type: "text", text }], structuredContent: { location: data.place, count: alerts.length, alerts } };
  }
  const err = new Error(`Unknown tool: ${name}`);
  err.code = -32602;
  throw err;
}

async function mcpHandle(msg, env) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return msg && msg.id != null ? rpcError(msg.id, -32600, "Invalid Request") : null;
  }
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  switch (method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: typeof params?.protocolVersion === "string" ? params.protocolVersion : MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: MCP_SERVER_INFO,
        instructions: "Live weather for Crosby, Texas from the U.S. National Weather Service.",
      });
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: mcpTools() });
    case "tools/call":
      try {
        const res = await mcpCallTool(params?.name, params?.arguments ?? {}, env);
        return rpcResult(id, res);
      } catch (e) {
        if (e && typeof e.code === "number") return rpcError(id, e.code, e.message);
        return rpcResult(id, { content: [{ type: "text", text: `Error: ${(e && e.message) || e}` }], isError: true });
      }
    default:
      // Notifications (e.g. notifications/initialized) get no response.
      if (!isRequest) return null;
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}
// --- end MCP server -------------------------------------------------------

// --- Agent Skills discovery (agentskills.io v0.2.0) -----------------------
const SKILLS_SCHEMA = "https://schemas.agentskills.io/discovery/0.2.0/schema.json";

// A real skill: it documents this site's actual public API + MCP server.
const CROSBY_WEATHER_SKILL = `---
name: crosby-weather
description: Get current conditions, forecast, and active weather alerts for Crosby, Texas (USA).
license: Public domain (U.S. National Weather Service source data)
---

# Crosby, TX Weather

Live weather for Crosby, Texas (lat 29.9119, lon -95.0608), sourced from the
U.S. National Weather Service and refreshed every 15 minutes.

## When to use this skill

Use it when a user asks about current conditions, the forecast, or active
weather alerts for Crosby, TX (or the northeast Houston / Crosby area).

## How to get the data

REST API (public, no auth):

- GET https://crosbynews.com/api/weather - JSON with these fields:
  - current  - latest conditions (temperature, shortForecast, wind, ...)
  - hourly   - next 12 hourly periods
  - forecast - 7-day day/night forecast
  - alerts   - active NWS alerts (empty array when none)
- GET https://crosbynews.com/api/health - status and cache freshness
- OpenAPI spec: https://crosbynews.com/openapi.json

MCP server (Streamable HTTP, JSON-RPC):

- Endpoint: https://crosbynews.com/mcp
- Tools: get_current_conditions, get_forecast (optional hours 1-12), get_alerts

## Notes

- Public and unauthenticated; no rate limits.
- Source data is public domain. Attribute "U.S. National Weather Service".
`;

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function agentSkillsIndex() {
  const digest = "sha256:" + (await sha256Hex(CROSBY_WEATHER_SKILL));
  return {
    $schema: SKILLS_SCHEMA,
    skills: [
      {
        name: "crosby-weather",
        type: "skill-md",
        description: "Get current conditions, forecast, and active weather alerts for Crosby, Texas.",
        url: "/.well-known/agent-skills/crosby-weather/SKILL.md",
        digest,
      },
    ],
  };
}
// --- end Agent Skills -----------------------------------------------------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/robots.txt") {
      return new Response(robotsTxt(), {
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
      });
    }
    if (path === "/sitemap.xml") {
      return new Response(sitemapXml(), {
        headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" },
      });
    }
    // Serve the favicon as a real file. Browsers and crawlers auto-request
    // /favicon.ico; serving it (as SVG) avoids needless 404s in crawl stats.
    if (path === "/favicon.ico" || path === "/favicon.svg") {
      return new Response(FAVICON_SVG, {
        headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=604800, immutable" },
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

    if (path === "/mcp") {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: MCP_CORS });
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST, OPTIONS", ...MCP_CORS } });
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

    if (path === "/api/weather") {
      try {
        const { data, cache } = await loadWeather(env);
        return new Response(JSON.stringify(apiWeather(data)), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "access-control-allow-origin": "*",
            "cache-control": "public, max-age=300",
            link: `<${SITE}/openapi.json>; rel="service-desc"; type="application/json"`,
            "x-cache": cache,
          },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "upstream_unavailable", message: err && err.message }), {
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
      const res = await fetch(upstream, {
        headers: { "User-Agent": "crosbynews.com", Accept: "image/png,image/*" },
        cf: { cacheTtl: 604800, cacheEverything: true },
      });
      if (!res.ok) {
        return new Response("Icon unavailable", { status: res.status === 404 ? 404 : 502 });
      }
      const headers = new Headers();
      headers.set("content-type", res.headers.get("content-type") || "image/png");
      // Cache hard at the edge and in the browser; icons are effectively static.
      headers.set("cache-control", "public, max-age=86400, s-maxage=604800, immutable");
      return new Response(res.body, { status: 200, headers });
    }

    // Single-document site: only the root serves the page.
    if (path !== "/") {
      return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
    }

    try {
      // loadWeather() reads the cache, refreshing on a missing/stale-shaped
      // entry so a deploy that changes the cached shape self-heals.
      const { data, cache } = await loadWeather(env);

      // Content negotiation: agents asking for markdown get markdown; the
      // default stays HTML for browsers. Vary: Accept keeps caches honest.
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";

      if (wantsMarkdown) {
        const md = renderMarkdown(data);
        return new Response(md, {
          headers: {
            "content-type": "text/markdown; charset=utf-8",
            "cache-control": "public, max-age=300",
            vary: "Accept",
            link: LINK_HEADER,
            "x-markdown-tokens": String(Math.ceil(md.length / 4)),
            "x-cache": cache,
          },
        });
      }

      return new Response(renderHtml(data), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=300",
          vary: "Accept",
          link: LINK_HEADER,
          "x-cache": cache,
        },
      });
    } catch (err) {
      return new Response(renderError(err), {
        status: 502,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },

  async scheduled(event, env, ctx) {
    const data = await fetchWeather();
    await env.WEATHER.put(KV_KEY, JSON.stringify(data));
  },
};
