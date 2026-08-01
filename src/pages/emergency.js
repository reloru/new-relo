// Emergency-resources directory. Pure static content, zero data loading —
// this page cannot fail. Every external link and phone number was verified
// before shipping.

import { SITE } from "../config.js";
import { T, canonicalFor, hreflangTags } from "../i18n.js";
import { esc } from "../lib/format.js";
import { BASE_CSS } from "../assets/base-css.js";
import { topbar, footer } from "../chrome.js";
import { JSONLD_SITE, OG_COMMON, ORG_ID, WEBSITE_ID } from "../seo.js";

// A static, evergreen directory of official emergency contacts for Crosby /
// NE Harris County — 911 guidance, outage reporting, flood + road conditions,
// shelters, disaster recovery. Pure content, zero new dependencies; same
// content-object + shared-renderer pattern as ABOUT/DEVELOPERS so the two
// languages can't drift. Every external link and phone number was verified
// live before shipping (texaspoison.com is a parked domain now — hence
// poison.org); federal sites (ready.gov, disasterassistance.gov) WAF-block
// datacenter curl but are canonical.
export const EMERGENCY = {
  title: "Emergency Resources",
  description:
    "Emergency contacts for Crosby, TX — 911 and non-emergency numbers, power outage and gas leak reporting, the CAER industrial-incident line, flood and road conditions, shelters, and disaster help for northeast Harris County.",
  intro:
    "In an immediate emergency — a medical crisis, a fire, a crime in progress, or water coming into your home — call 911 now. The rest of this page is for everything around that moment: the right number when it's not a 911 call, live flood and road conditions, how to report outages, and where to find help after a disaster.",
  sections: [
    {
      h: "Numbers to save",
      p: [
        "Put these in your phone before you need them. In a widespread storm, calls can fail while text and data still work — 911 also takes texts in Harris County, and most services below have a website.",
        "One thing that trips up new residents: Crosby is unincorporated Harris County, so Houston's 311 line doesn't cover it. For county problems that aren't emergencies — debris, drainage, stray animals — start with the sheriff's non-emergency line or 211.",
      ],
      links: [
        { href: "tel:911", label: "911", note: "police, fire, or medical emergency — call or text (Harris County supports text-to-911)" },
        { href: "tel:7132216000", label: "713-221-6000", note: "Harris County Sheriff's Office non-emergency line — the law enforcement agency covering Crosby" },
        { href: "tel:18002221222", label: "1-800-222-1222", note: "Poison Control — free, 24/7, interpreters available (poison.org)" },
        { href: "tel:988", label: "988", note: "Suicide & Crisis Lifeline — call or text, free, 24/7" },
        { href: "tel:211", label: "211", note: "211 Texas — community resources, shelter locations, disaster assistance" },
      ],
    },
    {
      h: "Weather alerts",
      p: ["These are the official warning channels for Crosby and northeast Harris County. Also keep Wireless Emergency Alerts turned on in your phone's settings — tornado and flash-flood warnings come through even when cell networks are congested."],
      links: [
        { href: "/alerts", label: "crosbynews.com/alerts", note: "active NWS alerts for Crosby, refreshed every 15 minutes — also an RSS feed at /alerts.xml" },
        { href: "https://www.readyharris.org", label: "ReadyHarris", note: "Harris County emergency management — sign up for official emergency alerts by call, text, or email" },
        { href: "https://www.weather.gov/hgx", label: "NWS Houston/Galveston", note: "the National Weather Service office that issues warnings for Crosby" },
      ],
    },
    {
      h: "Flooding & high water",
      p: ["Crosby floods from its bayous and the San Jacinto River. Never drive into water on a road — turn around, don't drown. Most flood deaths around Houston are people in vehicles."],
      links: [
        { href: "/water", label: "crosbynews.com/water", note: "live levels for Cedar Bayou, the San Jacinto River, Luce Bayou, and nearby gauges, with NWS flood stages" },
        { href: "https://www.harriscountyfws.org", label: "Harris County Flood Warning System", note: "county rainfall and channel gauges with live inundation mapping" },
        { href: "https://www.harriscountyfemt.org", label: "Harris County Flood Education Mapping Tool", note: "look up whether an address sits in a mapped floodplain" },
        { href: "https://www.hcfcd.org", label: "Harris County Flood Control District", note: "floodplain maps and drainage projects" },
        { href: "https://www.floodsmart.gov", label: "FloodSmart.gov", note: "the National Flood Insurance Program — homeowner's policies don't cover flood damage, and a new flood policy typically takes 30 days to take effect, so buy before a storm is named" },
      ],
    },
    {
      h: "Roads & traffic",
      p: ["Check before you drive in severe weather — high-water spots close Crosby's routes fast:"],
      links: [
        { href: "https://traffic.houstontranstar.org", label: "Houston TranStar", note: "real-time Houston-area traffic, incidents, and high-water road closures" },
        { href: "https://drivetexas.org", label: "DriveTexas", note: "TxDOT statewide highway conditions and closures" },
      ],
    },
    {
      h: "Power & gas outages",
      p: ["If a power line is down or you smell gas, get clear of the area and call 911 first — then the utility. Most of Crosby gets electric delivery and natural gas from CenterPoint Energy."],
      links: [
        { href: "https://www.centerpointenergy.com/outage", label: "CenterPoint Outage Center", note: "report an electric outage and track restoration on the outage map" },
        { href: "tel:7132072222", label: "713-207-2222", note: "CenterPoint electric — report outages and downed power lines" },
        { href: "tel:18888765786", label: "888-876-5786", note: "CenterPoint natural gas — report a gas leak or gas odor after you've left the area" },
      ],
    },
    {
      h: "Industrial incidents",
      p: ["Crosby has chemical plants of its own and sits near the east Harris County industrial corridor. When you see smoke or flaring or hear a boom, the CAER Line carries recorded updates straight from area plants and emergency officials — and any shelter-in-place order comes through ReadyHarris and Wireless Emergency Alerts."],
      links: [
        { href: "tel:2814762237", label: "281-476-2237", note: "East Harris County CAER Line — recorded industrial-incident and flaring updates, 24/7" },
        { href: "https://www.ehcma.org", label: "EHCMA / CAER Online", note: "the same updates on the web, from the East Harris County Manufacturers Association" },
      ],
    },
    {
      h: "Shelter & disaster recovery",
      p: ["When a disaster displaces people, shelters are announced through ReadyHarris, local media, and the organizations below:"],
      links: [
        { href: "https://www.redcross.org", label: "American Red Cross", note: "open shelters, emergency supplies, and recovery help — 1-800-733-2767" },
        { href: "https://www.disasterassistance.gov", label: "DisasterAssistance.gov", note: "apply for FEMA assistance after a federally declared disaster — or call 1-800-621-3362" },
        { href: "https://www.211texas.org", label: "211 Texas", note: "dial 211 for shelter, food, housing, and disaster recovery programs" },
      ],
    },
    {
      h: "Before the storm",
      p: ["Hurricane season runs June through November. Crosby sits inland of the coastal storm-surge evacuation zones, but coastal evacuations route through northeast Harris County — expect heavy traffic on US-90 and I-10 when zones toward the coast are called. Build a kit (water, food, medicine, flashlights, batteries) before a storm has a name."],
      links: [
        { href: "https://www.h-gac.com/hurricane-evacuation-planning", label: "H-GAC evacuation planning", note: "the regional Zip-Zone hurricane evacuation maps — check whether an address is in a zone (Crosby isn't, but family toward the coast may be)" },
        { href: "https://www.ready.gov", label: "Ready.gov", note: "FEMA's preparedness guides — build a kit, make a family plan" },
        { href: "/weather", label: "crosbynews.com/weather", note: "the Crosby forecast — check timing before severe weather arrives" },
      ],
    },
    {
      h: "About this page",
      p: [
        "Every link and number here was checked when this page was last updated, but services change — if a number stops working, dial 211 and they can route you, and please tell us so we can fix it.",
        "crosbynews.com is an independent project, not a government service. This page is a directory of official resources, not a live status board — in a life-threatening situation, don't read a website: call 911.",
      ],
      links: [
        { href: "/contact", label: "/contact", note: "report a broken link or a number that's changed" },
      ],
    },
  ],
};

export const EMERGENCY_ES = {
  title: "Recursos de emergencia",
  description:
    "Contactos de emergencia para Crosby, TX — el 911 y números que no son de emergencia, reportes de apagones y fugas de gas, la línea CAER de incidentes industriales, condiciones de inundación y de caminos, refugios y ayuda por desastre para el noreste del condado de Harris.",
  intro:
    "En una emergencia inmediata — una crisis médica, un incendio, un delito en curso o agua entrando a tu casa — llama al 911 ahora. El resto de esta página es para todo lo demás: el número correcto cuando no es una llamada al 911, condiciones de inundación y caminos en vivo, cómo reportar apagones y dónde encontrar ayuda después de un desastre.",
  sections: [
    {
      h: "Números para guardar",
      p: [
        "Guárdalos en tu teléfono antes de necesitarlos. En una tormenta fuerte las llamadas pueden fallar mientras los mensajes de texto y los datos siguen funcionando — el 911 también acepta mensajes de texto en el condado de Harris, y casi todos los servicios de abajo tienen sitio web.",
        "Algo que confunde a los residentes nuevos: Crosby es parte no incorporada del condado de Harris, así que el 311 de Houston no lo cubre. Para problemas del condado que no son emergencias — escombros, drenaje, animales callejeros — empieza con la línea que no es de emergencia del sheriff o con el 211.",
      ],
      links: [
        { href: "tel:911", label: "911", note: "emergencia policiaca, de incendio o médica — llama o manda mensaje de texto (el condado de Harris acepta texto al 911)" },
        { href: "tel:7132216000", label: "713-221-6000", note: "línea que no es de emergencia de la Oficina del Sheriff del Condado de Harris — la policía que cubre Crosby" },
        { href: "tel:18002221222", label: "1-800-222-1222", note: "Control de Envenenamientos — gratis, 24/7, con intérpretes en español (poison.org)" },
        { href: "tel:988", label: "988", note: "Línea de Prevención del Suicidio y Crisis — llama o manda texto, gratis, 24/7; oprime 2 para español" },
        { href: "tel:211", label: "211", note: "211 Texas — recursos comunitarios, refugios y asistencia por desastre, con atención en español" },
      ],
    },
    {
      h: "Alertas del clima",
      p: ["Estos son los canales oficiales de aviso para Crosby y el noreste del condado de Harris. Mantén también activadas las Alertas Inalámbricas de Emergencia (WEA) en la configuración de tu teléfono — los avisos de tornado e inundación repentina llegan aun cuando la red celular está congestionada. Las alertas del NWS se publican en inglés."],
      links: [
        { href: "/es/alerts", label: "crosbynews.com/es/alerts", note: "alertas activas del NWS para Crosby, actualizadas cada 15 minutos — también como feed RSS en /alerts.xml" },
        { href: "https://www.readyharris.org", label: "ReadyHarris", note: "manejo de emergencias del condado de Harris — regístrate para recibir alertas oficiales por llamada, texto o correo" },
        { href: "https://www.weather.gov/hgx", label: "NWS Houston/Galveston", note: "la oficina del Servicio Meteorológico Nacional que emite los avisos para Crosby" },
      ],
    },
    {
      h: "Inundaciones y agua alta",
      p: ["Crosby se inunda por sus arroyos (bayous) y el río San Jacinto. Nunca manejes por un camino con agua — da la vuelta, no te ahogues. La mayoría de las muertes por inundación en la zona de Houston son de personas en vehículos."],
      links: [
        { href: "/es/water", label: "crosbynews.com/es/water", note: "niveles en vivo de Cedar Bayou, el río San Jacinto, Luce Bayou y estaciones cercanas, con las etapas de inundación del NWS" },
        { href: "https://www.harriscountyfws.org", label: "Harris County Flood Warning System", note: "pluviómetros y medidores de canales del condado con mapas de inundación en vivo" },
        { href: "https://www.harriscountyfemt.org", label: "Harris County Flood Education Mapping Tool", note: "consulta si una dirección está en una zona inundable oficial" },
        { href: "https://www.hcfcd.org", label: "Harris County Flood Control District", note: "mapas de zonas inundables y proyectos de drenaje" },
        { href: "https://www.floodsmart.gov/es", label: "FloodSmart.gov (en español)", note: "el Programa Nacional de Seguro contra Inundaciones — las pólizas de casa no cubren daños por inundación, y una póliza nueva normalmente tarda 30 días en entrar en vigor, así que cómprala antes de que la tormenta tenga nombre" },
      ],
    },
    {
      h: "Caminos y tráfico",
      p: ["Consulta antes de manejar con mal tiempo — los puntos de agua alta cierran rápido las rutas de Crosby:"],
      links: [
        { href: "https://traffic.houstontranstar.org", label: "Houston TranStar", note: "tráfico del área de Houston en tiempo real, incidentes y cierres por agua alta" },
        { href: "https://drivetexas.org", label: "DriveTexas", note: "condiciones y cierres de carreteras estatales de TxDOT" },
      ],
    },
    {
      h: "Apagones y fugas de gas",
      p: ["Si hay un cable de luz caído o hueles a gas, aléjate del área y llama primero al 911 — después a la compañía. La mayor parte de Crosby recibe la electricidad y el gas natural de CenterPoint Energy."],
      links: [
        { href: "https://www.centerpointenergy.com/outage", label: "Centro de apagones de CenterPoint", note: "reporta un apagón eléctrico y sigue la restauración en el mapa de apagones" },
        { href: "tel:7132072222", label: "713-207-2222", note: "CenterPoint electricidad — reporta apagones y cables de luz caídos" },
        { href: "tel:18888765786", label: "888-876-5786", note: "CenterPoint gas natural — reporta una fuga u olor a gas después de alejarte del lugar" },
      ],
    },
    {
      h: "Incidentes industriales",
      p: ["Crosby tiene plantas químicas propias y está cerca del corredor industrial del este del condado de Harris. Cuando veas humo o quema en antorcha o escuches un estruendo, la Línea CAER tiene actualizaciones grabadas directamente de las plantas de la zona y de las autoridades — y cualquier orden de refugiarse en casa llega por ReadyHarris y las Alertas Inalámbricas de Emergencia."],
      links: [
        { href: "tel:2814762237", label: "281-476-2237", note: "Línea CAER del este del condado de Harris — actualizaciones grabadas de incidentes industriales y quemas en antorcha, 24/7 (en inglés)" },
        { href: "https://www.ehcma.org", label: "EHCMA / CAER Online", note: "las mismas actualizaciones en la web, de la asociación de manufactureras del este del condado de Harris" },
      ],
    },
    {
      h: "Refugios y recuperación",
      p: ["Cuando un desastre desplaza a la gente, los refugios se anuncian por ReadyHarris, los medios locales y las organizaciones de abajo:"],
      links: [
        { href: "https://www.redcross.org/cruz-roja.html", label: "Cruz Roja Americana", note: "refugios abiertos, suministros de emergencia y ayuda para recuperarse — 1-800-733-2767" },
        { href: "https://www.disasterassistance.gov", label: "DisasterAssistance.gov", note: "solicita ayuda de FEMA tras un desastre con declaración federal (disponible en español) — o llama al 1-800-621-3362" },
        { href: "https://www.211texas.org", label: "211 Texas", note: "marca 211 para refugio, comida, vivienda y programas de recuperación, con atención en español" },
      ],
    },
    {
      h: "Antes de la tormenta",
      p: ["La temporada de huracanes va de junio a noviembre. Crosby está tierra adentro, fuera de las zonas costeras de evacuación por marejada, pero las evacuaciones de la costa pasan por el noreste del condado de Harris — espera tráfico pesado en la US-90 y la I-10 cuando se ordene evacuar las zonas hacia la costa. Arma un kit (agua, comida, medicinas, linternas, pilas) antes de que la tormenta tenga nombre."],
      links: [
        { href: "https://www.h-gac.com/hurricane-evacuation-planning", label: "Planeación de evacuación de H-GAC", note: "los mapas regionales de zonas de evacuación por huracán (Zip-Zone), con versión en español — consulta si una dirección está en una zona (Crosby no lo está, pero tu familia hacia la costa quizá sí)" },
        { href: "https://www.ready.gov/es", label: "Listo (Ready.gov en español)", note: "guías de preparación de FEMA en español — arma un kit, haz un plan familiar" },
        { href: "/es/weather", label: "crosbynews.com/es/weather", note: "el pronóstico de Crosby — revisa los tiempos antes del mal tiempo" },
      ],
    },
    {
      h: "Sobre esta página",
      p: [
        "Cada enlace y número se verificó en la última actualización de esta página, pero los servicios cambian — si un número deja de funcionar, marca 211 para que te canalicen, y avísanos para corregirlo.",
        "crosbynews.com es un proyecto independiente, no un servicio del gobierno. Esta página es un directorio de recursos oficiales, no un tablero de estado en vivo — en una situación de riesgo para la vida, no leas un sitio web: llama al 911.",
      ],
      links: [
        { href: "/es/contact", label: "/es/contact", note: "reporta un enlace roto o un número que cambió" },
      ],
    },
  ],
};

export function jsonldEmergency(lang) {
  const E = lang === "es" ? EMERGENCY_ES : EMERGENCY;
  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": canonicalFor("/emergency", lang) + "#webpage",
    url: canonicalFor("/emergency", lang),
    name: E.title,
    description: E.description,
    inLanguage: lang === "es" ? "es-MX" : "en-US",
    isPartOf: { "@id": WEBSITE_ID },
    about: { "@id": ORG_ID },
  })}</script>`;
}

export function emergencyHtml(lang) {
  const E = lang === "es" ? EMERGENCY_ES : EMERGENCY;
  const body = E.sections
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
<title>${esc(E.title)} &mdash; Crosby, TX &mdash; crosbynews.com</title>
<meta name="description" content="${esc(E.description)}">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="${esc(E.title)}">
<meta property="og:description" content="${esc(E.description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/emergency", lang)}">
${OG_COMMON}
<link rel="canonical" href="${canonicalFor("/emergency", lang)}">
${hreflangTags("/emergency")}
${JSONLD_SITE}
${jsonldEmergency(lang)}
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
${topbar("/emergency", lang)}
<main id="main">
  <h1>${esc(E.title)}</h1>
  <p class="lede">${esc(E.intro)}</p>
${body}
</main>
${footer({ page: "/emergency", lang, source: T(lang, "Links on this page go to official government, utility, and nonprofit services.", "Los enlaces de esta página llevan a servicios oficiales del gobierno, de las compañías de servicios y de organizaciones sin fines de lucro.") })}
</body>
</html>`;
}

export function emergencyMarkdown(lang) {
  const E = lang === "es" ? EMERGENCY_ES : EMERGENCY;
  const out = [`# ${E.title}`, "", E.intro, ""];
  for (const s of E.sections) {
    out.push(`## ${s.h}`, "");
    for (const t of s.p || []) out.push(t, "");
    for (const l of s.links || []) out.push(`- [${l.label}](${l.href}) — ${l.note}`);
    if (s.links) out.push("");
  }
  out.push("---", `[crosbynews.com](${canonicalFor("/", lang)}) · ${T(lang, "weather for Crosby, Texas", "clima para Crosby, Texas")}`);
  return out.join("\n");
}
