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


// --- RSS feeds (RSS 2.0) ----------------------------------------------------
// /alerts.xml and /news.xml — the no-accounts, no-tracking notification
// channel: feed readers (and automations built on them) get storm alerts and
// curated town news without the site knowing who they are. English-only,
// like the API. Rendered from the same KV data as the HTML pages.

function alertsRss(data) {
  const items = (data.alerts ?? [])
    .map(
      (a) => `
  <item>
    <title>${esc(a.event || "Weather alert")}</title>
    <link>${SITE}/alerts</link>
    <guid isPermaLink="false">${esc(a.id || `${a.event} ${a.sent || a.effective || ""}`)}</guid>
    <pubDate>${rssDate(a.sent || a.effective || data.updated)}</pubDate>
    <description>${esc([a.headline, a.description, a.instruction ? `What to do: ${a.instruction}` : ""].filter(Boolean).join("\n\n"))}</description>
  </item>`
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Crosby, TX Weather Alerts — crosbynews.com</title>
  <link>${SITE}/alerts</link>
  <description>Active National Weather Service alerts for Crosby, Texas. The feed is empty when no alerts are active — items appear only when NWS issues one. Not a substitute for official warning channels.</description>
  <language>en-us</language>
  <ttl>15</ttl>
  <lastBuildDate>${rssDate(data.updated)}</lastBuildDate>${items}
</channel>
</rss>
`;
}
// --- end RSS feeds ----------------------------------------------------------

// /llms.txt — concise site summary for LLMs (llmstxt.org spec).
function llmsTxt() {
  return `# crosbynews.com

> Live weather and local news for Crosby, Texas — fast, no ads, no trackers.

crosbynews.com is an independent weather and news site for Crosby, TX (northeast Harris County). Weather data comes exclusively from the U.S. National Weather Service (api.weather.gov) and is refreshed every 15 minutes. Local news headlines are aggregated daily from Texas and Houston-area outlets and filtered for relevance to the Crosby community.

## Pages

- [Home](${SITE}/): The Crosby, TX front page — current conditions, water levels, local news, and school events at a glance, linking into each full section.
- [Weather](${SITE}/weather): Current conditions, 12-hour hourly strip, and 7-day forecast for Crosby, TX.
- [Hourly](${SITE}/hourly): Full 48-hour hour-by-hour forecast table grouped by day.
- [Radar](${SITE}/radar): Live NWS KHGX (Houston-Galveston) radar loop covering Crosby and northeast Harris County.
- [Alerts](${SITE}/alerts): Active NWS weather alerts for Crosby, TX plus a plain-language severe-weather guide.
- [Water Levels](${SITE}/water): Live river and bayou levels with NWS flood stages for Cedar Bayou, the San Jacinto River, Luce Bayou and other waters that flood the Crosby / NE Harris County area.
- [Fishing Conditions](${SITE}/fishing): Live USGS water conditions — temperature, dissolved oxygen, pH, and clarity — for the waters people fish near Crosby: Lake Houston, the San Jacinto River forks, the Trinity River, and nearby bayous.
- [Tropics](${SITE}/tropics): Active Atlantic tropical storms and hurricanes from the NOAA National Hurricane Center, plus what hurricane season means for Crosby — shows an all-clear when the basin is quiet.
- [Pollen & Mold](${SITE}/pollen): The Houston Health Department's measured daily pollen and mold count (tree, weed, and grass pollen plus mold spores, National Allergy Bureau scale) with the species actually counted — a real measurement, published weekday mornings, regionally valid for Crosby.
- [Air Quality](${SITE}/air): Measured US Air Quality Index (AQI) for the Houston-Galveston-Brazoria reporting area that includes Crosby, from EPA/AirNow monitors, with a per-pollutant breakdown and health guidance (Open-Meteo modeled fallback when AirNow isn't reporting).
- [News](${SITE}/news): Recent local headlines about Crosby, TX and nearby communities, filtered for relevance.
- [Roads & Traffic](${SITE}/traffic): Live traffic incidents and scheduled lane closures for US-90, FM-2100, FM-1942, and the Crosby stretch of IH-10 East, from Houston TranStar, with links to the live traffic cameras.
- [School Calendar](${SITE}/calendar): Upcoming Crosby ISD school calendar events (first day, holidays, no-school/early-release days, testing, athletics) rendered from the district's public iCal feed, plus one-tap subscribe links.
- [Emergency Resources](${SITE}/emergency): Emergency contacts for Crosby, TX — 911 and non-emergency numbers, power outage and gas leak reporting, the CAER industrial-incident line, live flood and road conditions, evacuation-zone lookup, shelters, and disaster assistance.
- [About](${SITE}/about): What this site is, where its data comes from, how often it updates, and how it's built.
- [Developers & Agents](${SITE}/developers): The public JSON API, OpenAPI spec, MCP server, RSS feeds, agent skills, and Markdown views — all in one place, no authentication.
- [Privacy](${SITE}/privacy): Privacy policy — no cookies, no trackers, no personal data.
- [Contact](${SITE}/contact): How to reach us — general inquiries and security reporting.
- [Sitemap](${SITE}/sitemap): Human-readable site map with every page and endpoint.

## Languages

Every page is also available in Mexican Spanish (es-MX) under the /es prefix — e.g. ${SITE}/es, ${SITE}/es/hourly, ${SITE}/es/alerts, ${SITE}/es/about. The English and Spanish URLs are linked with hreflang. Forecast conditions are translated with a hand-built dictionary; detailed NWS forecast descriptions and weather alerts remain in official English (NWS publishes no Spanish forecast/alert API). The JSON API and MCP server are English-only.

## API & agent access

Every page supports \`Accept: text/markdown\` (or \`?format=md\`) for a clean markdown rendering.

- REST API: \`GET ${SITE}/api/weather\` — JSON with current conditions, hourly, 7-day forecast, alerts, sun times, the EPA UV index, and a measured air-quality index from EPA/AirNow monitors (Houston metro reporting area; \`measured:true\`, with an Open-Meteo modeled fallback). No auth.
- Air quality API: \`GET ${SITE}/api/air\` — the measured AQI + per-pollutant breakdown (JSON).
- News API: \`GET ${SITE}/api/news\` — recent Crosby-area headlines (JSON).
- School calendar API: \`GET ${SITE}/api/calendar\` — upcoming Crosby ISD events (JSON).
- Water levels API: \`GET ${SITE}/api/water\` — river/bayou stage + NWS flood stages (JSON).
- Tropics API: \`GET ${SITE}/api/tropics\` — active Atlantic tropical cyclones from the NOAA NHC (JSON; empty storms array = quiet basin).
- Traffic API: \`GET ${SITE}/api/traffic\` — incidents and lane closures on Crosby's roads from Houston TranStar (JSON; empty arrays = quiet roads).
- Pollen API: \`GET ${SITE}/api/pollen\` — the Houston Health Department's measured daily pollen and mold count (JSON; weekday mornings).
- OpenAPI spec: \`${SITE}/openapi.json\`
- MCP server (Streamable HTTP): \`${SITE}/mcp\` — tools: \`get_current_conditions\`, \`get_forecast\`, \`get_alerts\`, \`get_tropical_outlook\`, \`get_pollen\`, \`get_air_quality\`, \`get_river_levels\`, \`get_fishing\`, \`get_traffic\`, \`get_crosby_news\`, \`get_school_events\`, \`get_emergency_contacts\`, \`get_radar\`
- MCP server card: \`${SITE}/.well-known/mcp/server-card.json\`

## Data policy

Source data is U.S. government public domain (NWS). No authentication required. No rate limits. Attribution: "U.S. National Weather Service".

## Optional

- [Alerts RSS](${SITE}/alerts.xml): Active NWS weather alerts as an RSS 2.0 feed (empty when all clear).
- [News RSS](${SITE}/news.xml): Curated Crosby-area headlines as an RSS 2.0 feed.
- [Weather badge](${SITE}/badge.svg): Hotlinkable live SVG badge — current temperature, conditions, feels-like, and an alert flag.
- [Sitemap](${SITE}/sitemap.xml): All pages in both languages, with hreflang alternates.
- [API catalog](${SITE}/.well-known/api-catalog): Machine-readable index of the API endpoints (RFC 9727 linkset).
- [Security contact](${SITE}/.well-known/security.txt): How to report a security issue (RFC 9116).
`;
}

// /robots.txt — RFC 9309 crawl rules, explicit AI-crawler entries, and a
// sitemap reference. Open by design: this is public-domain NWS data and the
// site wants to be discoverable by agents. (No Content-Signal line — it
// confused some crawlers when present, so it's intentionally omitted.)
function robotsTxt() {
  return `# crosbynews.com — robots.txt (RFC 9309)
# Crosby, TX weather, derived from the U.S. National Weather Service
# (public-domain data). Crawlers and AI agents are welcome.

User-agent: *
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

User-agent: Claude-SearchBot
Allow: /

User-agent: anthropic-ai
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: CCBot
Allow: /

User-agent: cohere-ai
Allow: /

Sitemap: ${SITE}/sitemap.xml
`;
}

// /sitemap.xml — every page in both languages. Each <url> carries xhtml:link
// alternates (en-US, es-MX, x-default → English) so Google ties the English and
// Spanish versions together, the same pairing the in-page hreflang tags assert.
function sitemapXml() {
  const today = new Date().toISOString().slice(0, 10);
  const pages = [
    { path: "/", changefreq: "hourly", priority: "1.0", lastmod: true },
    { path: "/weather", changefreq: "hourly", priority: "0.9", lastmod: true },
    { path: "/hourly", changefreq: "hourly", priority: "0.8", lastmod: true },
    { path: "/radar", changefreq: "daily", priority: "0.7" },
    { path: "/alerts", changefreq: "hourly", priority: "0.7" },
    { path: "/water", changefreq: "hourly", priority: "0.7" },
    { path: "/tropics", changefreq: "daily", priority: "0.6" },
    { path: "/pollen", changefreq: "daily", priority: "0.6" },
    { path: "/air", changefreq: "hourly", priority: "0.6" },
    { path: "/fishing", changefreq: "hourly", priority: "0.6" },
    { path: "/news", changefreq: "daily", priority: "0.6" },
    { path: "/traffic", changefreq: "hourly", priority: "0.6" },
    { path: "/calendar", changefreq: "daily", priority: "0.6" },
    { path: "/emergency", changefreq: "monthly", priority: "0.5" },
    { path: "/about", changefreq: "monthly", priority: "0.5" },
    { path: "/developers", changefreq: "monthly", priority: "0.4" },
    { path: "/privacy", changefreq: "monthly", priority: "0.3" },
    { path: "/contact", changefreq: "monthly", priority: "0.3" },
    { path: "/sitemap", changefreq: "monthly", priority: "0.3" },
  ];
  const entry = (loc, page) => {
    const en = SITE + page.path;
    const es = SITE + esPath(page.path);
    const alts =
      `\n    <xhtml:link rel="alternate" hreflang="en-US" href="${en}"/>` +
      `\n    <xhtml:link rel="alternate" hreflang="es-MX" href="${es}"/>` +
      `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${en}"/>`;
    const lastmod = page.lastmod ? `\n    <lastmod>${today}</lastmod>` : "";
    return `  <url>
    <loc>${loc}</loc>${lastmod}
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>${alts}
  </url>`;
  };
  const urls = [];
  for (const page of pages) {
    urls.push(entry(SITE + page.path, page));
    urls.push(entry(SITE + esPath(page.path), page));
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join("\n")}
</urlset>
`;
}



// --- Local news (rendered from KV; fetched out-of-band) ------------------
// --- end Local news -------------------------------------------------------

// --- Crosby ISD school calendar (iCal, cron-owned KV) --------------------
// --- end Crosby ISD school calendar ---------------------------------------







// RFC 9727 / RFC 9264 API catalog (application/linkset+json).
function apiCatalog() {
  const entry = (anchor, doc) => ({
    anchor: `${SITE}${anchor}`,
    "service-desc": [{ href: `${SITE}/openapi.json`, type: "application/json" }],
    "service-doc": [{ href: `${SITE}${doc}`, type: "text/html" }],
    status: [{ href: `${SITE}/api/health`, type: "application/json" }],
  });
  return {
    linkset: [entry("/api/weather", "/"), entry("/api/news", "/news"), entry("/api/calendar", "/calendar"), entry("/api/water", "/water"), entry("/api/fishing", "/fishing"), entry("/api/tropics", "/tropics"), entry("/api/pollen", "/pollen"), entry("/api/air", "/air"), entry("/api/traffic", "/traffic")],
  };
}

// OpenAPI 3.1 description of the weather API.
function openApiSpec() {
  const HourlyPeriod = {
    type: "object",
    // The NWS payload is passed through verbatim and carries more fields than
    // are called out here (number, name, dewpoint, relativeHumidity, ...).
    additionalProperties: true,
    properties: {
      number: { type: "integer" },
      name: { type: "string" },
      startTime: { type: "string", format: "date-time" },
      endTime: { type: "string", format: "date-time" },
      isDaytime: { type: "boolean" },
      temperature: { type: "number" },
      temperatureUnit: { type: "string" },
      temperatureTrend: { type: ["string", "null"] },
      shortForecast: { type: "string" },
      windSpeed: { type: "string" },
      windDirection: { type: "string" },
      windGust: { type: "string" },
      probabilityOfPrecipitation: { type: "object", properties: { value: { type: ["number", "null"] } } },
      icon: { type: "string", format: "uri" },
      feelsLike: {
        type: ["number", "null"],
        description: "Heat index or wind chill in °F, computed from temperature/humidity/wind using NWS's own formulas. Not an NWS field — null when neither applies.",
      },
    },
  };
  const Period = {
    type: "object",
    additionalProperties: true,
    properties: {
      number: { type: "integer" },
      startTime: { type: "string", format: "date-time" },
      endTime: { type: "string", format: "date-time" },
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
  const NewsItem = {
    type: "object",
    properties: {
      title: { type: "string" },
      link: { type: "string", format: "uri" },
      source: { type: ["string", "null"] },
      published: { type: ["string", "null"], format: "date-time" },
      category: { type: "string", enum: ["community", "incident"] },
    },
  };
  const SchoolEvent = {
    type: "object",
    properties: {
      summary: { type: "string" },
      location: { type: ["string", "null"] },
      start: {
        type: "string",
        description: "All-day events: a date (YYYY-MM-DD). Timed events: zone-less ISO 8601 local time (America/Chicago wall-clock, as authored by the district).",
      },
      end: { type: ["string", "null"] },
      allDay: { type: "boolean" },
    },
  };
  const Storm = {
    type: "object",
    properties: {
      id: { type: "string", description: "NHC storm id (e.g. al052026). Atlantic basin only." },
      name: { type: "string" },
      classification: { type: "string", description: "NHC classification code: TD/TS/HU/MH/STD/STS/PTC/PC/RL." },
      classificationLabel: { type: "string", description: "Human-readable classification (e.g. Hurricane, Tropical Storm)." },
      windMph: { type: ["integer", "null"], description: "Max sustained winds in mph, rounded to 5 like NHC advisories (converted from NHC's knots)." },
      intensityKt: { type: ["number", "null"], description: "Max sustained winds in knots, as NHC reports them." },
      pressureMb: { type: ["number", "null"] },
      lat: { type: ["number", "null"] },
      lon: { type: ["number", "null"] },
      movementDirection: { type: ["string", "null"], description: "Compass direction of movement (speed omitted — NHC's unit for it is not clearly documented)." },
      lastUpdate: { type: ["string", "null"], format: "date-time" },
      advisoryUrl: { type: "string", format: "uri", description: "The official NHC public advisory." },
    },
  };
  const Gauge = {
    type: "object",
    properties: {
      id: { type: "string", description: "NWPS location ID (e.g. HCDT2)." },
      name: { type: "string" },
      usgsId: { type: ["string", "null"] },
      stage: { type: ["number", "null"], description: "Observed gauge height, in stageUnit; null when the gauge is offline." },
      stageUnit: { type: "string" },
      flow: { type: ["number", "null"], description: "Observed discharge in cubic feet per second." },
      flowUnit: { type: "string" },
      category: { type: "string", description: "NWS flood category. no_flooding/action/minor/moderate/major where NWS defines flood stages; not_defined for gauges without them (e.g. reservoir levels).", enum: ["no_flooding", "action", "minor", "moderate", "major", "not_defined", "unknown"] },
      validTime: { type: ["string", "null"], format: "date-time" },
      thresholds: { type: "object", description: "NWS flood-stage thresholds in thresholdUnit; only the categories NWS defines for this gauge are present.", additionalProperties: { type: "number" } },
      thresholdUnit: { type: "string" },
      officialUrl: { type: "string", format: "uri" },
    },
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "crosbynews.com API",
      version: "1.5.0",
      description:
        "Crosby, Texas community data: current conditions, hourly and 7-day forecast, active alerts, the EPA UV index, and a measured air-quality index (EPA/AirNow monitors, with an Open-Meteo modeled fallback) from the U.S. National Weather Service, EPA/AirNow, and Open-Meteo; river/bayou flood levels; the Atlantic tropical outlook; the Houston Health Department's measured daily pollen and mold count; road incidents and lane closures from Houston TranStar; recent local news headlines; and the Crosby ISD school calendar. Public, no authentication.",
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
      "/api/news": {
        get: {
          operationId: "getNews",
          summary: "Recent local news headlines for Crosby, TX",
          responses: {
            "200": {
              description: "Curated headline list (community items first on the site; incidents flagged by category)",
              content: { "application/json": { schema: { $ref: "#/components/schemas/News" } } },
            },
            "502": { description: "News cache unavailable" },
          },
        },
      },
      "/api/calendar": {
        get: {
          operationId: "getCalendar",
          summary: "Upcoming Crosby ISD school calendar events",
          responses: {
            "200": {
              description: "Upcoming events (soonest first, capped at 60)",
              content: { "application/json": { schema: { $ref: "#/components/schemas/SchoolCalendar" } } },
            },
            "502": { description: "Calendar unavailable" },
          },
        },
      },
      "/api/water": {
        get: {
          operationId: "getWater",
          summary: "River and bayou levels with NWS flood stages for the Crosby, TX area",
          responses: {
            "200": {
              description: "Current stage, flow, flood category, and thresholds per gauge",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Water" } } },
            },
            "502": { description: "Water data unavailable" },
          },
        },
      },
      "/api/fishing": {
        get: {
          operationId: "getFishing",
          summary: "Live fishing-water conditions (USGS) for the waters people fish near Crosby, TX",
          responses: {
            "200": {
              description:
                "Per-station conditions from USGS real-time monitoring for the fished waters (Lake Houston, the San Jacinto forks, the Trinity River, and nearby bayous): temperature, dissolved oxygen, pH, and turbidity where measured, or water level for level-only stations. Nearby readings, not the exact spot.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      location: { type: "string" },
                      source: { type: "string" },
                      note: { type: "string" },
                      updated: { type: ["string", "null"] },
                      stations: { type: "array", items: { type: "object" } },
                    },
                    required: ["stations"],
                  },
                },
              },
            },
            "502": { description: "Fishing data unavailable" },
          },
        },
      },
      "/api/tropics": {
        get: {
          operationId: "getTropics",
          summary: "Active Atlantic tropical cyclones from the NOAA National Hurricane Center",
          responses: {
            "200": {
              description: "Active Atlantic systems; an empty storms array means a quiet basin (the normal state most of the year)",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Tropics" } } },
            },
            "502": { description: "Tropics data unavailable" },
          },
        },
      },
      "/api/pollen": {
        get: {
          operationId: "getPollen",
          summary: "Measured daily pollen and mold count for the Houston / Crosby, TX area",
          responses: {
            "200": {
              description:
                "The Houston Health Department's daily count (National Allergy Bureau scale): tree/weed/grass pollen and mold spores with category + grains-per-m³, plus the species counted above zero. Publishes weekday mornings; weekends carry Friday's count.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Pollen" } } },
            },
            "502": { description: "Pollen data unavailable" },
          },
        },
      },
      "/api/air": {
        get: {
          operationId: "getAir",
          summary: "Measured US Air Quality Index for the Houston / Crosby, TX area",
          responses: {
            "200": {
              description:
                "Current US AQI for the Houston-Galveston-Brazoria reporting area (which includes Crosby). Measured by EPA/AirNow monitors when available (measured:true), with an Open-Meteo modeled fallback (measured:false).",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Air" } } },
            },
            "502": { description: "Air quality data unavailable" },
          },
        },
      },
      "/api/traffic": {
        get: {
          operationId: "getTraffic",
          summary: "Traffic incidents and lane closures on Crosby, TX area roads",
          responses: {
            "200": {
              description:
                "Incidents and scheduled lane closures on US-90, FM-2100, FM-1942, and the Crosby stretch of IH-10 East, from Houston TranStar. Empty arrays mean quiet roads; null means that feed was unreachable at the last refresh.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Traffic" } } },
            },
            "502": { description: "Traffic data unavailable" },
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
            sun: {
              type: ["object", "null"],
              description: "Today's sunrise/sunset for Crosby, computed astronomically in-Worker (standard sunrise equation) — not an NWS field.",
              properties: {
                sunrise: { type: "string", format: "date-time" },
                sunset: { type: "string", format: "date-time" },
              },
            },
            uv: {
              type: ["object", "null"],
              description: "UV index from the U.S. EPA's UV forecast for Crosby's ZIP (77532) — not an NWS field. null when the EPA fetch failed or the current hour is outside the product's daytime window.",
              properties: {
                current: { type: ["integer", "null"], description: "UV index for the current hour (Central time)." },
                currentCategory: { type: ["string", "null"], description: "Low / Moderate / High / Very High / Extreme." },
                peakToday: { type: ["integer", "null"], description: "Highest forecast UV index for today." },
                peakCategory: { type: ["string", "null"] },
                source: { type: "string" },
              },
            },
            airQuality: {
              type: ["object", "null"],
              description:
                "US Air Quality Index. `measured: true` = EPA/AirNow official monitors for the Houston-Galveston-Brazoria reporting area (the nearest official area, which includes Crosby — there's no monitor in Crosby itself). `measured: false` = Open-Meteo modeled forecast for Crosby's coordinates, the fallback when AirNow isn't reporting. `modeled` is the inverse of `measured` (kept for back-compat). null when both failed.",
              properties: {
                usAqi: { type: "integer", description: "US AQI, 0–500 scale (the max of the pollutant sub-indices)." },
                category: { type: "string", description: "Good / Moderate / Unhealthy for Sensitive Groups / Unhealthy / Very Unhealthy / Hazardous." },
                dominantPollutant: { type: ["string", "null"], description: "The pollutant driving the overall AQI." },
                dominantMonitor: { type: ["string", "null"], description: "Monitor site reporting the dominant pollutant (measured path)." },
                monitors: { type: ["object", "null"], description: "Per-pollutant reporting monitor site names (measured path)." },
                reportingAgency: { type: ["string", "null"], description: "Agency operating the monitors (e.g. TCEQ)." },
                subIndices: { type: ["object", "null"], description: "Per-pollutant AQI (ozone/pm25/pm10/…). Present for both sources." },
                pm2_5: { type: ["number", "null"], description: "PM2.5 concentration in concentrationUnit (modeled source only; null when measured)." },
                pm10: { type: ["number", "null"] },
                ozone: { type: ["number", "null"] },
                concentrationUnit: { type: "string" },
                measured: { type: "boolean" },
                modeled: { type: "boolean", description: "Inverse of measured; retained for back-compat." },
                reportingArea: { type: ["string", "null"], description: "AirNow reporting area (measured source only)." },
                observed: { type: ["string", "null"], description: "Local observation time (measured source only)." },
                source: { type: "string" },
              },
            },
            current: { anyOf: [HourlyPeriod, { type: "null" }] },
            hourly: { type: "array", items: HourlyPeriod },
            forecast: { type: "array", items: Period },
            alerts: { type: "array", items: Alert },
          },
        },
        HourlyPeriod,
        Period,
        Alert,
        News: {
          type: "object",
          properties: {
            location: { type: "string" },
            source: { type: "string" },
            updated: { type: ["string", "null"], format: "date-time" },
            items: { type: "array", items: NewsItem },
          },
        },
        NewsItem,
        SchoolCalendar: {
          type: "object",
          properties: {
            district: { type: "string" },
            source: { type: "string" },
            timezone: { type: "string" },
            updated: { type: ["string", "null"], format: "date-time" },
            events: { type: "array", items: SchoolEvent },
          },
        },
        SchoolEvent,
        Water: {
          type: "object",
          properties: {
            location: { type: "string" },
            source: { type: "string" },
            updated: { type: ["string", "null"], format: "date-time" },
            gauges: { type: "array", items: Gauge },
          },
        },
        Gauge,
        Tropics: {
          type: "object",
          properties: {
            basin: { type: "string" },
            source: { type: "string" },
            updated: { type: ["string", "null"], format: "date-time" },
            storms: { type: "array", items: Storm },
          },
        },
        Storm,
        Pollen: {
          type: "object",
          properties: {
            location: { type: "string" },
            source: { type: "string" },
            measured: { type: "boolean", description: "Always true — a lab-counted air sample, not a model." },
            stationNote: { type: "string" },
            updated: { type: ["string", "null"], format: "date-time" },
            countDate: { type: ["string", "null"], description: "Calendar date (Central) the count is for; weekends carry Friday's." },
            officialUrl: { type: "string", format: "uri" },
            groups: {
              type: "object",
              description: "tree / weed / grass / mold; each null when missing from the day's report.",
              additionalProperties: {
                type: ["object", "null"],
                properties: {
                  category: { type: "string", description: "NAB category: None, Low, Medium, Heavy, or Extremely Heavy." },
                  count: { type: "integer", description: "Grains (spores) per cubic meter of air." },
                },
              },
            },
            species: {
              type: "object",
              description: "Per-group list of types counted above zero, as the lab names them.",
              additionalProperties: {
                type: "array",
                items: { type: "object", properties: { name: { type: "string" }, count: { type: "integer" } } },
              },
            },
          },
        },
        Air: {
          type: "object",
          properties: {
            location: { type: "string" },
            updated: { type: ["string", "null"], format: "date-time" },
            airQuality: {
              type: ["object", "null"],
              description: "measured:true = EPA/AirNow monitors (Houston metro reporting area incl. Crosby); measured:false = Open-Meteo modeled fallback. Null when both failed.",
              properties: {
                usAqi: { type: "integer" },
                category: { type: "string" },
                dominantPollutant: { type: ["string", "null"] },
                dominantMonitor: { type: ["string", "null"] },
                monitors: { type: ["object", "null"] },
                reportingAgency: { type: ["string", "null"] },
                subIndices: { type: ["object", "null"], description: "Per-pollutant AQI (ozone/pm25/pm10/…)." },
                pm2_5: { type: ["number", "null"] },
                pm10: { type: ["number", "null"] },
                ozone: { type: ["number", "null"] },
                concentrationUnit: { type: "string" },
                measured: { type: "boolean" },
                modeled: { type: "boolean" },
                reportingArea: { type: ["string", "null"] },
                observed: { type: ["string", "null"] },
                source: { type: "string" },
              },
            },
          },
        },
        Traffic: {
          type: "object",
          properties: {
            area: { type: "string" },
            source: { type: "string" },
            updated: { type: ["string", "null"], format: "date-time" },
            incidents: {
              type: ["array", "null"],
              description: "Live incidents on the Crosby corridors; empty = quiet, null = feed unreachable at the last refresh.",
              items: {
                type: "object",
                properties: {
                  location: { type: "string", description: 'TranStar location text, e.g. "US-90 Eastbound At RUNNEBURG RD".' },
                  type: { type: "string", description: 'Incident type(s), e.g. "Accident", "Stall", "High Water".' },
                  status: { type: "string", description: 'TranStar status, e.g. "Verified at 4:24 PM" (Central time).' },
                  lanesAffected: { type: ["string", "null"] },
                },
              },
            },
            laneClosures: {
              type: ["array", "null"],
              description: "Scheduled lane closures on the Crosby corridors; empty = none, null = feed unreachable at the last refresh.",
              items: {
                type: "object",
                properties: {
                  location: { type: "string" },
                  schedule: { type: "string", description: 'TranStar schedule text, e.g. "Closed nightly 9:00 PM to 5:00 AM through Friday, July 17".' },
                  lanesAffected: { type: ["string", "null"] },
                  status: { type: ["string", "null"] },
                },
              },
            },
            cameras: {
              type: "array",
              description:
                "TranStar traffic cameras on the Crosby corridors. pageUrl links TranStar's own camera page — snapshot images are not embedded or proxied here.",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  roadway: { type: "string" },
                  lat: { type: "number" },
                  lon: { type: "number" },
                  pageUrl: { type: "string", format: "uri" },
                },
              },
            },
            liveMapUrl: { type: "string", format: "uri" },
            note: { type: "string" },
          },
        },
      },
    },
  };
}

// --- MCP server (Streamable HTTP transport) -------------------------------
// A stateless Model Context Protocol server exposing the weather as callable
// tools. Single endpoint at /mcp: POST a JSON-RPC message, get one back.
const MCP_PROTOCOL_VERSION = "2025-06-18";
// Versions this server can honestly claim when a client requests them. Per
// spec, an UNSUPPORTED requested version gets answered with our latest —
// never echoed back (echoing e.g. "2026-07-28" would falsely promise the
// stateless-core semantics of that revision).
const MCP_SUPPORTED_VERSIONS = ["2025-03-26", "2025-06-18"];
// Version moves in lockstep with `server.json`'s registry version on any
// tool-set change — they drifted apart (1.2.0 vs 1.4.0) when `get_air_quality`
// and `get_fishing` shipped without a bump, so both now carry the same number.
const MCP_SERVER_INFO = { name: "crosbynews-weather", version: "1.5.0", title: "Crosby, TX Weather" };
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

// Every tool is a pure read of cached public data: read-only, idempotent, and
// closed-world (a fixed set of government upstreams, no arbitrary reach).
// Clients use these hints to skip per-call confirmation prompts.
const MCP_READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

function mcpTools() {
  // outputSchema fragments — shallow and honest: they name the load-bearing
  // fields and stay permissive (additionalProperties defaults to true) since
  // NWS/NHC objects are passed through with more fields than we enumerate.
  // Full field docs live in /openapi.json (also an MCP resource).
  const isoStamp = { type: ["string", "null"], description: "ISO 8601 timestamp of the last data refresh." };
  const nwsPeriod = {
    type: "object",
    description:
      "An NWS forecast period, passed through (startTime, temperature, shortForecast, windSpeed, probabilityOfPrecipitation, ...) plus computed feelsLike °F where applicable. Full schema: https://crosbynews.com/openapi.json",
  };
  return [
    {
      name: "get_current_conditions",
      title: "Current conditions",
      description:
        "Current weather for Crosby, TX: temperature, feels-like, sky, precip chance, humidity, dew point, UV index, measured air quality (EPA/AirNow, Houston metro area), and sunrise/sunset.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: {
        type: "object",
        properties: {
          location: { type: "string" },
          updated: isoStamp,
          sun: { type: ["object", "null"], properties: { sunrise: { type: "string" }, sunset: { type: "string" } } },
          uv: {
            type: ["object", "null"],
            description: "EPA UV index; null at night or when the EPA feed is down.",
            properties: { current: { type: "integer" }, currentCategory: { type: "string" }, peakToday: { type: ["integer", "null"] } },
          },
          airQuality: {
            type: ["object", "null"],
            description: "US AQI. measured:true = EPA/AirNow monitors (Houston metro reporting area incl. Crosby); measured:false = Open-Meteo modeled fallback. Regional, not Crosby-pinpoint either way.",
            properties: { usAqi: { type: "integer" }, category: { type: "string" }, dominantPollutant: { type: ["string", "null"] }, measured: { type: "boolean" }, reportingArea: { type: ["string", "null"] } },
          },
          current: { ...nwsPeriod, description: nwsPeriod.description + " Adds dewpointF and humidityPercent." },
        },
        required: ["location"],
      },
      annotations: MCP_READ_ONLY,
    },
    {
      name: "get_forecast",
      title: "Forecast",
      description:
        "Forecast for Crosby, TX from the U.S. National Weather Service. Returns the 7-day day/night forecast, or upcoming hourly periods if `hours` is given (up to 48 — through about two days out).",
      inputSchema: {
        type: "object",
        properties: {
          hours: { type: "integer", minimum: 1, maximum: 48, description: "Return this many upcoming hourly periods instead of the daily forecast." },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: {
          location: { type: "string" },
          forecast: { type: "array", description: "7-day day/night periods (daily mode).", items: nwsPeriod },
          hourly: { type: "array", description: "Upcoming hourly periods (only when `hours` was given).", items: nwsPeriod },
        },
        required: ["location"],
      },
      annotations: MCP_READ_ONLY,
    },
    {
      name: "get_alerts",
      title: "Active alerts",
      description: "Active NWS weather alerts for Crosby, TX. Returns an empty list when none are active.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: {
        type: "object",
        properties: {
          location: { type: "string" },
          count: { type: "integer" },
          alerts: {
            type: "array",
            items: { type: "object", properties: { event: { type: "string" }, headline: { type: "string" }, severity: { type: "string" }, expires: { type: "string" } } },
          },
        },
        required: ["location", "count", "alerts"],
      },
      annotations: MCP_READ_ONLY,
    },
    {
      name: "get_tropical_outlook",
      title: "Atlantic tropical outlook",
      description:
        "Active Atlantic tropical cyclones from the NOAA National Hurricane Center — the systems that matter to Crosby, TX in hurricane season (June–November). Returns an explicit all-clear when the basin is quiet.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: {
        type: "object",
        properties: {
          basin: { type: "string" },
          source: { type: "string" },
          updated: isoStamp,
          storms: {
            type: "array",
            description: "Empty when the basin is quiet — the normal state most of the year.",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                classificationLabel: { type: "string" },
                windMph: { type: ["integer", "null"] },
                pressureMb: { type: ["number", "null"] },
                lat: { type: ["number", "null"] },
                lon: { type: ["number", "null"] },
                movementDirection: { type: ["string", "null"] },
                advisoryUrl: { type: "string" },
              },
            },
          },
        },
        required: ["basin", "storms"],
      },
      annotations: MCP_READ_ONLY,
    },
    {
      name: "get_pollen",
      title: "Pollen & mold count",
      description:
        "The Houston Health Department's measured daily pollen and mold count (National Allergy Bureau scale) — tree, weed, and grass pollen plus mold spores, with the species actually counted. A real measurement, not a model; counts publish weekday mornings and apply regionally to Crosby, TX.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: {
        type: "object",
        properties: {
          location: { type: "string" },
          source: { type: "string" },
          measured: { type: "boolean" },
          updated: isoStamp,
          countDate: { type: ["string", "null"], description: "Calendar date (Central time) the count is for; weekends carry Friday's count." },
          officialUrl: { type: "string" },
          groups: {
            type: "object",
            description: "tree / weed / grass / mold — each null when that reading was missing from the day's report.",
            properties: {
              tree: { type: ["object", "null"], properties: { category: { type: "string" }, count: { type: "integer" } } },
              weed: { type: ["object", "null"], properties: { category: { type: "string" }, count: { type: "integer" } } },
              grass: { type: ["object", "null"], properties: { category: { type: "string" }, count: { type: "integer" } } },
              mold: { type: ["object", "null"], properties: { category: { type: "string" }, count: { type: "integer" } } },
            },
          },
          species: { type: "object", description: "Per-group list of the types counted above zero, as the lab names them." },
        },
        required: ["source", "groups"],
      },
      annotations: MCP_READ_ONLY,
    },
    {
      name: "get_air_quality",
      title: "Air quality (AQI)",
      description:
        "Current U.S. Air Quality Index for the Houston metro area (the Houston-Galveston-Brazoria reporting area, which includes Crosby, TX). Measured by EPA/AirNow monitors when available (measured:true), with an Open-Meteo modeled fallback (measured:false). Regional, not a Crosby-pinpoint reading.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: {
        type: "object",
        properties: {
          location: { type: "string" },
          updated: isoStamp,
          airQuality: {
            type: ["object", "null"],
            properties: {
              usAqi: { type: "integer" },
              category: { type: "string" },
              dominantPollutant: { type: ["string", "null"] },
              dominantMonitor: { type: ["string", "null"], description: "Site name of the monitor reporting the dominant pollutant (measured path)." },
              subIndices: { type: ["object", "null"], description: "Per-pollutant AQI (ozone/pm25/pm10/…)." },
              monitors: { type: ["object", "null"], description: "Per-pollutant reporting monitor site names (measured path)." },
              reportingAgency: { type: ["string", "null"] },
              measured: { type: "boolean" },
              reportingArea: { type: ["string", "null"] },
              observed: { type: ["string", "null"] },
              source: { type: "string" },
            },
          },
        },
        required: ["location", "airQuality"],
      },
      annotations: MCP_READ_ONLY,
    },
    {
      name: "get_crosby_news",
      title: "Local news",
      description:
        "Recent local news headlines for Crosby, TX and nearby northeast Harris County communities, aggregated from public sources and filtered for relevance. Empty when nothing recent.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: {
        type: "object",
        properties: {
          location: { type: "string" },
          source: { type: "string" },
          updated: isoStamp,
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                link: { type: "string" },
                source: { type: ["string", "null"] },
                published: { type: ["string", "null"] },
                category: { type: "string", description: "community or incident" },
              },
            },
          },
        },
        required: ["items"],
      },
      annotations: MCP_READ_ONLY,
    },
    {
      name: "get_school_events",
      title: "School calendar",
      description:
        "Upcoming Crosby ISD school-calendar events: first/last day of school, holidays, no-school and early-release days, testing windows, and campus activities.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 60, description: "Maximum events to return (default 15)." },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: {
          district: { type: "string" },
          source: { type: "string" },
          timezone: { type: "string" },
          updated: isoStamp,
          events: {
            type: "array",
            items: {
              type: "object",
              properties: {
                summary: { type: "string" },
                location: { type: ["string", "null"] },
                start: { type: "string", description: "All-day: YYYY-MM-DD. Timed: zone-less ISO local time (America/Chicago wall-clock)." },
                end: { type: ["string", "null"] },
                allDay: { type: "boolean" },
              },
            },
          },
        },
        required: ["events"],
      },
      annotations: MCP_READ_ONLY,
    },
    {
      name: "get_river_levels",
      title: "River & bayou levels",
      description:
        "Current water levels and NWS flood stages for the rivers and bayous that flood Crosby, TX and northeast Harris County (Cedar Bayou, San Jacinto River, Luce Bayou, and more). Each gauge reports its stage, flow, flood category, and thresholds.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: {
        type: "object",
        properties: {
          location: { type: "string" },
          source: { type: "string" },
          updated: isoStamp,
          gauges: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                stage: { type: ["number", "null"], description: "Observed gauge height in ft." },
                flow: { type: ["number", "null"], description: "Observed discharge in cfs." },
                category: { type: "string", description: "no_flooding/action/minor/moderate/major, or not_defined where NWS defines no flood stages." },
                thresholds: { type: "object", description: "NWS flood-stage thresholds in ft, keyed action/minor/moderate/major." },
                officialUrl: { type: "string" },
              },
            },
          },
        },
        required: ["gauges"],
      },
      annotations: MCP_READ_ONLY,
    },
    {
      name: "get_fishing",
      title: "Fishing conditions",
      description:
        "Live water conditions for the waters people fish near Crosby, TX — Lake Houston, the San Jacinto River forks, the Trinity River, and nearby bayous — from USGS real-time monitoring. Full stations report temperature, dissolved oxygen, pH, and turbidity; some fished bayous report water level only. A nearby-station reading, not the exact fishing spot, and conditions rather than a guaranteed bite.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: {
        type: "object",
        properties: {
          location: { type: "string" },
          source: { type: "string" },
          note: { type: "string" },
          updated: isoStamp,
          stations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                water: { type: ["string", "null"], description: "The fished water body (e.g. Lake Houston)." },
                spot: { type: ["string", "null"], description: "The station's location within that water." },
                knownFor: { type: ["string", "null"], description: "Species the water is known for." },
                temperatureF: { type: ["number", "null"] },
                dissolvedOxygenMgL: { type: ["number", "null"], description: "Main driver of fish activity; >6 healthy, 4-6 moderate, <4 low." },
                ph: { type: ["number", "null"] },
                turbidityFNU: { type: ["number", "null"], description: "Water clarity; higher = more stained." },
                waterLevelFt: { type: ["number", "null"], description: "Gage height, for level-only stations." },
                conditions: { type: "string", description: "Healthy oxygen / Moderate oxygen / Low oxygen / Water level only." },
                observed: { type: ["string", "null"] },
                officialUrl: { type: "string" },
              },
            },
          },
        },
        required: ["stations"],
      },
      annotations: MCP_READ_ONLY,
    },
    {
      name: "get_traffic",
      title: "Roads & traffic",
      description:
        "Live traffic incidents and scheduled lane closures on the roads Crosby, TX drives — US-90, FM-2100, FM-1942, and the Crosby stretch of IH-10 East — from Houston TranStar, plus links to the corridor traffic cameras. High-water road reports appear here during floods. Empty lists mean quiet roads.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: {
        type: "object",
        properties: {
          area: { type: "string" },
          source: { type: "string" },
          updated: isoStamp,
          incidents: {
            type: ["array", "null"],
            description: "Empty = no monitored incidents (the normal state); null = the incidents feed was unreachable at the last refresh.",
            items: {
              type: "object",
              properties: {
                location: { type: "string" },
                type: { type: "string", description: 'e.g. "Accident", "Stall", "High Water".' },
                status: { type: "string", description: 'e.g. "Verified at 4:24 PM" (Central time).' },
                lanesAffected: { type: ["string", "null"] },
              },
            },
          },
          laneClosures: {
            type: ["array", "null"],
            description: "Scheduled closures; empty = none, null = feed unreachable at the last refresh.",
            items: {
              type: "object",
              properties: {
                location: { type: "string" },
                schedule: { type: "string" },
                lanesAffected: { type: ["string", "null"] },
                status: { type: ["string", "null"] },
              },
            },
          },
          cameras: {
            type: "array",
            description: "Corridor cameras — pageUrl links TranStar's own camera pages (images are not embedded).",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                roadway: { type: "string" },
                lat: { type: "number" },
                lon: { type: "number" },
                pageUrl: { type: "string" },
              },
            },
          },
          liveMapUrl: { type: "string" },
        },
        required: ["area", "source"],
      },
      annotations: MCP_READ_ONLY,
    },
    {
      name: "get_emergency_contacts",
      title: "Emergency contacts",
      description:
        "Emergency resource directory for Crosby, TX (unincorporated Harris County): 911 guidance, sheriff non-emergency, power-outage and gas-leak reporting, the CAER industrial-incident line, flood and road tools, shelters, and disaster assistance. Static verified directory — in a life-threatening emergency, call 911.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: {
        type: "object",
        properties: {
          location: { type: "string" },
          note: { type: "string" },
          sections: {
            type: "array",
            items: {
              type: "object",
              properties: {
                heading: { type: "string" },
                notes: { type: "array", items: { type: "string" } },
                contacts: {
                  type: "array",
                  items: { type: "object", properties: { label: { type: "string" }, note: { type: "string" }, url: { type: "string", description: "tel: or https: URL." } } },
                },
              },
            },
          },
        },
        required: ["sections"],
      },
      annotations: MCP_READ_ONLY,
    },
    {
      name: "get_radar",
      title: "Weather radar image",
      description:
        "Latest NWS KHGX (Houston/Galveston) radar still image covering Crosby, TX, returned inline as a GIF. For the animated loop, see https://crosbynews.com/radar.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: MCP_READ_ONLY,
    },
  ];
}

// MCP prompts — one genuinely useful one: a data-grounded daily briefing.
// prompts/get composes the live data server-side (no tool round-trips), so
// the client gets a self-contained prompt with everything already in it.
function mcpPrompts() {
  return [
    {
      name: "crosby_briefing",
      title: "Crosby daily briefing",
      description:
        "Compose a concise daily briefing for a Crosby, TX resident: current weather with feels-like, today's outlook, active alerts, sunrise/sunset, recent local headlines, and upcoming Crosby ISD events — plus river levels, road incidents, Atlantic tropical systems, and heavy pollen/mold whenever any is a live concern. The prompt arrives pre-filled with live data.",
      arguments: [],
    },
  ];
}

async function mcpGetPrompt(name, env) {
  if (name !== "crosby_briefing") {
    const e = new Error(`Unknown prompt: ${name}`);
    e.code = -32602;
    throw e;
  }
  // Water, tropics, and traffic ride along failure-tolerant: they only ever
  // ADD lines (above-normal gauges, active storms, road incidents), so a fetch
  // hiccup must not sink the whole briefing the way a weather failure
  // legitimately does.
  const [{ data }, news, cal, water, tropics, traffic, pollen] = await Promise.all([
    loadWeather(env),
    loadNews(env),
    loadCalendar(env),
    loadWater(env).catch(() => ({ gauges: [] })),
    loadTropics(env).catch(() => ({ storms: [] })),
    loadTraffic(env).catch(() => ({ incidents: null, closures: null })),
    loadPollen(env).catch(() => ({ groups: {} })),
  ]);
  const now = currentHourly(data);
  const lead = data.periods?.[0];
  const sun = sunTimesForCtDate(Date.now());
  const feels = feelsLikeF(now);
  const lines = ["# Live Crosby, TX data (as of " + fullTime(data.updated) + " CT)", ""];
  if (now) lines.push(`Now: ${now.temperature}°${now.temperatureUnit}, ${now.shortForecast}${feels != null ? `, feels like ${feels}°` : ""}${pop(now) ? `, ${pop(now)}% precip` : ""}.`);
  const uvNow = uvCurrent(data), uvPk = uvPeakToday(data);
  if (uvNow || uvPk) lines.push(`UV index: ${uvNow ? `${uvNow} (${uvCategory(uvNow)}) now` : ""}${uvNow && uvPk ? ", " : ""}${uvPk ? `${uvPk} peak today` : ""}.`);
  if (data.aqi?.usAqi != null) lines.push(`Air quality (${data.aqi.measured ? `measured, EPA/AirNow ${data.aqi.reportingArea || "Houston metro"} area` : "modeled, Open-Meteo fallback"}): US AQI ${data.aqi.usAqi} (${aqiCategory(data.aqi.usAqi)})${data.aqi.dominant ? `, dominant ${aqiDominantLabel(data.aqi.dominant)}` : ""}.`);
  if (lead) lines.push(`${lead.name}: ${lead.detailedForecast}`);
  if (sun) lines.push(`Sunrise ${clockTime(sun.sunrise)}, sunset ${clockTime(sun.sunset)} CT.`);
  const alerts = data.alerts ?? [];
  lines.push(
    alerts.length
      ? `ACTIVE ALERTS: ${alerts.map((a) => `${a.event}${a.headline ? ` — ${a.headline}` : ""}`).join("; ")}`
      : "No active weather alerts."
  );
  // Quiet rivers and a quiet basin add nothing — only surface either when it
  // is actually a live concern, so calm-day briefings stay short.
  const flooding = (water.gauges ?? []).filter((g) => WATER_FLOOD_CATS.includes(g.category));
  if (flooding.length)
    lines.push(
      `RIVER/BAYOU LEVELS ABOVE NORMAL: ${flooding
        .map((g) => `${g.name} at ${g.stage != null ? `${g.stage} ft` : "n/a"} (${waterCatLabel(g.category, "en")})`)
        .join("; ")}. Details: ${SITE}/water`
    );
  const storms = tropics.storms ?? [];
  if (storms.length) lines.push(`ACTIVE ATLANTIC TROPICAL SYSTEMS: ${storms.map((s) => tropicsStormLine(s, "en")).join("; ")}. Details: ${SITE}/tropics`);
  const roadIncidents = traffic.incidents ?? [];
  if (roadIncidents.length)
    lines.push(
      `ROAD INCIDENTS ON CROSBY-AREA ROADS: ${roadIncidents
        .map((i) => `${i.location}${i.type ? ` (${i.type})` : ""}`)
        .join("; ")}. Details: ${SITE}/traffic`
    );
  // Like rivers/storms/roads, pollen only earns a line when it's a live
  // concern — a Heavy-or-worse reading on the measured HHD count.
  const heavyPollen = POLLEN_GROUPS.filter(([key]) => pollenCatRank(pollen.groups?.[key]?.category) >= 3);
  if (heavyPollen.length && pollen.countDate)
    lines.push(
      `POLLEN/MOLD AT HEAVY LEVELS (measured count for ${pollenDateLabel(pollen.countDate, "en")}): ${heavyPollen
        .map(([key]) => `${pollenGroupLabel(key, "en")} ${pollen.groups[key].category} (${pollen.groups[key].count.toLocaleString("en-US")}/m³)`)
        .join("; ")}. Details: ${SITE}/pollen`
    );
  const items = (news.items ?? []).slice(0, 5);
  if (items.length) {
    lines.push("", "Recent local headlines:");
    for (const n of items) lines.push(`- ${n.title}${n.source ? ` (${n.source})` : ""}`);
  }
  const events = upcomingEvents(cal.events ?? []).slice(0, 5);
  if (events.length) {
    lines.push("", "Upcoming Crosby ISD events:");
    for (const e of events) {
      const when = new Date(e.start).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
      lines.push(`- ${when}: ${e.summary}`);
    }
  }
  lines.push(
    "",
    "Using ONLY the data above, write a friendly, concise daily briefing for a Crosby, TX resident. Lead with anything safety-relevant (alerts, flooding rivers, tropical systems, extreme heat index). Keep it under 150 words. Note that weather data is from the U.S. National Weather Service."
  );
  return {
    description: "Data-grounded prompt for a Crosby, TX daily briefing.",
    messages: [{ role: "user", content: { type: "text", text: lines.join("\n") } }],
  };
}

// MCP resources — the machine-readable site docs, readable in-protocol.
const MCP_RESOURCES = [
  {
    uri: `${SITE}/llms.txt`,
    name: "crosbynews-overview",
    title: "crosbynews.com site overview",
    description: "Plain-language summary of the site, its pages, API, and data policy (llms.txt).",
    mimeType: "text/markdown",
  },
  {
    uri: `${SITE}/openapi.json`,
    name: "crosbynews-openapi",
    title: "crosbynews.com API spec",
    description: "OpenAPI 3.1 description of the weather, air-quality, pollen, news, school-calendar, water-levels, fishing, tropics, and traffic API.",
    mimeType: "application/json",
  },
];

function mcpReadResource(uri) {
  const r = MCP_RESOURCES.find((x) => x.uri === uri);
  if (!r) return null;
  const text = uri.endsWith("/llms.txt") ? llmsTxt() : JSON.stringify(openApiSpec(), null, 2);
  return { contents: [{ uri, mimeType: r.mimeType, text }] };
}

function mcpServerCard() {
  return {
    serverInfo: MCP_SERVER_INFO,
    protocolVersion: MCP_PROTOCOL_VERSION,
    description:
      "Live Crosby, Texas data: weather from the U.S. National Weather Service (current conditions, forecast, active alerts), a measured air-quality index (EPA/AirNow, with an Open-Meteo modeled fallback), the Houston Health Department's daily pollen and mold count, the Atlantic tropical outlook, river/bayou flood levels, USGS water conditions for nearby fishing waters, road incidents and lane closures, a live radar image, recent local news headlines, the Crosby ISD school calendar, and an emergency-contacts directory.",
    transport: { type: "streamable-http", endpoint: `${SITE}/mcp` },
    capabilities: { tools: { listChanged: false }, prompts: { listChanged: false }, resources: { listChanged: false } },
    tools: mcpTools().map((t) => ({ name: t.name, title: t.title, description: t.description })),
    prompts: mcpPrompts().map((p) => ({ name: p.name, title: p.title, description: p.description })),
    resources: MCP_RESOURCES.map((r) => ({ uri: r.uri, name: r.name, title: r.title })),
    documentation: `${SITE}/`,
  };
}

// Human-facing explainer shown when a browser opens /mcp (which only speaks
// POST JSON-RPC). Lists the tools and how to connect. The MCP protocol/API is
// English-only; `lang` renders a Spanish HUMAN explainer at /es/mcp that points
// readers back at the English /mcp endpoint (never /es/mcp) to actually connect.
function mcpInfoHtml(lang) {
  const tools = mcpTools()
    .map((t) => `<li><code>${esc(t.name)}</code> &mdash; ${esc(t.description)}</li>`)
    .join("\n      ");
  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${T(lang, "MCP Server", "Servidor MCP")} &mdash; crosbynews.com</title>
<meta name="description" content="${T(lang, "Model Context Protocol (MCP) server for Crosby, TX weather: connect an AI agent to get live conditions, forecast, and alerts.", "Servidor de Model Context Protocol (MCP) para datos de Crosby, TX: conecta un agente de IA para obtener el clima en vivo, el pronóstico y las alertas.")}">
<meta name="theme-color" content="#0b3d61">
<link rel="canonical" href="${canonicalFor("/mcp", lang)}">
${hreflangTags("/mcp")}
<link rel="manifest" href="/manifest.json">
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
${topbar("/mcp", lang)}
<main id="main">
  <h1>${T(lang, "MCP Server", "Servidor MCP")}</h1>
  <p class="intro">${T(lang, "This is the Model Context Protocol (MCP) endpoint for crosbynews.com. It is meant for AI agents, not browsers &mdash; it speaks JSON-RPC over HTTP POST. This page just explains what it is.", "Este es el punto de acceso de Model Context Protocol (MCP) de crosbynews.com. Está pensado para agentes de IA, no para navegadores &mdash; usa JSON-RPC sobre HTTP POST. Esta página solo explica qué es.")}</p>
  ${lang === "es" ? `<section class="card"><h2>Idioma</h2><p>El servidor MCP funciona <strong>solo en inglés</strong>. Para conectarte, usa la URL en inglés <code>${SITE}/mcp</code> &mdash; <strong>no</strong> <code>${SITE}/es/mcp</code>, que es únicamente esta página explicativa en español.</p></section>` : ""}
  <section class="card">
    <h2>${T(lang, "Endpoint", "Punto de acceso")}</h2>
    <p><code>${SITE}/mcp</code> &middot; ${T(lang, "transport", "transporte")}: Streamable HTTP (JSON-RPC 2.0). ${T(lang, "Discovery card", "Tarjeta de descubrimiento")}: <a href="/.well-known/mcp/server-card.json">/.well-known/mcp/server-card.json</a>.</p>
  </section>
  <section class="card">
    <h2>${T(lang, "Tools", "Herramientas")}</h2>
    ${lang === "es" ? `<p class="intro">Los nombres y las descripciones de las herramientas se muestran en inglés &mdash; el servidor responde en inglés.</p>` : ""}
    <ul>
      ${tools}
    </ul>
  </section>
  <section class="card">
    <h2>${T(lang, "Prompts &amp; resources", "Prompts y recursos")}</h2>
    <p>${T(lang, `The prompt <code>crosby_briefing</code> returns a data-grounded daily-briefing prompt with live weather, alerts, headlines, and school events already filled in. Resources expose <a href="/llms.txt"><code>llms.txt</code></a> and the <a href="/openapi.json">OpenAPI spec</a> in-protocol.`, `El prompt <code>crosby_briefing</code> devuelve un resumen diario con datos reales: clima en vivo, alertas, titulares y eventos escolares ya incluidos. Los recursos exponen <a href="/llms.txt"><code>llms.txt</code></a> y la <a href="/openapi.json">especificación OpenAPI</a> dentro del protocolo.`)}</p>
  </section>
  <section class="card">
    <h2>${T(lang, "Connect from Claude Code", "Conectar desde Claude Code")}</h2>
    <pre>claude mcp add --transport http crosbynews ${SITE}/mcp</pre>
    <p class="intro">${T(lang, `Then ask, e.g., "what's the forecast for Crosby, TX?" and the agent will call these tools. Prefer a webpage? See the <a href="/">live forecast</a>, <a href="/hourly">hourly</a>, and <a href="/radar">radar</a>.`, `Luego pregunta, por ejemplo, "¿cuál es el pronóstico para Crosby, TX?" y el agente llamará a estas herramientas. ¿Prefieres una página web? Mira el <a href="/es/weather">pronóstico en vivo</a>, <a href="/es/hourly">por hora</a> y <a href="/es/radar">radar</a>.`)}</p>
  </section>
</main>
${footer({ page: "/mcp", lang: lang === "es" ? "es" : "en", source: T(lang, `Data from the U.S. National Weather Service (<a href="https://weather.gov">weather.gov</a>).`, `Datos del Servicio Meteorológico Nacional de EE. UU. (<a href="https://weather.gov">weather.gov</a>).`) })}
</body>
</html>`;
}

// Markdown rendering of the same explainer, served when an agent asks for it
// (Accept: text/markdown / ?format=md) — so the footer's "View as Markdown"
// link works here like it does on every content page. `lang` mirrors the HTML:
// the protocol stays English-only; the Spanish variant is a human explainer
// that points at the English /mcp endpoint.
function mcpInfoMarkdown(lang) {
  const tools = mcpTools()
    .map((t) => `- \`${t.name}\` — ${t.description}`)
    .join("\n");
  if (lang === "es") {
    return `# Servidor MCP — crosbynews.com

Este es el punto de acceso de Model Context Protocol (MCP) de crosbynews.com.
Usa JSON-RPC 2.0 sobre HTTP POST (transporte Streamable HTTP); esta página solo
explica qué es.

**El servidor MCP funciona solo en inglés.** Para conectarte, usa la URL en
inglés \`${SITE}/mcp\` — **no** \`${SITE}/es/mcp\`, que es únicamente esta página
explicativa en español.

## Punto de acceso

- \`${SITE}/mcp\` — transporte: Streamable HTTP (JSON-RPC 2.0 sobre POST)
- Tarjeta de descubrimiento: ${SITE}/.well-known/mcp/server-card.json

## Herramientas

_Los nombres y las descripciones se muestran en inglés — el servidor responde en inglés._

${tools}

## Prompts y recursos

- Prompt \`crosby_briefing\` — un resumen diario con datos reales (clima en vivo, alertas, titulares y eventos escolares ya incluidos).
- Recursos — \`${SITE}/llms.txt\` (resumen del sitio) y \`${SITE}/openapi.json\` (especificación de la API), legibles dentro del protocolo.

## Conectar desde Claude Code

\`\`\`
claude mcp add --transport http crosbynews ${SITE}/mcp
\`\`\`

Luego pregunta, por ejemplo, "¿cuál es el pronóstico para Crosby, TX?" y el
agente llamará a estas herramientas. ¿Prefieres una página web? Mira el
[pronóstico en vivo](${SITE}/es/weather), [por hora](${SITE}/es/hourly) y
[radar](${SITE}/es/radar).

---
[crosbynews.com](${SITE}/es) · datos del Servicio Meteorológico Nacional de EE. UU.
`;
  }
  return `# MCP Server — crosbynews.com

This is the Model Context Protocol (MCP) endpoint for crosbynews.com. It speaks
JSON-RPC 2.0 over HTTP POST (Streamable HTTP transport); this page just explains
what it is.

## Endpoint

- \`${SITE}/mcp\` — transport: Streamable HTTP (JSON-RPC 2.0 over POST)
- Discovery card: ${SITE}/.well-known/mcp/server-card.json

## Tools

${tools}

## Prompts & resources

- Prompt \`crosby_briefing\` — a data-grounded daily-briefing prompt (live weather, alerts, headlines, and school events pre-filled).
- Resources — \`${SITE}/llms.txt\` (site overview) and \`${SITE}/openapi.json\` (API spec), readable in-protocol.

## Connect from Claude Code

\`\`\`
claude mcp add --transport http crosbynews ${SITE}/mcp
\`\`\`

Then ask, e.g., "what's the forecast for Crosby, TX?" and the agent will call
these tools. Prefer a webpage? See the [live forecast](${SITE}/),
[hourly](${SITE}/hourly), and [radar](${SITE}/radar).

---
[crosbynews.com](${SITE}/) · data from the U.S. National Weather Service
`;
}

// ArrayBuffer → base64, chunked so String.fromCharCode never sees an argument
// list long enough to overflow the call stack (radar stills run ~50–150 KB).
function bufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function mcpCallTool(name, args, env) {
  // News, calendar, water, and tropics tools read their own KV keys — handled
  // first so they don't pay for (or fail on) a weather load they never use.
  if (name === "get_tropical_outlook") {
    const tropics = await loadTropics(env);
    const payload = apiTropics(tropics);
    const text = payload.storms.length
      ? payload.storms
          .map((s) => {
            const bits = [];
            if (s.windMph != null) bits.push(`${s.windMph} mph winds`);
            if (s.pressureMb != null) bits.push(`${s.pressureMb} mb`);
            if (s.lat != null && s.lon != null) bits.push(`near ${Math.abs(s.lat)}°${s.lat < 0 ? "S" : "N"} ${Math.abs(s.lon)}°${s.lon < 0 ? "W" : "E"}`);
            if (s.movementDirection) bits.push(`moving ${s.movementDirection}`);
            return `- ${s.classificationLabel} ${s.name}${bits.length ? ` — ${bits.join(", ")}` : ""} (advisory: ${s.advisoryUrl})`;
          })
          .join("\n")
      : "No active tropical systems in the Atlantic basin — all clear. (Hurricane season runs June–November; Crosby's local threat is inland rain flooding, not surge.)";
    return { content: [{ type: "text", text }], structuredContent: payload };
  }
  if (name === "get_traffic") {
    const traffic = await loadTraffic(env);
    const payload = apiTraffic(traffic);
    const incLines =
      payload.incidents === null
        ? "Incident data is temporarily unavailable."
        : payload.incidents.length
          ? payload.incidents
              .map((i) => `- ${i.location}${i.type ? ` — ${i.type}` : ""}${i.status ? ` (${i.status})` : ""}${i.lanesAffected ? `. Lanes affected: ${i.lanesAffected}` : ""}`)
              .join("\n")
          : "No monitored incidents on Crosby-area roads right now (US-90, FM-2100, FM-1942, IH-10 East).";
    const clLine =
      payload.laneClosures === null
        ? "Lane-closure data is temporarily unavailable."
        : payload.laneClosures.length
          ? `${payload.laneClosures.length} scheduled lane closure(s) on the Crosby corridors — see structured data or ${SITE}/traffic.`
          : "No scheduled lane closures on the Crosby corridors.";
    const text = `${incLines}\n\n${clLine}\n\nLive cameras and map: ${SITE}/traffic (data: Houston TranStar). Never drive into high water.`;
    return { content: [{ type: "text", text }], structuredContent: payload };
  }
  if (name === "get_pollen") {
    const pollen = await loadPollen(env);
    const payload = apiPollen(pollen);
    const parts = POLLEN_GROUPS.filter(([key]) => payload.groups[key]).map(([key]) => {
      const g = payload.groups[key];
      return `${pollenGroupLabel(key, "en")}: ${g.category} (${g.count.toLocaleString("en-US")}/m³)`;
    });
    const text = parts.length
      ? `${parts.join(" · ")} — measured count for ${pollenDateLabel(payload.countDate, "en")} by the Houston Health Department (National Allergy Bureau station; new counts publish weekday mornings). Details: ${SITE}/pollen`
      : `The pollen and mold count is temporarily unavailable. Official source: ${payload.officialUrl}`;
    return { content: [{ type: "text", text }], structuredContent: payload };
  }
  if (name === "get_air_quality") {
    const { data } = await loadWeather(env);
    const payload = apiAir(data);
    const a = payload.airQuality;
    const text = a
      ? `US AQI ${a.usAqi} (${a.category})${a.dominantPollutant ? `, ${a.dominantPollutant}-driven` : ""} near Crosby, TX — ${a.measured ? `measured by the closest ${a.reportingAgency || "TCEQ/AirNow"} monitors${a.dominantMonitor ? ` (${a.dominantPollutant} from ${a.dominantMonitor})` : ""} in the ${a.reportingArea || "Houston-Galveston-Brazoria"} area` : "modeled (Open-Meteo fallback)"}. ${aqiHealth(a.usAqi, "en")} Details: ${SITE}/air`
      : `The air quality reading is temporarily unavailable. See ${SITE}/air`;
    return { content: [{ type: "text", text }], structuredContent: payload };
  }
  if (name === "get_emergency_contacts") {
    const abs = (href) => (href.startsWith("/") ? `${SITE}${href}` : href);
    const payload = {
      location: "Crosby, TX (unincorporated Harris County)",
      note: "In an immediate emergency — medical crisis, fire, crime in progress, water entering a home — call 911. Crosby is unincorporated, so Houston's 311 does not cover it.",
      sections: EMERGENCY.sections.map((s) => ({
        heading: s.h,
        notes: s.p ?? [],
        contacts: (s.links ?? []).map((l) => ({ label: l.label, note: l.note, url: abs(l.href) })),
      })),
    };
    const text = [
      "Emergency resources for Crosby, TX. In an immediate emergency, call 911.",
      ...payload.sections
        .filter((s) => s.contacts.length)
        .map((s) => `${s.heading}:\n${s.contacts.map((c) => `- ${c.label} — ${c.note}`).join("\n")}`),
      `Full directory: ${SITE}/emergency`,
    ].join("\n\n");
    return { content: [{ type: "text", text }], structuredContent: payload };
  }
  if (name === "get_radar") {
    let res = null;
    try {
      res = await fetch("https://radar.weather.gov/ridge/standard/KHGX_0.gif", {
        headers: { "User-Agent": "crosbynews.com", Accept: "image/gif,image/*" },
        cf: { cacheTtl: 180, cacheEverything: true },
      });
    } catch {}
    if (!res || !res.ok) {
      return {
        content: [{ type: "text", text: `Radar imagery is temporarily unavailable — see ${SITE}/radar for the live loop.` }],
      };
    }
    const data = bufToBase64(await res.arrayBuffer());
    return {
      content: [
        { type: "text", text: `Latest NWS KHGX radar still (covers Crosby, TX — the Houston/Galveston radar). Animated loop: ${SITE}/radar` },
        { type: "image", data, mimeType: res.headers.get("content-type")?.split(";")[0] || "image/gif" },
      ],
    };
  }
  if (name === "get_crosby_news") {
    const news = await loadNews(env);
    const items = news.items ?? [];
    const text = items.length
      ? items
          .map((n) => `- ${n.title}${n.source ? ` (${n.source}${n.ts ? `, ${newsDate(n.ts)}` : ""})` : ""}`)
          .join("\n")
      : "No recent Crosby news right now.";
    return { content: [{ type: "text", text }], structuredContent: apiNews(news) };
  }
  if (name === "get_school_events") {
    const cal = await loadCalendar(env);
    const limit = Math.min(Math.max(Number(args?.limit) || 15, 1), 60);
    const payload = apiCalendar(cal);
    payload.events = payload.events.slice(0, limit);
    const shown = upcomingEvents(cal.events ?? []).slice(0, limit);
    const text = shown.length
      ? shown
          .map((e) => {
            const when = new Date(e.start).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
            return `- ${when}: ${e.summary}${e.allDay ? "" : ` (${calTime(e.start)})`}${e.location ? ` — ${e.location}` : ""}`;
          })
          .join("\n")
      : "No upcoming Crosby ISD events are posted right now.";
    return { content: [{ type: "text", text }], structuredContent: payload };
  }
  if (name === "get_river_levels") {
    const water = await loadWater(env);
    const payload = apiWater(water);
    const text = payload.gauges.length
      ? payload.gauges
          .map((g) => {
            const th = ["action", "minor", "moderate", "major"]
              .filter((k) => typeof g.thresholds[k] === "number")
              .map((k) => `${k} ${g.thresholds[k]}ft`)
              .join(", ");
            return `- ${g.name}: ${g.stage != null ? `${g.stage} ft` : "n/a"} (${waterState(g, "en").label})${g.flow != null ? `, ${g.flow.toLocaleString("en-US")} cfs` : ""}${th ? ` [flood stages: ${th}]` : ""}`;
          })
          .join("\n")
      : "Water level data is temporarily unavailable.";
    return { content: [{ type: "text", text }], structuredContent: payload };
  }
  if (name === "get_fishing") {
    const fishing = await loadFishing(env);
    const payload = apiFishing(fishing);
    const text = payload.stations.length
      ? payload.stations
          .map((s) => {
            const wq =
              s.dissolvedOxygenMgL != null
                ? `${s.temperatureF != null ? `${s.temperatureF}°F, ` : ""}DO ${s.dissolvedOxygenMgL} mg/L${s.ph != null ? `, pH ${s.ph}` : ""}${s.turbidityFNU != null ? `, turbidity ${Math.round(s.turbidityFNU)} FNU` : ""}`
                : s.waterLevelFt != null
                ? `water level ${s.waterLevelFt} ft`
                : "no reading";
            return `- ${s.water}${s.spot ? ` (${s.spot})` : ""}: ${s.conditions} — ${wq}`;
          })
          .join("\n")
      : "Fishing conditions are temporarily unavailable.";
    return { content: [{ type: "text", text }], structuredContent: payload };
  }

  const { data } = await loadWeather(env);
  if (name === "get_current_conditions") {
    const now = currentHourly(data);
    const feels = feelsLikeF(now);
    const sun = sunTimesForCtDate(Date.now());
    const uvNow = uvCurrent(data);
    const aqi = data.aqi;
    const text = now
      ? `Crosby, TX: ${now.temperature}°${now.temperatureUnit}, ${now.shortForecast}` +
        `${feels != null ? `, feels like ${feels}°` : ""}${pop(now) ? `, ${pop(now)}% precip` : ""} (as of ${clockTime(now.startTime)} CT).` +
        `${uvNow ? ` UV index ${uvNow} (${uvCategory(uvNow)}).` : ""}` +
        `${aqi?.usAqi != null ? ` Air quality (${aqi.measured ? `measured, ${aqi.reportingArea || "Houston metro"} area` : "modeled"}) US AQI ${aqi.usAqi} (${aqiCategory(aqi.usAqi)}).` : ""}` +
        `${sun ? ` Sunrise ${clockTime(sun.sunrise)}, sunset ${clockTime(sun.sunset)} CT.` : ""}`
      : "Current conditions are unavailable.";
    return {
      content: [{ type: "text", text }],
      structuredContent: {
        location: data.place,
        updated: data.updated,
        sun: sun ? { sunrise: new Date(sun.sunrise).toISOString(), sunset: new Date(sun.sunset).toISOString() } : null,
        uv: uvNow != null ? { current: uvNow, currentCategory: uvCategory(uvNow), peakToday: uvPeakToday(data) } : null,
        airQuality: aqi?.usAqi != null ? { usAqi: aqi.usAqi, category: aqiCategory(aqi.usAqi), dominantPollutant: aqiDominantLabel(aqi.dominant), measured: !!aqi.measured, reportingArea: aqi.reportingArea ?? null, source: aqi.measured ? "EPA/AirNow measured (Houston metro reporting area)" : "Open-Meteo (modeled fallback)" } : null,
        current: now
          ? {
              ...now,
              feelsLike: feelsLikeRawF(now),
              // Normalized conveniences: NWS reports dew point in °C and wraps
              // humidity in a unit object — chat clients want plain numbers.
              dewpointF: typeof now.dewpoint?.value === "number" ? Math.round((now.dewpoint.value * 9) / 5 + 32) : null,
              humidityPercent: typeof now.relativeHumidity?.value === "number" ? Math.round(now.relativeHumidity.value) : null,
            }
          : null,
      },
    };
  }
  if (name === "get_forecast") {
    const hours = Number(args?.hours) || 0;
    if (hours > 0) {
      // The KV cache keeps 48 hourly periods (the /hourly page's supply) —
      // serve up to all of them so "tomorrow evening" is answerable.
      const slice = (data.hourly ?? []).slice(0, Math.min(hours, 48));
      const text =
        slice
          .map((h) => {
            const feels = feelsLikeRawF(h);
            return `${hourLabel(h.startTime)}: ${h.temperature}°${h.temperatureUnit}, ${h.shortForecast}${feels != null ? `, feels like ${feels}°` : ""}${pop(h) ? `, ${pop(h)}% precip` : ""}`;
          })
          .join("\n") || "No hourly data.";
      return { content: [{ type: "text", text }], structuredContent: { location: data.place, hourly: slice.map((h) => ({ ...h, feelsLike: feelsLikeRawF(h) })) } };
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
        protocolVersion: MCP_SUPPORTED_VERSIONS.includes(params?.protocolVersion) ? params.protocolVersion : MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false }, prompts: { listChanged: false }, resources: { listChanged: false } },
        serverInfo: MCP_SERVER_INFO,
        instructions:
          "Live Crosby, Texas data: weather from the U.S. National Weather Service, a measured air-quality index (EPA/AirNow), the daily pollen and mold count, the Atlantic tropical outlook, river/bayou flood levels, USGS water conditions for nearby fishing waters, road incidents and lane closures, a radar image, local news headlines, the Crosby ISD school calendar, and an emergency-contacts directory.",
      });
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: mcpTools() });
    case "prompts/list":
      return rpcResult(id, { prompts: mcpPrompts() });
    case "prompts/get":
      try {
        return rpcResult(id, await mcpGetPrompt(params?.name, env));
      } catch (e) {
        return rpcError(id, typeof e?.code === "number" ? e.code : -32603, (e && e.message) || "prompt failed");
      }
    case "resources/list":
      return rpcResult(id, { resources: MCP_RESOURCES });
    case "resources/read": {
      const res = mcpReadResource(params?.uri);
      return res ? rpcResult(id, res) : rpcError(id, -32602, `Unknown resource: ${params?.uri}`);
    }
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
- Tools: get_current_conditions, get_forecast (optional hours 1-48), get_alerts

## Other Crosby data (same API and MCP server)

- GET https://crosbynews.com/api/news - recent local Crosby headlines (JSON);
  MCP tool: get_crosby_news
- GET https://crosbynews.com/api/calendar - upcoming Crosby ISD school
  calendar events (JSON); MCP tool: get_school_events (optional limit 1-60)
- GET https://crosbynews.com/api/water - river/bayou levels with NWS flood
  stages for the Crosby area (JSON); MCP tool: get_river_levels
- GET https://crosbynews.com/api/tropics - active Atlantic tropical cyclones
  from the NOAA NHC (JSON); MCP tool: get_tropical_outlook
- GET https://crosbynews.com/api/pollen - measured daily pollen and mold count
  from the Houston Health Department (JSON); MCP tool: get_pollen
- GET https://crosbynews.com/api/air - measured US AQI for the Houston metro
  area incl. Crosby (EPA/AirNow, JSON); MCP tool: get_air_quality
- GET https://crosbynews.com/api/traffic - Crosby-corridor road incidents and
  lane closures from Houston TranStar (JSON); MCP tool: get_traffic
- GET https://crosbynews.com/api/fishing - water conditions (temperature,
  dissolved oxygen, pH, clarity) for the waters people fish near Crosby, from
  USGS real-time monitoring (JSON); MCP tool: get_fishing
- MCP-only tools: get_emergency_contacts (Crosby emergency directory) and
  get_radar (latest NWS KHGX radar still, returned as an inline image)

## Notes

- Public and unauthenticated; no rate limits.
- Source data is public domain. Attribute "U.S. National Weather Service".
`;

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Base64 SHA-256 — the form a CSP `'sha256-...'` source expression expects.
async function sha256Base64(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  let bin = "";
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return btoa(bin);
}

// Content-Security-Policy. Scripts are limited to same-origin, the one inline
// homepage block (allow-listed by its exact hash), and Cloudflare Web Analytics,
// whose beacon.min.js (static.cloudflareinsights.com) Cloudflare injects into
// browser responses and which reports to cloudflareinsights.com. 'unsafe-inline'
// is a backward-compat fallback only — browsers that honour the hash ignore it.
// Inline <style> blocks/attributes still need 'unsafe-inline' on style-src.
// Computed once per isolate and cached.
let CSP_CACHE = null;
async function contentSecurityPolicy() {
  if (!CSP_CACHE) {
    const scriptHash = await sha256Base64(HOME_SCRIPT);
    const pushHash = await sha256Base64(PUSH_CLIENT_SCRIPT);
    const newsAdminHash = await sha256Base64(NEWS_ADMIN_SCRIPT);
    CSP_CACHE = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      `script-src 'self' 'unsafe-inline' 'sha256-${scriptHash}' 'sha256-${pushHash}' 'sha256-${newsAdminHash}' https://static.cloudflareinsights.com`,
      "connect-src 'self' https://cloudflareinsights.com",
      "form-action 'self'",
    ].join("; ");
  }
  return CSP_CACHE;
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

// --- Severe-alert Web Push ---------------------------------------------------
// Opt-in browser push for life-threatening warnings only. Design: the Worker
// sends an EMPTY VAPID-authenticated wake-up (no encrypted payload — sidesteps
// the ECDH/HKDF/AES-GCM payload encryption entirely); the service worker
// composes the notification locally from /api/weather. We store only an
// anonymous push endpoint + its keys (no personal data), one KV entry per
// subscription under the `push:` prefix, and prune dead ones on 404/410.
const PUSH_PREFIX = "push:";
const PUSH_NOTIFIED_KEY = "push_notified"; // alert IDs already pushed (dedupe)
// Warnings that earn a push — warnings only, never watches/advisories. Kept in
// sync with PUSH_EVENTS in SW_SCRIPT.
const SEVERE_PUSH_EVENTS = new Set([
  "Tornado Warning",
  "Flash Flood Warning",
  "Hurricane Warning",
  "Hurricane Force Wind Warning",
  "Extreme Wind Warning",
  "Tropical Storm Warning",
]);
// SSRF guard: the cron POSTs to whatever endpoint a subscription stored, so we
// only ever accept real browser push-service hosts. Without this, a crafted
// subscribe body could turn our cron into an SSRF vector.
const PUSH_HOST_ALLOW = [
  /\.googleapis\.com$/, // FCM (Chrome/Edge/Android)
  /\.push\.apple\.com$/, // Safari/iOS
  /\.notify\.windows\.com$/, // legacy Edge/Windows
  /\.push\.services\.mozilla\.com$/, // Firefox
];
function pushEndpointAllowed(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && PUSH_HOST_ALLOW.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

const b64urlToBytes = (s) => {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const bytesToB64url = (bytes) => {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64urlJson = (obj) => bytesToB64url(new TextEncoder().encode(JSON.stringify(obj)));

// Build a VAPID Authorization header for a given push endpoint. Signs a short
// ES256 JWT (WebCrypto ECDSA P-256 already yields the raw r||s form JWS wants,
// so no DER unwrapping) with the private JWK secret. Returns null if the
// VAPID secrets aren't configured, so the whole feature no-ops safely.
async function vapidAuth(endpoint, env) {
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) return null;
  const { origin } = new URL(endpoint);
  const jwk = JSON.parse(env.VAPID_PRIVATE_KEY);
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = b64urlJson({ typ: "JWT", alg: "ES256" });
  const payload = b64urlJson({ aud: origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "mailto:security@crosbynews.com" });
  const unsigned = `${header}.${payload}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${bytesToB64url(sig)}`;
  return { Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}` };
}

// Send one empty wake-up. 201/202 = accepted; 404/410 = subscription gone
// (caller prunes). Returns the HTTP status (or 0 on network error).
async function sendPush(subscription, env) {
  const headers = await vapidAuth(subscription.endpoint, env);
  if (!headers) return 0;
  try {
    const res = await fetch(subscription.endpoint, {
      method: "POST",
      headers: { ...headers, TTL: "3600", "Content-Length": "0", Urgency: "high" },
    });
    return res.status;
  } catch (e) {
    console.error("push send failed:", e && e.message);
    return 0;
  }
}

// A stable KV key for a subscription (hash of its endpoint), so re-subscribing
// the same browser overwrites rather than duplicates.
async function pushKeyFor(endpoint) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return PUSH_PREFIX + [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Cron hook: if any NEW severe warning is active (not already notified), wake
// every subscriber once, then remember the alert IDs so ongoing warnings don't
// re-notify every 15 minutes. Prunes dead subscriptions and stale notified IDs.
async function pushSevereAlerts(env, alerts) {
  if (!env.VAPID_PRIVATE_KEY) return; // feature not configured
  const severe = (alerts ?? []).filter((a) => SEVERE_PUSH_EVENTS.has(a.event));
  const activeIds = severe.map((a) => a.id).filter(Boolean);
  let notified = [];
  try {
    notified = (await env.WEATHER.get(PUSH_NOTIFIED_KEY, "json")) || [];
  } catch {}
  const fresh = activeIds.filter((id) => !notified.includes(id));
  // Always reconcile the notified set to only-currently-active IDs (so an alert
  // that clears and later reissues under a new ID can notify again).
  const nextNotified = activeIds.slice();
  if (JSON.stringify(nextNotified.sort()) !== JSON.stringify([...notified].sort())) {
    await env.WEATHER.put(PUSH_NOTIFIED_KEY, JSON.stringify(nextNotified));
  }
  if (!fresh.length) return; // nothing new to announce

  const list = await env.WEATHER.list({ prefix: PUSH_PREFIX });
  for (const k of list.keys) {
    let sub = null;
    try {
      sub = await env.WEATHER.get(k.name, "json");
    } catch {}
    if (!sub || !sub.endpoint) {
      await env.WEATHER.delete(k.name);
      continue;
    }
    const status = await sendPush(sub, env);
    if (status === 404 || status === 410) await env.WEATHER.delete(k.name); // gone — prune
  }
}
// --- end Severe-alert Web Push -----------------------------------------------

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
