// Atlantic tropical outlook from the NOAA National Hurricane Center.
//
// An empty storms array is the normal quiet-basin state, not an error.
// Movement shows a compass direction only: movementSpeed's unit is not clearly
// documented upstream, and guessing it would put a wrong number on a
// hurricane page.

import { T, canonicalFor, hreflangTags, translateDir } from "../i18n.js";
import { esc, fullTime } from "../lib/format.js";
import { BASE_CSS } from "../assets/base-css.js";
import { topbar, footer } from "../chrome.js";
import { JSONLD_SITE, OG_COMMON } from "../seo.js";

// Cron + KV pattern like water/calendar: the cron refreshes the `tropics` key
// (throttled ~hourly — NHC advisories update every 2-6h) from NHC's
// CurrentStorms.json, filtered to the Atlantic basin (storm ids "al..." —
// East/Central Pacific storms don't threaten Crosby). The /tropics page and
// the homepage strip self-hide when nothing is active, which is most of the
// year. Worker reachability to www.nhc.noaa.gov was canary-verified from the
// deployed Worker runtime before this shipped (200, real body).
export const TROPICS_KV_KEY = "tropics";

// NHC classification codes → bilingual labels. Hand dictionary with English
// fallback, same deterministic-translation policy as NWS text elsewhere.
export const NHC_CLASS = {
  TD: ["Tropical Depression", "Depresión tropical"],
  TS: ["Tropical Storm", "Tormenta tropical"],
  HU: ["Hurricane", "Huracán"],
  MH: ["Major Hurricane", "Huracán mayor"],
  STD: ["Subtropical Depression", "Depresión subtropical"],
  STS: ["Subtropical Storm", "Tormenta subtropical"],
  PTC: ["Potential Tropical Cyclone", "Posible ciclón tropical"],
  PC: ["Post-tropical Cyclone", "Ciclón postropical"],
  RL: ["Remnant Low", "Baja remanente"],
};
export function tropicsClassLabel(code, lang) {
  const pair = NHC_CLASS[String(code || "").toUpperCase()];
  return pair ? T(lang, pair[0], pair[1]) : String(code || "").toUpperCase() || T(lang, "System", "Sistema");
}

// NHC's CurrentStorms.json reports intensity in KNOTS; advisories quote mph
// rounded to 5, so match that. (movementSpeed's unit isn't clearly documented,
// so we show movement direction only — never guess a unit.)
export const ktToMph = (kt) => (Number.isFinite(Number(kt)) ? Math.round((Number(kt) * 1.15078) / 5) * 5 : null);
export function degToCompass(deg) {
  const d = Number(deg);
  if (!Number.isFinite(d)) return null;
  const pts = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return pts[Math.round((((d % 360) + 360) % 360) / 22.5) % 16];
}

// Fetch active Atlantic systems. Throws on failure so the cron
// aborts-without-writing and the last snapshot survives (the water pattern).
// An empty storms array is a normal, meaningful result — quiet basin.
export async function fetchTropics() {
  const res = await fetch("https://www.nhc.noaa.gov/CurrentStorms.json", {
    headers: { "User-Agent": "crosbynews.com", Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`NHC request failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  const storms = (json.activeStorms ?? [])
    .filter((s) => String(s.id || "").toLowerCase().startsWith("al"))
    .map((s) => ({
      id: s.id,
      name: s.name,
      classification: String(s.classification || "").toUpperCase(),
      intensityKt: Number.isFinite(Number(s.intensity)) ? Number(s.intensity) : null,
      pressureMb: Number.isFinite(Number(s.pressure)) ? Number(s.pressure) : null,
      lat: typeof s.latitudeNumeric === "number" ? s.latitudeNumeric : null,
      lon: typeof s.longitudeNumeric === "number" ? s.longitudeNumeric : null,
      movementDeg: Number.isFinite(Number(s.movementDir)) ? Number(s.movementDir) : null,
      lastUpdate: s.lastUpdate || null,
      advisoryUrl: s.publicAdvisory?.url || "https://www.nhc.noaa.gov/",
    }));
  return { updated: new Date().toISOString(), storms };
}

// Read the cached outlook, self-healing on a cold/malformed entry and
// degrading to an empty shape on total failure (mirrors loadWater).
export async function loadTropics(env) {
  let data = null;
  try {
    data = await env.WEATHER.get(TROPICS_KV_KEY, "json");
  } catch (e) {
    console.error("KV tropics parse failed:", e && e.stack);
  }
  if (!data || !Array.isArray(data.storms)) {
    try {
      data = await fetchTropics();
      await env.WEATHER.put(TROPICS_KV_KEY, JSON.stringify(data));
    } catch (e) {
      console.error("tropics cold fetch failed:", e && e.stack);
      data = { updated: null, storms: [] };
    }
  }
  return data;
}

// One-line storm description shared by the page, the hub strip, and markdown:
// "Hurricane Nadine — 105 mph".
export function tropicsStormLine(s, lang) {
  const mph = ktToMph(s.intensityKt);
  return `${tropicsClassLabel(s.classification, lang)} ${s.name}${mph != null ? ` — ${mph} mph` : ""}`;
}

// JSON shape served at /api/tropics — the same NHC data behind /tropics.
// An empty `storms` array is the normal quiet-basin state, not an error.
export function apiTropics(data) {
  return {
    basin: "Atlantic",
    source: "NOAA National Hurricane Center (nhc.noaa.gov)",
    updated: data.updated ?? null,
    storms: (data.storms ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      classification: s.classification,
      classificationLabel: tropicsClassLabel(s.classification, "en"),
      windMph: ktToMph(s.intensityKt),
      intensityKt: s.intensityKt,
      pressureMb: s.pressureMb,
      lat: s.lat,
      lon: s.lon,
      movementDirection: degToCompass(s.movementDeg),
      lastUpdate: s.lastUpdate,
      advisoryUrl: s.advisoryUrl,
    })),
  };
}

export function tropicsHtml(data, lang) {
  const storms = data.storms ?? [];
  const title = T(lang, "Atlantic Tropical Weather", "Tiempo tropical del Atlántico");
  const desc = T(
    lang,
    "Active Atlantic tropical storms and hurricanes from the National Hurricane Center, plus what hurricane season means for Crosby, TX. Quiet-basin friendly: shows nothing scary when nothing is happening.",
    "Tormentas tropicales y huracanes activos del Atlántico según el Centro Nacional de Huracanes, y qué significa la temporada de huracanes para Crosby, TX."
  );
  const cards = storms
    .map((s) => {
      const mph = ktToMph(s.intensityKt);
      const compass = degToCompass(s.movementDeg);
      const rows = [];
      if (mph != null) rows.push(`<li><span class="pk-label">${T(lang, "Max sustained winds", "Vientos máximos sostenidos")}</span><span class="pk-val">${mph} mph</span></li>`);
      if (s.pressureMb != null) rows.push(`<li><span class="pk-label">${T(lang, "Central pressure", "Presión central")}</span><span class="pk-val">${esc(s.pressureMb)} mb</span></li>`);
      if (s.lat != null && s.lon != null) rows.push(`<li><span class="pk-label">${T(lang, "Position", "Posición")}</span><span class="pk-val">${Math.abs(s.lat).toFixed(1)}°${s.lat >= 0 ? "N" : "S"}, ${Math.abs(s.lon).toFixed(1)}°${s.lon >= 0 ? "E" : "W"}</span></li>`);
      if (compass) rows.push(`<li><span class="pk-label">${T(lang, "Moving", "Movimiento")}</span><span class="pk-val">${translateDir(compass, lang)}</span></li>`);
      return `      <article class="storm">
        <div class="storm-head">
          <h2>&#127744; ${esc(tropicsClassLabel(s.classification, lang))} ${esc(s.name)}</h2>
        </div>
        <ul class="peek">${rows.join("")}</ul>
        <p class="storm-meta">${s.lastUpdate ? `${T(lang, "NHC update", "Actualización del NHC")}: ${esc(fullTime(s.lastUpdate, lang))} CT &middot; ` : ""}<a href="${esc(s.advisoryUrl)}" target="_blank" rel="noopener">${T(lang, "Official NHC advisory", "Aviso oficial del NHC")}</a></p>
      </article>`;
    })
    .join("\n");

  const status = storms.length
    ? `<div class="status status-storm" role="status"><span class="status-icon">&#127744;</span><div><p class="status-title">${storms.length === 1 ? esc(tropicsStormLine(storms[0], lang)) : T(lang, `${storms.length} active systems in the Atlantic`, `${storms.length} sistemas activos en el Atlántico`)}</p><p class="status-sub">${T(lang, "Details below. For what it means locally, watch official guidance and the alerts page.", "Detalles abajo. Para saber qué significa localmente, sigue la guía oficial y la página de alertas.")}</p></div></div>`
    : `<div class="status status-ok" role="status"><span class="status-icon">&#10004;</span><div><p class="status-title">${T(lang, "Nothing active in the Atlantic", "Nada activo en el Atlántico")}</p><p class="status-sub">${T(lang, "The National Hurricane Center is tracking no active tropical systems in the Atlantic basin right now. This page rechecks about every hour.", "El Centro Nacional de Huracanes no está siguiendo ningún sistema tropical activo en la cuenca del Atlántico en este momento. Esta página se actualiza aproximadamente cada hora.")}</p></div></div>`;

  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} &mdash; Crosby, TX &mdash; crosbynews.com</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/tropics", lang)}">
${OG_COMMON}
<link rel="canonical" href="${canonicalFor("/tropics", lang)}">
${hreflangTags("/tropics")}
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
  .status-storm { background:linear-gradient(135deg,#6f1fa0,#8e2ec2); }
  .storms { display:grid; gap:0.7rem; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); margin-top:1rem; }
  .storm { background:var(--card); border-radius:12px; padding:0.85rem 1rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); border-left:5px solid #8e2ec2; }
  .storm-head h2 { margin:0 0 0.4rem; font-size:1.05rem; }
  .storm-meta { margin:0.5rem 0 0; font-size:0.82rem; color:var(--muted); }
  .peek { list-style:none; margin:0; padding:0; }
  .peek li { display:flex; justify-content:space-between; gap:0.6rem; padding:0.28rem 0; border-bottom:1px solid var(--line); font-size:0.9rem; }
  .peek li:last-child { border-bottom:none; }
  .pk-label { color:var(--muted); flex:none; }
  .pk-val { text-align:right; }
  .intro { color:var(--muted); margin:0.6rem 0 0; }
  .guide { margin-top:1.6rem; }
  .guide h2 { font-size:1.15rem; }
  .guide p { font-size:0.95rem; line-height:1.55; }
  .guide .links { margin:0.5rem 0 0; padding-left:1.1rem; }
  .guide .links li { margin:0.3rem 0; font-size:0.92rem; }
</style>
</head>
<body>
${topbar("/tropics", lang)}
<main id="main">
  <h1>${esc(title)}</h1>
  <p class="intro">${T(lang, "Active Atlantic tropical systems from the National Hurricane Center, checked about every hour. Storm advisories and names stay in NHC's official English.", "Sistemas tropicales activos del Atlántico según el Centro Nacional de Huracanes, consultados aproximadamente cada hora. Los avisos y nombres de tormentas se muestran en el inglés oficial del NHC.")}${data.updated ? ` ${T(lang, "Updated", "Actualizado")} ${esc(fullTime(data.updated, lang))} CT.` : ""}</p>
  ${status}
  ${storms.length ? `<div class="storms">\n${cards}\n  </div>` : ""}
  <section class="guide" data-nosnippet>
    <h2>${T(lang, "Hurricane season and Crosby", "La temporada de huracanes y Crosby")}</h2>
    <p>${T(
      lang,
      "Atlantic hurricane season runs June 1 through November 30, peaking mid-August to mid-October. Crosby sits about 35 miles inland — far enough that storm surge isn't the local threat, close enough that hurricanes still hit hard here. The dangers that reach Crosby are inland rain flooding (Harvey in 2017 flooded homes along the San Jacinto and Cedar Bayou), damaging wind, tornadoes spun off by landfalling storms, and days-long power outages.",
      "La temporada de huracanes del Atlántico va del 1 de junio al 30 de noviembre, con su pico de mediados de agosto a mediados de octubre. Crosby está a unas 35 millas tierra adentro — lo suficientemente lejos para que la marejada no sea la amenaza local, y lo suficientemente cerca para que los huracanes golpeen fuerte aquí. Los peligros que llegan a Crosby son la inundación por lluvia (Harvey en 2017 inundó casas a lo largo del San Jacinto y Cedar Bayou), el viento dañino, los tornados que generan las tormentas al tocar tierra y los apagones de varios días."
    )}</p>
    <p>${T(
      lang,
      "A watch means conditions are possible within 48 hours — finish preparations. A warning means they're expected within 36 hours — preparations should be done and it's time to follow official instructions. When a storm threatens the Texas coast, local watches and warnings for Crosby appear on the alerts page, and river levels are on the water page.",
      "Una vigilancia (watch) significa que las condiciones son posibles dentro de 48 horas — termina los preparativos. Un aviso (warning) significa que se esperan dentro de 36 horas — los preparativos deben estar listos y toca seguir las instrucciones oficiales. Cuando una tormenta amenaza la costa de Texas, las vigilancias y avisos locales para Crosby aparecen en la página de alertas, y los niveles de los ríos en la página de agua."
    )}</p>
    <ul class="links">
      <li><a href="https://www.nhc.noaa.gov/">${T(lang, "National Hurricane Center", "Centro Nacional de Huracanes")}</a> &mdash; ${T(lang, "the official source: outlooks, forecast cones, advisories", "la fuente oficial: pronósticos, conos y avisos")}</li>
      <li><a href="${lang === "es" ? "/es/alerts" : "/alerts"}">${T(lang, "Crosby alerts", "Alertas de Crosby")}</a> &mdash; ${T(lang, "local NWS watches and warnings when a storm approaches", "vigilancias y avisos locales del NWS cuando se acerca una tormenta")}</li>
      <li><a href="${lang === "es" ? "/es/water" : "/water"}">${T(lang, "Water levels", "Niveles de agua")}</a> &mdash; ${T(lang, "live river and bayou gauges during the rain", "medidores de ríos y arroyos en vivo durante la lluvia")}</li>
      <li><a href="${lang === "es" ? "/es/emergency" : "/emergency"}">${T(lang, "Emergency resources", "Recursos de emergencia")}</a> &mdash; ${T(lang, "numbers to save, outage reporting, shelters, evacuation-zone lookup", "números para guardar, reporte de apagones, refugios, zonas de evacuación")}</li>
    </ul>
  </section>
</main>
${footer({ page: "/tropics", lang, source: T(lang, `Tropical data from the NOAA <a href="https://www.nhc.noaa.gov/">National Hurricane Center</a>.`, `Datos tropicales del <a href="https://www.nhc.noaa.gov/">Centro Nacional de Huracanes</a> de NOAA.`) })}
</body>
</html>`;
}

export function tropicsMarkdown(data, lang) {
  const storms = data.storms ?? [];
  const out = [
    `# ${T(lang, "Atlantic Tropical Weather", "Tiempo tropical del Atlántico")}`,
    "",
    `_${T(lang, "Active Atlantic systems from the NOAA National Hurricane Center.", "Sistemas activos del Atlántico según el Centro Nacional de Huracanes de NOAA.")}${data.updated ? ` ${T(lang, "Updated", "Actualizado")} ${fullTime(data.updated, lang)} CT.` : ""}_`,
    "",
  ];
  if (storms.length) {
    for (const s of storms) {
      const mph = ktToMph(s.intensityKt);
      const compass = degToCompass(s.movementDeg);
      out.push(`## ${tropicsClassLabel(s.classification, lang)} ${s.name}`);
      if (mph != null) out.push(`- ${T(lang, "Max sustained winds", "Vientos máximos sostenidos")}: ${mph} mph`);
      if (s.pressureMb != null) out.push(`- ${T(lang, "Central pressure", "Presión central")}: ${s.pressureMb} mb`);
      if (s.lat != null && s.lon != null) out.push(`- ${T(lang, "Position", "Posición")}: ${Math.abs(s.lat).toFixed(1)}°${s.lat >= 0 ? "N" : "S"}, ${Math.abs(s.lon).toFixed(1)}°${s.lon >= 0 ? "E" : "W"}`);
      if (compass) out.push(`- ${T(lang, "Moving", "Movimiento")}: ${translateDir(compass, lang)}`);
      out.push(`- ${T(lang, "Official advisory", "Aviso oficial")}: ${s.advisoryUrl}`, "");
    }
  } else {
    out.push(T(lang, "Nothing active in the Atlantic basin right now. ✓", "Nada activo en la cuenca del Atlántico en este momento. ✓"), "");
  }
  out.push(
    `## ${T(lang, "Hurricane season and Crosby", "La temporada de huracanes y Crosby")}`,
    "",
    T(
      lang,
      "Season runs June 1 – November 30. Crosby's hurricane dangers are inland rain flooding, damaging wind, spin-off tornadoes, and extended power outages — not storm surge (we're ~35 miles inland). Watches mean possible within 48h; warnings mean expected within 36h.",
      "La temporada va del 1 de junio al 30 de noviembre. Los peligros para Crosby son la inundación por lluvia, el viento dañino, los tornados derivados y los apagones prolongados — no la marejada (estamos a ~35 millas tierra adentro). Una vigilancia significa posible en 48 h; un aviso, esperado en 36 h."
    ),
    "",
    "---",
    `${T(lang, "Source: NOAA National Hurricane Center (nhc.noaa.gov).", "Fuente: Centro Nacional de Huracanes de NOAA (nhc.noaa.gov).")} · [${T(lang, "Alerts", "Alertas")}](${canonicalFor("/alerts", lang)}) · [${T(lang, "Emergency resources", "Recursos de emergencia")}](${canonicalFor("/emergency", lang)}) · [crosbynews.com](${canonicalFor("/", lang)})`
  );
  return out.join("\n");
}
