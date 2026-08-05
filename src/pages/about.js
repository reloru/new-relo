// The "what this site is" page. Human-facing; the API/agent detail lives on
// /developers. Content in ABOUT/ABOUT_ES so HTML and Markdown cannot drift.

import { T, canonicalFor, hreflangTags } from "../i18n.js";
import { esc } from "../lib/format.js";
import { BASE_CSS } from "../assets/base-css.js";
import { topbar, footer } from "../chrome.js";
import { JSONLD_SITE, OG_COMMON, ORG_ID, WEBSITE_ID } from "../seo.js";

// Static "what this site is" page. Content lives in one structured place so the
// HTML and markdown renderings can't drift. Strengthens E-E-A-T (clear source,
// authorship, and method) and gives the site a second indexable page.
export const ABOUT = {
  title: "About crosbynews.com",
  description:
    "What crosbynews.com is, where its weather and local data come from, how often it updates, and how it's built.",
  intro:
    "crosbynews.com is a fast, ad-free front page for Crosby, Texas — live National Weather Service conditions and forecast, river and bayou flood levels, local news, and the Crosby ISD school calendar, all in one place. No ads, no trackers, no sign-up.",
  sections: [
    {
      h: "Where the data comes from",
      p: [
        "Every forecast, conditions reading, and alert on this site comes directly from the U.S. National Weather Service (api.weather.gov) for Crosby, TX (latitude 29.9119, longitude -95.0608). NWS data is in the public domain. The UV index is the one weather number sourced elsewhere — the U.S. EPA's public UV forecast for Crosby's ZIP code (77532). Road incidents and lane closures come from Houston TranStar (the region's official traffic agency, a TxDOT partnership), republished as facts with attribution from the RSS feeds TranStar publishes for public subscription.",
        "The air quality index (AQI) comes from EPA/AirNow — the official measured monitors — for the Houston-Galveston-Brazoria reporting area, the nearest official area, which includes Crosby. There's no monitor in Crosby itself, so it's a real reading for the metro rather than a Crosby-pinpoint value, and we label it that way. When the AirNow monitors aren't reporting, we fall back to Open-Meteo's modeled forecast for Crosby's coordinates, labeled \"modeled\" so you always know which you're seeing. The full breakdown lives on the air quality page.",
        "We don't editorialize or adjust the numbers — the site is a clean presentation layer over the official government forecast for the Crosby area. Two values we compute ourselves: \"feels like\" temperature (the heat index or wind chill, using the National Weather Service's own published formulas applied to its temperature, humidity, and wind data — shown only when it's meaningfully different from the air temperature) and sunrise/sunset times (standard astronomical formulas; the NWS forecast API doesn't provide them).",
      ],
    },
    {
      h: "How often it updates",
      p: [
        "The forecast and alerts are refreshed every 15 minutes from the National Weather Service. The page you load is served from a cached copy at the edge for speed, and an open browser tab reloads itself every 15 minutes to stay current.",
      ],
    },
    {
      h: "For developers & agents",
      p: [
        "The same data powering this site is available as a free, public, no-authentication JSON API — plus an OpenAPI spec, a Model Context Protocol (MCP) server, RSS feeds, and a Markdown version of every page. It's all documented on one page:",
      ],
      links: [
        { href: "/developers", label: "Developers & agents", note: "the API, MCP server, feeds, and agent integrations" },
      ],
    },
    {
      h: "Privacy",
      p: [
        "No cookies, no ads, no trackers, no personal data. crosbynews.com doesn't set cookies, show ads, or run third-party tracking or advertising networks, and it never asks for or collects personal information about you.",
        "Page visits are counted anonymously and in aggregate — without cookies, without fingerprinting, and without anything that identifies you or follows you across other sites.",
      ],
      links: [{ href: "/privacy", label: "Full privacy policy", note: "no cookies, ads, trackers, or personal data" }],
    },
    {
      h: "Contact",
      p: ["Questions, corrections, or a local news tip? Email us:"],
      links: [
        { href: "mailto:contact@crosbynews.com", label: "contact@crosbynews.com", note: "general questions, corrections, and news tips" },
        { href: "mailto:security@crosbynews.com", label: "security@crosbynews.com", note: "security issues and vulnerability reports" },
        { href: "/contact", label: "Contact page", note: "all contact information" },
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

// Mexican-Spanish (es-MX) translation of the About content, same shape as ABOUT
// so aboutHtml()/aboutMarkdown() render either from one set of functions. API
// endpoints stay English (they're language-neutral); only the self-referential
// markdown link points at the Spanish page.
export const ABOUT_ES = {
  title: "Acerca de crosbynews.com",
  description:
    "Qué es crosbynews.com, de dónde provienen sus datos meteorológicos y locales, con qué frecuencia se actualiza y cómo está construido.",
  intro:
    "crosbynews.com es una página principal rápida y sin anuncios para Crosby, Texas: condiciones y pronóstico en vivo del Servicio Meteorológico Nacional, niveles de inundación de ríos y arroyos, noticias locales y el calendario escolar de Crosby ISD, todo en un solo lugar. Sin anuncios, sin rastreadores, sin registro.",
  sections: [
    {
      h: "De dónde provienen los datos",
      p: [
        "Cada pronóstico, lectura de condiciones y alerta de este sitio proviene directamente del Servicio Meteorológico Nacional de EE. UU. (api.weather.gov) para Crosby, TX (latitud 29.9119, longitud -95.0608). Los datos del NWS son de dominio público. El índice UV es el único dato meteorológico de otra fuente: el pronóstico UV público de la EPA de EE. UU. para el código postal de Crosby (77532). Los incidentes viales y cierres de carriles provienen de Houston TranStar (la agencia oficial de tráfico de la región, una alianza con TxDOT), republicados como hechos con atribución desde los feeds RSS que TranStar publica para suscripción pública.",
        "El índice de calidad del aire (AQI) proviene de EPA/AirNow — los monitores oficiales medidos — para el área de reporte Houston-Galveston-Brazoria, el área oficial más cercana, que incluye a Crosby. No hay un monitor en Crosby mismo, así que es una lectura real del área metropolitana y no un valor exacto de Crosby, y así lo etiquetamos. Cuando los monitores de AirNow no reportan, usamos como respaldo el pronóstico modelado de Open-Meteo para las coordenadas de Crosby, etiquetado como \"modelado\" para que siempre sepas cuál estás viendo. El desglose completo está en la página de calidad del aire.",
        "No editorializamos ni ajustamos las cifras: el sitio es una capa de presentación limpia sobre el pronóstico oficial del gobierno para la zona de Crosby. Dos valores los calculamos nosotros mismos: la \"sensación térmica\" (el índice de calor o la sensación por viento, con las fórmulas oficiales del Servicio Meteorológico Nacional aplicadas a su temperatura, humedad y viento, y solo se muestra cuando difiere de forma notable de la temperatura del aire) y las horas de amanecer y atardecer (fórmulas astronómicas estándar; la API de pronóstico del NWS no las ofrece). Las condiciones se traducen al español con un diccionario propio; las descripciones detalladas del pronóstico y las alertas se muestran en su idioma oficial, inglés.",
      ],
    },
    {
      h: "Con qué frecuencia se actualiza",
      p: [
        "El pronóstico y las alertas se actualizan cada 15 minutos desde el Servicio Meteorológico Nacional. La página que cargas se sirve desde una copia en caché en el borde de la red para mayor velocidad, y una pestaña abierta del navegador se recarga sola cada 15 minutos para mantenerse al día.",
      ],
    },
    {
      h: "Para desarrolladores y agentes",
      p: [
        "Los mismos datos que alimentan este sitio están disponibles como una API JSON gratuita, pública y sin autenticación, además de una especificación OpenAPI, un servidor del Protocolo de Contexto de Modelo (MCP), feeds RSS y una versión en Markdown de cada página. Todo está documentado en una sola página:",
      ],
      links: [
        { href: "/es/developers", label: "Desarrolladores y agentes", note: "la API, el servidor MCP, los feeds y las integraciones para agentes" },
      ],
    },
    {
      h: "Privacidad",
      p: [
        "Sin cookies, sin anuncios, sin rastreadores, sin datos personales. crosbynews.com no usa cookies, no muestra anuncios ni ejecuta redes de rastreo o publicidad de terceros, y nunca pide ni recopila información personal sobre ti.",
        "Las visitas se cuentan de forma anónima y agregada, sin cookies, sin huellas digitales (fingerprinting) y sin nada que te identifique o te siga por otros sitios.",
      ],
      links: [{ href: "/es/privacy", label: "Política de privacidad completa", note: "sin cookies, anuncios, rastreadores ni datos personales" }],
    },
    {
      h: "Contacto",
      p: ["¿Preguntas, correcciones o un dato de noticias local? Escríbenos:"],
      links: [
        { href: "mailto:contact@crosbynews.com", label: "contact@crosbynews.com", note: "preguntas generales, correcciones y datos de noticias" },
        { href: "mailto:security@crosbynews.com", label: "security@crosbynews.com", note: "problemas de seguridad y reportes de vulnerabilidades" },
        { href: "/es/contact", label: "Página de contacto", note: "toda la información de contacto" },
      ],
    },
    {
      h: "Aviso legal",
      p: [
        "crosbynews.com es un proyecto independiente y no está afiliado al Servicio Meteorológico Nacional, la NOAA ni ninguna agencia gubernamental. Para decisiones de vida o muerte durante condiciones meteorológicas severas, confía siempre en las fuentes oficiales y las autoridades locales.",
      ],
    },
  ],
};

// AboutPage node for /about, linked to the sitewide WebSite/Organization by @id.
export function jsonldAbout(lang) {
  const A = lang === "es" ? ABOUT_ES : ABOUT;
  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "AboutPage",
    "@id": canonicalFor("/about", lang) + "#webpage",
    url: canonicalFor("/about", lang),
    name: A.title,
    description: A.description,
    inLanguage: lang === "es" ? "es-MX" : "en-US",
    isPartOf: { "@id": WEBSITE_ID },
    about: { "@id": ORG_ID },
  })}</script>`;
}

export function aboutHtml(lang) {
  const A = lang === "es" ? ABOUT_ES : ABOUT;
  const body = A.sections
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
<title>${esc(A.title)} &mdash; ${T(lang, "Crosby, TX Weather", "Clima de Crosby, TX")}</title>
<meta name="description" content="${esc(A.description)}">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="${esc(A.title)}">
<meta property="og:description" content="${esc(A.description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/about", lang)}">
${OG_COMMON}
<link rel="canonical" href="${canonicalFor("/about", lang)}">
${hreflangTags("/about")}
${JSONLD_SITE}
${jsonldAbout(lang)}
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
${topbar("/about", lang)}
<main id="main">
  <h1>${esc(A.title)}</h1>
  <p class="lede">${esc(A.intro)}</p>
${body}
</main>
${footer({ page: "/about", lang, source: T(lang, `Data from the U.S. National Weather Service (<a href="https://weather.gov">weather.gov</a>).`, `Datos del Servicio Meteorológico Nacional de EE. UU. (<a href="https://weather.gov">weather.gov</a>).`) })}
</body>
</html>`;
}

export function aboutMarkdown(lang) {
  const A = lang === "es" ? ABOUT_ES : ABOUT;
  const out = [`# ${A.title}`, "", A.intro, ""];
  for (const s of A.sections) {
    out.push(`## ${s.h}`, "");
    for (const t of s.p || []) out.push(t, "");
    for (const l of s.links || []) out.push(`- [${l.label}](${l.href}) — ${l.note}`);
    if (s.links) out.push("");
  }
  out.push("---", `[crosbynews.com](${canonicalFor("/", lang)}) · ${T(lang, "weather for Crosby, Texas", "clima para Crosby, Texas")}`);
  return out.join("\n");
}
