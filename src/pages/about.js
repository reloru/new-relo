// The "what this site is" page. Human-facing; the API/agent detail lives on
// /developers. Content in ABOUT/ABOUT_ES so HTML and Markdown cannot drift.

import { T, canonicalFor, hreflangTags } from "../i18n.js";
import { esc } from "../lib/format.js";
import { BASE_CSS } from "../assets/base-css.js";
import { topbar, footer } from "../chrome.js";
import { JSONLD_SITE, sharedHead, ORG_ID, WEBSITE_ID } from "../seo.js";

// Static "what this site is" page. Content lives in one structured place so the
// HTML and markdown renderings can't drift. Strengthens E-E-A-T (clear source,
// authorship, and method) and gives the site a second indexable page.
export const ABOUT = {
  title: "About crosbynews.com",
  description:
    "What crosbynews.com is, where its weather and local data come from, how often it updates, and how it's built.",
  intro:
    "crosbynews.com is a front page for Crosby, Texas. It shows current conditions and the forecast from the National Weather Service, how high the rivers and bayous are, local headlines and the Crosby ISD school calendar. It also keeps a dated record of the town's weather warnings, floods, rainfall and burn bans. It has no ads and no trackers, and there is nothing to sign up for.",
  sections: [
    {
      h: "Where the data comes from",
      p: [
        "The forecast, current conditions and alerts come from the U.S. National Weather Service (api.weather.gov) for Crosby, TX (latitude 29.9119, longitude -95.0608). NWS data is in the public domain. The UV index is the one weather number from somewhere else: the U.S. EPA's public UV forecast for Crosby's ZIP code, 77532.",
        "The other pages each name their own source: NOAA for river levels and tropical storms, the U.S. Geological Survey for measured rain and fishing-water conditions, the Texas Commission on Environmental Quality for water samples, the Houston Health Department for pollen, the Texas A&M Forest Service and the Harris County Fire Marshal's Office for the burn ban, Houston TranStar for road incidents and lane closures, Crosby ISD for the school calendar, and Google News for local headlines. Weather warnings from before this site began recording come from the Iowa Environmental Mesonet's archive of National Weather Service products, at Iowa State University. The methods page explains how each number is obtained and what it cannot tell you.",
        "The air quality index (AQI) comes from the monitors that report to EPA's AirNow for the Houston-Galveston-Brazoria area, which includes Crosby. Crosby has no monitor of its own, so the number is a real measurement taken elsewhere in the area, and the site says so. When those monitors are not reporting, the site shows Open-Meteo's modeled forecast for Crosby's coordinates and labels it \"modeled\". The air quality page has each pollutant.",
        "The numbers are shown as the agencies publish them, without adjustment or commentary. Two values are calculated here. The \"feels like\" temperature is the heat index or wind chill, worked out with the National Weather Service's published formulas from its own temperature, humidity and wind, and shown only when it differs noticeably from the air temperature. Sunrise and sunset come from standard astronomical formulas, because the NWS forecast does not include them.",
      ],
      links: [{ href: "/methods", label: "How the numbers are made", note: "every source, how each number is computed, and its limits" }],
    },
    {
      h: "How often it updates",
      p: [
        "The forecast and alerts are refreshed every 15 minutes from the National Weather Service. Pages are served from a copy kept close to you so they load quickly, and a tab left open reloads itself every 15 minutes.",
      ],
    },
    {
      h: "For developers & agents",
      p: [
        "The data behind this site is also available as a free public JSON API that needs no key. There is an OpenAPI spec, a Model Context Protocol (MCP) server, RSS feeds and a Markdown version of every page. One page documents all of it:",
      ],
      links: [
        { href: "/developers", label: "Developers & agents", note: "the API, MCP server, feeds, and agent integrations" },
      ],
    },
    {
      h: "Privacy",
      p: [
        "crosbynews.com sets no cookies, shows no ads and runs no outside tracking or advertising code. It never asks for personal information and does not collect any.",
        "There is no analytics script either. Nothing loads in your browser to count, profile or report your visit.",
      ],
      links: [{ href: "/privacy", label: "Full privacy policy", note: "no cookies, ads, trackers, or personal data" }],
    },
    {
      h: "Contact",
      p: ["Questions, corrections, or a local news tip? Send an email:"],
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
    "crosbynews.com es una portada para Crosby, Texas. Muestra las condiciones actuales y el pronóstico del Servicio Meteorológico Nacional, qué tan altos están los ríos y arroyos, titulares locales y el calendario escolar de Crosby ISD. También lleva un registro fechado de los avisos meteorológicos, las inundaciones, la lluvia y las prohibiciones de quemas del pueblo. No tiene anuncios ni rastreadores, y no hay que registrarse en nada.",
  sections: [
    {
      h: "De dónde provienen los datos",
      p: [
        "El pronóstico, las condiciones actuales y las alertas provienen del Servicio Meteorológico Nacional de EE. UU. (api.weather.gov) para Crosby, TX (latitud 29.9119, longitud -95.0608). Los datos del NWS son de dominio público. El índice UV es el único dato meteorológico de otra fuente: el pronóstico UV público de la EPA de EE. UU. para el código postal de Crosby (77532).",
        "Cada una de las demás páginas nombra su propia fuente: la NOAA para los niveles de los ríos y las tormentas tropicales, el Servicio Geológico de EE. UU. para la lluvia medida y las condiciones del agua para pescar, la Comisión de Calidad Ambiental de Texas para las muestras de agua, el Departamento de Salud de Houston para el polen, el Servicio Forestal de Texas A&M y la Oficina del Jefe de Bomberos del condado de Harris para la prohibición de quemas, Houston TranStar para los incidentes viales y cierres de carriles, Crosby ISD para el calendario escolar y Google News para los titulares locales. Los avisos meteorológicos anteriores a que este sitio empezara a registrarlos vienen del archivo de productos del Servicio Meteorológico Nacional del Iowa Environmental Mesonet, de la Universidad Estatal de Iowa. La página de métodos explica cómo se obtiene cada número y qué no puede decirte.",
        "El índice de calidad del aire (AQI) viene de los monitores que reportan a AirNow de la EPA para el área Houston-Galveston-Brazoria, que incluye a Crosby. Crosby no tiene un monitor propio, así que el número es una medición real tomada en otro punto del área, y el sitio lo dice. Cuando esos monitores no reportan, el sitio muestra el pronóstico modelado de Open-Meteo para las coordenadas de Crosby y lo marca como \"modelado\". La página de calidad del aire tiene cada contaminante.",
        "Las cifras se muestran como las publican las agencias, sin ajustes ni comentarios. Dos valores se calculan aquí. La \"sensación térmica\" es el índice de calor o la sensación por viento, calculada con las fórmulas publicadas del Servicio Meteorológico Nacional a partir de su propia temperatura, humedad y viento, y solo se muestra cuando difiere de forma notable de la temperatura del aire. El amanecer y el atardecer salen de fórmulas astronómicas estándar, porque el pronóstico del NWS no los incluye. Las condiciones se traducen al español con un diccionario propio; las descripciones detalladas del pronóstico y las alertas se muestran en su idioma oficial, inglés.",
      ],
      links: [{ href: "/es/methods", label: "Cómo se obtienen las cifras", note: "cada fuente, cómo se calcula cada número y sus límites" }],
    },
    {
      h: "Con qué frecuencia se actualiza",
      p: [
        "El pronóstico y las alertas se actualizan cada 15 minutos desde el Servicio Meteorológico Nacional. Las páginas se sirven desde una copia guardada cerca de ti para que carguen rápido, y una pestaña que dejes abierta se recarga sola cada 15 minutos.",
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
        "crosbynews.com no usa cookies, no muestra anuncios y no ejecuta código de rastreo ni de publicidad de terceros. Nunca pide información personal y no recopila ninguna.",
        "Tampoco hay ningún script de analítica: nada se carga en tu navegador para contar, perfilar ni informar tu visita.",
      ],
      links: [{ href: "/es/privacy", label: "Política de privacidad completa", note: "sin cookies, anuncios, rastreadores ni datos personales" }],
    },
    {
      h: "Contacto",
      p: ["¿Preguntas, correcciones o un dato de noticias local? Escribe a:"],
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
            .map((l) => `<li><a href="${l.href}"><strong>${esc(l.label)}</strong></a>: ${esc(l.note)}</li>`)
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
<title>${esc(A.title)} &mdash; ${T(lang, "Crosby, TX Weather", "Clima de Crosby, TX")}</title>
<meta name="description" content="${esc(A.description)}">
<meta property="og:title" content="${esc(A.title)}">
<meta property="og:description" content="${esc(A.description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/about", lang)}">
${sharedHead(lang)}
<link rel="canonical" href="${canonicalFor("/about", lang)}">
${hreflangTags("/about")}
${JSONLD_SITE}
${jsonldAbout(lang)}
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
