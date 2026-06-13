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
    // Keep 48 hours: the homepage shows the first 12, /hourly shows them all.
    hourly: (hourly.properties.periods ?? []).slice(0, 48),
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
const dayLabel = (iso) => fmt(iso, { weekday: "long", month: "short", day: "numeric" });

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
        <h1 class="hero-h1">${esc(data.place)} Weather</h1>
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

// Shared CSS used by every HTML page (weather + about), so styling can't drift.
const BASE_CSS = `
  :root { color-scheme: light dark; --blue:#0b3d61; --accent:#2c7fb8; --sun:#f5b301; --bg:#eef2f6; --card:#fff; --ink:#16222e; --muted:#5a6b7b; --line:#d8dee5; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0f1620; --card:#1a2430; --ink:#e6ebf1; --muted:#94a3b2; --line:#2a3744; }
  }
  * { box-sizing: border-box; }
  body { margin:0; font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; line-height:1.5; background:var(--bg); color:var(--ink); }
  .topbar { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:0.4rem 1rem; background:var(--blue); color:#fff; padding:0.6rem 1rem; }
  .topbar a { color:#fff; text-decoration:none; }
  .topbar .brand { font-weight:800; letter-spacing:0.09em; text-transform:uppercase; font-size:1rem; }
  .topbar nav { display:flex; flex-wrap:wrap; gap:0.5rem 1rem; align-items:center; font-size:0.9rem; }
  .topbar nav a { opacity:0.85; white-space:nowrap; }
  .topbar nav a:hover, .topbar nav a[aria-current="page"] { opacity:1; text-decoration:underline; }
  @media (max-width:520px) {
    .topbar { gap:0.35rem 0.75rem; padding:0.55rem 0.85rem; }
    .topbar .brand { font-size:0.88rem; }
    .topbar nav { gap:0.4rem 0.85rem; font-size:0.86rem; }
  }
  main { max-width:920px; margin:0 auto; padding:1rem; }
  h2 { font-size:1.1rem; margin:1.4rem 0 0.6rem; }
  .none { color:var(--muted); font-style:italic; }
  footer { max-width:920px; margin:1rem auto; padding:0 1rem 2rem; font-size:0.8rem; color:var(--muted); text-align:center; }
  footer a { color:inherit; }
`;

// Site header with cross-page nav. \`current\` is the active path for aria-current.
function topbar(current) {
  const link = (href, label) =>
    `<a href="${href}"${current === href ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<header class="topbar">
  <a class="brand" href="/">crosbynews.com</a>
  <nav>${link("/", "Weather")} ${link("/hourly", "Hourly")} ${link("/radar", "Radar")} ${link("/alerts", "Alerts")} ${link("/news", "News")} ${link("/about", "About")}</nav>
</header>`;
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
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  .hero { display:flex; align-items:center; gap:1rem; background:linear-gradient(135deg,var(--blue),var(--accent)); color:#fff; border-radius:16px; padding:1.1rem 1.3rem; margin-top:0.5rem; }
  .hero-h1 { margin:0 0 0.15rem; font-size:1rem; font-weight:600; opacity:0.9; letter-spacing:0.01em; }
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
</style>
</head>
<body>
${topbar("/")}
<main>
  ${renderAlerts(data.alerts ?? [])}
  ${renderHero(data)}
  ${renderHourly((data.hourly ?? []).slice(0, 12))}
  ${renderDaily(data.periods ?? [])}
</main>
<footer>
  ${hasAlerts ? "" : "No active weather alerts. "}Data from the U.S. National Weather Service (<a href="https://weather.gov">weather.gov</a>).<br>
  Updated ${esc(fullTime(data.updated))} CT &middot; refreshes every 15 minutes. &middot; <a href="/about">About this site</a>
</footer>
<script>
// Auto-refresh the page every 15 minutes to keep the forecast current.
// (Done in JS rather than a meta-refresh http-equiv tag, which search engines
// flag.) Only reloads a foreground tab, so a background tab isn't thrashed.
setTimeout(function () {
  if (document.visibilityState === "visible") location.reload();
  else document.addEventListener("visibilitychange", function once() {
    if (document.visibilityState === "visible") { document.removeEventListener("visibilitychange", once); location.reload(); }
  });
}, 900000);

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

// /llms.txt — concise site summary for LLMs (llmstxt.org spec).
function llmsTxt() {
  return `# crosbynews.com

> Live weather and local news for Crosby, Texas — fast, no ads, no trackers.

crosbynews.com is an independent weather and news site for Crosby, TX (northeast Harris County). Weather data comes exclusively from the U.S. National Weather Service (api.weather.gov) and is refreshed every 15 minutes. Local news headlines are aggregated daily from Texas and Houston-area outlets and filtered for relevance to the Crosby community.

## Pages

- [Weather](${SITE}/): Current conditions, 12-hour hourly strip, and 7-day forecast for Crosby, TX.
- [Hourly](${SITE}/hourly): Full 48-hour hour-by-hour forecast table grouped by day.
- [Radar](${SITE}/radar): Live NWS KHGX (Houston-Galveston) radar loop covering Crosby and northeast Harris County.
- [Alerts](${SITE}/alerts): Active NWS weather alerts for Crosby, TX plus a plain-language severe-weather guide.
- [News](${SITE}/news): Recent local headlines about Crosby, TX and nearby communities, filtered for relevance.
- [About](${SITE}/about): What this site is, where data comes from, and how to access the API and MCP server.

## API & agent access

Every page supports \`Accept: text/markdown\` (or \`?format=md\`) for a clean markdown rendering.

- REST API: \`GET ${SITE}/api/weather\` — JSON with current conditions, hourly, 7-day forecast, and alerts. No auth.
- OpenAPI spec: \`${SITE}/openapi.json\`
- MCP server (Streamable HTTP): \`${SITE}/mcp\` — tools: \`get_current_conditions\`, \`get_forecast\`, \`get_alerts\`
- MCP server card: \`${SITE}/.well-known/mcp/server-card.json\`

## Data policy

Source data is U.S. government public domain (NWS). No authentication required. No rate limits. Attribution: "U.S. National Weather Service".
`;
}

// /robots.txt — RFC 9309 crawl rules, AI-crawler entries, Content Signals,
// and a sitemap reference. Open by design: this is public-domain NWS data and
// the site wants to be discoverable by agents.
function robotsTxt() {
  return `# crosbynews.com — robots.txt (RFC 9309)
# Crosby, TX weather, derived from the U.S. National Weather Service
# (public-domain data). Crawlers and AI agents are welcome.

User-agent: *
Allow: /
# Content-Signal: search=yes, ai-input=yes, ai-train=yes

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
  <url>
    <loc>${SITE}/hourly</loc>
    <lastmod>${today}</lastmod>
    <changefreq>hourly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${SITE}/radar</loc>
    <changefreq>daily</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>${SITE}/alerts</loc>
    <changefreq>hourly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>${SITE}/news</loc>
    <changefreq>daily</changefreq>
    <priority>0.6</priority>
  </url>
  <url>
    <loc>${SITE}/about</loc>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
</urlset>
`;
}

// --- About page -----------------------------------------------------------
// Static "what this site is" page. Content lives in one structured place so the
// HTML and markdown renderings can't drift. Strengthens E-E-A-T (clear source,
// authorship, and method) and gives the site a second indexable page.
const ABOUT = {
  title: "About crosbynews.com",
  description:
    "What crosbynews.com is, where its weather data comes from, how often it updates, and the public API and MCP server it offers.",
  intro:
    "crosbynews.com is a fast, no-frills weather page for Crosby, Texas. It shows current conditions, an hourly outlook, a 7-day forecast, and any active weather alerts — and nothing else. No ads, no trackers, no sign-up.",
  sections: [
    {
      h: "Where the data comes from",
      p: [
        "Every forecast, conditions reading, and alert on this site comes directly from the U.S. National Weather Service (api.weather.gov) for Crosby, TX (latitude 29.9119, longitude -95.0608). NWS data is in the public domain.",
        "We don't editorialize or adjust the numbers — the site is a clean presentation layer over the official government forecast for the Crosby area.",
      ],
    },
    {
      h: "How often it updates",
      p: [
        "The forecast and alerts are refreshed every 15 minutes from the National Weather Service. The page you load is served from a cached copy at the edge for speed, and an open browser tab reloads itself every 15 minutes to stay current.",
      ],
    },
    {
      h: "A weather API for developers and agents",
      p: [
        "The same data powering this page is available as a free, public, no-authentication JSON API:",
      ],
      links: [
        { href: "/api/weather", label: "/api/weather", note: "current conditions, hourly, 7-day forecast, and alerts (JSON)" },
        { href: "/api/health", label: "/api/health", note: "service status and cache freshness" },
        { href: "/openapi.json", label: "/openapi.json", note: "OpenAPI 3.1 description of the API" },
        { href: "/.well-known/api-catalog", label: "/.well-known/api-catalog", note: "RFC 9727 API catalog" },
      ],
    },
    {
      h: "Built for AI agents",
      p: [
        "This site is designed to be readable by AI agents as well as people. Every page is available as Markdown (send an Accept: text/markdown header, or add ?format=md to the URL), and there is a Model Context Protocol (MCP) server that exposes the weather as callable tools.",
      ],
      links: [
        { href: "/mcp", label: "/mcp", note: "MCP server (Streamable HTTP): get_current_conditions, get_forecast, get_alerts" },
        { href: "/.well-known/mcp/server-card.json", label: "MCP server card", note: "discovery metadata" },
        { href: "/?format=md", label: "This site as Markdown", note: "the weather page, rendered for agents" },
      ],
    },
    {
      h: "Disclaimer",
      p: [
        "crosbynews.com is an independent project and is not affiliated with the National Weather Service, NOAA, or any government agency. Always rely on official sources and local authorities for life-safety decisions during severe weather.",
      ],
    },
  ],
};

function aboutHtml() {
  const body = ABOUT.sections
    .map((s) => {
      const paras = (s.p || []).map((t) => `<p>${esc(t)}</p>`).join("\n      ");
      const links = s.links
        ? `<ul class="links">${s.links
            .map((l) => `<li><a href="${l.href}"><code>${esc(l.label)}</code></a> &mdash; ${esc(l.note)}</li>`)
            .join("")}</ul>`
        : "";
      return `      <section class="card">
        <h2>${esc(s.h)}</h2>
        ${paras}
        ${links}
      </section>`;
    })
    .join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(ABOUT.title)} &mdash; Crosby, TX Weather</title>
<meta name="description" content="${esc(ABOUT.description)}">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="${esc(ABOUT.title)}">
<meta property="og:description" content="${esc(ABOUT.description)}">
<meta property="og:type" content="website">
<link rel="canonical" href="${SITE}/about">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  .card { background:var(--card); border-radius:12px; padding:0.9rem 1.1rem; margin-top:1rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); }
  .card h2 { margin:0 0 0.5rem; }
  .card p { margin:0.5rem 0; }
  .lede { font-size:1.05rem; color:var(--ink); }
  .links { margin:0.5rem 0 0; padding-left:1.1rem; }
  .links li { margin:0.3rem 0; }
  code { background:color-mix(in srgb,var(--ink) 10%, transparent); padding:0.05rem 0.3rem; border-radius:4px; font-size:0.9em; }
</style>
</head>
<body>
${topbar("/about")}
<main>
  <h1>${esc(ABOUT.title)}</h1>
  <p class="lede">${esc(ABOUT.intro)}</p>
${body}
</main>
<footer>
  Data from the U.S. National Weather Service (<a href="https://weather.gov">weather.gov</a>). &middot; <a href="/">Back to the forecast</a>
</footer>
</body>
</html>`;
}

function aboutMarkdown() {
  const out = [`# ${ABOUT.title}`, "", ABOUT.intro, ""];
  for (const s of ABOUT.sections) {
    out.push(`## ${s.h}`, "");
    for (const t of s.p || []) out.push(t, "");
    for (const l of s.links || []) out.push(`- [${l.label}](${l.href}) — ${l.note}`);
    if (s.links) out.push("");
  }
  out.push("---", `[crosbynews.com](${SITE}/) · weather for Crosby, Texas`);
  return out.join("\n");
}
// --- end About page -------------------------------------------------------

// --- Radar page -----------------------------------------------------------
// Embeds the NOAA/NWS Houston-Galveston (KHGX) radar loop, which covers Crosby.
// The image is proxied through /radar-image so it lives on our crawlable origin
// and is edge-cached. Static-ish page; the image itself carries a short TTL.
function radarHtml() {
  const title = "Crosby, TX Weather Radar";
  const desc = "Live NWS weather radar loop for Crosby, Texas and the greater Houston area (KHGX), updated continuously.";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} &mdash; crosbynews.com</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<link rel="canonical" href="${SITE}/radar">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  .radar-wrap { margin-top:1rem; background:var(--card); border-radius:12px; padding:0.8rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); }
  .radar-wrap img { width:100%; height:auto; border-radius:8px; display:block; background:#000; }
  .radar-meta { margin:0.6rem 0 0; font-size:0.85rem; color:var(--muted); }
  .intro { color:var(--muted); margin:0.6rem 0 0; }
</style>
</head>
<body>
${topbar("/radar")}
<main>
  <h1>${esc(title)}</h1>
  <p class="intro">Live radar for the Crosby / northeast Houston area from the U.S. National Weather Service KHGX (Houston-Galveston) radar. The loop animates the most recent reflectivity scans, showing showers and thunderstorms moving across the region.</p>
  <div class="radar-wrap">
    <img src="/radar-image" alt="Animated NWS weather radar loop for Crosby, TX (KHGX)" width="600" height="550" loading="eager">
    <p class="radar-meta">Source: NOAA/NWS KHGX radar &middot; the loop refreshes as new scans publish (roughly every few minutes).</p>
  </div>
  <section class="card">
    <h2>Reading this radar</h2>
    <p>Color indicates precipitation intensity. Blues and greens are light rain; yellows and oranges are moderate; reds and purples indicate heavy rainfall or large hail. The animation plays the most recent reflectivity scans in sequence so you can see storms moving across the region.</p>
    <p>The KHGX radar is sited at Galveston Bay, roughly 40 miles south of Crosby, giving it a low-angle view of storms approaching from the Gulf. Crosby sits in northeast Harris County, a low-lying area that is especially prone to flash flooding during slow-moving Gulf Coast storms. A rotating hook echo or tight circulation on the southwest flank of a storm cell can indicate a tornado threat &mdash; check <a href="/alerts">active alerts</a> for any warnings already issued by the National Weather Service.</p>
    <p>During hurricane season (June&ndash;November) the radar helps track the outer rain bands of tropical systems well before they make landfall. The <a href="https://www.weather.gov/hgx/">NWS Houston/Galveston office</a> is the authoritative source for warnings and watches covering Crosby.</p>
  </section>
  <p class="intro"><a href="/">&larr; Back to the Crosby forecast</a></p>
</main>
<footer>
  Radar imagery from the U.S. National Weather Service (<a href="https://radar.weather.gov">radar.weather.gov</a>). &middot; <a href="/about">About this site</a>
</footer>
</body>
</html>`;
}

function radarMarkdown() {
  return [
    "# Crosby, TX Weather Radar",
    "",
    "Live NWS weather radar for the Crosby / northeast Houston area, from the U.S. National Weather Service KHGX (Houston-Galveston) radar.",
    "",
    `![Crosby TX radar loop](${SITE}/radar-image)`,
    "",
    "The loop animates the most recent reflectivity scans (refreshed every few minutes) so you can see showers and thunderstorms moving across the region.",
    "",
    "---",
    `[crosbynews.com](${SITE}/) · [forecast](${SITE}/) · [hourly](${SITE}/hourly)`,
  ].join("\n");
}
// --- end Radar page -------------------------------------------------------

// --- Hourly page ----------------------------------------------------------
// Full multi-day hourly forecast (the cache holds 48h; the homepage shows 12).
// Rows are grouped by day. Reuses the NWS hourly data already in KV.
function hourlyHtml(data) {
  const hours = data.hourly ?? [];
  const groups = [];
  for (const h of hours) {
    const day = dayLabel(h.startTime);
    let g = groups[groups.length - 1];
    if (!g || g.day !== day) {
      g = { day, rows: [] };
      groups.push(g);
    }
    g.rows.push(h);
  }
  const body = groups
    .map((g) => {
      const rows = g.rows
        .map(
          (h) => `<tr>
        <td>${esc(hourLabel(h.startTime))}</td>
        <td>${h.icon ? `<img src="${iconUrl(h.icon, "small")}" alt="${esc(h.shortForecast)}" width="32" height="32" loading="lazy"> ` : ""}${esc(h.shortForecast)}</td>
        <td class="num">${esc(h.temperature)}&deg;${esc(h.temperatureUnit)}</td>
        <td class="num${pop(h) >= 30 ? " wet" : ""}">${pop(h)}%</td>
        <td class="wind">${esc(h.windSpeed)} ${esc(h.windDirection)}</td>
      </tr>`
        )
        .join("\n");
      return `  <section class="day">
    <h2>${esc(g.day)}</h2>
    <table>
      <thead><tr><th>Time</th><th>Conditions</th><th class="num">Temp</th><th class="num">Precip</th><th>Wind</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </section>`;
    })
    .join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Crosby, TX Hourly Forecast &mdash; crosbynews.com</title>
<meta name="description" content="Hour-by-hour weather forecast for Crosby, Texas for the next two days, from the U.S. National Weather Service: temperature, conditions, precipitation chance, and wind.">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="Crosby, TX Hourly Forecast">
<meta property="og:description" content="Hour-by-hour forecast for Crosby, Texas from the National Weather Service.">
<meta property="og:type" content="website">
<link rel="canonical" href="${SITE}/hourly">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  .day { margin-top:1rem; background:var(--card); border-radius:12px; padding:0.5rem 0.9rem 0.9rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); }
  .day h2 { font-size:1.05rem; }
  table { width:100%; border-collapse:collapse; font-size:0.9rem; }
  th, td { text-align:left; padding:0.4rem 0.5rem; border-bottom:1px solid var(--line); vertical-align:middle; }
  th { font-size:0.78rem; text-transform:uppercase; letter-spacing:0.03em; color:var(--muted); }
  td img { vertical-align:middle; border-radius:4px; }
  .num { text-align:right; white-space:nowrap; }
  .wet { color:var(--accent); font-weight:700; }
  .wind { color:var(--muted); white-space:nowrap; }
  tr:last-child td { border-bottom:none; }
  .intro { color:var(--muted); margin:0.6rem 0 0; }
</style>
</head>
<body>
${topbar("/hourly")}
<main>
  <h1>Crosby, TX Hourly Forecast</h1>
  <p class="intro">Hour-by-hour forecast for Crosby, Texas from the U.S. National Weather Service, covering the next ${hours.length} hours. Updated ${esc(fullTime(data.updated))} CT.</p>
${body || '<p class="none">Hourly forecast is temporarily unavailable.</p>'}
  <p class="intro"><a href="/">&larr; Back to the Crosby forecast</a> &middot; <a href="/radar">Radar</a></p>
</main>
<footer>
  Data from the U.S. National Weather Service (<a href="https://weather.gov">weather.gov</a>). &middot; <a href="/about">About this site</a>
</footer>
</body>
</html>`;
}

function hourlyMarkdown(data) {
  const hours = data.hourly ?? [];
  const out = [
    "# Crosby, TX Hourly Forecast",
    "",
    `_Hour-by-hour forecast for Crosby, Texas (next ${hours.length} hours) — source: U.S. National Weather Service. Updated ${fullTime(data.updated)} CT._`,
    "",
  ];
  let curDay = "";
  for (const h of hours) {
    const day = dayLabel(h.startTime);
    if (day !== curDay) {
      curDay = day;
      out.push(`## ${day}`, "", "| Time | Conditions | Temp | Precip | Wind |", "| --- | --- | --- | --- | --- |");
    }
    const cell = (s) => String(s ?? "").replace(/\|/g, "/");
    out.push(`| ${hourLabel(h.startTime)} | ${cell(h.shortForecast)} | ${h.temperature}°${h.temperatureUnit} | ${pop(h)}% | ${cell(h.windSpeed)} ${cell(h.windDirection)} |`);
  }
  out.push("", "---", `[crosbynews.com](${SITE}/) · [forecast](${SITE}/) · [radar](${SITE}/radar)`);
  return out.join("\n");
}
// --- end Hourly page ------------------------------------------------------

// --- Alerts hub -----------------------------------------------------------
// Stable URL for active NWS alerts in Crosby. When nothing is active (the usual
// case) it stays substantial with an evergreen guide to the alert types common
// on the Texas Gulf Coast and what to do — so it isn't a thin/empty page.
const ALERT_GUIDE = [
  { event: "Tornado Warning", what: "A tornado is occurring or imminent (radar-indicated or spotted).", do: "Shelter immediately on the lowest floor, interior room, away from windows. Do not wait to see it." },
  { event: "Severe Thunderstorm Warning", what: "Damaging winds (58+ mph) and/or large hail are occurring or imminent.", do: "Move indoors, away from windows. Be ready for possible tornado warnings to follow." },
  { event: "Flash Flood Warning", what: "Rapid flooding is occurring or imminent — common with the area's heavy downpours.", do: "Move to higher ground. Never drive through flooded roads — turn around, don't drown." },
  { event: "Hurricane / Tropical Storm Warning", what: "Tropical-storm or hurricane conditions are expected within 36 hours — relevant in Gulf season (Jun–Nov).", do: "Follow local officials, finish preparations, and evacuate if told to." },
  { event: "Heat Advisory / Excessive Heat Warning", what: "Dangerous heat and humidity, frequent in a Gulf Coast summer.", do: "Hydrate, limit midday exertion, check on neighbors, and never leave anyone in a parked car." },
];

function alertsHtml(data) {
  const alerts = data.alerts ?? [];
  // The page's dominant message is the current status: a big reassuring green
  // panel when all-clear, or the active alerts when there are any.
  const status = alerts.length
    ? `<section class="alerts" aria-label="Active weather alerts">
    <div class="status status-alert">
      <span class="status-icon">&#9888;</span>
      <div><p class="status-title">${alerts.length} active weather ${alerts.length === 1 ? "alert" : "alerts"}</p>
      <p class="status-sub">for Crosby, TX &mdash; details below. Follow official guidance.</p></div>
    </div>${alerts
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
      .join("")}</section>`
    : `<div class="status status-ok" role="status">
    <span class="status-icon">&#10004;</span>
    <div><p class="status-title">All clear</p>
    <p class="status-sub">No active weather alerts for Crosby, TX right now. This page checks for new alerts every 15 minutes.</p></div>
  </div>`;

  // The guide is reference material, clearly framed as "what these mean" so the
  // alert names below the all-clear panel aren't mistaken for active warnings.
  const guide = ALERT_GUIDE.map(
    (g) => `
    <article class="ref">
      <h3>${esc(g.event)}</h3>
      <p class="ref-line"><span class="ref-label">Means</span> ${esc(g.what)}</p>
      <p class="ref-line"><span class="ref-label">Do</span> ${esc(g.do)}</p>
    </article>`
  ).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Crosby, TX Weather Alerts &mdash; crosbynews.com</title>
<meta name="robots" content="max-snippet:160">
<meta name="description" content="Active National Weather Service alerts, warnings, and watches for Crosby, Texas, plus a plain-language guide to what each severe-weather alert means and what to do.">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="Crosby, TX Weather Alerts">
<meta property="og:description" content="Active NWS alerts for Crosby, Texas and a plain-language severe-weather guide.">
<meta property="og:type" content="website">
<link rel="canonical" href="${SITE}/alerts">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  /* Big, calm status panel — the first thing you see. */
  .status { display:flex; align-items:center; gap:1rem; border-radius:16px; padding:1.4rem 1.5rem; margin-top:0.8rem; }
  .status-icon { font-size:2.6rem; line-height:1; flex:none; }
  .status-title { margin:0; font-size:1.7rem; font-weight:800; line-height:1.1; }
  .status-sub { margin:0.35rem 0 0; font-size:1rem; opacity:0.95; }
  .status-ok { background:linear-gradient(135deg,#1f8b4c,#2eb86a); color:#fff; }
  .status-alert { background:linear-gradient(135deg,#a3271b,#d44230); color:#fff; }

  /* Active-alert detail cards (only shown when alerts exist). */
  .alerts { display:grid; gap:0.6rem; margin-top:0.5rem; }
  .alert { background:#fff4f3; border-left:5px solid #c0392b; border-radius:10px; padding:0.8rem 1rem; }
  .alert h3 { margin:0 0 0.3rem; color:#a3271b; }
  .alert .headline { font-weight:700; }
  .alert .instruction { background:rgba(255,255,255,0.65); border-radius:6px; padding:0.5rem 0.7rem; }
  .alert .meta { font-size:0.8rem; color:var(--muted); }
  @media (prefers-color-scheme: dark) { .alert { background:#2a1715; } .alert .instruction { background:rgba(0,0,0,0.25); } }

  /* Reference section — deliberately calm/muted so it reads as a glossary,
     not as active warnings. */
  .ref-head { margin-top:2rem; }
  .ref-note { color:var(--muted); margin:0.5rem 0 1rem; font-size:0.95rem; line-height:1.55; }
  .ref-grid { display:grid; gap:0.5rem; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); margin-top:0.7rem; }
  .ref { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:0.7rem 0.9rem; }
  .ref h3 { margin:0 0 0.35rem; font-size:0.98rem; color:var(--muted); font-weight:700; }
  .ref-line { margin:0.25rem 0; font-size:0.85rem; }
  .ref-label { display:inline-block; min-width:3.1rem; font-size:0.7rem; text-transform:uppercase; letter-spacing:0.04em; font-weight:700; color:var(--accent); }
  .intro { color:var(--muted); margin:0.6rem 0 0; }
</style>
</head>
<body>
${topbar("/alerts")}
<main>
  <h1>Crosby, TX Weather Alerts</h1>
  ${status}
  <p class="intro"><a href="/">&larr; Back to the forecast</a> &middot; <a href="/radar">Radar</a> &middot; Official source: <a href="https://www.weather.gov/hgx/">NWS Houston/Galveston</a>. In an emergency, call 911.</p>

  <div data-nosnippet>
  <h2 class="ref-head">Severe Weather Guide</h2>
  <p class="ref-note">The guide below explains common NWS alert types in plain language &mdash; what each one means and what to do if one is issued. It&rsquo;s here for reference; no action is needed when the status above shows &ldquo;All clear.&rdquo; If an alert is active for Crosby, it will appear in the green panel at the top of this page. In any emergency, call&nbsp;911 and follow guidance from local officials and the <a href="https://www.weather.gov/hgx/">NWS Houston/Galveston</a> office.</p>
  <div class="ref-grid">${guide}</div>
  </div>
</main>
<footer>
  Data from the U.S. National Weather Service (<a href="https://weather.gov">weather.gov</a>). &middot; <a href="/about">About this site</a>
</footer>
</body>
</html>`;
}

function alertsMarkdown(data) {
  const alerts = data.alerts ?? [];
  const out = ["# Crosby, TX Weather Alerts", "", `_Active NWS alerts for Crosby, Texas. Updated ${fullTime(data.updated)} CT._`, ""];
  out.push("## Active alerts");
  if (alerts.length) {
    for (const a of alerts) {
      out.push(`### ${a.event}`);
      if (a.headline) out.push(`**${a.headline}**`, "");
      if (a.description) out.push(String(a.description).replace(/\s*\n\s*/g, " "), "");
      if (a.instruction) out.push(`What to do: ${String(a.instruction).replace(/\s*\n\s*/g, " ")}`, "");
      if (a.expires) out.push(`_In effect until ${fullTime(a.expires)} CT_`, "");
    }
  } else {
    out.push("None right now. ✓", "");
  }
  out.push("## Severe-weather guide (Texas Gulf Coast)", "");
  for (const g of ALERT_GUIDE) {
    out.push(`### ${g.event}`, `- **Means:** ${g.what}`, `- **Do:** ${g.do}`, "");
  }
  out.push("---", `Official source: NWS Houston/Galveston. In an emergency, call 911. · [crosbynews.com](${SITE}/)`);
  return out.join("\n");
}
// --- end Alerts hub -------------------------------------------------------

// --- Local news (rendered from KV; fetched out-of-band) ------------------
// The Worker is a pure renderer: /news serves the WEATHER KV "news" key,
// which is written by scripts/fetch-news.mjs run on a Claude routine. Google
// News (the only source with real Crosby coverage) blocks Cloudflare Worker
// IPs, but a routine environment can reach it — so the Worker never fetches
// news itself; it just renders what the routine wrote.
const NEWS_KV_KEY = "news";

// Read the routine-written news from KV (read-only; no live fetch).
async function loadNews(env) {
  const data = await env.WEATHER.get(NEWS_KV_KEY, "json");
  return data && Array.isArray(data.items) ? data : { updated: null, items: [] };
}

function newsDate(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

function newsList(items) {
  return `<ul class="news-list">${items
    .map(
      (n) => `
      <li class="news-item">
        <a class="news-title" href="${esc(n.link)}" target="_blank" rel="noopener nofollow">${esc(n.title)}</a>
        <p class="news-meta">${esc(n.source)}${n.source && n.ts ? " &middot; " : ""}${esc(newsDate(n.ts))}</p>
      </li>`
    )
    .join("")}</ul>`;
}

function newsHtml(data) {
  const items = data.items ?? [];
  const community = items.filter((n) => !n.crime);
  const incidents = items.filter((n) => n.crime);
  const list = items.length
    ? `${community.length ? newsList(community) : ""}${
        incidents.length
          ? `<h2 class="incidents-head">Public safety &amp; incidents</h2>${newsList(incidents)}`
          : ""
      }`
    : `<p class="none">No recent Crosby news right now. This page refreshes automatically.</p>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Crosby, TX News &mdash; crosbynews.com</title>
<meta name="description" content="Recent local news headlines for Crosby, Texas, gathered from Texas and Houston-area news sources and filtered for relevance to the Crosby community.">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="Crosby, TX News">
<meta property="og:description" content="Recent local news headlines for Crosby, Texas.">
<meta property="og:type" content="website">
<link rel="canonical" href="${SITE}/news">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  .news-list { list-style:none; padding:0; margin:1rem 0 0; }
  .news-item { background:var(--card); border-radius:10px; padding:0.7rem 0.95rem; margin-bottom:0.6rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); }
  .news-title { font-weight:600; color:var(--ink); text-decoration:none; display:block; }
  .news-title:hover { text-decoration:underline; color:var(--accent); }
  .news-meta { margin:0.3rem 0 0; font-size:0.8rem; color:var(--muted); }
  .incidents-head { font-size:0.95rem; color:var(--muted); margin-top:1.6rem; border-top:1px solid var(--line); padding-top:0.9rem; }
  .intro { color:var(--muted); margin:0.6rem 0 0; }
  .disclaimer { margin-top:1.4rem; font-size:0.8rem; color:var(--muted); border-top:1px solid var(--line); padding-top:0.7rem; }
</style>
</head>
<body>
${topbar("/news")}
<main>
  <h1>Crosby, TX News</h1>
  <p class="intro">Recent headlines about Crosby, Texas and the Crosby ISD community, gathered automatically from Texas and Houston-area news outlets and filtered for relevance to Crosby. Links open the original source.${data.updated ? ` Last updated ${esc(newsDate(data.updated))}.` : ""}</p>
  ${list}
  <section class="card">
    <h2>About Crosby, Texas</h2>
    <p>Crosby is a community in northeast Harris County, Texas, situated along the San Jacinto River corridor between Houston and Baytown. The area includes Barrett Station and surrounding neighborhoods in the 77532 zip code. Crosby ISD serves the local schools, including Crosby High School, home of the Cougars.</p>
    <p>The community regularly experiences Gulf Coast weather events &mdash; tropical storms, flash flooding, and severe thunderstorms &mdash; making it a distinct news beat separate from the wider Houston metro. Stories here focus on Crosby and the nearby northeast Harris County communities of Huffman, Highlands, Channelview, and Atascocita.</p>
    <p class="disclaimer">Headlines are aggregated from public news sources and filtered to stories about Crosby, TX and nearby communities. crosbynews.com isn&rsquo;t the publisher &mdash; each link goes to the original outlet. Spotted something off-topic? It&rsquo;s automated filtering and we tune it over time.</p>
  </section>
  <p class="intro"><a href="/">&larr; Back to the forecast</a></p>
</main>
<footer>
  Weather data from the U.S. National Weather Service. News headlines aggregated from public sources. &middot; <a href="/about">About this site</a>
</footer>
</body>
</html>`;
}

function newsMarkdown(data) {
  const items = data.items ?? [];
  const out = ["# Crosby, TX News", "", `_Recent headlines about Crosby, Texas, filtered for local relevance. Updated ${fullTime(data.updated)} CT._`, ""];
  const row = (n) => `- [${n.title}](${n.link})${n.source ? ` — ${n.source}` : ""}${n.ts ? ` (${newsDate(n.ts)})` : ""}`;
  if (items.length) {
    const community = items.filter((n) => !n.crime);
    const incidents = items.filter((n) => n.crime);
    for (const n of community) out.push(row(n));
    if (incidents.length) {
      out.push("", "## Public safety & incidents", "");
      for (const n of incidents) out.push(row(n));
    }
  } else {
    out.push("No recent Crosby news right now.");
  }
  out.push("", "---", `Headlines aggregated from public sources, filtered for Crosby, TX. · [crosbynews.com](${SITE}/)`);
  return out.join("\n");
}
// --- end Local news -------------------------------------------------------

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

  const hourly = (data.hourly ?? []).slice(0, 12);
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
    hourly: (data.hourly ?? []).slice(0, 12),
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
      windSpeed: { type: "string" },
      windDirection: { type: "string" },
      windGust: { type: "string" },
      probabilityOfPrecipitation: { type: "object", properties: { value: { type: ["number", "null"] } } },
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
      probabilityOfPrecipitation: { type: "object", properties: { value: { type: ["number", "null"] } } },
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

// Human-facing explainer shown when a browser opens /mcp (which only speaks
// POST JSON-RPC). Lists the tools and how to connect.
function mcpInfoHtml() {
  const tools = mcpTools()
    .map((t) => `<li><code>${esc(t.name)}</code> &mdash; ${esc(t.description)}</li>`)
    .join("\n      ");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MCP Server &mdash; crosbynews.com</title>
<meta name="description" content="Model Context Protocol (MCP) server for Crosby, TX weather: connect an AI agent to get live conditions, forecast, and alerts.">
<meta name="theme-color" content="#0b3d61">
<meta name="robots" content="noindex">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  .card { background:var(--card); border-radius:12px; padding:0.9rem 1.1rem; margin-top:1rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); }
  .card h2 { margin:0 0 0.5rem; }
  code { background:color-mix(in srgb,var(--ink) 10%, transparent); padding:0.05rem 0.3rem; border-radius:4px; font-size:0.9em; }
  pre { background:color-mix(in srgb,var(--ink) 8%, transparent); padding:0.8rem; border-radius:8px; overflow-x:auto; font-size:0.85rem; }
  .intro { color:var(--muted); margin:0.6rem 0 0; }
  ul { padding-left:1.1rem; } li { margin:0.3rem 0; }
</style>
</head>
<body>
${topbar("")}
<main>
  <h1>MCP Server</h1>
  <p class="intro">This is the Model Context Protocol (MCP) endpoint for crosbynews.com. It is meant for AI agents, not browsers &mdash; it speaks JSON-RPC over HTTP POST, which is why loading it directly shows a "Method Not Allowed" message. This page just explains what it is.</p>
  <section class="card">
    <h2>Endpoint</h2>
    <p><code>${SITE}/mcp</code> &middot; transport: Streamable HTTP (JSON-RPC 2.0). Discovery card: <a href="/.well-known/mcp/server-card.json">/.well-known/mcp/server-card.json</a>.</p>
  </section>
  <section class="card">
    <h2>Tools</h2>
    <ul>
      ${tools}
    </ul>
  </section>
  <section class="card">
    <h2>Connect from Claude Code</h2>
    <pre>claude mcp add --transport http crosbynews ${SITE}/mcp</pre>
    <p class="intro">Then ask, e.g., "what's the forecast for Crosby, TX?" and the agent will call these tools. Prefer a webpage? See the <a href="/">live forecast</a>, <a href="/hourly">hourly</a>, and <a href="/radar">radar</a>.</p>
  </section>
</main>
<footer>
  Data from the U.S. National Weather Service (<a href="https://weather.gov">weather.gov</a>). &middot; <a href="/about">About this site</a>
</footer>
</body>
</html>`;
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
      // Any GET to /mcp returns a human-friendly explainer. The MCP protocol itself uses POST.
      if (request.method === "GET") {
        return new Response(mcpInfoHtml(), {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600", allow: "POST, OPTIONS", ...MCP_CORS },
        });
      }
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

    // About page — content-negotiated like the homepage (HTML, or Markdown for
    // agents via Accept: text/markdown / ?format=md). Static, so cache longer.
    if (path === "/about") {
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
      if (wantsMarkdown) {
        return new Response(aboutMarkdown(), {
          headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=3600", vary: "Accept" },
        });
      }
      return new Response(aboutHtml(), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600", vary: "Accept" },
      });
    }

    // Radar page — static HTML/markdown; the radar image is a separate proxy.
    if (path === "/radar") {
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
      const bodyText = wantsMarkdown ? radarMarkdown() : radarHtml();
      return new Response(bodyText, {
        headers: {
          "content-type": `${wantsMarkdown ? "text/markdown" : "text/html"}; charset=utf-8`,
          "cache-control": "public, max-age=3600",
          vary: "Accept",
        },
      });
    }

    // Proxy the NWS KHGX radar loop through our origin so it's crawlable and
    // edge-cached. Locked to that single upstream image (not an open proxy).
    if (path === "/radar-image") {
      const res = await fetch("https://radar.weather.gov/ridge/standard/KHGX_loop.gif", {
        headers: { "User-Agent": "crosbynews.com", Accept: "image/gif,image/*" },
        cf: { cacheTtl: 180, cacheEverything: true },
      });
      if (!res.ok) return new Response("Radar unavailable", { status: 502 });
      const headers = new Headers();
      headers.set("content-type", res.headers.get("content-type") || "image/gif");
      // Radar updates every few minutes; cache briefly at the edge and browser.
      headers.set("cache-control", "public, max-age=120, s-maxage=180");
      return new Response(res.body, { status: 200, headers });
    }

    // Hourly forecast page — full multi-day table from the cached NWS data.
    if (path === "/hourly") {
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
      try {
        const { data } = await loadWeather(env);
        const bodyText = wantsMarkdown ? hourlyMarkdown(data) : hourlyHtml(data);
        return new Response(bodyText, {
          headers: {
            "content-type": `${wantsMarkdown ? "text/markdown" : "text/html"}; charset=utf-8`,
            "cache-control": "public, max-age=300",
            vary: "Accept",
          },
        });
      } catch (err) {
        return new Response(renderError(err), { status: 502, headers: { "content-type": "text/html; charset=utf-8" } });
      }
    }

    // Alerts hub — active NWS alerts plus an evergreen severe-weather guide.
    if (path === "/alerts") {
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
      try {
        const { data } = await loadWeather(env);
        const bodyText = wantsMarkdown ? alertsMarkdown(data) : alertsHtml(data);
        return new Response(bodyText, {
          headers: {
            "content-type": `${wantsMarkdown ? "text/markdown" : "text/html"}; charset=utf-8`,
            "cache-control": "public, max-age=300",
            vary: "Accept",
          },
        });
      } catch (err) {
        return new Response(renderError(err), { status: 502, headers: { "content-type": "text/html; charset=utf-8" } });
      }
    }

    // Local news — aggregated + relevance-filtered headlines about Crosby, TX.
    if (path === "/news") {
      const accept = (request.headers.get("accept") || "").toLowerCase();
      const wantsMarkdown = accept.includes("text/markdown") || url.searchParams.get("format") === "md";
      try {
        const data = await loadNews(env);
        const bodyText = wantsMarkdown ? newsMarkdown(data) : newsHtml(data);
        return new Response(bodyText, {
          headers: {
            "content-type": `${wantsMarkdown ? "text/markdown" : "text/html"}; charset=utf-8`,
            "cache-control": "public, max-age=900",
            vary: "Accept",
          },
        });
      } catch (err) {
        return new Response(renderError(err), { status: 502, headers: { "content-type": "text/html; charset=utf-8" } });
      }
    }

    // Otherwise only the root serves a page.
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
}

export default {
  async fetch(request, env, ctx) {
    const resp = await _fetch(request, env, ctx);
    const r = new Response(resp.body, resp);
    r.headers.set("strict-transport-security", "max-age=63072000; includeSubDomains");
    r.headers.set("x-frame-options", "SAMEORIGIN");
    return r;
  },

  async scheduled(event, env, ctx) {
    // Refresh the weather cache. News is NOT fetched here — it's written to the
    // KV "news" key out-of-band by scripts/fetch-news.mjs (a Claude routine),
    // because Google News blocks Worker IPs. The Worker only renders that key.
    try {
      const data = await fetchWeather();
      await env.WEATHER.put(KV_KEY, JSON.stringify(data));
    } catch (e) {
      console.error("Cron weather refresh failed:", e && e.stack);
    }
  },
};
