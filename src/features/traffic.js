// Crosby-corridor road incidents and lane closures from Houston TranStar RSS.
//
// The feeds carry no coordinates, so relevance is text matching: US-90 but
// never US-90 Alternate/US-90A (a different road), IH-10 East gated on
// Crosby-stretch cross streets, plus Crosby-area place tokens.
//
// null vs [] is load-bearing on both incidents and closures: null means that
// feed was unreachable at the last refresh, [] means quiet roads.
//
// Camera images are never embedded or proxied — TxDOT's terms forbid
// hotlinking, so we link TranStar's own per-roadway camera pages.

import { SITE } from "../config.js";
import { T, canonicalFor, hreflangTags } from "../i18n.js";
import { esc, fullTime } from "../lib/format.js";
import { BASE_CSS } from "../assets/base-css.js";
import { topbar, footer } from "../chrome.js";
import { JSONLD_SITE, OG_COMMON } from "../seo.js";

// Live incidents and scheduled lane closures for the roads Crosby actually
// drives — US-90 (the Crosby Freeway), FM-2100, FM-1942, and the Crosby
// stretch of IH-10 East — from Houston TranStar's public RSS feeds
// (traffic.houstontranstar.org/data/rss/, updated about once a minute).
// Worker reachability was canary-verified from the deployed runtime (200 +
// live XML) before this shipped. Cron + KV pattern (key "traffic", cron-owned,
// refreshed every tick — incidents move fast, and high-water closures are the
// storm-time payoff alongside /water).
//
// Source-terms notes (why this looks the way it does):
// - TranStar's JSON API data feeds require a data-use agreement (they 403
//   without one), so this uses the RSS feeds TranStar publishes for public
//   subscription instead, republishing only the facts they carry (road,
//   location, status, lanes) with attribution — the same model /news uses
//   with Google News RSS.
// - TxDOT's houstontranstar.org terms prohibit hotlinking/framing images
//   without written consent, so camera SNAPSHOTS are never embedded or
//   proxied — cameras are LINKS to TranStar's own pages only.
// - DriveTexas (www.drivetexas.org) times out from Worker egress IPs
//   (canary-verified 2026-07-16), so TxDOT statewide conditions aren't used.
export const TRAFFIC_KV_KEY = "traffic";

// Corridor filter. TranStar's RSS items are text-only (no coordinates), so
// relevance is matched on the location text, anchored at the start of the
// title where the roadway name lives:
// - US-90: TranStar's monitored US-90 corridor IS Crosby's highway (Hunting
//   Bayou east to the Liberty County line), so any title starting "US-90"
//   counts — but never "US-90 Alternate"/"US-90A", a different road 30+ miles
//   southwest.
// - IH-10 East: only with a cross street on the Channelview–Baytown stretch
//   Crosby drives (Crosby-Lynchburg, Sheldon, San Jacinto River, Garth, ...).
// - Named Crosby-area roads anywhere in the text (FM-2100, FM-1942,
//   Runneburg, Barrett Station, ...) for street-level items.
export const TRAFFIC_I10E_XSTREETS = /crosby|lynchburg|sheldon|san jacinto river|cedar bayou|garth|sjolander|monmouth/i;
export const TRAFFIC_AREA_TOKENS = /\b(crosby|runneburg|janacek|krenek|kernohan|barrett station|huffman|fm[- ]?2100|fm[- ]?1942)\b/i;
export function trafficRelevant(text) {
  const t = String(text || "");
  if (/^US-?\s?90(?!\s*A(lternate)?\b)/i.test(t)) return true;
  if (/^IH-10 East\b/i.test(t) && TRAFFIC_I10E_XSTREETS.test(t)) return true;
  return TRAFFIC_AREA_TOKENS.test(t);
}

// Minimal RSS 2.0 item reader for TranStar's feeds (title/description/guid per
// <item>; entity-decode only, no dependency — the parseIcs approach).
export function xmlDecode(s) {
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
export function parseRssItems(xml) {
  return String(xml)
    .split(/<item>/i)
    .slice(1)
    .map((block) => {
      const grab = (tag) => {
        const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
        return m ? xmlDecode(m[1].trim()) : "";
      };
      return { title: grab("title"), description: grab("description"), guid: grab("guid") };
    });
}

// Incident titles are "<roadway + cross street> - <type>"; the roadway name
// itself can contain " - " (SH-99 Lanier/Grand Pkwy - North), so split on the
// LAST separator. Descriptions are "Status: <s> - Lanes Affected: <l>".
export function parseTrafficIncident(item) {
  const i = item.title.lastIndexOf(" - ");
  const location = (i > 0 ? item.title.slice(0, i) : item.title).trim();
  const type = (i > 0 ? item.title.slice(i + 3) : "").trim();
  const status = (item.description.match(/Status:\s*([^-]+?)(?:\s+-\s+|$)/i)?.[1] || "").trim();
  const lanes = (item.description.match(/Lanes Affected:\s*(.+)$/i)?.[1] || "").trim();
  return { location, type, status, lanes };
}
// Lane-closure titles are the location; descriptions are
// "<schedule> - Lanes Affected: <l> - Status: <s>".
export function parseTrafficClosure(item) {
  const schedule = (item.description.match(/^(.*?)(?:\s+-\s+Lanes Affected:)/i)?.[1] || item.description).trim();
  const lanes = (item.description.match(/Lanes Affected:\s*(.*?)(?:\s+-\s+Status:|$)/i)?.[1] || "").trim();
  const status = (item.description.match(/Status:\s*(.+)$/i)?.[1] || "").trim();
  return { location: item.title.trim(), schedule, lanes, status };
}

// Fetch both feeds. Each side is independently failure-tolerant: a failed
// side stores null ("unavailable" — honest, distinct from [] "quiet"); throw
// only when BOTH fail so the cron aborts-without-writing and the last
// snapshot survives (the water pattern).
export async function fetchTraffic() {
  const feed = async (file) => {
    const res = await fetch(`https://traffic.houstontranstar.org/data/rss/${file}`, {
      headers: { "User-Agent": "crosbynews.com", Accept: "application/rss+xml, text/xml" },
    });
    if (!res.ok) throw new Error(`TranStar ${file}: ${res.status} ${res.statusText}`);
    return parseRssItems(await res.text());
  };
  let incidents = null;
  let closures = null;
  try {
    incidents = (await feed("incidents_rss.xml"))
      .filter((it) => trafficRelevant(it.title))
      .map(parseTrafficIncident)
      .filter((inc) => !/^cleared\b/i.test(inc.status))
      .slice(0, 25);
  } catch (e) {
    console.error("TranStar incidents fetch failed:", e && e.message);
  }
  try {
    closures = (await feed("laneclosures_rss.xml"))
      .filter((it) => trafficRelevant(it.title))
      .map(parseTrafficClosure)
      .slice(0, 25);
  } catch (e) {
    console.error("TranStar lane closures fetch failed:", e && e.message);
  }
  if (!incidents && !closures) throw new Error("TranStar: both RSS feeds failed");
  return { updated: new Date().toISOString(), incidents, closures };
}

// Read the cached snapshot, self-healing on a cold/malformed entry and
// degrading to the all-null "unavailable" shape on total failure.
export async function loadTraffic(env) {
  let data = null;
  try {
    data = await env.WEATHER.get(TRAFFIC_KV_KEY, "json");
  } catch (e) {
    console.error("KV traffic parse failed:", e && e.stack);
  }
  if (!data || !("incidents" in data)) {
    try {
      data = await fetchTraffic();
      await env.WEATHER.put(TRAFFIC_KV_KEY, JSON.stringify(data));
    } catch (e) {
      console.error("traffic cold fetch failed:", e && e.stack);
      data = { updated: null, incidents: null, closures: null };
    }
  }
  return data;
}

// TranStar incident types → bilingual labels. Hand dictionary with English
// fallback (same deterministic-translation policy as NWS text); compound
// types arrive comma-joined ("Heavy Truck, Stall") and translate per part.
export const TRAFFIC_TYPE_ES = {
  stall: "Vehículo averiado",
  accident: "Accidente",
  "heavy truck": "Camión pesado",
  "road debris": "Escombros en la vía",
  "high water": "Agua en la vía",
  "vehicle fire": "Vehículo incendiado",
  "lost load": "Carga caída",
  construction: "Construcción",
  "road closure": "Cierre de vía",
  other: "Otro",
};
export function trafficTypeLabel(type, lang) {
  if (lang !== "es") return type;
  return String(type)
    .split(/,\s*/)
    .map((part) => TRAFFIC_TYPE_ES[part.toLowerCase()] || part)
    .join(", ");
}
// Status strings are "Detected/Verified/Cleared at H:MM AM" — deterministic
// enough to localize the verb; anything else stays in TranStar's English.
export function trafficStatusLabel(status, lang) {
  if (lang !== "es") return status;
  const m = String(status).match(/^(Detected|Verified|Cleared)\s+at\s+(.+)$/i);
  if (!m) return status;
  const verb = { detected: "Detectado", verified: "Verificado", cleared: "Despejado" }[m[1].toLowerCase()];
  return `${verb} a las ${m[2]}`;
}
// High-water incidents get the red treatment — they're the life-safety case.
export const trafficIsWater = (type) => /high water|flood/i.test(String(type));

// The Crosby-corridor TranStar cameras (from TranStar's public camera
// catalog; the owner's issue #92 list, kept to the corridors Crosby drives).
// Coordinates are facts for "which camera is near me"; images are NEVER
// embedded or proxied (TxDOT terms) — the pageUrl points at TranStar's own
// per-roadway camera page.
export const transtarCameraPage = (roadway) =>
  `https://www.houstontranstar.org/cctv/transtar/by_roadway.aspx?mnu=freeway&rd=${roadway.replace(/ /g, "_")}`;
export const TRAFFIC_CAMERAS = [
  { name: "US-90 @ Hunting Bayou", roadway: "US-90", lat: 29.788556, lon: -95.240142 },
  { name: "US-90 @ S Lake Houston Pkwy", roadway: "US-90", lat: 29.812607, lon: -95.210381 },
  { name: "US-90 @ Miller Road Number 3", roadway: "US-90", lat: 29.83844, lon: -95.16166 },
  { name: "US-90 @ San Jacinto River", roadway: "US-90", lat: 29.862702, lon: -95.101932 },
  { name: "US-90 @ FM-1942", roadway: "US-90", lat: 29.879806, lon: -95.068035 },
  { name: "US-90 @ Runneburg Rd", roadway: "US-90", lat: 29.909497, lon: -95.04845 },
  { name: "US-90 @ Janacek Rd", roadway: "US-90", lat: 29.940959, lon: -95.025899 },
  { name: "US-90 @ Liberty County Line", roadway: "US-90", lat: 29.972246, lon: -94.985728 },
  { name: "IH-10 East @ Sheldon", roadway: "IH-10 East", lat: 29.778262, lon: -95.124498 },
  { name: "IH-10 East @ San Jacinto River", roadway: "IH-10 East", lat: 29.794459, lon: -95.07399 },
  { name: "IH-10 East @ Crosby Lynchburg", roadway: "IH-10 East", lat: 29.79459, lon: -95.07399 },
  { name: "IH-10 East @ Garth Rd (W)", roadway: "IH-10 East", lat: 29.803457, lon: -94.990349 },
  { name: "IH-10 East @ Garth Rd", roadway: "IH-10 East", lat: 29.804554, lon: -94.981575 },
  { name: "IH-10 East @ Garth Rd (E)", roadway: "IH-10 East", lat: 29.805825, lon: -94.974788 },
];
// TranStar's live map, centered on Crosby with incidents/closures/cameras on
// (their layers_ve.aspx puts latitude in x= — kept verbatim from their links).
export const TRANSTAR_MAP_URL =
  "https://traffic.houstontranstar.org/layers/layers_ve.aspx?x=29.9119&y=-95.0608&z=12&inc=true&rc=true&cam=true";
export const TRANSTAR_CLOSURES_URL = "https://traffic.houstontranstar.org/roadclosures/";

// JSON shape served at /api/traffic — the same TranStar data behind /traffic.
// incidents/laneClosures are null when that feed was unreachable at the last
// refresh (distinct from [], the normal quiet state).
export function apiTraffic(data) {
  return {
    area: "Crosby, TX corridors: US-90, FM-2100, FM-1942, and IH-10 East (Channelview–Baytown)",
    source: "Houston TranStar (houstontranstar.org) public RSS feeds",
    updated: data.updated ?? null,
    incidents: data.incidents
      ? data.incidents.map((i) => ({ location: i.location, type: i.type, status: i.status, lanesAffected: i.lanes || null }))
      : null,
    laneClosures: data.closures
      ? data.closures.map((c) => ({ location: c.location, schedule: c.schedule, lanesAffected: c.lanes || null, status: c.status || null }))
      : null,
    cameras: TRAFFIC_CAMERAS.map((c) => ({ ...c, pageUrl: transtarCameraPage(c.roadway) })),
    liveMapUrl: TRANSTAR_MAP_URL,
    note: "Incident and closure facts republished from Houston TranStar's public RSS feeds with attribution. During floods, check river gauges at https://crosbynews.com/api/water and never drive into high water.",
  };
}

export function trafficHtml(data, lang) {
  const incidents = data.incidents;
  const closures = data.closures;
  const title = T(lang, "Crosby Roads & Traffic", "Caminos y tráfico de Crosby");
  const desc = T(
    lang,
    "Live traffic incidents and scheduled lane closures for the roads Crosby, TX drives — US-90, FM-2100, FM-1942, and IH-10 East — from Houston TranStar, plus links to the live traffic cameras.",
    "Incidentes de tráfico en vivo y cierres de carriles programados para los caminos de Crosby, TX — US-90, FM-2100, FM-1942 e IH-10 East — según Houston TranStar, más enlaces a las cámaras de tráfico en vivo."
  );

  const status =
    incidents === null
      ? `<p class="none">${T(lang, "Incident data is temporarily unavailable — check TranStar's live map below.", "Los datos de incidentes no están disponibles temporalmente — consulta el mapa en vivo de TranStar más abajo.")}</p>`
      : incidents.length
        ? `<div class="status status-inc" role="status"><span class="status-icon">&#9888;</span><div><p class="status-title">${
            incidents.length === 1
              ? T(lang, "1 incident on Crosby-area roads", "1 incidente en los caminos del área de Crosby")
              : T(lang, `${incidents.length} incidents on Crosby-area roads`, `${incidents.length} incidentes en los caminos del área de Crosby`)
          }</p><p class="status-sub">${T(lang, "Details below — reported and updated by Houston TranStar about every minute.", "Detalles abajo — reportados y actualizados por Houston TranStar aproximadamente cada minuto.")}</p></div></div>`
        : `<div class="status status-ok" role="status"><span class="status-icon">&#10004;</span><div><p class="status-title">${T(lang, "No incidents on Crosby-area roads", "Sin incidentes en los caminos del área de Crosby")}</p><p class="status-sub">${T(lang, "TranStar is reporting no monitored incidents on US-90, FM-2100, FM-1942, or the Crosby stretch of IH-10 East right now.", "TranStar no reporta incidentes en US-90, FM-2100, FM-1942 ni el tramo de Crosby de IH-10 East en este momento.")}</p></div></div>`;

  const incidentCards = (incidents ?? [])
    .map(
      (i) => `      <article class="inc ${trafficIsWater(i.type) ? "inc-water" : ""}">
        <div class="inc-head">
          <h3>${esc(i.location)}</h3>
          ${i.type ? `<span class="inc-badge">${esc(trafficTypeLabel(i.type, lang))}</span>` : ""}
        </div>
        <p class="inc-meta">${[i.status ? esc(trafficStatusLabel(i.status, lang)) : "", i.lanes ? `${T(lang, "Lanes affected", "Carriles afectados")}: ${esc(i.lanes)}` : ""].filter(Boolean).join(" &middot; ")}</p>
      </article>`
    )
    .join("\n");

  const closureRows =
    closures === null
      ? `<p class="none">${T(lang, "Lane-closure data is temporarily unavailable.", "Los datos de cierres de carriles no están disponibles temporalmente.")}</p>`
      : closures.length
        ? `<ul class="closures">${closures
            .map(
              (c) =>
                `<li><strong>${esc(c.location)}</strong><br><span class="cl-meta">${esc(c.schedule)}${c.lanes ? ` &middot; ${T(lang, "Lanes affected", "Carriles afectados")}: ${esc(c.lanes)}` : ""}</span></li>`
            )
            .join("\n")}</ul>`
        : `<p class="none">${T(lang, "No scheduled lane closures on Crosby-area roads right now.", "No hay cierres de carriles programados en los caminos del área de Crosby en este momento.")}</p>`;

  const camList = (roadway) =>
    TRAFFIC_CAMERAS.filter((c) => c.roadway === roadway)
      .map((c) => c.name.replace(`${roadway} @ `, ""))
      .join(", ");

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
<meta property="og:url" content="${canonicalFor("/traffic", lang)}">
${OG_COMMON}
<link rel="canonical" href="${canonicalFor("/traffic", lang)}">
${hreflangTags("/traffic")}
${JSONLD_SITE}
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  .status { display:flex; align-items:center; gap:1rem; border-radius:16px; padding:1.2rem 1.4rem; margin-top:0.8rem; color:#fff; }
  .status-icon { font-size:2.4rem; line-height:1; flex:none; }
  .status-title { margin:0; font-size:1.5rem; font-weight:800; line-height:1.1; }
  .status-sub { margin:0.35rem 0 0; font-size:0.98rem; opacity:0.95; }
  .status-ok { background:linear-gradient(135deg,#1f8b4c,#2eb86a); }
  .status-inc { background:linear-gradient(135deg,#b8860b,#e0a800); }
  .incs { display:grid; gap:0.7rem; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); margin-top:1rem; }
  .inc { background:var(--card); border-radius:12px; padding:0.85rem 1rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); border-left:5px solid #e0a800; }
  .inc-water { border-left-color:#d44230; }
  .inc-head { display:flex; justify-content:space-between; align-items:flex-start; gap:0.5rem; }
  .inc-head h3 { margin:0; font-size:1rem; }
  .inc-badge { flex:none; font-size:0.72rem; font-weight:700; text-transform:uppercase; letter-spacing:0.03em; padding:0.15rem 0.5rem; border-radius:999px; color:#fff; background:#b8860b; white-space:nowrap; }
  .inc-water .inc-badge { background:#b5301f; }
  .inc-meta { margin:0.45rem 0 0; font-size:0.85rem; color:var(--muted); }
  .closures { list-style:none; margin:0.6rem 0 0; padding:0; }
  .closures li { padding:0.5rem 0; border-bottom:1px solid var(--line); font-size:0.92rem; }
  .closures li:last-child { border-bottom:none; }
  .cl-meta { color:var(--muted); font-size:0.85rem; }
  .none { color:var(--muted); margin-top:0.8rem; }
  .intro { color:var(--muted); margin:0.6rem 0 0; }
  .section-h { margin:1.6rem 0 0; font-size:1.15rem; }
  .guide { margin-top:1.6rem; }
  .guide h2 { font-size:1.15rem; }
  .guide p { font-size:0.95rem; line-height:1.55; }
  .guide .links { margin:0.5rem 0 0; padding-left:1.1rem; }
  .guide .links li { margin:0.3rem 0; font-size:0.92rem; }
</style>
</head>
<body>
${topbar("/traffic", lang)}
<main id="main">
  <h1>${esc(title)}</h1>
  <p class="intro">${T(
    lang,
    "Traffic incidents and scheduled lane closures for the roads Crosby drives — US-90 (the Crosby Freeway), FM-2100, FM-1942, and the Crosby stretch of IH-10 East — from Houston TranStar, the region's official traffic agency. Lane and schedule details are shown in TranStar's official English.",
    "Incidentes de tráfico y cierres de carriles programados para los caminos que usa Crosby — US-90 (la autopista de Crosby), FM-2100, FM-1942 y el tramo de Crosby de IH-10 East — según Houston TranStar, la agencia oficial de tráfico de la región. Los detalles de carriles y horarios se muestran en el inglés oficial de TranStar."
  )}${data.updated ? ` ${T(lang, "Updated", "Actualizado")} ${esc(fullTime(data.updated, lang))} CT.` : ""}</p>
  ${status}
  ${incidents?.length ? `<div class="incs">\n${incidentCards}\n  </div>` : ""}
  <h2 class="section-h">${T(lang, "Scheduled lane closures", "Cierres de carriles programados")}</h2>
  ${closureRows}
  <h2 class="section-h">${T(lang, "Live traffic cameras", "Cámaras de tráfico en vivo")}</h2>
  <p class="intro">${T(lang, "Houston TranStar's cameras cover the Crosby corridors — view them on TranStar's own site:", "Las cámaras de Houston TranStar cubren los corredores de Crosby — míralas en el propio sitio de TranStar:")}</p>
  <ul class="closures">
    <li><a href="${transtarCameraPage("US-90")}" target="_blank" rel="noopener">${T(lang, "US-90 cameras", "Cámaras de US-90")}</a><br><span class="cl-meta">${esc(camList("US-90"))}</span></li>
    <li><a href="${transtarCameraPage("IH-10 East")}" target="_blank" rel="noopener">${T(lang, "IH-10 East cameras", "Cámaras de IH-10 East")}</a><br><span class="cl-meta">${esc(camList("IH-10 East"))}</span></li>
    <li><a href="${TRANSTAR_MAP_URL}" target="_blank" rel="noopener">${T(lang, "Live traffic map centered on Crosby", "Mapa de tráfico en vivo centrado en Crosby")}</a><br><span class="cl-meta">${T(lang, "incidents, closures, and cameras on one map", "incidentes, cierres y cámaras en un solo mapa")}</span></li>
  </ul>
  <section class="guide" data-nosnippet>
    <h2>${T(lang, "When water covers the road", "Cuando el agua cubre el camino")}</h2>
    <p>${T(
      lang,
      "Crosby's defining road hazard is high water — US-90 at the San Jacinto River, FM-2100 near Cedar Bayou, and the low spots in between. TranStar reports high-water locations as incidents above during floods. Never drive into water on the road: most flood deaths in Harris County happen in vehicles, and two feet of moving water floats a truck. Turn around, don't drown.",
      "El peligro vial característico de Crosby es el agua alta — US-90 en el río San Jacinto, FM-2100 cerca de Cedar Bayou y los puntos bajos intermedios. Durante inundaciones, TranStar reporta los lugares con agua alta como incidentes arriba. Nunca conduzcas hacia agua en el camino: la mayoría de las muertes por inundación en el condado de Harris ocurren en vehículos, y dos pies de agua en movimiento hacen flotar una camioneta. Da la vuelta, no te arriesgues."
    )}</p>
    <ul class="links">
      <li><a href="${lang === "es" ? "/es/water" : "/water"}">${T(lang, "River & bayou levels", "Niveles de ríos y arroyos")}</a> &mdash; ${T(lang, "the gauges behind Crosby's flooding, live", "los medidores detrás de las inundaciones de Crosby, en vivo")}</li>
      <li><a href="${lang === "es" ? "/es/alerts" : "/alerts"}">${T(lang, "Weather alerts", "Alertas del clima")}</a> &mdash; ${T(lang, "flash-flood warnings for Crosby appear here", "los avisos de inundación repentina para Crosby aparecen aquí")}</li>
      <li><a href="${TRANSTAR_CLOSURES_URL}" target="_blank" rel="noopener">${T(lang, "TranStar incidents & road closures", "Incidentes y cierres de TranStar")}</a> &mdash; ${T(lang, "the full regional list, all roads", "la lista regional completa, todos los caminos")}</li>
      <li><a href="https://www.drivetexas.org/" target="_blank" rel="noopener">DriveTexas</a> &mdash; ${T(lang, "TxDOT statewide highway conditions, for trips beyond Houston", "condiciones de carreteras de TxDOT en todo el estado, para viajes fuera de Houston")}</li>
      <li><a href="${lang === "es" ? "/es/emergency" : "/emergency"}">${T(lang, "Emergency resources", "Recursos de emergencia")}</a> &mdash; ${T(lang, "flood tools, outage reporting, and numbers to save", "herramientas de inundación, reporte de apagones y números para guardar")}</li>
    </ul>
  </section>
</main>
${footer({ page: "/traffic", lang, source: T(lang, `Road and traffic data from <a href="https://www.houstontranstar.org/">Houston TranStar</a>.`, `Datos viales y de tráfico de <a href="https://www.houstontranstar.org/">Houston TranStar</a>.`) })}
</body>
</html>`;
}

export function trafficMarkdown(data, lang) {
  const incidents = data.incidents;
  const closures = data.closures;
  const out = [
    `# ${T(lang, "Crosby Roads & Traffic", "Caminos y tráfico de Crosby")}`,
    "",
    `_${T(lang, "Incidents and lane closures on US-90, FM-2100, FM-1942, and the Crosby stretch of IH-10 East, from Houston TranStar.", "Incidentes y cierres de carriles en US-90, FM-2100, FM-1942 y el tramo de Crosby de IH-10 East, según Houston TranStar.")}${data.updated ? ` ${T(lang, "Updated", "Actualizado")} ${fullTime(data.updated, lang)} CT.` : ""}_`,
    "",
    `## ${T(lang, "Incidents", "Incidentes")}`,
    "",
  ];
  if (incidents === null) {
    out.push(T(lang, "Incident data is temporarily unavailable.", "Los datos de incidentes no están disponibles temporalmente."), "");
  } else if (incidents.length) {
    for (const i of incidents) {
      out.push(`- **${i.location}**${i.type ? ` — ${trafficTypeLabel(i.type, lang)}` : ""}${i.status ? ` (${trafficStatusLabel(i.status, lang)})` : ""}${i.lanes ? `. ${T(lang, "Lanes affected", "Carriles afectados")}: ${i.lanes}` : ""}`);
    }
    out.push("");
  } else {
    out.push(T(lang, "No incidents on Crosby-area roads right now. ✓", "Sin incidentes en los caminos del área de Crosby en este momento. ✓"), "");
  }
  out.push(`## ${T(lang, "Scheduled lane closures", "Cierres de carriles programados")}`, "");
  if (closures === null) {
    out.push(T(lang, "Lane-closure data is temporarily unavailable.", "Los datos de cierres no están disponibles temporalmente."), "");
  } else if (closures.length) {
    for (const c of closures) {
      out.push(`- **${c.location}** — ${c.schedule}${c.lanes ? `. ${T(lang, "Lanes affected", "Carriles afectados")}: ${c.lanes}` : ""}`);
    }
    out.push("");
  } else {
    out.push(T(lang, "No scheduled lane closures on Crosby-area roads right now.", "No hay cierres programados en los caminos del área de Crosby en este momento."), "");
  }
  out.push(
    `## ${T(lang, "Live cameras", "Cámaras en vivo")}`,
    "",
    `- [${T(lang, "US-90 cameras", "Cámaras de US-90")}](${transtarCameraPage("US-90")})`,
    `- [${T(lang, "IH-10 East cameras", "Cámaras de IH-10 East")}](${transtarCameraPage("IH-10 East")})`,
    `- [${T(lang, "Live traffic map centered on Crosby", "Mapa de tráfico en vivo centrado en Crosby")}](${TRANSTAR_MAP_URL})`,
    "",
    "---",
    `${T(lang, "Never drive into high water — turn around, don't drown.", "Nunca conduzcas hacia agua alta — da la vuelta, no te arriesgues.")} ${T(lang, "Data from Houston TranStar (houstontranstar.org).", "Datos de Houston TranStar (houstontranstar.org).")} · [${T(lang, "Water levels", "Niveles de agua")}](${canonicalFor("/water", lang)}) · [crosbynews.com](${canonicalFor("/", lang)})`
  );
  return out.join("\n");
}
