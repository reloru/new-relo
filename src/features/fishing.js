// USGS real-time water conditions for the waters people actually fish near
// Crosby. Location selection is fishing-first, not data-first: industrial
// sites that are physically closer are deliberately excluded, because nearest
// data is not the same as a place people fish.

import { T, canonicalFor, hreflangTags } from "../i18n.js";
import { esc, fullTime, clockTime } from "../lib/format.js";
import { BASE_CSS } from "../assets/base-css.js";
import { topbar, footer } from "../chrome.js";
import { JSONLD_SITE, OG_COMMON } from "../seo.js";

// Live water conditions for the waters people ACTUALLY fish near Crosby, matched
// to the nearest USGS real-time station. Source: waterservices.usgs.gov — the
// keyless legacy IV service (the staged USGS_API_KEY isn't needed for it).
// Location selection is fishing-first, not data-first: Lake Houston (the local
// lake — three in-lake stations incl. the FM 1960 bridge), the San Jacinto
// forks, and the Trinity at Liberty carry the full water-quality suite
// (temperature, dissolved oxygen, pH, turbidity); a few genuinely-fished bayous
// only have a stage gauge, so we show water level and say so. Industrial sites
// that happen to be closer (Lynchburg Reservoir, the SJRA canal) are excluded —
// "nearest data" isn't the same as "a place people fish". Cron + KV like /water,
// failure-tolerant. Honest: the station is nearby, not the exact fishing hole,
// and these are conditions, not a guaranteed bite.
export const FISHING_KV_KEY = "fishing";
export const USGS_PARAMS = { "00010": "tempC", "00300": "do", "00400": "ph", "63680": "turb", "00065": "gageFt" };
export const FISHING_SITES = [
  { id: "300032095080501", water: "Lake Houston", es: "Lake Houston", spot: "FM 1960 bridge", esSpot: "puente FM 1960", fish: "bass, crappie, white bass, catfish", esFish: "lobina, crappie, lobina blanca, bagre" },
  { id: "295554095093402", water: "Lake Houston", es: "Lake Houston", spot: "Jack's Ditch", esSpot: "Jack's Ditch" },
  { id: "295826095082200", water: "Lake Houston", es: "Lake Houston", spot: "Union Pacific RR bridge", esSpot: "puente del FC Union Pacific" },
  { id: "08069500", water: "San Jacinto River — West Fork", es: "Río San Jacinto — Bifurcación Oeste", spot: "near Humble", esSpot: "cerca de Humble", fish: "largemouth bass, catfish", esFish: "lobina negra, bagre" },
  { id: "08070200", water: "San Jacinto River — East Fork", es: "Río San Jacinto — Bifurcación Este", spot: "near New Caney", esSpot: "cerca de New Caney", fish: "largemouth bass, catfish", esFish: "lobina negra, bagre" },
  { id: "08067000", water: "Trinity River", es: "Río Trinity", spot: "at Liberty", esSpot: "en Liberty", fish: "blue & channel catfish", esFish: "bagre azul y de canal" },
  { id: "08067500", water: "Cedar Bayou", es: "Cedar Bayou", spot: "near Crosby", esSpot: "cerca de Crosby", fish: "crappie, bream, bass, catfish", esFish: "crappie, mojarra, lobina, bagre" },
  { id: "08071250", water: "Luce Bayou", es: "Luce Bayou", spot: "at SH-99 near Huffman", esSpot: "en SH-99 cerca de Huffman", fish: "bass, catfish", esFish: "lobina, bagre" },
  { id: "08072050", water: "San Jacinto River — below the lake", es: "Río San Jacinto — debajo del lago", spot: "near Sheldon", esSpot: "cerca de Sheldon", fish: "catfish, bass", esFish: "bagre, lobina" },
];
export const usgsSiteUrl = (id) => `https://waterdata.usgs.gov/monitoring-location/${id}/`;
export const usgsNum = (v) => (v === "" || v == null || v === "-999999" || Number.isNaN(Number(v)) ? null : Number(v));
export const fishMeta = (id) => FISHING_SITES.find((s) => s.id === id) || {};
export const cToF = (c) => Math.round((c * 9) / 5 + 32);

// One USGS IV call for every station; parse the latest value per parameter.
// Per-station filtering keeps a bad site from sinking the batch; throw only if
// nothing usable came back so the cron aborts-without-writing (water pattern).
export async function fetchFishing() {
  const ids = FISHING_SITES.map((s) => s.id).join(",");
  const res = await fetch(
    `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${ids}&parameterCd=00010,00300,00400,63680,00065&siteStatus=all`,
    { headers: { "User-Agent": "crosbynews.com", Accept: "application/json" } }
  );
  if (!res.ok) throw new Error(`USGS IV request failed: ${res.status}`);
  const j = await res.json();
  const series = j?.value?.timeSeries;
  if (!Array.isArray(series) || !series.length) throw new Error("USGS IV: no timeSeries");
  const byId = {};
  for (const ts of series) {
    const id = ts.sourceInfo?.siteCode?.[0]?.value;
    const key = USGS_PARAMS[ts.variable?.variableCode?.[0]?.value];
    if (!id || !key) continue;
    const vals = ts.values?.[0]?.value;
    const last = Array.isArray(vals) && vals.length ? vals[vals.length - 1] : null;
    const num = last ? usgsNum(last.value) : null;
    if (num == null) continue;
    (byId[id] ||= {})[key] = { value: num, time: last.dateTime || null };
  }
  const stations = FISHING_SITES.map((s) => {
    const d = byId[s.id];
    if (!d) return null;
    const params = {};
    for (const k of ["tempC", "do", "ph", "turb", "gageFt"]) if (d[k]) params[k] = d[k];
    if (!Object.keys(params).length) return null;
    const times = Object.values(params).map((p) => p.time).filter(Boolean).sort();
    return { id: s.id, params, observed: times[times.length - 1] || null };
  }).filter(Boolean);
  if (!stations.length) throw new Error("USGS IV: no usable stations");
  return { updated: new Date().toISOString(), stations };
}

// Read the cached conditions, self-healing on a cold/malformed entry (mirrors
// loadWater); empty shape on total failure so the page degrades gracefully.
export async function loadFishing(env) {
  let data = null;
  try {
    data = await env.WEATHER.get(FISHING_KV_KEY, "json");
  } catch (e) {
    console.error("KV fishing parse failed:", e && e.stack);
  }
  if (!data || !Array.isArray(data.stations)) {
    try {
      data = await fetchFishing();
      await env.WEATHER.put(FISHING_KV_KEY, JSON.stringify(data));
    } catch (e) {
      console.error("fishing cold fetch failed:", e && e.stack);
      data = { updated: null, stations: [] };
    }
  }
  return data;
}

// Dissolved oxygen (mg/L) is the main water-quality driver for fish activity;
// stations with only a stage gauge get a neutral "water level only" state.
export function fishingState(st, lang) {
  const dov = st.params.do?.value;
  if (dov == null) return { cls: "f-level", label: T(lang, "Water level only", "Solo nivel del agua") };
  if (dov >= 6) return { cls: "f-good", label: T(lang, "Healthy oxygen", "Oxígeno saludable") };
  if (dov >= 4) return { cls: "f-fair", label: T(lang, "Moderate oxygen", "Oxígeno moderado") };
  return { cls: "f-low", label: T(lang, "Low oxygen", "Oxígeno bajo") };
}
// A short, honest read of conditions — never a guaranteed-bite claim.
export function fishingNote(st, lang) {
  const dov = st.params.do?.value;
  if (dov == null) return T(lang, "Only water level is monitored here — no water-quality sensor at this station.", "Aquí solo se mide el nivel del agua — no hay sensor de calidad del agua en esta estación.");
  const parts = [];
  if (dov >= 6) parts.push(T(lang, "oxygen is healthy", "el oxígeno está saludable"));
  else if (dov >= 4) parts.push(T(lang, "oxygen is moderate — fish may hold deeper or near moving water", "el oxígeno es moderado — los peces pueden mantenerse más profundo o cerca de agua en movimiento"));
  else parts.push(T(lang, "oxygen is low — fish likely sluggish; best odds early morning or near inflows", "el oxígeno está bajo — los peces probablemente lentos; mejores probabilidades temprano o cerca de entradas de agua"));
  const tF = st.params.tempC ? cToF(st.params.tempC.value) : null;
  if (tF != null && tF >= 85) parts.push(T(lang, `warm at ${tF}°F — try deeper, shaded water midday`, `tibia a ${tF}°F — prueba agua más profunda y con sombra al mediodía`));
  else if (tF != null && tF <= 55) parts.push(T(lang, `cool at ${tF}°F — work baits slowly`, `fría a ${tF}°F — mueve el señuelo despacio`));
  const turb = st.params.turb?.value;
  if (turb != null && turb >= 50) parts.push(T(lang, "stained water — scent and vibration baits shine", "agua turbia — señuelos de olor y vibración funcionan mejor"));
  else if (turb != null && turb < 10) parts.push(T(lang, "clear water — go lighter and more natural", "agua clara — usa señuelos más ligeros y naturales"));
  return parts.join("; ");
}
// Metric chips: the full water-quality suite, or a water-level chip.
export function fishingMetrics(st, lang) {
  const p = st.params;
  const chip = (label, val) => `<span class="fchip"><span class="fk">${label}</span> ${val}</span>`;
  const out = [];
  if (p.tempC) out.push(chip(T(lang, "Temp", "Temp"), `${cToF(p.tempC.value)}°F`));
  if (p.do) out.push(chip(T(lang, "Oxygen", "Oxígeno"), `${p.do.value.toFixed(1)}<span class="u"> mg/L</span>`));
  if (p.ph) out.push(chip("pH", `${p.ph.value.toFixed(1)}`));
  if (p.turb) out.push(chip(T(lang, "Clarity", "Claridad"), `${Math.round(p.turb.value)}<span class="u"> FNU</span>`));
  if (p.gageFt && !p.do) out.push(chip(T(lang, "Water level", "Nivel"), `${p.gageFt.value.toFixed(2)}<span class="u"> ft</span>`));
  return out.join(" ");
}
// Group stations by water body, preserving FISHING_SITES order.
export function fishingGroups(stations) {
  const order = [];
  const groups = {};
  for (const st of stations) {
    const m = fishMeta(st.id);
    const w = m.water || "Other";
    if (!groups[w]) { groups[w] = { meta: m, sts: [] }; order.push(w); }
    if (!groups[w].meta.fish && m.fish) groups[w].meta = m;
    groups[w].sts.push(st);
  }
  return order.map((w) => ({ water: w, ...groups[w] }));
}

export function fishingHtml(data, lang) {
  const stations = data.stations ?? [];
  const title = T(lang, "Crosby, TX Fishing Conditions", "Condiciones de pesca de Crosby, TX");
  const desc = T(
    lang,
    "Live water conditions — temperature, dissolved oxygen, pH, and clarity — for the waters people fish near Crosby, TX: Lake Houston, the San Jacinto River forks, the Trinity River, and nearby bayous, from USGS real-time monitoring.",
    "Condiciones del agua en vivo — temperatura, oxígeno disuelto, pH y claridad — para las aguas donde se pesca cerca de Crosby, TX: Lake Houston, las bifurcaciones del río San Jacinto, el río Trinity y arroyos cercanos, del monitoreo en tiempo real del USGS."
  );
  const sections = stations.length
    ? fishingGroups(stations)
        .map((g) => {
          const wName = T(lang, g.water, g.meta.es || g.water);
          const fishLine = g.meta.fish
            ? `      <p class="fw-fish">${T(lang, "Known for", "Se pesca")}: ${esc(T(lang, g.meta.fish, g.meta.esFish || g.meta.fish))}</p>`
            : "";
          const cards = g.sts
            .map((st) => {
              const m = fishMeta(st.id);
              const state = fishingState(st, lang);
              const spot = T(lang, m.spot || "", m.esSpot || m.spot || "");
              return `        <article class="fcard ${state.cls}">
          <div class="fcard-head"><h3>${esc(spot)}</h3><span class="fbadge">${esc(state.label)}</span></div>
          <div class="fmetrics">${fishingMetrics(st, lang)}</div>
          <p class="fnote">${esc(fishingNote(st, lang))}</p>
          <p class="fmeta">${st.observed ? `${T(lang, "as of", "a las")} ${esc(clockTime(st.observed, lang))} CT &middot; ` : ""}<a href="${usgsSiteUrl(st.id)}" target="_blank" rel="noopener">USGS</a></p>
        </article>`;
            })
            .join("\n");
          return `    <section class="fw">
      <h2>${esc(wName)}</h2>
${fishLine}
      <div class="fgrid">
${cards}
      </div>
    </section>`;
        })
        .join("\n")
    : `    <p class="none">${T(lang, "Fishing conditions are temporarily unavailable — try again shortly.", "Las condiciones de pesca no están disponibles temporalmente — inténtalo de nuevo en un momento.")}</p>`;

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
<meta property="og:url" content="${canonicalFor("/fishing", lang)}">
${OG_COMMON}
<link rel="canonical" href="${canonicalFor("/fishing", lang)}">
${hreflangTags("/fishing")}
${JSONLD_SITE}
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  .intro { color:var(--muted); margin:0.6rem 0 0; }
  .fw { margin-top:1.5rem; }
  .fw h2 { font-size:1.15rem; margin:0 0 0.15rem; }
  .fw-fish { margin:0 0 0.5rem; font-size:0.85rem; color:var(--muted); }
  .fgrid { display:grid; gap:0.7rem; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); }
  .fcard { background:var(--card); border-radius:12px; padding:0.85rem 1rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); border-left:5px solid var(--muted); }
  .fcard-head { display:flex; justify-content:space-between; align-items:flex-start; gap:0.5rem; }
  .fcard-head h3 { margin:0; font-size:1rem; }
  .fbadge { flex:none; font-size:0.72rem; font-weight:700; text-transform:uppercase; letter-spacing:0.03em; padding:0.15rem 0.5rem; border-radius:999px; color:#fff; background:var(--muted); white-space:nowrap; }
  .fmetrics { display:flex; flex-wrap:wrap; gap:0.35rem; margin:0.55rem 0 0; }
  .fchip { font-size:0.9rem; font-weight:700; background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:0.15rem 0.45rem; }
  .fchip .fk { font-size:0.68rem; font-weight:700; text-transform:uppercase; letter-spacing:0.03em; color:var(--muted); }
  .fchip .u { font-size:0.72rem; font-weight:600; opacity:0.7; }
  .fnote { margin:0.5rem 0 0; font-size:0.85rem; color:var(--ink); line-height:1.45; }
  .fmeta { margin:0.3rem 0 0; font-size:0.78rem; color:var(--muted); }
  .f-good { border-left-color:#2eb86a; } .f-good .fbadge { background:#1f8b4c; }
  .f-fair { border-left-color:#e0a800; } .f-fair .fbadge { background:#b8860b; }
  .f-low { border-left-color:#d44230; } .f-low .fbadge { background:#b5301f; }
  .f-level { border-left-color:var(--accent); } .f-level .fbadge { background:var(--accent); }
  .fguide { margin-top:1.6rem; background:var(--card); border-radius:12px; padding:0.9rem 1.1rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); }
  .fguide h2 { font-size:1.05rem; margin:0 0 0.3rem; }
  .fguide p, .fguide ul { font-size:0.88rem; color:var(--muted); line-height:1.55; margin:0.3rem 0 0; }
  .fguide ul { padding-left:1.1rem; }
  .safety { margin-top:1.4rem; font-size:0.85rem; color:var(--muted); border-top:1px solid var(--line); padding-top:0.8rem; }
</style>
</head>
<body>
${topbar("/fishing", lang)}
<main id="main">
  <h1>${esc(title)}</h1>
  <p class="intro">${T(lang, "Live water conditions for the waters people actually fish around Crosby — matched to the nearest U.S. Geological Survey real-time station. Dissolved oxygen and temperature are what most drive whether fish are active; the reading is from a nearby station, not your exact spot.", "Condiciones del agua en vivo para las aguas donde realmente se pesca cerca de Crosby — con la estación en tiempo real del USGS más cercana. El oxígeno disuelto y la temperatura son lo que más determina si los peces están activos; la lectura es de una estación cercana, no de tu punto exacto.")}${data.updated ? ` ${T(lang, "Updated", "Actualizado")} ${esc(fullTime(data.updated, lang))} CT.` : ""}</p>
${sections}
  <section class="fguide" data-nosnippet>
    <h2>${T(lang, "How to read it", "Cómo interpretarlo")}</h2>
    <ul>
      <li>${T(lang, "<strong>Dissolved oxygen (mg/L)</strong> — above 6 is healthy; 4&ndash;6 is moderate; below 4 the fish get sluggish. Summer afternoons and warm, still water run lowest.", "<strong>Oxígeno disuelto (mg/L)</strong> — más de 6 es saludable; 4&ndash;6 moderado; por debajo de 4 los peces se vuelven lentos. Las tardes de verano y el agua tibia y quieta son las más bajas.")}</li>
      <li>${T(lang, "<strong>Temperature</strong> drives activity by species; <strong>clarity</strong> (turbidity, FNU) hints at bait choice &mdash; clear water favors natural finesse, stained water favors scent and vibration.", "<strong>Temperatura</strong> afecta la actividad según la especie; <strong>claridad</strong> (turbidez, FNU) sugiere el señuelo &mdash; agua clara favorece lo natural y sutil, agua turbia favorece olor y vibración.")}</li>
      <li>${T(lang, "These are water conditions, not a bite guarantee &mdash; wind, pressure, season, and time of day matter too.", "Estas son condiciones del agua, no una garantía de picada &mdash; el viento, la presión, la temporada y la hora también importan.")}</li>
    </ul>
  </section>
  <p class="safety">${T(lang, "A Texas fishing license is required for most anglers &mdash; see <a href=\"https://tpwd.texas.gov/\">Texas Parks &amp; Wildlife</a>. Watch the water: never wade unfamiliar current, and in high water turn around, don't drown. River and bayou <a href=\"/water\">flood levels are here</a>.", "Se requiere licencia de pesca de Texas para la mayoría &mdash; consulta <a href=\"https://tpwd.texas.gov/\">Texas Parks &amp; Wildlife</a>. Cuida el agua: nunca vadees corrientes desconocidas, y con agua alta da la vuelta, no te arriesgues. Los <a href=\"/es/water\">niveles de inundación están aquí</a>.")}</p>
  <p class="intro"><a href="${lang === "es" ? "/es/water" : "/water"}">${T(lang, "Water levels", "Niveles de agua")}</a> &middot; <a href="${lang === "es" ? "/es/weather" : "/weather"}">${T(lang, "Forecast", "Pronóstico")}</a></p>
</main>
${footer({ page: "/fishing", lang, source: T(lang, `Water data from the <a href="https://waterdata.usgs.gov/">U.S. Geological Survey</a> (real-time monitoring).`, `Datos del agua del <a href="https://waterdata.usgs.gov/">Servicio Geológico de EE. UU.</a> (monitoreo en tiempo real).`) })}
</body>
</html>`;
}

export function fishingMarkdown(data, lang) {
  const stations = data.stations ?? [];
  const out = [
    `# ${T(lang, "Crosby, TX Fishing Conditions", "Condiciones de pesca de Crosby, TX")}`,
    "",
    `_${T(lang, "Live water conditions for the waters people fish near Crosby, from USGS real-time monitoring. Nearby station readings, not your exact spot.", "Condiciones del agua en vivo para las aguas donde se pesca cerca de Crosby, del monitoreo en tiempo real del USGS. Lecturas de estaciones cercanas, no de tu punto exacto.")}${data.updated ? ` ${T(lang, "Updated", "Actualizado")} ${fullTime(data.updated, lang)} CT.` : ""}_`,
    "",
  ];
  if (stations.length) {
    for (const g of fishingGroups(stations)) {
      out.push(`## ${T(lang, g.water, g.meta.es || g.water)}`);
      if (g.meta.fish) out.push(`_${T(lang, "Known for", "Se pesca")}: ${T(lang, g.meta.fish, g.meta.esFish || g.meta.fish)}_`, "");
      for (const st of g.sts) {
        const m = fishMeta(st.id);
        const p = st.params;
        const bits = [];
        if (p.tempC) bits.push(`${T(lang, "temp", "temp")} ${cToF(p.tempC.value)}°F`);
        if (p.do) bits.push(`${T(lang, "oxygen", "oxígeno")} ${p.do.value.toFixed(1)} mg/L`);
        if (p.ph) bits.push(`pH ${p.ph.value.toFixed(1)}`);
        if (p.turb) bits.push(`${T(lang, "clarity", "claridad")} ${Math.round(p.turb.value)} FNU`);
        if (p.gageFt && !p.do) bits.push(`${T(lang, "water level", "nivel")} ${p.gageFt.value.toFixed(2)} ft`);
        out.push(`- **${T(lang, m.spot || "", m.esSpot || m.spot || "")}** (${fishingState(st, lang).label})${bits.length ? ` — ${bits.join(", ")}` : ""}${st.observed ? ` · ${T(lang, "as of", "a las")} ${clockTime(st.observed, lang)} CT` : ""}`);
        out.push(`  ${fishingNote(st, lang)}`);
      }
      out.push("");
    }
  } else {
    out.push(T(lang, "Fishing conditions are temporarily unavailable.", "Las condiciones de pesca no están disponibles temporalmente."), "");
  }
  out.push(
    "---",
    `${T(lang, "Water conditions, not a bite guarantee. A Texas fishing license is required for most anglers (tpwd.texas.gov). Data from the U.S. Geological Survey.", "Condiciones del agua, no una garantía de picada. Se requiere licencia de pesca de Texas para la mayoría (tpwd.texas.gov). Datos del Servicio Geológico de EE. UU.")} · [crosbynews.com](${canonicalFor("/", lang)})`
  );
  return out.join("\n");
}

// JSON shape served at /api/fishing — the same USGS data behind /fishing.
export function apiFishing(data) {
  return {
    location: "Crosby, TX area — the waters people fish (Lake Houston, San Jacinto forks, Trinity River, nearby bayous)",
    source: "USGS real-time water data (waterservices.usgs.gov)",
    note: "Nearest USGS monitoring station per fished water body — a nearby reading, not the exact fishing spot. Dissolved oxygen, temperature, pH, and turbidity indicate conditions, not a guaranteed bite.",
    updated: data.updated ?? null,
    stations: (data.stations ?? []).map((st) => {
      const m = fishMeta(st.id);
      const p = st.params;
      return {
        id: st.id,
        water: m.water ?? null,
        spot: m.spot ?? null,
        knownFor: m.fish ?? null,
        temperatureF: p.tempC ? cToF(p.tempC.value) : null,
        dissolvedOxygenMgL: p.do?.value ?? null,
        ph: p.ph?.value ?? null,
        turbidityFNU: p.turb?.value ?? null,
        waterLevelFt: p.gageFt?.value ?? null,
        conditions: fishingState(st, "en").label,
        observed: st.observed ?? null,
        officialUrl: usgsSiteUrl(st.id),
      };
    }),
  };
}
