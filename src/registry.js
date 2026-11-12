// The site's one list of pages and public endpoints.
//
// Everything that enumerates pages is generated from PAGES: the canonical path
// set (index.js), the header nav and footer links (chrome.js), /sitemap.xml and
// the Pages section of /llms.txt (discovery.js), and the /sitemap page
// (pages/sitemap.js). The router refuses to start without a handler for each
// entry, and scripts/test-routes.mjs requests every one in both languages.
//
// This module is data only and imports nothing but config and i18n (which
// imports only config), so any module can import it without creating a cycle. Handlers live in router.js.
//
// Text here is PLAIN TEXT (a literal "&", never "&amp;"): HTML renderers
// escape it, Markdown renderers use it as written.

import { esPath } from "./i18n.js";

export const SECTIONS = [
  { id: "weather", name: { en: "Weather & Conditions", es: "Clima y condiciones" }, nav: { en: "Weather", es: "Clima" } },
  { id: "community", name: { en: "Community", es: "Comunidad" }, nav: { en: "Community", es: "Comunidad" } },
  { id: "about", name: { en: "About & Policies", es: "Acerca de y políticas" }, nav: { en: "More", es: "Más" } },
  { id: "developers", name: { en: "For Developers & Agents", es: "Para desarrolladores y agentes" }, nav: { en: "More", es: "Más" } },
];

// Fields:
//   path     English path. The Spanish page is the same path under /es.
//   section  Which SECTIONS group lists it.
//   name     Full name: /sitemap page and llms.txt.
//   nav      Short header-nav label; `desktop: false` keeps it in the mobile
//            menu only. Omit to leave the page out of the header.
//   footer   Short footer-link label. Omit to leave it out of the footer.
//   desc     One line for the /sitemap page.
//   llms     One line for llms.txt (English only, like the file).
//   maxAge   Browser cache lifetime in seconds for both representations.
//   feeds    The cron feeds (names as on /api/health) whose data the page
//            shows. /sitemap.xml dates the page by when that data last
//            changed. Omit for a static page, which then carries no date —
//            an absent date is honest, a guessed one is not.
//   gauge    NWPS location id, for a river-gauge page (served by the shared
//            gauge handler in router.js and linked from its /water card).
//            Such a page is dated in /sitemap.xml by its handler's lastmod().
//   custom   true when router.js serves the path outside the shared page
//            handler (the two /mcp explainers, which share a path with the
//            protocol endpoint).
export const PAGES = [
  {
    path: "/", section: "weather", maxAge: 300,
    name: { en: "Home", es: "Inicio" },
    nav: { en: "Home", es: "Inicio", desktop: true },
    footer: { en: "Home", es: "Inicio" },
    desc: { en: "The Crosby front page — conditions, water, news, and school events at a glance.", es: "La página principal de Crosby — condiciones, agua, noticias y eventos escolares de un vistazo." },
    llms: "The Crosby, TX front page — current conditions, water levels, local news, and school events at a glance, linking into each full section.",
    feeds: ["weather", "water", "news", "calendar", "tropics", "burnban"],
  },
  {
    path: "/weather", section: "weather", maxAge: 300,
    name: { en: "Weather", es: "Clima" },
    nav: { en: "Weather", es: "Clima", desktop: true },
    desc: { en: "Current conditions, 12-hour hourly strip, and 7-day forecast.", es: "Condiciones actuales, franja horaria de 12 horas y pronóstico a 7 días." },
    llms: "Current conditions, 12-hour hourly strip, and 7-day forecast for Crosby, TX.",
    feeds: ["weather"],
  },
  {
    path: "/hourly", section: "weather", maxAge: 300,
    name: { en: "Hourly Forecast", es: "Pronóstico por hora" },
    nav: { en: "Hourly", es: "Por hora", desktop: false },
    desc: { en: "Full 48-hour hour-by-hour forecast table.", es: "Tabla completa de pronóstico hora por hora de 48 horas." },
    llms: "Full 48-hour hour-by-hour forecast table grouped by day.",
    feeds: ["weather"],
  },
  {
    path: "/radar", section: "weather", maxAge: 3600,
    name: { en: "Radar", es: "Radar" },
    nav: { en: "Radar", es: "Radar", desktop: true },
    desc: { en: "Live NWS KHGX radar loop for the Crosby area.", es: "Radar en vivo del NWS KHGX para la zona de Crosby." },
    llms: "Live NWS KHGX (Houston-Galveston) radar loop covering Crosby and northeast Harris County.",
  },
  {
    path: "/alerts", section: "weather", maxAge: 300,
    name: { en: "Alerts", es: "Alertas" },
    nav: { en: "Alerts", es: "Alertas", desktop: true },
    desc: { en: "Active NWS weather alerts plus a severe-weather guide.", es: "Alertas meteorológicas activas del NWS más una guía de clima severo." },
    llms: "Active NWS weather alerts for Crosby, TX plus a plain-language severe-weather guide.",
    feeds: ["weather"],
  },
  {
    path: "/history", section: "weather", maxAge: 3600,
    name: { en: "Warning History", es: "Historial de avisos" },
    nav: { en: "Warning History", es: "Historial de avisos", desktop: false },
    desc: { en: "Every NWS warning that covered Crosby, TX: tornado, storm, flood, tropical and freeze warnings by type and year.", es: "Cada aviso del NWS que cubrió a Crosby, TX: tornados, tormentas, inundaciones, trópicos y heladas, por tipo y año." },
    llms: "The National Weather Service warnings, watches and advisories that covered Crosby, TX — polygon warnings since 2007-10-01, forecast-zone and county products since 2005, river flood warnings for nearby gauges — counted by type and year from the site's own record, with method notes and limits.",
  },
  {
    path: "/water", section: "weather", maxAge: 300,
    name: { en: "Water Levels", es: "Niveles de agua" },
    nav: { en: "Water Levels", es: "Niveles de agua", desktop: true },
    desc: { en: "Live river and bayou levels with NWS flood stages.", es: "Niveles de ríos y arroyos en vivo con las etapas de inundación del NWS." },
    llms: "Live river and bayou levels with NWS flood stages for Cedar Bayou, the San Jacinto River, Luce Bayou and other waters that flood the Crosby / NE Harris County area.",
    feeds: ["water"],
  },
  // One page per river gauge with a recorded flood history. `gauge` is the
  // NWPS location id the page is about; router.js gives each one the shared
  // gauge handler and /water links each card to its page. A gauge is listed
  // here only once the record gives it content of its own (NOAA crests): Luce
  // Bayou (HFFT2) and Goose Creek (GMKT2) have none yet.
  {
    path: "/water/cedar-bayou-crosby", section: "weather", maxAge: 900, gauge: "HCDT2",
    name: { en: "Cedar Bayou near Crosby: flood history", es: "Cedar Bayou cerca de Crosby: historial de inundaciones" },
    desc: { en: "Every crest NOAA lists for Cedar Bayou, its flood stages and warnings, and the current level.", es: "Cada cresta que NOAA registra para Cedar Bayou, sus etapas de inundación, avisos y el nivel actual." },
    llms: "Cedar Bayou near Crosby (NWS gauge HCDT2): every historic crest NOAA publishes, each measured against today's flood stages, river flood warnings for the gauge, the site's own daily readings, and the current level.",
  },
  {
    path: "/water/san-jacinto-sheldon", section: "weather", maxAge: 900, gauge: "SHLT2",
    name: { en: "San Jacinto River near Sheldon: flood history", es: "Río San Jacinto cerca de Sheldon: historial de inundaciones" },
    desc: { en: "Every crest NOAA lists for the San Jacinto near Sheldon, its flood stages and warnings, and the current level.", es: "Cada cresta que NOAA registra para el San Jacinto cerca de Sheldon, sus etapas, avisos y el nivel actual." },
    llms: "San Jacinto River near Sheldon (NWS gauge SHLT2): every historic crest NOAA publishes against today's flood stages, NOAA's flood-impact statements, river flood warnings for the gauge, the site's daily readings, and the current level.",
  },
  {
    path: "/water/lake-houston", section: "weather", maxAge: 900, gauge: "HSJT2",
    name: { en: "San Jacinto River at Lake Houston: flood history", es: "Río San Jacinto en Lake Houston: historial de inundaciones" },
    desc: { en: "Every crest NOAA lists for the Lake Houston gauge, and the current lake level.", es: "Cada cresta que NOAA registra para el medidor de Lake Houston y el nivel actual del lago." },
    llms: "San Jacinto River at Lake Houston (NWS gauge HSJT2): every historic crest NOAA publishes for the lake gauge, the site's daily readings, and the current level. NWS defines no flood stages for this gauge.",
  },
  {
    path: "/water/east-fork-new-caney", section: "weather", maxAge: 900, gauge: "NCET2",
    name: { en: "East Fork San Jacinto near New Caney: flood history", es: "Bifurcación Este del San Jacinto cerca de New Caney: historial" },
    desc: { en: "Every crest NOAA lists for the East Fork near New Caney, its flood stages and warnings, and the current level.", es: "Cada cresta que NOAA registra para la Bifurcación Este cerca de New Caney, sus etapas, avisos y el nivel actual." },
    llms: "East Fork San Jacinto River near New Caney (NWS gauge NCET2), upstream of Lake Houston: every historic crest NOAA publishes against today's flood stages, NOAA's flood-impact statements, river flood warnings for the gauge, the site's daily readings, and the current level.",
  },
  {
    path: "/fishing", section: "weather", maxAge: 300,
    name: { en: "Fishing Conditions", es: "Condiciones de pesca" },
    nav: { en: "Fishing", es: "Pesca", desktop: false },
    desc: { en: "Live water conditions for the waters people fish near Crosby.", es: "Condiciones del agua para las aguas donde se pesca cerca de Crosby." },
    llms: "Live USGS water conditions — temperature, dissolved oxygen, pH, and clarity — for the waters people fish near Crosby: Lake Houston, the San Jacinto River forks, the Trinity River, and nearby bayous.",
    feeds: ["fishing"],
  },
  {
    path: "/tropics", section: "weather", maxAge: 900,
    name: { en: "Tropics", es: "Trópicos" },
    nav: { en: "Tropics", es: "Trópicos", desktop: false },
    desc: { en: "Active Atlantic tropical systems from the National Hurricane Center.", es: "Sistemas tropicales activos del Atlántico según el Centro Nacional de Huracanes." },
    llms: "Active Atlantic tropical storms and hurricanes from the NOAA National Hurricane Center, the areas it is watching for development with their formation chances, plus what hurricane season means for Crosby — an all-clear only when there are neither.",
    feeds: ["tropics"],
  },
  {
    path: "/pollen", section: "weather", maxAge: 1800,
    name: { en: "Pollen & Mold", es: "Polen y moho" },
    nav: { en: "Pollen", es: "Polen", desktop: false },
    desc: { en: "Measured daily pollen and mold count from the Houston Health Department.", es: "Conteo diario medido de polen y moho del Departamento de Salud de Houston." },
    llms: "The Houston Health Department's measured daily pollen and mold count (tree, weed, and grass pollen plus mold spores, National Allergy Bureau scale) with the species actually counted — a real measurement, published weekday mornings, regionally valid for Crosby.",
    feeds: ["pollen"],
  },
  {
    path: "/air", section: "weather", maxAge: 600,
    name: { en: "Air Quality", es: "Calidad del aire" },
    nav: { en: "Air Quality", es: "Calidad del aire", desktop: false },
    desc: { en: "Measured AQI for the Houston / Crosby area from EPA/AirNow, with a per-pollutant breakdown.", es: "AQI medido para la zona de Houston / Crosby de EPA/AirNow, con desglose por contaminante." },
    llms: "Measured US Air Quality Index (AQI) for the Houston-Galveston-Brazoria reporting area that includes Crosby, from EPA/AirNow monitors, with a per-pollutant breakdown and health guidance (Open-Meteo modeled fallback when AirNow isn't reporting).",
    feeds: ["air"],
  },
  {
    path: "/burn-ban", section: "weather", maxAge: 1800,
    name: { en: "Burn Ban Status", es: "Estado de la prohibición de quemas" },
    nav: { en: "Burn Ban", es: "Prohibición de quemas", desktop: false },
    desc: { en: "Current Harris County outdoor-burning ban status from the Texas A&M Forest Service.", es: "Estado actual de la prohibición de quemas al aire libre del condado de Harris, según el Servicio Forestal de Texas A&M." },
    llms: "Current outdoor-burning ban status for Harris County, TX (which includes Crosby) from the Texas A&M Forest Service — countywide only, no sub-county resolution.",
    feeds: ["burnban"],
  },
  {
    path: "/news", section: "community", maxAge: 900,
    name: { en: "News", es: "Noticias" },
    nav: { en: "News", es: "Noticias", desktop: true },
    desc: { en: "Local headlines about Crosby, TX and nearby communities.", es: "Titulares locales sobre Crosby, TX y comunidades cercanas." },
    llms: "Recent local headlines about Crosby, TX and nearby communities, filtered for relevance.",
    feeds: ["news"],
  },
  {
    path: "/traffic", section: "community", maxAge: 300,
    name: { en: "Roads & Traffic", es: "Caminos y tráfico" },
    nav: { en: "Traffic", es: "Tráfico", desktop: false },
    desc: { en: "Incidents and lane closures on US-90, FM-2100, and IH-10 East, with live cameras.", es: "Incidentes y cierres de carriles en US-90, FM-2100 e IH-10 East, con cámaras en vivo." },
    llms: "Live traffic incidents and scheduled lane closures for US-90, FM-2100, FM-1942, and the Crosby stretch of IH-10 East, from Houston TranStar, with links to the live traffic cameras.",
    feeds: ["traffic"],
  },
  {
    path: "/calendar", section: "community", maxAge: 1800,
    name: { en: "School Calendar", es: "Calendario escolar" },
    nav: { en: "School Calendar", es: "Calendario escolar", desktop: true },
    desc: { en: "Upcoming Crosby ISD school calendar events.", es: "Próximos eventos del calendario escolar de Crosby ISD." },
    llms: "Upcoming Crosby ISD school calendar events (first day, holidays, no-school/early-release days, testing, athletics) rendered from the district's public iCal feed, plus one-tap subscribe links.",
    feeds: ["calendar"],
  },
  {
    path: "/emergency", section: "community", maxAge: 3600,
    name: { en: "Emergency Resources", es: "Recursos de emergencia" },
    nav: { en: "Emergency", es: "Emergencias", desktop: false },
    footer: { en: "Emergency", es: "Emergencias" },
    desc: { en: "911 and non-emergency numbers, outages, flooding, shelters, and disaster help.", es: "El 911 y números que no son de emergencia, apagones, inundaciones, refugios y ayuda por desastre." },
    llms: "Emergency contacts for Crosby, TX — 911 and non-emergency numbers, power outage and gas leak reporting, the CAER industrial-incident line, live flood and road conditions, evacuation-zone lookup, shelters, and disaster assistance.",
  },
  {
    path: "/about", section: "about", maxAge: 3600,
    name: { en: "About", es: "Acerca de" },
    nav: { en: "About", es: "Acerca de", desktop: true },
    footer: { en: "About", es: "Acerca de" },
    desc: { en: "What this site is, where its data comes from, and how often it updates.", es: "Qué es este sitio, de dónde vienen sus datos y cada cuánto se actualiza." },
    llms: "What this site is, where its data comes from, how often it updates, and how it's built.",
  },
  {
    path: "/privacy", section: "about", maxAge: 3600,
    name: { en: "Privacy Policy", es: "Política de privacidad" },
    footer: { en: "Privacy", es: "Privacidad" },
    desc: { en: "No cookies, no trackers — how we handle your data.", es: "Sin cookies, sin rastreadores — cómo manejamos tus datos." },
    llms: "Privacy policy — no cookies, no trackers, no personal data.",
  },
  {
    path: "/contact", section: "about", maxAge: 3600,
    name: { en: "Contact", es: "Contacto" },
    footer: { en: "Contact", es: "Contacto" },
    desc: { en: "How to reach us for questions, tips, and security reports.", es: "Cómo comunicarte con nosotros para preguntas, datos y reportes de seguridad." },
    llms: "How to reach us — general inquiries and security reporting.",
  },
  {
    path: "/sitemap", section: "about", maxAge: 3600,
    name: { en: "Sitemap", es: "Mapa del sitio" },
    footer: { en: "Sitemap", es: "Mapa del sitio" },
    desc: { en: "This page — every page and public endpoint on the site.", es: "Esta página — todas las páginas y endpoints públicos del sitio." },
    llms: "Human-readable site map with every page and endpoint.",
  },
  {
    path: "/developers", section: "developers", maxAge: 3600,
    name: { en: "Developers & Agents", es: "Desarrolladores y agentes" },
    nav: { en: "Developers", es: "Desarrolladores", desktop: false },
    footer: { en: "Developers", es: "Desarrolladores" },
    desc: { en: "Start here — the API, MCP server, feeds, and agent integrations, documented on one page.", es: "Empieza aquí — la API, el servidor MCP, los feeds y las integraciones para agentes, en una sola página." },
    llms: "The public JSON API, OpenAPI spec, MCP server, RSS feeds, agent skills, and Markdown views — all in one place, no authentication.",
  },
  {
    // GET /mcp is this page; POST /mcp is the protocol. The Spanish name says
    // "about" because /es/mcp is only ever the explainer — a POST there 404s.
    path: "/mcp", section: "developers", maxAge: 3600, custom: true,
    name: { en: "MCP Server", es: "Acerca del servidor MCP" },
    desc: { en: "Model Context Protocol server (Streamable HTTP), and how to connect to it.", es: "Qué es el servidor del Protocolo de Contexto de Modelo y cómo conectarte. El servidor está en /mcp y funciona solo en inglés." },
    llms: "What the Model Context Protocol server offers and how to connect an AI assistant to it.",
  },
];

// Public non-page routes worth listing for people and agents. English-only by
// design: none of these carries an /es form. `llms` is the llms.txt line;
// `group` picks the llms.txt section ("api", or "optional" for the rest).
export const ENDPOINTS = [
  { path: "/api/weather", group: "api", name: { en: "Weather API", es: "API del clima" },
    desc: { en: "JSON: current conditions, hourly, 7-day, and alerts.", es: "JSON: condiciones actuales, por hora, 7 días y alertas." },
    llms: "JSON with current conditions, hourly, 7-day forecast, alerts, sun times, the EPA UV index, and a measured air-quality index from EPA/AirNow monitors (Houston metro reporting area; `measured:true`, with an Open-Meteo modeled fallback). No auth." },
  { path: "/api/air", group: "api", name: { en: "Air Quality API", es: "API de calidad del aire" },
    desc: { en: "JSON: the measured AQI + per-pollutant breakdown.", es: "JSON: el AQI medido + desglose por contaminante." },
    llms: "the measured AQI + per-pollutant breakdown (JSON)." },
  { path: "/api/news", group: "api", name: { en: "News API", es: "API de noticias" },
    desc: { en: "JSON: recent local headlines.", es: "JSON: titulares locales recientes." },
    llms: "recent Crosby-area headlines (JSON)." },
  { path: "/api/calendar", group: "api", name: { en: "School Calendar API", es: "API del calendario escolar" },
    desc: { en: "JSON: upcoming Crosby ISD events.", es: "JSON: próximos eventos de Crosby ISD." },
    llms: "upcoming Crosby ISD events (JSON)." },
  { path: "/api/water", group: "api", name: { en: "Water Levels API", es: "API de niveles de agua" },
    desc: { en: "JSON: river/bayou stage, flow, and NWS flood stages.", es: "JSON: nivel y caudal de ríos y bayous, con etapas de inundación del NWS." },
    llms: "river/bayou stage + NWS flood stages (JSON)." },
  { path: "/api/fishing", group: "api", name: { en: "Fishing API", es: "API de pesca" },
    desc: { en: "JSON: USGS water conditions for nearby fishing waters.", es: "JSON: condiciones del agua del USGS para las aguas de pesca cercanas." },
    llms: "USGS water conditions (temperature, dissolved oxygen, pH, turbidity) for the waters people fish near Crosby (JSON)." },
  { path: "/api/tropics", group: "api", name: { en: "Tropics API", es: "API de trópicos" },
    desc: { en: "JSON: active Atlantic tropical cyclones from the NHC.", es: "JSON: ciclones tropicales activos del Atlántico, del NHC." },
    llms: "active Atlantic tropical cyclones from the NOAA NHC, plus unnamed areas under watch with formation chances (JSON; an empty storms array alone does NOT mean a quiet basin — read `disturbances` too, where null means the outlook was unreadable)." },
  { path: "/api/traffic", group: "api", name: { en: "Traffic API", es: "API de tráfico" },
    desc: { en: "JSON: incidents and lane closures on Crosby's roads.", es: "JSON: incidentes y cierres de carriles en los caminos de Crosby." },
    llms: "incidents and lane closures on Crosby's roads from Houston TranStar (JSON; empty arrays = quiet roads)." },
  { path: "/api/pollen", group: "api", name: { en: "Pollen API", es: "API de polen" },
    desc: { en: "JSON: the measured daily pollen and mold count.", es: "JSON: el conteo diario medido de polen y moho." },
    llms: "the Houston Health Department's measured daily pollen and mold count (JSON; weekday mornings)." },
  { path: "/api/burn-ban", group: "api", name: { en: "Burn Ban API", es: "API de prohibición de quemas" },
    desc: { en: "JSON: Harris County's outdoor-burning ban status.", es: "JSON: el estado de la prohibición de quemas al aire libre del condado de Harris." },
    llms: "Harris County's current outdoor-burning ban status from the Texas A&M Forest Service (JSON; countywide only)." },
  { path: "/api/health", group: "optional", name: { en: "Health Check", es: "Estado del servicio" },
    desc: { en: "Refresh attempts and when each feed's data last changed.", es: "Intentos de actualización y cuándo cambiaron los datos de cada fuente." },
    llms: "When each feed last refreshed and when its data last changed (JSON)." },
  { path: "/openapi.json", group: "optional", name: { en: "OpenAPI 3.1", es: "OpenAPI 3.1" },
    desc: { en: "Machine-readable API description.", es: "Descripción de la API legible por máquinas." },
    llms: "Machine-readable description of the JSON API." },
  { path: "/llms.txt", group: "self", name: { en: "llms.txt", es: "llms.txt" },
    desc: { en: "Plain-language site summary for LLMs.", es: "Resumen del sitio en lenguaje sencillo para LLM." } },
  { path: "/alerts.xml", group: "optional", name: { en: "Alerts RSS", es: "RSS de alertas" },
    desc: { en: "Active weather alerts as an RSS feed.", es: "Alertas meteorológicas activas como feed RSS." },
    llms: "Active NWS weather alerts as an RSS 2.0 feed (empty when all clear)." },
  { path: "/news.xml", group: "optional", name: { en: "News RSS", es: "RSS de noticias" },
    desc: { en: "Local headlines as an RSS feed.", es: "Titulares locales como feed RSS." },
    llms: "Curated Crosby-area headlines as an RSS 2.0 feed." },
  { path: "/badge.svg", group: "optional", name: { en: "Weather Badge", es: "Insignia del clima" },
    desc: { en: "Hotlinkable live SVG weather badge for other sites.", es: "Insignia SVG del clima en vivo para enlazar desde otros sitios." },
    llms: "Hotlinkable live SVG badge — current temperature, conditions, feels-like, and an alert flag." },
  { path: "/.well-known/api-catalog", group: "optional", name: { en: "API Catalog", es: "Catálogo de API" },
    desc: { en: "RFC 9727 machine-readable API index.", es: "Índice de API legible por máquinas (RFC 9727)." },
    llms: "Machine-readable index of the API endpoints (RFC 9727 linkset)." },
  { path: "/sitemap.xml", group: "optional", name: { en: "XML Sitemap", es: "Sitemap XML" },
    desc: { en: "Machine-readable sitemap for crawlers.", es: "Sitemap legible por máquinas para rastreadores." },
    llms: "All pages in both languages, with hreflang alternates." },
  { path: "/.well-known/security.txt", group: "optional", name: { en: "Security Contact", es: "Contacto de seguridad" },
    desc: { en: "How to report a security issue (RFC 9116).", es: "Cómo reportar un problema de seguridad (RFC 9116)." },
    llms: "How to report a security issue (RFC 9116)." },
];

const BY_PATH = new Map(PAGES.map((p) => [p.path, p]));
export const pageFor = (enPath) => BY_PATH.get(enPath);
// The English path of a gauge's page, or undefined for a gauge without one.
export const gaugePagePath = (lid) => PAGES.find((p) => p.gauge === lid)?.path;

// Every content URL path in both languages: the set the fetch wrapper stamps
// with a canonical Link header and restricts to GET/HEAD.
export const PAGE_PATHS = new Set(PAGES.flatMap((p) => [p.path, esPath(p.path)]));
