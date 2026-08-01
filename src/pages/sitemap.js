// The human-readable sitemap. Hand-maintained: adding a page or a public
// endpoint means adding it here too. Distinct from /sitemap.xml.

import { SITE } from "../config.js";
import { T, canonicalFor, hreflangTags, esPath } from "../i18n.js";
import { esc } from "../lib/format.js";
import { BASE_CSS } from "../assets/base-css.js";
import { topbar, footer } from "../chrome.js";
import { JSONLD_SITE, OG_COMMON, ORG_ID, WEBSITE_ID } from "../seo.js";


export function sitemapPageHtml(lang) {
  const t = (en, es) => T(lang, en, es);
  const lk = (enHref, label, desc) => {
    const href = lang === "es" ? esPath(enHref) : enHref;
    return `<li><a href="${href}">${label}</a> &mdash; ${desc}</li>`;
  };
  const extLk = (href, label, desc) => `<li><a href="${href}">${label}</a> &mdash; ${desc}</li>`;

  const title = t("Sitemap", "Mapa del sitio");
  const description = t(
    "Every page and endpoint on crosbynews.com, organized by category.",
    "Todas las páginas y endpoints de crosbynews.com, organizados por categoría.",
  );

  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} &mdash; ${t("Crosby, TX Weather", "Clima de Crosby, TX")}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/sitemap", lang)}">
${OG_COMMON}
<link rel="canonical" href="${canonicalFor("/sitemap", lang)}">
${hreflangTags("/sitemap")}
${JSONLD_SITE}
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  .card { background:var(--card); border-radius:12px; padding:0.9rem 1.1rem; margin-top:1rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); }
  .card h2 { margin:0 0 0.5rem; }
  .card ul { margin:0.5rem 0; padding-left:1.3rem; }
  .card li { margin:0.3rem 0; }
  .lede { font-size:1.05rem; color:var(--ink); }
</style>
</head>
<body>
${topbar("/sitemap", lang)}
<main id="main">
  <h1>${esc(title)}</h1>
  <p class="lede">${esc(description)}</p>

  <section class="card">
    <h2>${t("Weather &amp; Forecast", "Clima y pronóstico")}</h2>
    <ul>
      ${lk("/", t("Home", "Inicio"), t("The Crosby front page — conditions, water, news, and school events at a glance.", "La página principal de Crosby — condiciones, agua, noticias y eventos escolares de un vistazo."))}
      ${lk("/weather", t("Weather", "Clima"), t("Current conditions, 12-hour hourly strip, and 7-day forecast.", "Condiciones actuales, franja horaria de 12 horas y pronóstico a 7 días."))}
      ${lk("/hourly", t("Hourly Forecast", "Pronóstico por hora"), t("Full 48-hour hour-by-hour forecast table.", "Tabla completa de pronóstico hora por hora de 48 horas."))}
      ${lk("/radar", t("Radar", "Radar"), t("Live NWS KHGX radar loop for the Crosby area.", "Radar en vivo del NWS KHGX para la zona de Crosby."))}
      ${lk("/alerts", t("Alerts", "Alertas"), t("Active NWS weather alerts plus a severe-weather guide.", "Alertas meteorológicas activas del NWS más una guía de clima severo."))}
      ${lk("/water", t("Water Levels", "Niveles de agua"), t("Live river and bayou levels with NWS flood stages.", "Niveles de ríos y arroyos en vivo con las etapas de inundación del NWS."))}
      ${lk("/fishing", t("Fishing", "Pesca"), t("Live water conditions for the waters people fish near Crosby.", "Condiciones del agua para las aguas donde se pesca cerca de Crosby."))}
      ${lk("/tropics", t("Tropics", "Trópicos"), t("Active Atlantic tropical systems from the National Hurricane Center.", "Sistemas tropicales activos del Atlántico según el Centro Nacional de Huracanes."))}
      ${lk("/pollen", t("Pollen &amp; Mold", "Polen y moho"), t("Measured daily pollen and mold count from the Houston Health Department.", "Conteo diario medido de polen y moho del Departamento de Salud de Houston."))}
      ${lk("/air", t("Air Quality", "Calidad del aire"), t("Measured AQI for the Houston / Crosby area from EPA/AirNow, with a per-pollutant breakdown.", "AQI medido para la zona de Houston / Crosby de EPA/AirNow, con desglose por contaminante."))}
    </ul>
  </section>

  <section class="card">
    <h2>${t("Community", "Comunidad")}</h2>
    <ul>
      ${lk("/news", t("News", "Noticias"), t("Local headlines about Crosby, TX and nearby communities.", "Titulares locales sobre Crosby, TX y comunidades cercanas."))}
      ${lk("/traffic", t("Roads &amp; Traffic", "Caminos y tráfico"), t("Incidents and lane closures on US-90, FM-2100, and IH-10 East, with live cameras.", "Incidentes y cierres de carriles en US-90, FM-2100 e IH-10 East, con cámaras en vivo."))}
      ${lk("/calendar", t("School Calendar", "Calendario escolar"), t("Upcoming Crosby ISD school calendar events.", "Próximos eventos del calendario escolar de Crosby ISD."))}
      ${lk("/emergency", t("Emergency Resources", "Recursos de emergencia"), t("911 and non-emergency numbers, outages, flooding, shelters, and disaster help.", "El 911 y números que no son de emergencia, apagones, inundaciones, refugios y ayuda por desastre."))}
    </ul>
  </section>

  <section class="card">
    <h2>${t("About &amp; Policies", "Acerca de y políticas")}</h2>
    <ul>
      ${lk("/about", t("About", "Acerca de"), t("What this site is, data sources, API, and MCP server.", "Qué es este sitio, fuentes de datos, API y servidor MCP."))}
      ${lk("/privacy", t("Privacy Policy", "Política de privacidad"), t("No cookies, no trackers — how we handle your data.", "Sin cookies, sin rastreadores — cómo manejamos tus datos."))}
      ${lk("/contact", t("Contact", "Contacto"), t("How to reach us for questions, tips, and security reports.", "Cómo comunicarte con nosotros para preguntas, datos y reportes de seguridad."))}
    </ul>
  </section>

  <section class="card">
    <h2>${t("For Developers &amp; Agents", "Para desarrolladores y agentes")}</h2>
    <ul>
      ${lk("/developers", t("Developers &amp; Agents", "Desarrolladores y agentes"), t("Start here — the API, MCP server, feeds, and agent integrations, documented on one page.", "Empieza aquí — la API, el servidor MCP, los feeds y las integraciones para agentes, en una sola página."))}
      ${extLk("/api/weather", t("Weather API", "API del clima"), t("JSON: current conditions, hourly, 7-day, and alerts.", "JSON: condiciones actuales, por hora, 7 días y alertas."))}
      ${extLk("/api/news", t("News API", "API de noticias"), t("JSON: recent local headlines.", "JSON: titulares locales recientes."))}
      ${extLk("/api/calendar", t("School Calendar API", "API del calendario escolar"), t("JSON: upcoming Crosby ISD events.", "JSON: próximos eventos de Crosby ISD."))}
      ${extLk("/api/traffic", t("Traffic API", "API de tráfico"), t("JSON: incidents and lane closures on Crosby's roads.", "JSON: incidentes y cierres de carriles en los caminos de Crosby."))}
      ${extLk("/api/pollen", t("Pollen API", "API de polen"), t("JSON: the measured daily pollen and mold count.", "JSON: el conteo diario medido de polen y moho."))}
      ${extLk("/api/air", t("Air Quality API", "API de calidad del aire"), t("JSON: the measured AQI + per-pollutant breakdown.", "JSON: el AQI medido + desglose por contaminante."))}
      ${extLk("/api/health", t("Health Check", "Estado del servicio"), t("Service status and cache freshness.", "Estado del servicio y antigüedad de la caché."))}
      ${extLk("/openapi.json", "OpenAPI 3.1", t("Machine-readable API description.", "Descripción de la API legible por máquinas."))}
      ${extLk("/mcp", t("MCP Server", "Servidor MCP"), t("Model Context Protocol server (Streamable HTTP).", "Servidor del Protocolo de Contexto de Modelo (Streamable HTTP)."))}
      ${extLk("/llms.txt", "llms.txt", t("Plain-language site summary for LLMs.", "Resumen del sitio en lenguaje sencillo para LLM."))}
      ${extLk("/alerts.xml", t("Alerts RSS", "RSS de alertas"), t("Active weather alerts as an RSS feed.", "Alertas meteorológicas activas como feed RSS."))}
      ${extLk("/news.xml", t("News RSS", "RSS de noticias"), t("Local headlines as an RSS feed.", "Titulares locales como feed RSS."))}
      ${extLk("/badge.svg", t("Weather Badge", "Insignia del clima"), t("Hotlinkable live SVG weather badge for other sites.", "Insignia SVG del clima en vivo para enlazar desde otros sitios."))}
      ${extLk("/.well-known/api-catalog", t("API Catalog", "Catálogo de API"), t("RFC 9727 machine-readable API index.", "Índice de API legible por máquinas (RFC 9727)."))}
      ${extLk("/sitemap.xml", t("XML Sitemap", "Sitemap XML"), t("Machine-readable sitemap for crawlers.", "Sitemap legible por máquinas para rastreadores."))}
    </ul>
  </section>
</main>
${footer({ page: "/sitemap", lang, source: T(lang, `Data from the U.S. National Weather Service (<a href="https://weather.gov">weather.gov</a>).`, `Datos del Servicio Meteorológico Nacional de EE. UU. (<a href="https://weather.gov">weather.gov</a>).`) })}
</body>
</html>`;
}

export function sitemapPageMarkdown(lang) {
  const t = (en, es) => T(lang, en, es);
  const lk = (enHref, label, desc) => `- [${label}](${SITE}${lang === "es" ? esPath(enHref) : enHref}) — ${desc}`;
  const extLk = (href, label, desc) => `- [${label}](${SITE}${href}) — ${desc}`;

  const out = [
    `# ${t("Sitemap", "Mapa del sitio")}`,
    "",
    t("Every page and endpoint on crosbynews.com.", "Todas las páginas y endpoints de crosbynews.com."),
    "",
    `## ${t("Weather & Forecast", "Clima y pronóstico")}`,
    "",
    lk("/", t("Home", "Inicio"), t("The Crosby front page.", "La página principal de Crosby.")),
    lk("/weather", t("Weather", "Clima"), t("Current conditions, hourly, and 7-day forecast.", "Condiciones actuales, por hora y pronóstico a 7 días.")),
    lk("/hourly", t("Hourly Forecast", "Pronóstico por hora"), t("Full 48-hour table.", "Tabla completa de 48 horas.")),
    lk("/radar", t("Radar", "Radar"), t("Live NWS KHGX radar loop.", "Radar en vivo del NWS KHGX.")),
    lk("/alerts", t("Alerts", "Alertas"), t("Active weather alerts plus severe-weather guide.", "Alertas activas más guía de clima severo.")),
    lk("/water", t("Water Levels", "Niveles de agua"), t("River and bayou levels with NWS flood stages.", "Niveles de ríos y arroyos con las etapas de inundación del NWS.")),
    lk("/fishing", t("Fishing", "Pesca"), t("Live water conditions for nearby fishing waters.", "Condiciones del agua para aguas de pesca cercanas.")),
    lk("/tropics", t("Tropics", "Trópicos"), t("Active Atlantic systems from the NHC.", "Sistemas activos del Atlántico según el NHC.")),
    lk("/pollen", t("Pollen & Mold", "Polen y moho"), t("Measured daily count from the Houston Health Department.", "Conteo diario medido del Departamento de Salud de Houston.")),
    lk("/air", t("Air Quality", "Calidad del aire"), t("Measured AQI from EPA/AirNow, per-pollutant.", "AQI medido de EPA/AirNow, por contaminante.")),
    "",
    `## ${t("Community", "Comunidad")}`,
    "",
    lk("/news", t("News", "Noticias"), t("Local headlines.", "Titulares locales.")),
    lk("/traffic", t("Roads & Traffic", "Caminos y tráfico"), t("Incidents, lane closures, cameras.", "Incidentes, cierres de carriles, cámaras.")),
    lk("/calendar", t("School Calendar", "Calendario escolar"), t("Crosby ISD events.", "Eventos de Crosby ISD.")),
    lk("/emergency", t("Emergency Resources", "Recursos de emergencia"), t("911, outages, flooding, shelters, disaster help.", "911, apagones, inundaciones, refugios, ayuda por desastre.")),
    "",
    `## ${t("About & Policies", "Acerca de y políticas")}`,
    "",
    lk("/about", t("About", "Acerca de"), t("Data sources, API, MCP server.", "Fuentes de datos, API, servidor MCP.")),
    lk("/privacy", t("Privacy", "Privacidad"), t("No cookies, no trackers.", "Sin cookies, sin rastreadores.")),
    lk("/contact", t("Contact", "Contacto"), t("Questions, tips, security.", "Preguntas, datos, seguridad.")),
    "",
    `## ${t("For Developers & Agents", "Para desarrolladores y agentes")}`,
    "",
    lk("/developers", t("Developers & Agents", "Desarrolladores y agentes"), t("Start here — API, MCP, feeds, agents on one page.", "Empieza aquí — API, MCP, feeds y agentes en una página.")),
    extLk("/api/weather", t("Weather API", "API del clima"), "JSON"),
    extLk("/api/news", t("News API", "API de noticias"), "JSON"),
    extLk("/api/calendar", t("School Calendar API", "API del calendario escolar"), "JSON"),
    extLk("/api/traffic", t("Traffic API", "API de tráfico"), "JSON"),
    extLk("/api/pollen", t("Pollen API", "API de polen"), "JSON"),
    extLk("/api/air", t("Air Quality API", "API de calidad del aire"), "JSON"),
    extLk("/api/health", t("Health", "Estado"), t("Status + cache.", "Estado + caché.")),
    extLk("/openapi.json", "OpenAPI 3.1", t("API spec.", "Especificación de la API.")),
    extLk("/mcp", t("MCP Server", "Servidor MCP"), "Streamable HTTP"),
    extLk("/llms.txt", "llms.txt", t("LLM summary.", "Resumen para LLM.")),
    extLk("/alerts.xml", t("Alerts RSS", "RSS de alertas"), "RSS 2.0"),
    extLk("/news.xml", t("News RSS", "RSS de noticias"), "RSS 2.0"),
    extLk("/badge.svg", t("Weather Badge", "Insignia del clima"), t("Hotlinkable SVG.", "SVG para enlazar.")),
    extLk("/.well-known/api-catalog", t("API Catalog", "Catálogo de API"), "RFC 9727"),
    extLk("/sitemap.xml", t("XML Sitemap", "Sitemap XML"), t("For crawlers.", "Para rastreadores.")),
    "",
    "---",
    `[crosbynews.com](${canonicalFor("/", lang)}) · ${t("weather for Crosby, Texas", "clima para Crosby, Texas")}`,
  ];
  return out.join("\n");
}
