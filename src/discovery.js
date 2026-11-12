// Crawler- and agent-facing discovery surfaces, plus the CSP.
//
// The agent-skills index publishes a SHA-256 of CROSBY_WEATHER_SKILL computed
// at request time from the same constant the SKILL.md route serves, so the two
// cannot disagree. contentSecurityPolicy() uses the same trick for the three
// inline page scripts.
//
// The page and endpoint lists in llmsTxt() and sitemapXml() come from
// registry.js. llmsTxt() and CROSBY_WEATHER_SKILL still name the MCP tools in
// prose by hand.

import { SITE } from "./config.js";
import { esPath } from "./i18n.js";
import { PAGES, ENDPOINTS } from "./registry.js";
import { HOME_SCRIPT, NEWS_ADMIN_SCRIPT, PUSH_CLIENT_SCRIPT } from "./assets/client-scripts.js";
// /llms.txt — concise site summary for LLMs (llmstxt.org spec).
export function llmsTxt() {
  return `# crosbynews.com

> Live weather and local news for Crosby, Texas — fast, no ads, no trackers.

crosbynews.com is an independent weather and news site for Crosby, TX (northeast Harris County). Weather data comes exclusively from the U.S. National Weather Service (api.weather.gov) and is refreshed every 15 minutes. Local news headlines are aggregated daily from Texas and Houston-area outlets and filtered for relevance to the Crosby community.

## Pages

${PAGES.map((p) => `- [${p.name.en}](${SITE}${p.path === "/" ? "/" : p.path}): ${p.llms}`).join("\n")}

## Languages

Every page is also available in Mexican Spanish (es-MX) under the /es prefix — e.g. ${SITE}/es, ${SITE}/es/hourly, ${SITE}/es/alerts, ${SITE}/es/about. The English and Spanish URLs are linked with hreflang. Forecast conditions are translated with a hand-built dictionary; detailed NWS forecast descriptions and weather alerts remain in official English (NWS publishes no Spanish forecast/alert API). The JSON API and MCP server are English-only.

## API & agent access

Every page supports \`Accept: text/markdown\` (or \`?format=md\`) for a clean markdown rendering.

${ENDPOINTS.filter((e) => e.group === "api").map((e) => `- ${e.name.en}: \`GET ${SITE}${e.path}\` — ${e.llms}`).join("\n")}
- MCP server (Streamable HTTP): \`${SITE}/mcp\` — tools: \`get_current_conditions\`, \`get_forecast\`, \`get_alerts\`, \`get_tropical_outlook\`, \`get_pollen\`, \`get_burn_ban\`, \`get_air_quality\`, \`get_river_levels\`, \`get_fishing\`, \`get_traffic\`, \`get_crosby_news\`, \`get_school_events\`, \`get_emergency_contacts\`, \`get_radar\`, \`get_flood_history\`, \`get_warning_history\`
- MCP server card: \`${SITE}/.well-known/mcp/server-card.json\`

## Data policy

Source data is U.S. government public domain (NWS). No authentication required. No rate limits. Attribution: "U.S. National Weather Service".

## Optional

${ENDPOINTS.filter((e) => e.group === "optional").map((e) => `- [${e.name.en}](${SITE}${e.path}): ${e.llms}`).join("\n")}
`;
}

// /robots.txt — RFC 9309 crawl rules, explicit AI-crawler entries, and a
// sitemap reference. Open by design: this is public-domain NWS data and the
// site wants to be discoverable by agents. (No Content-Signal line — it
// confused some crawlers when present, so it's intentionally omitted.)
export function robotsTxt() {
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
//
// <lastmod> is the moment the page's DATA last changed — `changedAt` in the
// cron's status record, which moves only when a feed's content does, not every
// time it is re-fetched. Google uses lastmod only while it proves accurate, so
// a page with no such instant (the static ones) gets no lastmod at all.
// No <changefreq> or <priority>: Google ignores both.
// `dates` maps an English path to an instant (or null) for pages that date
// themselves (router.js handlers with lastmod); it wins over `feeds`.
export function sitemapXml(cronStatus, dates = {}) {
  const changed = (page) => {
    const stamps = (page.feeds || []).map((f) => cronStatus?.feeds?.[f]?.changedAt).filter((x) => typeof x === "string" && !Number.isNaN(Date.parse(x)));
    return stamps.length ? new Date(stamps.sort().at(-1)).toISOString() : null;
  };
  const entry = (loc, page) => {
    const en = SITE + page.path;
    const es = SITE + esPath(page.path);
    const alts =
      `\n    <xhtml:link rel="alternate" hreflang="en-US" href="${en}"/>` +
      `\n    <xhtml:link rel="alternate" hreflang="es-MX" href="${es}"/>` +
      `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${en}"/>`;
    const when = Object.hasOwn(dates, page.path) ? dates[page.path] : changed(page);
    return `  <url>
    <loc>${loc}</loc>${when ? `\n    <lastmod>${when}</lastmod>` : ""}${alts}
  </url>`;
  };
  const urls = [];
  for (const page of PAGES) {
    urls.push(entry(SITE + page.path, page));
    urls.push(entry(SITE + esPath(page.path), page));
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join("\n")}
</urlset>
`;
}

// --- Agent Skills discovery (agentskills.io v0.2.0) -----------------------
export const SKILLS_SCHEMA = "https://schemas.agentskills.io/discovery/0.2.0/schema.json";

// A real skill: it documents this site's actual public API + MCP server.
export const CROSBY_WEATHER_SKILL = `---
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
- GET https://crosbynews.com/api/health - site liveness, when each feed last
  tried to refresh and whether it worked, and when its data last changed
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
  from the NOAA NHC, plus unnamed areas under watch and their formation
  chances (JSON); MCP tool: get_tropical_outlook
- GET https://crosbynews.com/api/pollen - measured daily pollen and mold count
  from the Houston Health Department (JSON); MCP tool: get_pollen
- GET https://crosbynews.com/api/burn-ban - Harris County's current outdoor-
  burning ban status from the Texas A&M Forest Service (JSON; countywide
  only); MCP tool: get_burn_ban
- GET https://crosbynews.com/api/air - measured US AQI for the Houston metro
  area incl. Crosby (EPA/AirNow, JSON); MCP tool: get_air_quality
- GET https://crosbynews.com/api/traffic - Crosby-corridor road incidents and
  lane closures from Houston TranStar (JSON); MCP tool: get_traffic
- GET https://crosbynews.com/api/fishing - water conditions (temperature,
  dissolved oxygen, pH, clarity) for the waters people fish near Crosby, from
  USGS real-time monitoring (JSON); MCP tool: get_fishing
- MCP-only tools: get_emergency_contacts (Crosby emergency directory),
  get_radar (latest NWS KHGX radar still, returned as an inline image),
  get_flood_history (each nearby river gauge's historic crests against
  today's flood stages, and its river flood warnings) and get_warning_history
  (NWS warnings that covered Crosby, by type and year)

## Notes

- Public and unauthenticated; no rate limits.
- Source data is public domain. Attribute "U.S. National Weather Service".
`;

export async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Base64 SHA-256 — the form a CSP `'sha256-...'` source expression expects.
export async function sha256Base64(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  let bin = "";
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return btoa(bin);
}

// Content-Security-Policy. Scripts are limited to same-origin and the inline
// blocks allow-listed by their exact hashes — no third-party script origin is
// permitted at all. Cloudflare Web Analytics used to be the one exception: its
// beacon.min.js (static.cloudflareinsights.com) was injected at the edge, not by
// this Worker, and reported to cloudflareinsights.com. That site was deleted on
// 2026-08-19, so the allowances are gone and the policy now matches the "no
// third-party analytics scripts" claim on /privacy and /about. Adding any
// analytics vendor means widening script-src AND connect-src here and correcting
// both pages in both languages — see docs/ops/analytics.md.
// 'unsafe-inline' is a backward-compat fallback only — browsers that honour the
// hash ignore it.
// Inline <style> blocks/attributes still need 'unsafe-inline' on style-src.
// Computed once per isolate and cached.
let CSP_CACHE = null;
export async function contentSecurityPolicy() {
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
      `script-src 'self' 'unsafe-inline' 'sha256-${scriptHash}' 'sha256-${pushHash}' 'sha256-${newsAdminHash}'`,
      "connect-src 'self'",
      "form-action 'self'",
    ].join("; ");
  }
  return CSP_CACHE;
}

export async function agentSkillsIndex() {
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
