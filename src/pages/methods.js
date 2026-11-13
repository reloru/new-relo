// /methods — how each number on the site is obtained, and its limits.
//
// Static. It explains methods and points at the page where each number lives;
// it deliberately restates no count, list or cadence that another module owns
// (gauges, tools, feeds), so it cannot drift from them. The page-specific
// method notes on /history and the gauge pages carry the computed details.

import { T, canonicalFor, hreflangTags, esPath } from "../i18n.js";
import { esc } from "../lib/format.js";
import { BASE_CSS } from "../assets/base-css.js";
import { topbar, footer } from "../chrome.js";
import { JSONLD_SITE, sharedHead } from "../seo.js";
import { SITE } from "../config.js";

const PATH = "/methods";

// Each section: heading, paragraphs, and the page(s) it describes. Text is
// plain (escaped on output); `pages` are English paths.
const SECTIONS = [
  {
    h: ["Rules every number follows", "Reglas que sigue cada cifra"],
    p: [
      ["Every value comes from a named public source or from this site's own readings of one. Nothing is estimated, smoothed or filled in: a gap in a source is a gap here.", "Cada valor viene de una fuente pública nombrada o de las lecturas que este sitio hace de ella. Nada se estima, suaviza ni rellena: un hueco en la fuente es un hueco aquí."],
      ["Times are Central time and carry the date they refer to. No page counts time relative to now, because a copy of the page read later would be wrong.", "Las horas están en hora del centro y llevan la fecha a la que se refieren. Ninguna página cuenta el tiempo respecto a ahora, porque una copia de la página leída más tarde estaría equivocada."],
      ["Counts in the record (warnings, crests, bans) are computed from the database each time a page is requested, so a new entry appears without anyone editing the page.", "Los conteos del registro (avisos, crestas, prohibiciones) se calculan desde la base de datos cada vez que se pide una página, así que una entrada nueva aparece sin que nadie edite la página."],
      ["On the Spanish pages, short forecast phrases go through a hand-written dictionary. National Weather Service forecast discussions, alert text and NOAA's flood-impact statements stay in their official English: no machine translation of safety information.", "En las páginas en español, las frases cortas del pronóstico pasan por un diccionario escrito a mano. Las descripciones del pronóstico, el texto de las alertas del Servicio Meteorológico Nacional y las descripciones de impacto de NOAA quedan en su inglés oficial: nada de traducción automática de información de seguridad."],
    ],
  },
  {
    h: ["Weather, forecast and alerts", "Clima, pronóstico y alertas"],
    pages: ["/weather", "/hourly", "/alerts"],
    p: [
      ["From the U.S. National Weather Service's public API for Crosby's coordinates (29.9119, -95.0608). The site keeps the latest copy and refreshes it on a schedule; each page shows when it was last refreshed.", "Del API público del Servicio Meteorológico Nacional de EE. UU. para las coordenadas de Crosby (29.9119, -95.0608). El sitio guarda la copia más reciente y la actualiza periódicamente; cada página muestra cuándo se actualizó."],
      ["\"Now\" is the forecast hour that covers the current time, not the first hour NWS lists, which can lag the clock by an hour or more.", "\"Ahora\" es la hora del pronóstico que abarca la hora actual, no la primera hora que lista el NWS, que puede ir una hora o más atrás del reloj."],
      ["Active alerts are the ones NWS lists for Crosby's point. This site is not an alerting service: rely on official warnings, a weather radio or Wireless Emergency Alerts.", "Las alertas activas son las que el NWS lista para el punto de Crosby. Este sitio no es un servicio de alertas: confía en los avisos oficiales, un radio meteorológico o las Alertas Inalámbricas de Emergencia."],
    ],
  },
  {
    h: ["River levels and flood history", "Niveles de ríos e historial de inundaciones"],
    pages: ["/water"],
    p: [
      ["Readings, flood stages and flood categories come from NOAA's National Water Prediction Service, the source NWS uses for river gauges. The category badge is NWS's own; the site never classifies a level itself.", "Las lecturas, etapas y categorías de inundación vienen del Servicio Nacional de Predicción de Agua de NOAA, la fuente que usa el NWS para los medidores. La categoría es la del NWS; el sitio nunca clasifica un nivel por su cuenta."],
      ["Each gauge's flood-history page lists the historic crests NOAA publishes, measured against today's flood stages (and says so, because stages change). Crests NOAA marks as on an older gauge datum are listed apart and never compared. Where USGS publishes a year's peak flow on a crest's date, it is shown beside NOAA's. The site's own daily highs and lows come from its regular readings.", "La página de historial de cada medidor lista las crestas históricas que publica NOAA, comparadas con las etapas de inundación de hoy (y lo dice, porque las etapas cambian). Las crestas que NOAA marca con un datum anterior se listan aparte y nunca se comparan. Cuando el USGS publica el caudal máximo de un año en la fecha de una cresta, se muestra junto al de NOAA. Los máximos y mínimos diarios propios del sitio vienen de sus lecturas periódicas."],
    ],
  },
  {
    h: ["Measured rain", "Lluvia medida"],
    pages: ["/rain"],
    p: [["Rain is measured every 15 minutes by the U.S. Geological Survey's weather station at the Lake Houston dam, about 5 miles west of Crosby. Every total is the sum of those provisional 15-minute amounts; a day missing readings is marked incomplete rather than shown as dry. Rain varies over short distances, so Crosby can get more or less than the dam.", "La lluvia la mide cada 15 minutos la estación meteorológica del Servicio Geológico de EE. UU. en la presa de Lake Houston, a unos 8 km al oeste de Crosby. Cada total es la suma de esas cantidades provisionales de 15 minutos; un día al que le faltan lecturas se marca como incompleto en vez de mostrarse seco. La lluvia varía en distancias cortas, así que en Crosby puede caer más o menos que en la presa."]],
  },
  {
    h: ["Warning history", "Historial de avisos"],
    pages: ["/history"],
    p: [
      ["Warnings NWS draws as a polygon (tornado, severe thunderstorm, flash flood) count when the polygon contained Crosby, from October 1, 2007, the day polygons became the official warned area. Zone products count for the forecast zone that contains Crosby, whose boundaries have been redrawn. County watches cover all of Harris County.", "Los avisos que el NWS traza como polígono (tornado, tormenta severa, inundación repentina) cuentan cuando el polígono contenía a Crosby, desde el 1 de octubre de 2007, el día en que los polígonos se volvieron el área oficial del aviso. Los productos por zona cuentan para la zona de pronóstico que contiene a Crosby, cuyos límites se han redibujado. Las vigilancias del condado cubren todo el condado de Harris."],
      ["Events before this site began recording come from the Iowa Environmental Mesonet's archive of NWS products (Iowa State University). Since then the site files the alerts it receives, and river flood warnings from NWS's own flood products, which name each river gauge.", "Los eventos anteriores al inicio del registro del sitio provienen del archivo de productos del NWS del Iowa Environmental Mesonet (Universidad Estatal de Iowa). Desde entonces el sitio registra las alertas que recibe, y los avisos de inundación fluvial a partir de los propios productos de inundación del NWS, que nombran cada medidor."],
    ],
  },
  {
    h: ["Air quality and UV", "Calidad del aire y UV"],
    pages: ["/air"],
    p: [
      ["The air-quality index is measured by EPA/AirNow monitors for the Houston reporting area that includes Crosby. When AirNow is not reporting, a modeled index for Crosby's coordinates from Open-Meteo is shown instead and labeled \"modeled\" wherever it appears.", "El índice de calidad del aire lo miden los monitores de EPA/AirNow para el área de reporte de Houston que incluye a Crosby. Cuando AirNow no reporta, se muestra en su lugar un índice modelado de Open-Meteo para las coordenadas de Crosby, marcado como \"modelado\" donde aparece."],
      ["The UV index is EPA's forecast. When EPA's hourly product is unavailable, the site shows EPA's daily peak instead, for the date it was issued.", "El índice UV es el pronóstico de la EPA. Cuando el producto por hora de la EPA no está disponible, el sitio muestra el pico diario de la EPA, para la fecha en que se emitió."],
    ],
  },
  {
    h: ["Pollen and mold", "Polen y moho"],
    pages: ["/pollen"],
    p: [["The Houston Health Department's measured count, published weekday mornings, on the National Allergy Bureau scale. It is a real measurement for the Houston area, not a forecast; weekends and holidays carry the last count.", "El conteo medido del Departamento de Salud de Houston, publicado las mañanas entre semana, en la escala del National Allergy Bureau. Es una medición real para el área de Houston, no un pronóstico; los fines de semana y feriados muestran el último conteo."]],
  },
  {
    h: ["Burn bans", "Prohibiciones de quemas"],
    pages: ["/burn-ban"],
    p: [["Current status follows the Texas A&M Forest Service's statewide map, to which counties report; the Forest Service does not issue the ban. Past bans list where each date came from: the county's own release for a start, and, because the county's ReadyHarris site lists no lift notice, the news outlet that reported the county's statement for an end.", "El estado actual sigue el mapa estatal del Servicio Forestal de Texas A&M, al que reportan los condados; el Servicio Forestal no emite la prohibición. Las prohibiciones anteriores indican de dónde viene cada fecha: el comunicado del condado para el inicio y, como el sitio ReadyHarris del condado no lista avisos de levantamiento, el medio que reportó la declaración del condado para el fin."]],
  },
  {
    h: ["Tropics, traffic, fishing waters", "Trópicos, tráfico, aguas de pesca"],
    pages: ["/tropics", "/traffic", "/fishing"],
    p: [
      ["Storms and the areas being watched come from the National Hurricane Center; the page says \"nothing active\" only when it could read both.", "Las tormentas y las áreas en vigilancia vienen del Centro Nacional de Huracanes; la página dice \"nada activo\" solo cuando pudo leer ambas."],
      ["Road incidents and lane closures come from Houston TranStar; fishing-water conditions from U.S. Geological Survey monitoring stations.", "Los incidentes viales y cierres de carriles vienen de Houston TranStar; las condiciones de las aguas de pesca, de estaciones de monitoreo del Servicio Geológico de EE. UU."],
    ],
  },
  {
    h: ["School calendar and news", "Calendario escolar y noticias"],
    pages: ["/calendar", "/news"],
    p: [
      ["The school calendar is Crosby ISD's public feed. Key dates are picked out by tested title patterns (no school, breaks, early release, grading periods); a date the district has not posted is not listed.", "El calendario escolar es el feed público de Crosby ISD. Las fechas clave se identifican con patrones de título probados (sin clases, vacaciones, salida temprana, periodos de calificaciones); una fecha que el distrito no ha publicado no aparece."],
      ["News headlines are gathered from Google News and filtered for relevance to Crosby and nearby towns. This site does not write or edit the stories; each links to its publisher.", "Los titulares se reúnen de Google News y se filtran por relevancia para Crosby y pueblos cercanos. Este sitio no escribe ni edita las notas; cada una enlaza a su medio."],
    ],
  },
];

const t = (pair, lang) => (lang === "es" ? pair[1] : pair[0]);
const pageName = (p, lang) =>
  ({
    "/weather": ["Weather", "Clima"], "/hourly": ["Hourly", "Por hora"], "/alerts": ["Alerts", "Alertas"], "/water": ["Water levels", "Niveles de agua"],
    "/history": ["Warning history", "Historial de avisos"], "/rain": ["Rainfall record", "Registro de lluvia"], "/air": ["Air quality", "Calidad del aire"], "/pollen": ["Pollen", "Polen"],
    "/burn-ban": ["Burn ban", "Prohibición de quemas"], "/tropics": ["Tropics", "Trópicos"], "/traffic": ["Traffic", "Tráfico"],
    "/fishing": ["Fishing", "Pesca"], "/calendar": ["School calendar", "Calendario escolar"], "/news": ["News", "Noticias"],
  })[p][lang === "es" ? 1 : 0];

export function methodsHtml(lang) {
  const title = T(lang, "How the Numbers Are Made", "Cómo se obtienen las cifras");
  const desc = T(lang, "Where every number on crosbynews.com comes from, how it is computed, and what it cannot tell you.", "De dónde viene cada cifra de crosbynews.com, cómo se calcula y lo que no puede decirte.");
  const href = (p) => (lang === "es" ? esPath(p) : p);
  const sections = SECTIONS.map(
    (s) => `  <section class="card">
    <h2>${esc(t(s.h, lang))}</h2>
${s.p.map((p) => `    <p>${esc(t(p, lang))}</p>`).join("\n")}
${s.pages ? `    <p class="see">${T(lang, "See", "Ver")}: ${s.pages.map((p) => `<a href="${href(p)}">${esc(pageName(p, lang))}</a>`).join(" &middot; ")}</p>` : ""}
  </section>`,
  ).join("\n");
  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<title>${esc(title)} &mdash; crosbynews.com</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor(PATH, lang)}">
${sharedHead(lang)}
<link rel="canonical" href="${canonicalFor(PATH, lang)}">
${hreflangTags(PATH)}
${JSONLD_SITE}
<style>${BASE_CSS}
  .card { background:var(--card); border-radius:12px; padding:0.9rem 1.1rem; margin-top:1rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); }
  .card h2 { margin:0 0 0.5rem; }
  .card p { margin:0.45rem 0; }
  .card .see { font-size:0.9rem; color:var(--muted); }
  .lede { font-size:1.05rem; }
</style>
</head>
<body>
${topbar(PATH, lang)}
<main id="main">
  <h1>${esc(title)}</h1>
  <p class="lede">${esc(desc)} ${T(lang, `Questions or a correction: <a href="${href("/contact")}">contact</a>.`, `Preguntas o una corrección: <a href="${href("/contact")}">contacto</a>.`)}</p>
${sections}
</main>
${footer({ page: PATH, lang, source: T(lang, "Sources are named in each section and on each page.", "Las fuentes se nombran en cada sección y en cada página.") })}
</body>
</html>`;
}

export function methodsMarkdown(lang) {
  const out = [`# ${T(lang, "How the Numbers Are Made", "Cómo se obtienen las cifras")}`, "", T(lang, "Where every number on crosbynews.com comes from, how it is computed, and what it cannot tell you.", "De dónde viene cada cifra de crosbynews.com, cómo se calcula y lo que no puede decirte."), ""];
  for (const s of SECTIONS) {
    out.push(`## ${t(s.h, lang)}`, "", ...s.p.flatMap((p) => [t(p, lang), ""]));
    if (s.pages) out.push(`${T(lang, "See", "Ver")}: ${s.pages.map((p) => `[${pageName(p, lang)}](${SITE}${lang === "es" ? esPath(p) : p})`).join(" · ")}`, "");
  }
  out.push("---", `[crosbynews.com](${canonicalFor("/", lang)})`);
  return out.join("\n");
}
