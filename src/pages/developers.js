// The developer/agent surface on one page. Both languages list the same
// English-only endpoints; only prose localizes. Names the 13 MCP tools in
// prose in BOTH objects — two of the five hand-maintained surfaces that go
// stale when a tool is added.

import { T, canonicalFor, hreflangTags } from "../i18n.js";
import { esc } from "../lib/format.js";
import { BASE_CSS } from "../assets/base-css.js";
import { topbar, footer } from "../chrome.js";
import { JSONLD_SITE, OG_COMMON, ORG_ID, WEBSITE_ID, JSONLD_DATASET } from "../seo.js";

// The site's agent/developer surface, gathered onto one page (moved off /about
// during the 2026 restructure so /about stays human-facing). Same {h,p,links}
// content-object shape as ABOUT so developersHtml/developersMarkdown render it
// without drift. The API + MCP are English-only, so both languages list the
// same endpoints; only the prose and self-referential markdown link localize.
export const DEVELOPERS = {
  title: "Developers & Agents",
  description:
    "The crosbynews.com API, MCP server, RSS feeds, and agent integrations for Crosby, TX — free, public, no authentication.",
  intro:
    "crosbynews.com is built to be read by machines as well as people. Everything below is public and free, with no API key or sign-up. Source data is U.S. government public domain (NWS/NOAA) — attribute it as \"U.S. National Weather Service.\"",
  sections: [
    {
      h: "JSON API",
      p: ["Every dataset behind the site is a plain JSON endpoint with open CORS (Access-Control-Allow-Origin: *) and no rate limits. The polled endpoints also support conditional GET (ETag / If-None-Match → 304):"],
      links: [
        { href: "/api/weather", label: "/api/weather", note: "current conditions, hourly, 7-day forecast, alerts, plus feels-like and sun times" },
        { href: "/api/water", label: "/api/water", note: "river/bayou stage, flow, and NWS flood stages" },
        { href: "/api/fishing", label: "/api/fishing", note: "USGS water-quality conditions (temp, dissolved oxygen, pH, turbidity) for nearby fishing waters" },
        { href: "/api/tropics", label: "/api/tropics", note: "active Atlantic tropical cyclones from the NOAA NHC, plus unnamed areas under watch and their formation chances" },
        { href: "/api/pollen", label: "/api/pollen", note: "the Houston Health Department's measured daily pollen and mold count (weekday mornings)" },
        { href: "/api/burn-ban", label: "/api/burn-ban", note: "Harris County's current outdoor-burning ban status from the Texas A&M Forest Service (countywide only)" },
        { href: "/api/air", label: "/api/air", note: "the measured US AQI (EPA/AirNow, Houston metro area) with a per-pollutant breakdown" },
        { href: "/api/traffic", label: "/api/traffic", note: "incidents and lane closures on Crosby's roads, from Houston TranStar" },
        { href: "/api/news", label: "/api/news", note: "recent local Crosby-area headlines" },
        { href: "/api/calendar", label: "/api/calendar", note: "upcoming Crosby ISD school events" },
        { href: "/api/health", label: "/api/health", note: "site liveness, when each feed last tried to refresh and whether it worked, and when its data last actually changed" },
      ],
    },
    {
      h: "Specs & discovery",
      p: ["Machine-readable descriptions and a discovery catalog:"],
      links: [
        { href: "/openapi.json", label: "/openapi.json", note: "OpenAPI 3.1 description of every endpoint" },
        { href: "/.well-known/api-catalog", label: "/.well-known/api-catalog", note: "RFC 9727 API catalog (linkset)" },
      ],
    },
    {
      h: "Markdown for every page",
      p: ["Any page returns clean Markdown instead of HTML when you send an Accept: text/markdown header or append ?format=md — handy for LLMs and text pipelines. Every content page supports it, in both languages, including this one and the MCP explainer."],
      links: [
        { href: "/weather?format=md", label: "/weather?format=md", note: "the forecast, rendered as Markdown" },
        { href: "/llms.txt", label: "/llms.txt", note: "plain-language site summary for LLMs (llmstxt.org)" },
      ],
    },
    {
      h: "MCP server",
      p: [
        "A stateless Model Context Protocol server (Streamable HTTP, JSON-RPC) exposes the data as callable tools — get_current_conditions, get_forecast, get_alerts, get_tropical_outlook, get_pollen, get_burn_ban, get_air_quality, get_river_levels, get_fishing, get_traffic, get_crosby_news, get_school_events, get_emergency_contacts, and get_radar (a live radar image, inline) — plus a crosby_briefing prompt and readable resources.",
        "Connect from Claude Code: claude mcp add --transport http crosbynews https://crosbynews.com/mcp",
      ],
      links: [
        { href: "/mcp", label: "/mcp", note: "MCP endpoint (POST JSON-RPC); a GET shows a human explainer (also in Spanish at /es/mcp)" },
        { href: "/.well-known/mcp/server-card.json", label: "MCP server card", note: "discovery metadata" },
      ],
    },
    {
      h: "Agent skills",
      p: ["An agentskills.io (v0.2.0) discovery index points to a real SKILL.md for the Crosby weather data; its digest is a runtime hash of the file, so the two can't drift."],
      links: [
        { href: "/.well-known/agent-skills/index.json", label: "/.well-known/agent-skills/index.json", note: "agent-skills discovery index" },
      ],
    },
    {
      h: "RSS feeds",
      p: ["Watch alerts and local news in any feed reader — the no-account, no-tracking notification channel:"],
      links: [
        { href: "/alerts.xml", label: "/alerts.xml", note: "active NWS alerts (RSS 2.0; empty when all clear)" },
        { href: "/news.xml", label: "/news.xml", note: "curated Crosby-area headlines (RSS 2.0)" },
      ],
    },
    {
      h: "Embeddable weather badge",
      p: ["Put live Crosby weather on your own site with one image tag — a small SVG (300×80) showing the current temperature, conditions, feels-like, and an alert flag. Edge-cached and refreshed on the same 15-minute cycle as everything else; no key, no script, CORS open."],
      links: [
        { href: "/badge.svg", label: "/badge.svg", note: `the live badge — embed with <img src="https://crosbynews.com/badge.svg" width="300" height="80" alt="Crosby, TX weather">` },
      ],
    },
    {
      h: "Terms & attribution",
      p: [
        "Public and unauthenticated, no rate limits — please be reasonable with polling (the data refreshes every 15 minutes). Weather and water data are U.S. government public domain from the National Weather Service and NOAA; news headlines link to their original publishers.",
        "crosbynews.com is an independent project and is not affiliated with the National Weather Service, NOAA, Crosby ISD, or any government agency.",
      ],
    },
  ],
};

export const DEVELOPERS_ES = {
  title: "Desarrolladores y agentes",
  description:
    "La API de crosbynews.com, el servidor MCP, los feeds RSS y las integraciones para agentes de Crosby, TX — gratis, público, sin autenticación.",
  intro:
    "crosbynews.com está hecho para que lo lean tanto las máquinas como las personas. Todo lo de abajo es público y gratuito, sin clave de API ni registro. Los datos provienen del dominio público del gobierno de EE. UU. (NWS/NOAA); atribúyelos como «U.S. National Weather Service». La API y el servidor MCP se ofrecen en inglés.",
  sections: [
    {
      h: "API JSON",
      p: ["Cada conjunto de datos del sitio es un endpoint JSON con CORS abierto (Access-Control-Allow-Origin: *) y sin límites de tasa. Los endpoints consultados con frecuencia también admiten GET condicional (ETag / If-None-Match → 304):"],
      links: [
        { href: "/api/weather", label: "/api/weather", note: "condiciones actuales, por hora, pronóstico a 7 días, alertas, sensación térmica y horas de sol" },
        { href: "/api/water", label: "/api/water", note: "nivel y caudal de ríos/arroyos y etapas de inundación del NWS" },
        { href: "/api/fishing", label: "/api/fishing", note: "condiciones del agua del USGS (temp, oxígeno disuelto, pH, turbidez) para aguas de pesca cercanas" },
        { href: "/api/tropics", label: "/api/tropics", note: "ciclones tropicales activos del Atlántico según el NHC de NOAA, además de zonas sin nombre bajo vigilancia y sus probabilidades de formación" },
        { href: "/api/pollen", label: "/api/pollen", note: "el conteo diario medido de polen y moho del Departamento de Salud de Houston (mañanas entre semana)" },
        { href: "/api/burn-ban", label: "/api/burn-ban", note: "el estado actual de la prohibición de quemas al aire libre del condado de Harris, según el Servicio Forestal de Texas A&M (solo a nivel de condado)" },
        { href: "/api/air", label: "/api/air", note: "el AQI medido de EE. UU. (EPA/AirNow, área metropolitana de Houston) con desglose por contaminante" },
        { href: "/api/traffic", label: "/api/traffic", note: "incidentes y cierres de carriles en los caminos de Crosby, según Houston TranStar" },
        { href: "/api/news", label: "/api/news", note: "titulares locales recientes del área de Crosby" },
        { href: "/api/calendar", label: "/api/calendar", note: "próximos eventos escolares de Crosby ISD" },
        { href: "/api/health", label: "/api/health", note: "si el sitio está en línea, cuándo intentó actualizarse cada fuente y si funcionó, y cuándo cambiaron realmente sus datos" },
      ],
    },
    {
      h: "Especificaciones y descubrimiento",
      p: ["Descripciones legibles por máquinas y un catálogo de descubrimiento:"],
      links: [
        { href: "/openapi.json", label: "/openapi.json", note: "descripción OpenAPI 3.1 de cada endpoint" },
        { href: "/.well-known/api-catalog", label: "/.well-known/api-catalog", note: "catálogo de API RFC 9727 (linkset)" },
      ],
    },
    {
      h: "Markdown en cada página",
      p: ["Cualquier página devuelve Markdown limpio en lugar de HTML si envías un encabezado Accept: text/markdown o agregas ?format=md — útil para LLM y flujos de texto. Todas las páginas de contenido lo admiten, en ambos idiomas."],
      links: [
        { href: "/es/weather?format=md", label: "/es/weather?format=md", note: "el pronóstico, en Markdown" },
        { href: "/llms.txt", label: "/llms.txt", note: "resumen del sitio en lenguaje sencillo para LLM (llmstxt.org)" },
      ],
    },
    {
      h: "Servidor MCP",
      p: [
        "Un servidor del Protocolo de Contexto de Modelo sin estado (Streamable HTTP, JSON-RPC) expone los datos como herramientas invocables — get_current_conditions, get_forecast, get_alerts, get_tropical_outlook, get_pollen, get_burn_ban, get_air_quality, get_river_levels, get_fishing, get_traffic, get_crosby_news, get_school_events, get_emergency_contacts y get_radar (una imagen de radar en vivo, en línea) — además de un prompt crosby_briefing y recursos legibles.",
        "Conéctate desde Claude Code: claude mcp add --transport http crosbynews https://crosbynews.com/mcp",
      ],
      links: [
        { href: "/mcp", label: "/mcp", note: "endpoint MCP (POST JSON-RPC) — el servidor funciona solo en inglés" },
        { href: "/es/mcp", label: "/es/mcp", note: "página explicativa en español (no es un endpoint: un POST aquí devuelve 404)" },
        { href: "/.well-known/mcp/server-card.json", label: "Tarjeta del servidor MCP", note: "metadatos de descubrimiento" },
      ],
    },
    {
      h: "Habilidades para agentes",
      p: ["Un índice de descubrimiento agentskills.io (v0.2.0) apunta a un SKILL.md real para los datos del clima de Crosby; su digest es un hash del archivo en tiempo de ejecución, así que no pueden desincronizarse."],
      links: [
        { href: "/.well-known/agent-skills/index.json", label: "/.well-known/agent-skills/index.json", note: "índice de descubrimiento de habilidades" },
      ],
    },
    {
      h: "Feeds RSS",
      p: ["Sigue las alertas y las noticias locales en cualquier lector de feeds — el canal de notificaciones sin cuentas ni rastreo:"],
      links: [
        { href: "/alerts.xml", label: "/alerts.xml", note: "alertas activas del NWS (RSS 2.0; vacío cuando no hay ninguna)" },
        { href: "/news.xml", label: "/news.xml", note: "titulares seleccionados del área de Crosby (RSS 2.0)" },
      ],
    },
    {
      h: "Insignia del clima para incrustar",
      p: ["Pon el clima de Crosby en vivo en tu propio sitio con una sola etiqueta de imagen — un SVG pequeño (300×80) con la temperatura actual, las condiciones, la sensación térmica y un indicador de alertas. Con caché en el borde y actualizado en el mismo ciclo de 15 minutos que todo lo demás; sin clave, sin scripts, CORS abierto. El texto de la insignia está en inglés."],
      links: [
        { href: "/badge.svg", label: "/badge.svg", note: `la insignia en vivo — incrústala con <img src="https://crosbynews.com/badge.svg" width="300" height="80" alt="Crosby, TX weather">` },
      ],
    },
    {
      h: "Términos y atribución",
      p: [
        "Público y sin autenticación, sin límites de tasa — sé razonable con la frecuencia de consulta (los datos se actualizan cada 15 minutos). Los datos meteorológicos y de agua son de dominio público del gobierno de EE. UU. (NWS y NOAA); los titulares enlazan a sus editores originales.",
        "crosbynews.com es un proyecto independiente y no está afiliado al Servicio Meteorológico Nacional, la NOAA, Crosby ISD ni ninguna agencia gubernamental.",
      ],
    },
  ],
};

export function jsonldDevelopers(lang) {
  const D = lang === "es" ? DEVELOPERS_ES : DEVELOPERS;
  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": canonicalFor("/developers", lang) + "#webpage",
    url: canonicalFor("/developers", lang),
    name: D.title,
    description: D.description,
    inLanguage: lang === "es" ? "es-MX" : "en-US",
    isPartOf: { "@id": WEBSITE_ID },
    about: { "@id": ORG_ID },
  })}</script>`;
}

export function developersHtml(lang) {
  const D = lang === "es" ? DEVELOPERS_ES : DEVELOPERS;
  const body = D.sections
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
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(D.title)} &mdash; crosbynews.com</title>
<meta name="description" content="${esc(D.description)}">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="${esc(D.title)}">
<meta property="og:description" content="${esc(D.description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/developers", lang)}">
${OG_COMMON}
<link rel="canonical" href="${canonicalFor("/developers", lang)}">
${hreflangTags("/developers")}
${JSONLD_SITE}
${JSONLD_DATASET}
${jsonldDevelopers(lang)}
<link rel="manifest" href="/manifest.json">
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
${topbar("/developers", lang)}
<main id="main">
  <h1>${esc(D.title)}</h1>
  <p class="lede">${esc(D.intro)}</p>
${body}
</main>
${footer({ page: "/developers", lang, source: T(lang, `Data from the U.S. National Weather Service (<a href="https://weather.gov">weather.gov</a>) and NOAA/NWS.`, `Datos del Servicio Meteorológico Nacional de EE. UU. (<a href="https://weather.gov">weather.gov</a>) y de NOAA/NWS.`) })}
</body>
</html>`;
}

export function developersMarkdown(lang) {
  const D = lang === "es" ? DEVELOPERS_ES : DEVELOPERS;
  const out = [`# ${D.title}`, "", D.intro, ""];
  for (const s of D.sections) {
    out.push(`## ${s.h}`, "");
    for (const t of s.p || []) out.push(t, "");
    for (const l of s.links || []) out.push(`- [${l.label}](${l.href}) — ${l.note}`);
    if (s.links) out.push("");
  }
  out.push("---", `[crosbynews.com](${canonicalFor("/", lang)}) · ${T(lang, "weather for Crosby, Texas", "clima para Crosby, Texas")}`);
  return out.join("\n");
}
