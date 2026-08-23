// Harris County outdoor-burning ban status from the Texas A&M Forest Service.
//
// Burn bans are COUNTYWIDE ONLY — TFS has no sub-county resolution, so this
// page never implies anything finer-grained than "Harris County." TFS's feed
// updates roughly daily (county judges declare/lift bans by order, not on a
// schedule), so the cron throttles this to ~12h rather than every tick.
// Worker reachability to gis.tfs.tamu.edu was canary-verified from the
// deployed runtime (200, real body) before this shipped.

import { T, canonicalFor, hreflangTags } from "../i18n.js";
import { esc, fmt, fullTime } from "../lib/format.js";
import { BASE_CSS } from "../assets/base-css.js";
import { topbar, footer } from "../chrome.js";
import { JSONLD_SITE, OG_COMMON } from "../seo.js";

export const BURNBAN_KV_KEY = "burnban";

// TFS's public ArcGIS FeatureServer, queried for Harris County only. The
// where clause is passed verbatim (unencoded) — canary-verified to work as-is
// from the deployed Worker; encoding it differently is untested.
export const BURNBAN_QUERY_URL =
  "https://gis.tfs.tamu.edu/arcgis/rest/services/EOC/BurnBan/FeatureServer/0/query?where=County='Harris'&outFields=County,BurnBan,StartDate,FIPS&returnGeometry=false&f=json";

export const BURNBAN_OFFICIAL_URL = "https://tfsweb.tamu.edu/wildfire-and-other-disasters/burn-bans-and-information/";

// Fetch Harris County's current ban status. Throws on a non-200, on the
// error-shaped body ArcGIS can return with a 200 status for a malformed
// query, on a response missing the Harris County row, or on a BurnBan value
// that isn't "Yes"/"No" — so the cron aborts-without-writing and the last
// good status survives (the tropics/water pattern).
export async function fetchBurnBan() {
  const res = await fetch(BURNBAN_QUERY_URL, { headers: { "User-Agent": "crosbynews.com", Accept: "application/json" } });
  if (!res.ok) throw new Error(`TFS burn ban request failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.error) throw new Error(`TFS burn ban query error: ${JSON.stringify(json.error)}`);
  const feature = (json.features ?? []).find((f) => String(f.attributes?.County ?? "").trim() === "Harris");
  if (!feature) throw new Error("TFS burn ban response had no Harris County feature");
  const attrs = feature.attributes;
  // BurnBan is a STRING ("Yes"/"No"), not a boolean.
  const status = String(attrs.BurnBan ?? "").trim();
  if (status !== "Yes" && status !== "No") throw new Error(`TFS burn ban returned an unrecognized status: ${JSON.stringify(attrs.BurnBan)}`);
  // StartDate is epoch MILLISECONDS (or null when there's no active ban), not ISO.
  const startDate = Number.isFinite(attrs.StartDate) ? new Date(attrs.StartDate).toISOString() : null;
  return { updated: new Date().toISOString(), status, startDate };
}

// Read the cached status, self-healing on a cold/malformed entry and
// degrading to an unknown-status shape on total failure (mirrors loadTropics).
export async function loadBurnBan(env) {
  let data = null;
  try {
    data = await env.WEATHER.get(BURNBAN_KV_KEY, "json");
  } catch (e) {
    console.error("KV burnban parse failed:", e && e.stack);
  }
  if (!data || (data.status !== "Yes" && data.status !== "No")) {
    try {
      data = await fetchBurnBan();
      await env.WEATHER.put(BURNBAN_KV_KEY, JSON.stringify(data));
    } catch (e) {
      console.error("burnban cold fetch failed:", e && e.stack);
      data = { updated: null, status: null, startDate: null };
    }
  }
  return data;
}

// JSON shape served at /api/burn-ban. `lastChecked` names the same instant
// as the cached `updated` field — the timestamp is internal-convention-named
// (matching every other feature's cache stamp, which cron.js's throttle gate
// and /api/health's change-fingerprinting both key on) but reads clearer to
// an API/MCP consumer as "when did we last check this."
export function apiBurnBan(data) {
  return {
    county: "Harris",
    source: "Texas A&M Forest Service (tfsweb.tamu.edu)",
    status: data.status ?? null,
    startDate: data.startDate ?? null,
    lastChecked: data.updated ?? null,
    officialUrl: BURNBAN_OFFICIAL_URL,
  };
}

export function burnbanHtml(data, lang) {
  const title = T(lang, "Burn Ban Status", "Estado de la prohibición de quemas");
  const desc = T(
    lang,
    "Current outdoor-burning ban status for Harris County, TX (which includes Crosby) from the Texas A&M Forest Service. Countywide only — no sub-county resolution.",
    "Estado actual de la prohibición de quemas al aire libre para el condado de Harris, TX (que incluye Crosby), según el Servicio Forestal de Texas A&M. Aplica a todo el condado — sin resolución por debajo del nivel de condado."
  );

  const known = data.status === "Yes" || data.status === "No";
  const status = !known
    ? `<div class="status status-unknown" role="status"><span class="status-icon">&#10067;</span><div><p class="status-title">${T(lang, "Status unavailable", "Estado no disponible")}</p><p class="status-sub">${T(lang, "The Texas A&M Forest Service feed didn't return a status on the last check. Try the official page below.", "El feed del Servicio Forestal de Texas A&M no devolvió un estado en la última verificación. Prueba la página oficial de abajo.")}</p></div></div>`
    : data.status === "Yes"
      ? `<div class="status status-ban" role="status"><span class="status-icon">&#128293;</span><div><p class="status-title">${T(lang, "Burn ban in effect for Harris County", "Prohibición de quemas vigente en el condado de Harris")}</p><p class="status-sub">${T(lang, "No outdoor burning is allowed anywhere in the county.", "No se permite quemar al aire libre en ningún lugar del condado.")}${data.startDate ? ` ${T(lang, "In effect since", "Vigente desde")} ${esc(fmt(data.startDate, { dateStyle: "long" }, lang))}.` : ""}</p></div></div>`
      : `<div class="status status-ok" role="status"><span class="status-icon">&#10004;</span><div><p class="status-title">${T(lang, "No burn ban in Harris County", "Sin prohibición de quemas en el condado de Harris")}</p><p class="status-sub">${T(lang, "The Texas A&M Forest Service is not reporting an active outdoor-burning ban for the county right now.", "El Servicio Forestal de Texas A&M no reporta una prohibición de quemas activa para el condado en este momento.")}</p></div></div>`;

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
<meta property="og:url" content="${canonicalFor("/burn-ban", lang)}">
${OG_COMMON}
<link rel="canonical" href="${canonicalFor("/burn-ban", lang)}">
${hreflangTags("/burn-ban")}
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
  .status-ban { background:linear-gradient(135deg,#b3400d,#e2621a); }
  .status-unknown { background:linear-gradient(135deg,#5b6470,#7a8494); }
  .intro { color:var(--muted); margin:0.6rem 0 0; }
  .guide { margin-top:1.6rem; }
  .guide h2 { font-size:1.15rem; }
  .guide p { font-size:0.95rem; line-height:1.55; }
  .guide .links { margin:0.5rem 0 0; padding-left:1.1rem; }
  .guide .links li { margin:0.3rem 0; font-size:0.92rem; }
</style>
</head>
<body>
${topbar("/burn-ban", lang)}
<main id="main">
  <h1>${esc(title)}</h1>
  <p class="intro">${T(lang, "Countywide outdoor-burning ban status for Harris County, TX from the Texas A&M Forest Service, checked a few times a day.", "Estado de la prohibición de quemas al aire libre para todo el condado de Harris, TX, según el Servicio Forestal de Texas A&M, verificado varias veces al día.")}${data.updated ? ` ${T(lang, "Checked", "Verificado")} ${esc(fullTime(data.updated, lang))} CT.` : ""}</p>
  ${status}
  <section class="guide" data-nosnippet>
    <h2>${T(lang, "What a burn ban means", "Qué significa una prohibición de quemas")}</h2>
    <p>${T(
      lang,
      "A burn ban is a county judge's order prohibiting outdoor burning — brush piles, trash burning, agricultural burning — anywhere in the county, issued when drought and fuel conditions raise wildfire risk. It applies to all of Harris County at once; there is no separate status for Crosby or any other part of the county.",
      "Una prohibición de quemas es una orden del juez del condado que prohíbe quemar al aire libre — pilas de maleza, basura, quemas agrícolas — en todo el condado, emitida cuando la sequía y las condiciones del combustible elevan el riesgo de incendios forestales. Aplica a todo el condado de Harris a la vez; no hay un estado separado para Crosby ni para ninguna otra parte del condado."
    )}</p>
    <p>${T(
      lang,
      "This page reflects the Texas A&M Forest Service's statewide burn-ban tracker, which county officials report to directly. For the authoritative record, official exemptions, and any local Harris County notices, use the official page.",
      "Esta página refleja el rastreador estatal de prohibiciones de quemas del Servicio Forestal de Texas A&M, al que los funcionarios del condado reportan directamente. Para el registro oficial, las exenciones y cualquier aviso local del condado de Harris, consulta la página oficial."
    )}</p>
    <ul class="links">
      <li><a href="${BURNBAN_OFFICIAL_URL}">${T(lang, "Texas A&M Forest Service — burn bans", "Servicio Forestal de Texas A&M — prohibiciones de quemas")}</a> &mdash; ${T(lang, "the official statewide burn-ban tracker", "el rastreador estatal oficial de prohibiciones de quemas")}</li>
      <li><a href="${lang === "es" ? "/es/emergency" : "/emergency"}">${T(lang, "Emergency resources", "Recursos de emergencia")}</a> &mdash; ${T(lang, "local numbers and reporting", "números locales y reportes")}</li>
    </ul>
  </section>
</main>
${footer({ page: "/burn-ban", lang, source: T(lang, `Burn ban data from the <a href="https://tfsweb.tamu.edu/">Texas A&amp;M Forest Service</a>.`, `Datos de prohibición de quemas del <a href="https://tfsweb.tamu.edu/">Servicio Forestal de Texas A&amp;M</a>.`) })}
</body>
</html>`;
}

export function burnbanMarkdown(data, lang) {
  const known = data.status === "Yes" || data.status === "No";
  const out = [
    `# ${T(lang, "Burn Ban Status", "Estado de la prohibición de quemas")}`,
    "",
    `_${T(lang, "Harris County, TX outdoor-burning ban status from the Texas A&M Forest Service.", "Estado de la prohibición de quemas al aire libre del condado de Harris, TX, según el Servicio Forestal de Texas A&M.")}${data.updated ? ` ${T(lang, "Checked", "Verificado")} ${fullTime(data.updated, lang)} CT.` : ""}_`,
    "",
  ];
  if (!known) {
    out.push(T(lang, "Status unavailable from the last check. See the official page below.", "Estado no disponible en la última verificación. Consulta la página oficial abajo."), "");
  } else if (data.status === "Yes") {
    out.push(
      T(lang, "**Burn ban in effect for Harris County.** No outdoor burning is allowed anywhere in the county.", "**Prohibición de quemas vigente en el condado de Harris.** No se permite quemar al aire libre en ningún lugar del condado."),
      data.startDate ? `${T(lang, "In effect since", "Vigente desde")}: ${fmt(data.startDate, { dateStyle: "long" }, lang)}` : "",
      ""
    );
  } else {
    out.push(T(lang, "No burn ban in Harris County right now. ✓", "Sin prohibición de quemas en el condado de Harris en este momento. ✓"), "");
  }
  out.push(
    `## ${T(lang, "What a burn ban means", "Qué significa una prohibición de quemas")}`,
    "",
    T(
      lang,
      "A burn ban is a county judge's order prohibiting outdoor burning countywide when drought and fuel conditions raise wildfire risk. It's countywide only — there's no separate status for Crosby or any other part of Harris County.",
      "Una prohibición de quemas es una orden del juez del condado que prohíbe quemar al aire libre en todo el condado cuando la sequía y las condiciones del combustible elevan el riesgo de incendios. Aplica a todo el condado — no hay un estado separado para Crosby ni para ninguna otra parte del condado de Harris."
    ),
    "",
    "---",
    `${T(lang, "Source: Texas A&M Forest Service (tfsweb.tamu.edu).", "Fuente: Servicio Forestal de Texas A&M (tfsweb.tamu.edu).")} · [${T(lang, "Official page", "Página oficial")}](${BURNBAN_OFFICIAL_URL}) · [${T(lang, "Emergency resources", "Recursos de emergencia")}](${canonicalFor("/emergency", lang)}) · [crosbynews.com](${canonicalFor("/", lang)})`
  );
  return out.join("\n");
}
