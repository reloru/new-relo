// Privacy policy. The PRIVACY/PRIVACY_ES content objects were physically
// filed inside the About-page region of the old single file, several hundred
// lines from the renderers that use them; this reunites them.

import { SITE } from "../config.js";
import { T, canonicalFor, hreflangTags } from "../i18n.js";
import { esc } from "../lib/format.js";
import { BASE_CSS } from "../assets/base-css.js";
import { topbar, footer } from "../chrome.js";
import { JSONLD_SITE, OG_COMMON, ORG_ID, WEBSITE_ID } from "../seo.js";

export const PRIVACY = {
  title: "Privacy Policy",
  description: "How crosbynews.com handles your data — no cookies, no trackers, no personal information.",
  intro: "crosbynews.com doesn't set cookies, show ads, or run third-party tracking or advertising networks, and it never asks for or collects personal information about you.",
  sections: [
    {
      h: "What we don't collect",
      p: [
        "No cookies, no fingerprinting, no sign-up, no login. There is no personal data to collect because the site never asks for any. There are no third-party analytics scripts, advertising networks, social-media widgets, or tracking pixels on any page.",
      ],
    },
    {
      h: "Third-party data sources",
      p: [
        "The site displays data from several external, public sources. All of it is fetched server-side and cached — your browser never contacts these sources directly, and none of it involves sharing any user data:",
        "U.S. National Weather Service (api.weather.gov) — public-domain forecasts, conditions, and alerts for Crosby, TX; and the U.S. EPA (UV index) and NOAA (river/bayou levels, tropical outlook).",
        "EPA/AirNow (airnowapi.org) — the measured air-quality index for the Houston-Galveston-Brazoria reporting area that includes Crosby; Open-Meteo provides a modeled fallback for Crosby's coordinates when AirNow isn't reporting (labeled measured vs modeled throughout).",
        "Houston Health Department (houstonhealth.org) — the measured daily pollen and mold count (tree, weed, and grass pollen and mold spores, on the National Allergy Bureau scale) for the Houston area, which applies regionally to Crosby; published weekday mornings.",
        "U.S. Geological Survey (waterservices.usgs.gov) — real-time water conditions (temperature, dissolved oxygen, pH, turbidity, and stage) for the nearby waters people fish, behind the fishing page.",
        "Houston TranStar (houstontranstar.org) — road incidents and scheduled lane closures for the Crosby corridors, from TranStar's public RSS feeds.",
        "Google News — local news headlines aggregated from public RSS feeds by an out-of-band process and cached.",
        "Crosby ISD (crosbyisd.org) — the school district's public iCal calendar feed.",
      ],
    },
    {
      h: "Push notifications (optional)",
      p: [
        "If you opt in to severe-weather alerts on the Alerts page, your browser creates an anonymous \"push subscription\" — a unique address at your browser vendor's push service (Google, Apple, Mozilla, or Microsoft) plus a pair of keys. We store only that subscription, so we can wake your device when a tornado, flash-flood, or hurricane warning is issued for Crosby. It carries no personal information and isn't tied to any identity.",
        "We never send message content through it: the wake-up is empty, and the notification text is assembled on your own device from the public alerts feed. Turn it off anytime with the same button (or in your browser's site settings) and the stored subscription is deleted. Dead subscriptions are also pruned automatically.",
      ],
    },
    {
      h: "Analytics",
      p: [
        "Page visits are counted anonymously and in aggregate — without cookies, without fingerprinting, and without anything that identifies you or follows you across other sites.",
      ],
    },
    {
      h: "Questions",
      p: ["If you have questions about this privacy policy:"],
      links: [{ href: "mailto:contact@crosbynews.com", label: "contact@crosbynews.com", note: "general questions" }],
    },
  ],
};

export const PRIVACY_ES = {
  title: "Política de privacidad",
  description: "Cómo crosbynews.com maneja tus datos: sin cookies, sin rastreadores, sin información personal.",
  intro: "crosbynews.com no usa cookies, no muestra anuncios ni ejecuta redes de rastreo o publicidad de terceros, y nunca pide ni recopila información personal sobre ti.",
  sections: [
    {
      h: "Lo que no recopilamos",
      p: [
        "Sin cookies, sin huellas digitales (fingerprinting), sin registro, sin inicio de sesión. No hay datos personales que recopilar porque el sitio nunca los solicita. No hay scripts de analítica de terceros, redes publicitarias, widgets de redes sociales ni píxeles de seguimiento en ninguna página.",
      ],
    },
    {
      h: "Fuentes de datos de terceros",
      p: [
        "El sitio muestra datos de varias fuentes externas y públicas. Todo se obtiene del lado del servidor y se almacena en caché — tu navegador nunca contacta estas fuentes directamente, y ninguna implica compartir datos de usuario:",
        "Servicio Meteorológico Nacional de EE. UU. (api.weather.gov) — pronósticos, condiciones y alertas de dominio público para Crosby, TX; además de la EPA de EE. UU. (índice UV) y la NOAA (niveles de ríos/arroyos, panorama tropical).",
        "EPA/AirNow (airnowapi.org) — el índice de calidad del aire medido para el área de reporte Houston-Galveston-Brazoria que incluye a Crosby; Open-Meteo aporta un respaldo modelado para las coordenadas de Crosby cuando AirNow no reporta (etiquetado como medido o modelado en todo el sitio).",
        "Departamento de Salud de Houston (houstonhealth.org) — el conteo diario medido de polen y moho (polen de árboles, malezas y pastos, y esporas de moho, en la escala de la Oficina Nacional de Alergias) para el área de Houston, que aplica regionalmente a Crosby; publicado entre semana por la mañana.",
        "Servicio Geológico de EE. UU. (waterservices.usgs.gov) — condiciones del agua en tiempo real (temperatura, oxígeno disuelto, pH, turbidez y nivel) de las aguas de pesca cercanas, detrás de la página de pesca.",
        "Houston TranStar (houstontranstar.org) — incidentes viales y cierres de carriles programados para los corredores de Crosby, desde los feeds RSS públicos de TranStar.",
        "Google News — titulares de noticias locales recopilados de fuentes RSS públicas mediante un proceso externo y almacenados en caché.",
        "Crosby ISD (crosbyisd.org) — el calendario público iCal del distrito escolar.",
      ],
    },
    {
      h: "Notificaciones push (opcional)",
      p: [
        "Si te suscribes a las alertas de clima severo en la página de Alertas, tu navegador crea una «suscripción push» anónima: una dirección única en el servicio push de tu navegador (Google, Apple, Mozilla o Microsoft) más un par de claves. Solo guardamos esa suscripción para poder despertar tu dispositivo cuando se emita un aviso de tornado, inundación repentina o huracán para Crosby. No contiene información personal ni está vinculada a ninguna identidad.",
        "Nunca enviamos contenido a través de ella: el aviso de despertar va vacío y el texto de la notificación se arma en tu propio dispositivo a partir del feed público de alertas. Desactívala cuando quieras con el mismo botón (o en la configuración del sitio de tu navegador) y la suscripción guardada se elimina. Las suscripciones inactivas también se depuran automáticamente.",
      ],
    },
    {
      h: "Analítica",
      p: [
        "Las visitas se cuentan de forma anónima y agregada, sin cookies, sin huellas digitales (fingerprinting) y sin nada que te identifique o te siga por otros sitios.",
      ],
    },
    {
      h: "Preguntas",
      p: ["Si tienes preguntas sobre esta política de privacidad:"],
      links: [{ href: "mailto:contact@crosbynews.com", label: "contact@crosbynews.com", note: "preguntas generales" }],
    },
  ],
};

// --- Contact page -------------------------------------------------------------
export function jsonldPrivacy(lang) {
  const P = lang === "es" ? PRIVACY_ES : PRIVACY;
  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": canonicalFor("/privacy", lang) + "#webpage",
    url: canonicalFor("/privacy", lang),
    name: P.title,
    description: P.description,
    inLanguage: lang === "es" ? "es-MX" : "en-US",
    isPartOf: { "@id": WEBSITE_ID },
  })}</script>`;
}

export function privacyHtml(lang) {
  const P = lang === "es" ? PRIVACY_ES : PRIVACY;
  const body = P.sections
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
<title>${esc(P.title)} &mdash; ${T(lang, "Crosby, TX Weather", "Clima de Crosby, TX")}</title>
<meta name="description" content="${esc(P.description)}">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="${esc(P.title)}">
<meta property="og:description" content="${esc(P.description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/privacy", lang)}">
${OG_COMMON}
<link rel="canonical" href="${canonicalFor("/privacy", lang)}">
${hreflangTags("/privacy")}
${JSONLD_SITE}
${jsonldPrivacy(lang)}
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
</style>
</head>
<body>
${topbar("/privacy", lang)}
<main id="main">
  <h1>${esc(P.title)}</h1>
  <p class="lede">${esc(P.intro)}</p>
${body}
</main>
${footer({ page: "/privacy", lang, source: T(lang, `Data from the U.S. National Weather Service (<a href="https://weather.gov">weather.gov</a>).`, `Datos del Servicio Meteorológico Nacional de EE. UU. (<a href="https://weather.gov">weather.gov</a>).`) })}
</body>
</html>`;
}

export function privacyMarkdown(lang) {
  const P = lang === "es" ? PRIVACY_ES : PRIVACY;
  const out = [`# ${P.title}`, "", P.intro, ""];
  for (const s of P.sections) {
    out.push(`## ${s.h}`, "");
    for (const t of s.p || []) out.push(t, "");
    for (const l of s.links || []) out.push(`- [${l.label}](${l.href}) — ${l.note}`);
    if (s.links) out.push("");
  }
  out.push("---", `[crosbynews.com](${canonicalFor("/", lang)}) · ${T(lang, "weather for Crosby, Texas", "clima para Crosby, Texas")}`);
  return out.join("\n");
}
