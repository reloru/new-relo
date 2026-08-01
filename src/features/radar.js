// The radar page. The image itself is proxied through /radar-image so it sits
// on our crawlable origin — NWS robots.txt disallows all crawling, so a
// hotlinked radar image could never be indexed, and img-src 'self' would block it.

import { SITE } from "../config.js";
import { T, canonicalFor, hreflangTags } from "../i18n.js";
import { esc } from "../lib/format.js";
import { BASE_CSS } from "../assets/base-css.js";
import { topbar, footer } from "../chrome.js";
import { JSONLD_SITE, OG_COMMON } from "../seo.js";

// Embeds the NOAA/NWS Houston-Galveston (KHGX) radar loop, which covers Crosby.
// The image is proxied through /radar-image so it lives on our crawlable origin
// and is edge-cached. Static-ish page; the image itself carries a short TTL.
export function radarHtml(lang, data) {
  const title = T(lang, "Crosby, TX Weather Radar", "Radar meteorológico de Crosby, TX");
  const desc = T(lang, "Live NWS weather radar loop for Crosby, Texas and the greater Houston area (KHGX), updated continuously.", "Radar meteorológico en vivo del NWS para Crosby, Texas y el área metropolitana de Houston (KHGX), actualizado continuamente.");
  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} &mdash; crosbynews.com</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/radar", lang)}">
${OG_COMMON}
<link rel="canonical" href="${canonicalFor("/radar", lang)}">
${hreflangTags("/radar")}
${JSONLD_SITE}
<link rel="manifest" href="/manifest.json">
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
${topbar("/radar", lang)}
<main id="main">
  <h1>${esc(title)}</h1>
  <p class="intro">${T(lang, "Live radar for the Crosby / northeast Houston area from the U.S. National Weather Service KHGX (Houston-Galveston) radar. The loop animates the most recent reflectivity scans, showing showers and thunderstorms moving across the region.", "Radar en vivo para Crosby y el noreste de Houston, del radar KHGX (Houston-Galveston) del Servicio Meteorológico Nacional de EE. UU. La animación reproduce los escaneos de reflectividad más recientes, mostrando chubascos y tormentas que se desplazan por la región.")}</p>
  <div class="radar-wrap">
    <img src="/radar-image" alt="${T(lang, "Animated NWS weather radar loop for Crosby, TX (KHGX)", "Animación del radar meteorológico del NWS para Crosby, TX (KHGX)")}" width="600" height="550" loading="eager">
    <p class="radar-meta">${T(lang, "Source: NOAA/NWS KHGX radar &middot; the loop refreshes as new scans publish (roughly every few minutes).", "Fuente: radar KHGX de NOAA/NWS &middot; la animación se actualiza conforme se publican nuevos escaneos (cada pocos minutos).")} <a href="/radar-image?still=1">${T(lang, "Prefer a still image? View the latest single frame.", "¿Prefieres una imagen fija? Ver el último escaneo.")}</a></p>
  </div>
  <section class="card">
    <h2>${T(lang, "Reading this radar", "Cómo leer este radar")}</h2>
    <p>${T(lang, "Color indicates precipitation intensity. Blues and greens are light rain; yellows and oranges are moderate; reds and purples indicate heavy rainfall or large hail. The animation plays the most recent reflectivity scans in sequence so you can see storms moving across the region.", "El color indica la intensidad de la precipitación. Los azules y verdes son lluvia ligera; los amarillos y naranjas, moderada; los rojos y morados indican lluvia intensa o granizo grande. La animación reproduce los escaneos de reflectividad más recientes en secuencia para que veas las tormentas moverse por la región.")}</p>
    <p>${T(lang, `The KHGX radar is sited at Galveston Bay, roughly 40 miles south of Crosby, giving it a low-angle view of storms approaching from the Gulf. Crosby sits in northeast Harris County, a low-lying area that is especially prone to flash flooding during slow-moving Gulf Coast storms. A rotating hook echo or tight circulation on the southwest flank of a storm cell can indicate a tornado threat &mdash; check <a href="/alerts">active alerts</a> for any warnings already issued by the National Weather Service.`, `El radar KHGX está ubicado en la bahía de Galveston, a unos 65 km al sur de Crosby, lo que le da una vista de ángulo bajo de las tormentas que se acercan desde el Golfo. Crosby se encuentra en el noreste del condado de Harris, una zona baja especialmente propensa a inundaciones repentinas durante las tormentas lentas de la costa del Golfo. Un eco en forma de gancho o una circulación cerrada en el flanco suroeste de una celda de tormenta puede indicar amenaza de tornado &mdash; consulta las <a href="/es/alerts">alertas activas</a> para ver cualquier aviso ya emitido por el Servicio Meteorológico Nacional.`)}</p>
    <p>${T(lang, `During hurricane season (June&ndash;November) the radar helps track the outer rain bands of tropical systems well before they make landfall. The <a href="https://www.weather.gov/hgx/">NWS Houston/Galveston office</a> is the authoritative source for warnings and watches covering Crosby.`, `Durante la temporada de huracanes (junio&ndash;noviembre) el radar ayuda a rastrear las bandas de lluvia exteriores de los sistemas tropicales mucho antes de que toquen tierra. La <a href="https://www.weather.gov/hgx/">oficina del NWS en Houston/Galveston</a> es la fuente autorizada de avisos y vigilancias para Crosby.`)}</p>
  </section>
  <p class="intro"><a href="${lang === "es" ? "/es/weather" : "/weather"}">&larr; ${T(lang, "Back to the forecast", "Volver al pronóstico")}</a></p>
</main>
${footer({ page: "/radar", lang, source: T(lang, `Radar imagery from the U.S. National Weather Service (<a href="https://radar.weather.gov">radar.weather.gov</a>).`, `Imágenes de radar del Servicio Meteorológico Nacional de EE. UU. (<a href="https://radar.weather.gov">radar.weather.gov</a>).`), data })}
</body>
</html>`;
}

export function radarMarkdown(lang) {
  return [
    `# ${T(lang, "Crosby, TX Weather Radar", "Radar meteorológico de Crosby, TX")}`,
    "",
    T(lang, "Live NWS weather radar for the Crosby / northeast Houston area, from the U.S. National Weather Service KHGX (Houston-Galveston) radar.", "Radar meteorológico en vivo del NWS para Crosby y el noreste de Houston, del radar KHGX (Houston-Galveston) del Servicio Meteorológico Nacional de EE. UU."),
    "",
    `![${T(lang, "Crosby TX radar loop", "Animación del radar de Crosby, TX")}](${SITE}/radar-image)`,
    "",
    T(lang, "The loop animates the most recent reflectivity scans (refreshed every few minutes) so you can see showers and thunderstorms moving across the region.", "La animación reproduce los escaneos de reflectividad más recientes (actualizados cada pocos minutos) para que veas chubascos y tormentas moverse por la región."),
    "",
    "---",
    `[crosbynews.com](${canonicalFor("/", lang)}) · [${T(lang, "forecast", "pronóstico")}](${canonicalFor("/weather", lang)}) · [${T(lang, "hourly", "por hora")}](${canonicalFor("/hourly", lang)})`,
  ].join("\n");
}
