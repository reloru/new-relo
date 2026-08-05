// Active NWS alerts plus the evergreen severe-weather guide, so the page stays
// substantial when nothing is active. Carries the severe-alert push opt-in.
//
// Alert text stays in NWS official English in BOTH languages: NWS publishes no
// Spanish alert API, and a mistranslated warning is a safety problem.

import { SITE } from "../config.js";
import { T, canonicalFor, hreflangTags } from "../i18n.js";
import { esc, fullTime, nl2br, rssDate } from "../lib/format.js";
import { BASE_CSS } from "../assets/base-css.js";
import { topbar, footer } from "../chrome.js";
import { JSONLD_SITE, OG_COMMON } from "../seo.js";
import { PUSH_CLIENT_SCRIPT } from "../assets/client-scripts.js";

// Stable URL for active NWS alerts in Crosby. When nothing is active (the usual
// case) it stays substantial with an evergreen guide to the alert types common
// on the Texas Gulf Coast and what to do — so it isn't a thin/empty page.
export const ALERT_GUIDE = [
  { event: "Tornado Warning", what: "A tornado is occurring or imminent (radar-indicated or spotted).", do: "Shelter immediately on the lowest floor, interior room, away from windows. Do not wait to see it." },
  { event: "Severe Thunderstorm Warning", what: "Damaging winds (58+ mph) and/or large hail are occurring or imminent.", do: "Move indoors, away from windows. Be ready for possible tornado warnings to follow." },
  { event: "Flash Flood Warning", what: "Rapid flooding is occurring or imminent — common with the area's heavy downpours.", do: "Move to higher ground. Never drive through flooded roads — turn around, don't drown." },
  { event: "Hurricane / Tropical Storm Warning", what: "Tropical-storm or hurricane conditions are expected within 36 hours — relevant in Gulf season (Jun–Nov).", do: "Follow local officials, finish preparations, and evacuate if told to." },
  { event: "Heat Advisory / Excessive Heat Warning", what: "Dangerous heat and humidity, frequent in a Gulf Coast summer.", do: "Hydrate, limit midday exertion, check on neighbors, and never leave anyone in a parked car." },
];

// Spanish (es-MX) version of the severe-weather guide. The event names keep the
// official English term (what you'll actually see in a live alert) followed by
// the Spanish, so a reader learns to recognize both. The explanations are
// general educational reference — not live warnings — so translating them is
// both safe and useful.
export const ALERT_GUIDE_ES = [
  { event: "Tornado Warning (Aviso de tornado)", what: "Hay un tornado en curso o es inminente (detectado por radar o avistado).", do: "Refúgiate de inmediato en el piso más bajo, en una habitación interior y lejos de ventanas. No esperes a verlo." },
  { event: "Severe Thunderstorm Warning (Aviso de tormenta severa)", what: "Vientos dañinos (90+ km/h) o granizo grande en curso o inminentes.", do: "Métete bajo techo, lejos de ventanas. Prepárate por si se emiten avisos de tornado después." },
  { event: "Flash Flood Warning (Aviso de inundación repentina)", what: "Inundación rápida en curso o inminente, común con los aguaceros fuertes de la zona.", do: "Busca terreno alto. Nunca conduzcas por caminos inundados: da la vuelta, no te arriesgues." },
  { event: "Hurricane / Tropical Storm Warning (Aviso de huracán / tormenta tropical)", what: "Se esperan condiciones de tormenta tropical o huracán dentro de 36 horas; relevante en la temporada del Golfo (jun–nov).", do: "Sigue a las autoridades locales, termina los preparativos y evacúa si te lo indican." },
  { event: "Heat Advisory / Excessive Heat Warning (Advertencia de calor)", what: "Calor y humedad peligrosos, frecuentes en el verano de la costa del Golfo.", do: "Hidrátate, limita el esfuerzo al mediodía, revisa a tus vecinos y nunca dejes a nadie en un auto estacionado." },
];

export function alertsHtml(data, lang) {
  const alerts = data.alerts ?? [];
  // The page's dominant message is the current status: a big reassuring green
  // panel when all-clear, or the active alerts when there are any. Alert event
  // names + body text stay in NWS's official English (no translation of
  // life-safety wording); only the surrounding labels are localized.
  const status = alerts.length
    ? `<section class="alerts" aria-label="${T(lang, "Active weather alerts", "Alertas meteorológicas activas")}">
    <div class="status status-alert">
      <span class="status-icon">&#9888;</span>
      <div><p class="status-title">${T(lang, `${alerts.length} active weather ${alerts.length === 1 ? "alert" : "alerts"}`, `${alerts.length} ${alerts.length === 1 ? "alerta meteorológica activa" : "alertas meteorológicas activas"}`)}</p>
      <p class="status-sub">${T(lang, "for Crosby, TX &mdash; details below. Follow official guidance.", "para Crosby, TX &mdash; detalles abajo. Sigue la guía oficial.")}</p></div>
    </div>${alerts
      .map(
        (a) => `
    <article class="alert">
      <h3>&#9888; ${esc(a.event)}</h3>
      ${a.headline ? `<p class="headline">${esc(a.headline)}</p>` : ""}
      ${a.description ? `<p>${nl2br(a.description)}</p>` : ""}
      ${a.instruction ? `<p class="instruction"><strong>${T(lang, "What to do:", "Qué hacer:")}</strong> ${nl2br(a.instruction)}</p>` : ""}
      ${a.expires ? `<p class="meta">${T(lang, "In effect until", "Vigente hasta")} ${esc(fullTime(a.expires, lang))}</p>` : ""}
    </article>`
      )
      .join("")}</section>`
    : `<div class="status status-ok" role="status">
    <span class="status-icon">&#10004;</span>
    <div><p class="status-title">${T(lang, "All clear", "Todo despejado")}</p>
    <p class="status-sub">${T(lang, "No active weather alerts for Crosby, TX right now. This page checks for new alerts every 15 minutes.", "Sin alertas meteorológicas activas para Crosby, TX en este momento. Esta página busca nuevas alertas cada 15 minutos.")}</p></div>
  </div>`;

  // The guide is reference material, clearly framed as "what these mean" so the
  // alert names below the all-clear panel aren't mistaken for active warnings.
  const guide = (lang === "es" ? ALERT_GUIDE_ES : ALERT_GUIDE).map(
    (g) => `
    <article class="ref">
      <h3>${esc(g.event)}</h3>
      <p class="ref-line"><span class="ref-label">${T(lang, "Means", "Significa")}</span> ${esc(g.what)}</p>
      <p class="ref-line"><span class="ref-label">${T(lang, "Do", "Qué hacer")}</span> ${esc(g.do)}</p>
    </article>`
  ).join("");

  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${T(lang, "Crosby, TX Weather Alerts", "Alertas meteorológicas de Crosby, TX")} &mdash; crosbynews.com</title>
<meta name="robots" content="max-snippet:160">
<meta name="description" content="${T(lang, "Active National Weather Service alerts, warnings, and watches for Crosby, Texas, plus a plain-language guide to what each severe-weather alert means and what to do.", "Alertas, avisos y vigilancias activas del Servicio Meteorológico Nacional para Crosby, Texas, además de una guía en lenguaje sencillo sobre qué significa cada alerta de clima severo y qué hacer.")}">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="${T(lang, "Crosby, TX Weather Alerts", "Alertas meteorológicas de Crosby, TX")}">
<meta property="og:description" content="${T(lang, "Active NWS alerts for Crosby, Texas and a plain-language severe-weather guide.", "Alertas activas del NWS para Crosby, Texas y una guía de clima severo en lenguaje sencillo.")}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/alerts", lang)}">
${OG_COMMON}
<link rel="canonical" href="${canonicalFor("/alerts", lang)}">
${hreflangTags("/alerts")}
<link rel="alternate" type="application/rss+xml" title="Crosby, TX Weather Alerts (RSS)" href="/alerts.xml">
${JSONLD_SITE}
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  /* Big, calm status panel — the first thing you see. */
  .status { display:flex; align-items:center; gap:1rem; border-radius:16px; padding:1.4rem 1.5rem; margin-top:0.8rem; }
  .status-icon { font-size:2.6rem; line-height:1; flex:none; }
  .status-title { margin:0; font-size:1.7rem; font-weight:800; line-height:1.1; }
  .status-sub { margin:0.35rem 0 0; font-size:1rem; opacity:0.95; }
  .status-ok { background:linear-gradient(135deg,#1f8b4c,#2eb86a); color:#fff; }
  .status-alert { background:linear-gradient(135deg,#a3271b,#d44230); color:#fff; }

  /* Active-alert detail cards (only shown when alerts exist). */
  .alerts { display:grid; gap:0.6rem; margin-top:0.5rem; }
  .alert { background:#fff4f3; border-left:5px solid #c0392b; border-radius:10px; padding:0.8rem 1rem; }
  .alert h3 { margin:0 0 0.3rem; color:#a3271b; }
  .alert .headline { font-weight:700; }
  .alert .instruction { background:rgba(255,255,255,0.65); border-radius:6px; padding:0.5rem 0.7rem; }
  .alert .meta { font-size:0.8rem; color:var(--muted); }
  @media (prefers-color-scheme: dark) { .alert { background:#2a1715; } .alert .instruction { background:rgba(0,0,0,0.25); } }

  /* Reference section — deliberately calm/muted so it reads as a glossary,
     not as active warnings. */
  .ref-head { margin-top:2rem; }
  .ref-note { color:var(--muted); margin:0.5rem 0 1rem; font-size:0.95rem; line-height:1.55; }
  .ref-grid { display:grid; gap:0.5rem; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); margin-top:0.7rem; }
  .ref { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:0.7rem 0.9rem; }
  .ref h3 { margin:0 0 0.35rem; font-size:0.98rem; color:var(--muted); font-weight:700; }
  .ref-line { margin:0.25rem 0; font-size:0.85rem; }
  .ref-label { display:inline-block; min-width:3.1rem; font-size:0.7rem; text-transform:uppercase; letter-spacing:0.04em; font-weight:700; color:var(--accent); }
  .intro { color:var(--muted); margin:0.6rem 0 0; }
  .push-optin { margin-top:1rem; background:var(--card); border:1px solid var(--line); border-radius:12px; padding:0.9rem 1.1rem; }
  .push-optin .push-desc { margin:0 0 0.6rem; font-size:0.95rem; }
  .push-btn { font:inherit; font-weight:700; color:#fff; background:var(--accent); border:none; border-radius:8px; padding:0.55rem 1rem; cursor:pointer; }
  .push-btn:hover { filter:brightness(1.07); }
  .push-btn:disabled { opacity:0.6; cursor:default; }
  .push-status { margin:0.5rem 0 0; font-size:0.85rem; color:var(--muted); }
</style>
</head>
<body>
${topbar("/alerts", lang)}
<main id="main">
  <h1>${T(lang, "Crosby, TX Weather Alerts", "Alertas meteorológicas de Crosby, TX")}</h1>
  ${status}
  <p class="intro"><a href="${lang === "es" ? "/es/weather" : "/weather"}">&larr; ${T(lang, "Back to the forecast", "Volver al pronóstico")}</a> &middot; <a href="${lang === "es" ? "/es/radar" : "/radar"}">Radar</a> &middot; <a href="${lang === "es" ? "/es/emergency" : "/emergency"}"><strong>${T(lang, "Emergency resources", "Recursos de emergencia")}</strong></a> &middot; ${T(lang, `Official source: <a href="https://www.weather.gov/hgx/">NWS Houston/Galveston</a>. In an emergency, call 911.`, `Fuente oficial: <a href="https://www.weather.gov/hgx/">NWS Houston/Galveston</a>. En una emergencia, llama al 911.`)}</p>

  <section class="push-optin" id="push-optin" hidden aria-label="${T(lang, "Severe weather alerts on this device", "Alertas de clima severo en este dispositivo")}"
    data-sub="${T(lang, "Turn on severe alerts", "Activar alertas severas")}"
    data-unsub="${T(lang, "Turn off alerts on this device", "Desactivar alertas en este dispositivo")}"
    data-off="${T(lang, "Get a push notification on this device when a tornado, flash flood, or hurricane warning is issued for Crosby. No account needed, and you can turn it off anytime. Detailed alert text stays in official NWS English.", "Recibe una notificación en este dispositivo cuando se emita un aviso de tornado, inundación repentina o huracán para Crosby. Sin cuenta, y puedes desactivarla cuando quieras. El texto detallado de la alerta permanece en el inglés oficial del NWS.")}"
    data-on="${T(lang, "Alerts are on for this device. You'll be notified of tornado, flash-flood, and hurricane warnings for Crosby.", "Las alertas están activadas en este dispositivo. Se te notificará de avisos de tornado, inundación repentina y huracán para Crosby.")}"
    data-blocked="${T(lang, "Notifications are blocked in your browser settings. Enable them for this site to receive alerts.", "Las notificaciones están bloqueadas en la configuración de tu navegador. Actívalas para este sitio para recibir alertas.")}"
    data-error="${T(lang, "Couldn't update alerts just now. Please try again.", "No se pudieron actualizar las alertas ahora. Inténtalo de nuevo.")}"
    data-ios="${T(lang, "To get severe-weather alerts on an iPhone, first add this site to your Home Screen: tap the Share button, choose “Add to Home Screen,” then open Crosby News from that icon and come back to this page.", "Para recibir alertas de clima severo en un iPhone, primero agrega este sitio a tu pantalla de inicio: toca el botón Compartir, elige «Agregar a pantalla de inicio», luego abre Crosby News desde ese ícono y vuelve a esta página.")}">
    <p class="push-desc"></p>
    <button type="button" class="push-btn" aria-pressed="false"></button>
    <p class="push-status" role="status"></p>
  </section>

  <div data-nosnippet>
  <h2 class="ref-head">${T(lang, "Severe Weather Guide", "Guía de clima severo")}</h2>
  <p class="ref-note">${T(lang, `The guide below explains common NWS alert types in plain language &mdash; what each one means and what to do if one is issued. It&rsquo;s here for reference; no action is needed when the status above shows &ldquo;All clear.&rdquo; If an alert is active for Crosby, the panel at the top of this page turns red and shows the full alert. In any emergency, call&nbsp;911 and follow guidance from local officials and the <a href="https://www.weather.gov/hgx/">NWS Houston/Galveston</a> office.`, `La guía siguiente explica en lenguaje sencillo los tipos de alerta más comunes del NWS: qué significa cada una y qué hacer si se emite. Está aquí como referencia; no se requiere ninguna acción cuando el estado de arriba indica «Todo despejado». Si hay una alerta activa para Crosby, el panel de la parte superior de esta página se vuelve rojo y muestra la alerta completa. En cualquier emergencia, llama al&nbsp;911 y sigue las indicaciones de las autoridades locales y de la <a href="https://www.weather.gov/hgx/">oficina del NWS en Houston/Galveston</a>.`)}</p>
  <div class="ref-grid">${guide}</div>
  </div>
</main>
${footer({ page: "/alerts", lang, source: T(lang, `Data from the U.S. National Weather Service (<a href="https://weather.gov">weather.gov</a>).`, `Datos del Servicio Meteorológico Nacional de EE. UU. (<a href="https://weather.gov">weather.gov</a>).`), data })}
<script>${PUSH_CLIENT_SCRIPT}</script>
</body>
</html>`;
}

export function alertsMarkdown(data, lang) {
  const alerts = data.alerts ?? [];
  const out = [`# ${T(lang, "Crosby, TX Weather Alerts", "Alertas meteorológicas de Crosby, TX")}`, "", `_${T(lang, `Active NWS alerts for Crosby, Texas. Updated ${fullTime(data.updated)} CT.`, `Alertas activas del NWS para Crosby, Texas. Actualizado ${fullTime(data.updated, lang)} CT.`)}_`, ""];
  out.push(T(lang, "## Active alerts", "## Alertas activas"));
  if (alerts.length) {
    for (const a of alerts) {
      out.push(`### ${a.event}`);
      if (a.headline) out.push(`**${a.headline}**`, "");
      if (a.description) out.push(String(a.description).replace(/\s*\n\s*/g, " "), "");
      if (a.instruction) out.push(`${T(lang, "What to do:", "Qué hacer:")} ${String(a.instruction).replace(/\s*\n\s*/g, " ")}`, "");
      if (a.expires) out.push(`_${T(lang, "In effect until", "Vigente hasta")} ${fullTime(a.expires, lang)} CT_`, "");
    }
  } else {
    out.push(T(lang, "None right now. ✓", "Ninguna en este momento. ✓"), "");
  }
  out.push(T(lang, "## Severe-weather guide (Texas Gulf Coast)", "## Guía de clima severo (costa del Golfo de Texas)"), "");
  for (const g of lang === "es" ? ALERT_GUIDE_ES : ALERT_GUIDE) {
    out.push(`### ${g.event}`, `- **${T(lang, "Means:", "Significa:")}** ${g.what}`, `- **${T(lang, "Do:", "Qué hacer:")}** ${g.do}`, "");
  }
  out.push("---", `${T(lang, "Official source: NWS Houston/Galveston. In an emergency, call 911.", "Fuente oficial: NWS Houston/Galveston. En una emergencia, llama al 911.")} · [${T(lang, "Emergency resources", "Recursos de emergencia")}](${canonicalFor("/emergency", lang)}) · [crosbynews.com](${canonicalFor("/", lang)})`);
  return out.join("\n");
}

// /alerts.xml — the no-accounts, no-tracking notification channel. An empty
// channel is the normal all-clear state, not an error.
export function alertsRss(data) {
  const items = (data.alerts ?? [])
    .map(
      (a) => `
  <item>
    <title>${esc(a.event || "Weather alert")}</title>
    <link>${SITE}/alerts</link>
    <guid isPermaLink="false">${esc(a.id || `${a.event} ${a.sent || a.effective || ""}`)}</guid>
    <pubDate>${rssDate(a.sent || a.effective || data.updated)}</pubDate>
    <description>${esc([a.headline, a.description, a.instruction ? `What to do: ${a.instruction}` : ""].filter(Boolean).join("\n\n"))}</description>
  </item>`
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Crosby, TX Weather Alerts — crosbynews.com</title>
  <link>${SITE}/alerts</link>
  <description>Active National Weather Service alerts for Crosby, Texas. The feed is empty when no alerts are active — items appear only when NWS issues one. Not a substitute for official warning channels.</description>
  <language>en-us</language>
  <ttl>15</ttl>
  <lastBuildDate>${rssDate(data.updated)}</lastBuildDate>${items}
</channel>
</rss>
`;
}
