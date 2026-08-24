// Harris County outdoor-burning ban status from the Texas A&M Forest Service.
//
// Burn bans are COUNTYWIDE ONLY — TFS has no sub-county resolution, so this
// page never implies anything finer-grained than "Harris County." TFS's feed
// updates roughly daily (county judges declare/lift bans by order, not on a
// schedule), so the cron throttles this to ~12h rather than every tick.
// Worker reachability to gis.tfs.tamu.edu was canary-verified from the
// deployed runtime (200, real body) before this shipped.
//
// SAFETY FRAMING — the reason this page is more than a status flag. "No burn
// ban" is NOT "you may burn": Texas prohibits outdoor burning statewide (30
// TAC 111.201) and then carves out exceptions, so the county's status is one
// condition among several. Two specifics this page must never blur:
//
//   * Household trash. The domestic-waste exception applies only where the
//     local government does NOT provide garbage collection. Crosby has
//     collection, so burning household trash is effectively never allowed
//     here — an earlier draft of this page listed "trash burning" as an
//     example of what a BAN prohibits, which implied the opposite the rest
//     of the year. Don't reintroduce that framing.
//   * Scope. A Harris County ban is issued by the county judge /
//     Commissioners Court and covers the UNINCORPORATED county — which is
//     where Crosby is. Incorporated cities inside the county set their own
//     rules, so "anywhere in the county" is wrong.
//
// The concrete thresholds quoted on the page (wind 6–23 mph, one hour after
// sunrise to one hour before sunset, 300 ft from neighbouring structures,
// the never-burn material list) are the real requirements in 30 TAC 111.219,
// not general advice. Check the rule before editing any of those numbers.

import { T, canonicalFor, hreflangTags, esPath } from "../i18n.js";
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
// The Harris County Fire Marshal's Office is the LOCAL authority — TFS only
// tracks and republishes what counties report, and says so in its own
// disclaimer. Anyone acting on this page should end up here.
export const BURNBAN_COUNTY_URL = "https://www.hcfmo.net/Resources/Wildfire-Burn-Bans";
// TCEQ's "Outdoor Burning in Texas" (RG-049) — the statewide rules that apply
// with or without a county ban.
export const BURNBAN_STATE_RULES_URL = "https://www.tceq.texas.gov/goto/rg-049";

// Shared content objects. The site-wide rule is that a page's HTML and
// Markdown render from ONE object so the two cannot drift; these are that
// object for the checklist and FAQ. `path` is an English internal path (each
// renderer localizes it its own way — relative for HTML, absolute for
// Markdown); `url` is an external absolute link.

// What actually has to line up before lighting an outdoor fire near Crosby.
// Ordered so the county status (this page's own subject) comes first and the
// things people forget come last.
export function burnbanChecklist(lang) {
  return [
    {
      h: T(lang, "No county burn ban", "Sin prohibición del condado"),
      p: T(
        lang,
        "The status above covers unincorporated Harris County, which is where Crosby is.",
        "El estado de arriba cubre el condado de Harris no incorporado, que es donde está Crosby."
      ),
    },
    {
      h: T(lang, "No fire-weather alert", "Sin alerta de clima de incendios"),
      p: T(
        lang,
        "Check for an active Red Flag Warning or Fire Weather Watch first.",
        "Primero revisa si hay una Alerta de Bandera Roja (Red Flag Warning) o una Vigilancia de Clima de Incendios (Fire Weather Watch) activa."
      ),
      path: "/alerts",
      label: T(lang, "Active alerts", "Alertas activas"),
    },
    {
      h: T(lang, "Conditions allow it", "Las condiciones lo permiten"),
      p: T(
        lang,
        "Texas allows burning only when the wind is between 6 and 23 mph, and only from one hour after sunrise to one hour before sunset.",
        "Texas solo permite quemar cuando el viento está entre 6 y 23 mph, y únicamente desde una hora después del amanecer hasta una hora antes del atardecer."
      ),
      path: "/weather",
      label: T(lang, "Current conditions", "Condiciones actuales"),
    },
    {
      h: T(lang, "The material is allowed", "El material está permitido"),
      p: T(
        lang,
        "Never burn plastics, tires or rubber, treated lumber, construction debris, chemicals, or heavy oils. Household trash generally can't be burned in Crosby either — that exception is only for places without garbage collection, and Crosby has it.",
        "Nunca quemes plásticos, llantas o hule, madera tratada, escombros de construcción, químicos ni aceites pesados. La basura doméstica tampoco se puede quemar en Crosby — esa excepción es solo para lugares sin recolección de basura, y Crosby sí la tiene."
      ),
      url: BURNBAN_STATE_RULES_URL,
      label: T(lang, "Texas outdoor burning rules", "Reglas de quemas al aire libre de Texas"),
    },
    {
      h: T(lang, "You can control it", "Puedes controlarlo"),
      p: T(
        lang,
        "Someone stays with the fire until it is completely out, water and hand tools are within reach, and the fire is at least 300 feet from homes on neighboring property.",
        "Alguien se queda con el fuego hasta que se apague por completo, hay agua y herramientas al alcance, y el fuego está al menos a 300 pies de casas en propiedades vecinas."
      ),
    },
    {
      h: T(lang, "Local restrictions allow it", "Las restricciones locales lo permiten"),
      p: T(
        lang,
        "An HOA, subdivision, or deed restriction can prohibit burning even when the county has no ban.",
        "Una asociación de vecinos (HOA), un fraccionamiento o una restricción de escritura puede prohibir las quemas aunque el condado no tenga prohibición."
      ),
    },
  ];
}

// The questions this page actually gets asked. Answers stay conservative:
// where the controlling detail lives in a county order we can't read from the
// feed, the answer says so and points at the order rather than guessing.
export function burnbanFaq(lang) {
  return [
    {
      q: T(lang, "Does “no burn ban” mean I can burn anything?", "¿«Sin prohibición» significa que puedo quemar lo que sea?"),
      a: T(
        lang,
        "No. Texas prohibits outdoor burning statewide and then allows specific exceptions, so the county's ban status is only one of the conditions that has to line up. The checklist above is the short version.",
        "No. Texas prohíbe las quemas al aire libre en todo el estado y luego permite excepciones específicas, así que el estado del condado es solo una de las condiciones que deben cumplirse. La lista de arriba es la versión corta."
      ),
    },
    {
      q: T(lang, "Is there a separate Crosby burn ban?", "¿Existe una prohibición de quemas propia de Crosby?"),
      a: T(
        lang,
        "No. Crosby is unincorporated, so Harris County's order is the one that applies here — there is no separate Crosby ban and no separate Crosby status to look up. HOA and deed restrictions are a different matter and can still apply.",
        "No. Crosby no está incorporado, así que la orden del condado de Harris es la que aplica aquí — no hay una prohibición ni un estado separado para Crosby. Las restricciones de HOA y de escritura son otra cosa y sí pueden aplicar."
      ),
    },
    {
      q: T(lang, "What about grills, fire pits, and cooking fires?", "¿Y las parrillas, fogatas y fuegos para cocinar?"),
      a: T(
        lang,
        "Each county order sets its own exceptions, so the order in force is what controls. Harris County's recent bans have continued to allow non-commercial cooking such as backyard barbecues, approved ceremonial fires, and fires kept inside an enclosure that contains all flames and sparks.",
        "Cada orden del condado establece sus propias excepciones, así que la orden vigente es la que manda. Las prohibiciones recientes del condado de Harris han seguido permitiendo cocinar sin fines comerciales, como asados en el patio, fogatas ceremoniales aprobadas y fuegos dentro de un recipiente que contenga todas las llamas y chispas."
      ),
    },
    {
      q: T(lang, "What if a fire gets away from me?", "¿Qué hago si un fuego se sale de control?"),
      a: T(
        lang,
        "Call 911 immediately — a grass fire moving with the wind outruns a person quickly, and it is not worth chasing. Before you light anything, have a charged garden hose or filled buckets within reach and a rake or shovel to pull fuel away from the edge.",
        "Llama al 911 de inmediato — un incendio de pasto que avanza con el viento le gana a una persona rápidamente y no vale la pena perseguirlo. Antes de encender algo, ten a la mano una manguera con agua o cubetas llenas y un rastrillo o pala para retirar el combustible del borde."
      ),
    },
  ];
}

// The row of onward links, shared by both renderers.
export function burnbanRelated(lang) {
  return [
    { path: "/weather", label: T(lang, "Weather", "Clima") },
    { path: "/alerts", label: T(lang, "Active alerts", "Alertas activas") },
    { path: "/emergency", label: T(lang, "Emergency resources", "Recursos de emergencia") },
    { url: BURNBAN_COUNTY_URL, label: T(lang, "Harris County Fire Marshal", "Jefe de Bomberos del Condado de Harris") },
    { url: BURNBAN_STATE_RULES_URL, label: T(lang, "Texas outdoor burning rules", "Reglas de quemas de Texas") },
    { url: BURNBAN_OFFICIAL_URL, label: T(lang, "Texas A&M Forest Service", "Servicio Forestal de Texas A&M") },
  ];
}

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
  const title = T(lang, "Harris County Burn Ban Status", "Estado de la prohibición de quemas del condado de Harris");
  const desc = T(
    lang,
    "Is there a burn ban in Harris County, TX right now? Live outdoor-burning ban status for unincorporated Harris County — which includes Crosby — from the Texas A&M Forest Service, plus what Texas law still restricts when there is no ban.",
    "¿Hay una prohibición de quemas en el condado de Harris, TX ahora mismo? Estado en vivo de la prohibición de quemas al aire libre para el condado de Harris no incorporado — que incluye a Crosby — según el Servicio Forestal de Texas A&M, y qué restringe la ley de Texas cuando no hay prohibición."
  );
  const lk = (p) => (lang === "es" ? esPath(p) : p);

  const known = data.status === "Yes" || data.status === "No";
  const status = !known
    ? `<div class="status status-unknown" role="status"><span class="status-icon">&#10067;</span><div><p class="status-title">${T(lang, "Status unavailable", "Estado no disponible")}</p><p class="status-sub">${T(lang, "The Texas A&M Forest Service feed didn't return a status on the last check. Check with the Harris County Fire Marshal's Office below.", "El feed del Servicio Forestal de Texas A&M no devolvió un estado en la última verificación. Consulta con la Oficina del Jefe de Bomberos del Condado de Harris abajo.")}</p></div></div>`
    : data.status === "Yes"
      ? `<div class="status status-ban" role="status"><span class="status-icon">&#128293;</span><div><p class="status-title">${T(lang, "Burn ban in effect", "Prohibición de quemas vigente")}</p><p class="status-sub">${T(lang, "Outdoor burning is prohibited in unincorporated Harris County, which includes Crosby.", "Está prohibido quemar al aire libre en el condado de Harris no incorporado, que incluye a Crosby.")}${data.startDate ? ` ${T(lang, "In effect since", "Vigente desde")} ${esc(fmt(data.startDate, { dateStyle: "long" }, lang))}.` : ""}</p></div></div>`
      : `<div class="status status-ok" role="status"><span class="status-icon">&#10004;</span><div><p class="status-title">${T(lang, "No burn ban in Harris County", "Sin prohibición de quemas en el condado de Harris")}</p><p class="status-sub">${T(lang, "The Texas A&M Forest Service is not reporting an active outdoor-burning ban for Harris County right now.", "El Servicio Forestal de Texas A&M no reporta una prohibición de quemas activa para el condado de Harris en este momento.")}</p></div></div>`;

  // Shown only on the all-clear. A green panel reading "no burn ban" is the
  // single most misreadable thing on this page — this is the sentence that
  // stops it from being taken as permission.
  const caveat = data.status === "No"
    ? `<p class="note">${T(
        lang,
        "<strong>A county ban is not the only thing that decides whether you can burn.</strong> Texas restricts outdoor burning statewide whether or not a ban is in effect, and the day's wind and conditions matter as much as the county's status. Run through the checklist before you light anything.",
        "<strong>Una prohibición del condado no es lo único que determina si puedes quemar.</strong> Texas restringe las quemas al aire libre en todo el estado haya o no una prohibición vigente, y el viento y las condiciones del día importan tanto como el estado del condado. Revisa la lista antes de encender algo."
      )}</p>`
    : "";

  const checklist = burnbanChecklist(lang)
    .map((c) => {
      const href = c.path ? lk(c.path) : c.url;
      const link = href ? ` <a href="${esc(href)}">${esc(c.label)} &rarr;</a>` : "";
      return `      <li><h3>${esc(c.h)}</h3><p>${esc(c.p)}${link}</p></li>`;
    })
    .join("\n");

  const faq = burnbanFaq(lang)
    .map((f) => `      <details class="faq"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`)
    .join("\n");

  const related = burnbanRelated(lang)
    .map((r) => `<a href="${esc(r.path ? lk(r.path) : r.url)}">${esc(r.label)}</a>`)
    .join(" &middot; ");

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
  .note { margin:0.9rem 0 0; padding:0.85rem 1.05rem; background:var(--card); border-left:5px solid #e2621a; border-radius:10px; font-size:0.95rem; line-height:1.55; }
  .check { list-style:none; margin:0.7rem 0 0; padding:0; display:grid; gap:0.5rem; }
  .check li { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:0.65rem 0.85rem; }
  .check h3 { margin:0 0 0.2rem; font-size:0.98rem; }
  .check p { margin:0; font-size:0.9rem; color:var(--muted); line-height:1.5; }
  .check a { color:var(--accent); white-space:nowrap; }
  .faq { margin-top:0.45rem; font-size:0.95rem; }
  .faq summary { cursor:pointer; font-weight:600; }
  .faq p { margin:0.4rem 0 0.7rem; color:var(--muted); line-height:1.55; }
  .rel { margin:1.4rem 0 0; font-size:0.9rem; color:var(--muted); }
  .rel a { color:var(--accent); }
  .guide { margin-top:1.6rem; }
  .guide h2 { font-size:1.15rem; }
  .guide p { font-size:0.95rem; line-height:1.55; }
</style>
</head>
<body>
${topbar("/burn-ban", lang)}
<main id="main">
  <h1>${esc(title)}</h1>
  <p class="intro">${T(lang, "Whether an outdoor-burning ban is in effect for unincorporated Harris County, TX — which includes Crosby — from the Texas A&M Forest Service, rechecked about every 12 hours.", "Si hay una prohibición de quemas al aire libre vigente para el condado de Harris, TX no incorporado — que incluye a Crosby — según el Servicio Forestal de Texas A&M, revisado aproximadamente cada 12 horas.")}${data.updated ? ` ${T(lang, "Checked", "Verificado")} ${esc(fullTime(data.updated, lang))} CT.` : ""}</p>
  ${status}
  ${caveat}
  <section data-nosnippet>
    <h2>${T(lang, "Before you burn", "Antes de quemar")}</h2>
    <ul class="check">
${checklist}
    </ul>
  </section>
  <section class="guide" data-nosnippet>
    <h2>${T(lang, "What a burn ban means", "Qué significa una prohibición de quemas")}</h2>
    <p>${T(
      lang,
      "A burn ban is an order from the county judge or Commissioners Court that suspends outdoor burning when drought and fuel conditions raise the wildfire risk. In Harris County it covers the unincorporated areas — which is where Crosby is — while cities inside the county set their own rules. Violating it is a Class C misdemeanor, punishable by a fine of up to $500.",
      "Una prohibición de quemas es una orden del juez del condado o de la Corte de Comisionados que suspende las quemas al aire libre cuando la sequía y las condiciones del combustible elevan el riesgo de incendios forestales. En el condado de Harris cubre las áreas no incorporadas — donde está Crosby — mientras que las ciudades dentro del condado fijan sus propias reglas. Violarla es un delito menor clase C, con una multa de hasta $500."
    )}</p>
    <p>${T(
      lang,
      "This page tracks the Texas A&M Forest Service's statewide burn-ban map, which counties report to. TFS is not the issuing authority and says so itself, so for the order in force, its exact exceptions, and any local notice, go to the Harris County Fire Marshal's Office.",
      "Esta página sigue el mapa estatal de prohibiciones de quemas del Servicio Forestal de Texas A&M, al que reportan los condados. TFS no es la autoridad que emite la orden y así lo aclara, por lo que para la orden vigente, sus excepciones exactas y cualquier aviso local, acude a la Oficina del Jefe de Bomberos del Condado de Harris."
    )}</p>
    <h2>${T(lang, "Common questions", "Preguntas frecuentes")}</h2>
${faq}
  </section>
  <p class="rel">${related}</p>
</main>
${footer({ page: "/burn-ban", lang, source: T(lang, `Burn ban data from the <a href="https://tfsweb.tamu.edu/">Texas A&amp;M Forest Service</a>.`, `Datos de prohibición de quemas del <a href="https://tfsweb.tamu.edu/">Servicio Forestal de Texas A&amp;M</a>.`) })}
</body>
</html>`;
}

export function burnbanMarkdown(data, lang) {
  const known = data.status === "Yes" || data.status === "No";
  const out = [
    `# ${T(lang, "Harris County Burn Ban Status", "Estado de la prohibición de quemas del condado de Harris")}`,
    "",
    `_${T(lang, "Outdoor-burning ban status for unincorporated Harris County, TX — which includes Crosby — from the Texas A&M Forest Service, rechecked about every 12 hours.", "Estado de la prohibición de quemas al aire libre para el condado de Harris, TX no incorporado — que incluye a Crosby — según el Servicio Forestal de Texas A&M, revisado aproximadamente cada 12 horas.")}${data.updated ? ` ${T(lang, "Checked", "Verificado")} ${fullTime(data.updated, lang)} CT.` : ""}_`,
    "",
  ];
  if (!known) {
    out.push(T(lang, "Status unavailable from the last check. Check with the Harris County Fire Marshal's Office (linked below).", "Estado no disponible en la última verificación. Consulta con la Oficina del Jefe de Bomberos del Condado de Harris (enlace abajo)."), "");
  } else if (data.status === "Yes") {
    out.push(
      `${T(lang, "**Burn ban in effect.** Outdoor burning is prohibited in unincorporated Harris County, which includes Crosby.", "**Prohibición de quemas vigente.** Está prohibido quemar al aire libre en el condado de Harris no incorporado, que incluye a Crosby.")}${data.startDate ? ` ${T(lang, "In effect since", "Vigente desde")} ${fmt(data.startDate, { dateStyle: "long" }, lang)}.` : ""}`,
      ""
    );
  } else {
    out.push(
      T(lang, "**No burn ban in Harris County right now.** ✓", "**Sin prohibición de quemas en el condado de Harris en este momento.** ✓"),
      "",
      T(
        lang,
        "A county ban is not the only thing that decides whether you can burn. Texas restricts outdoor burning statewide whether or not a ban is in effect, and the day's wind and conditions matter as much as the county's status.",
        "Una prohibición del condado no es lo único que determina si puedes quemar. Texas restringe las quemas al aire libre en todo el estado haya o no una prohibición vigente, y el viento y las condiciones del día importan tanto como el estado del condado."
      ),
      ""
    );
  }
  out.push(`## ${T(lang, "Before you burn", "Antes de quemar")}`, "");
  for (const c of burnbanChecklist(lang)) {
    const href = c.path ? canonicalFor(c.path, lang) : c.url;
    out.push(`- **${c.h}** — ${c.p}${href ? ` [${c.label}](${href})` : ""}`);
  }
  out.push(
    "",
    `## ${T(lang, "What a burn ban means", "Qué significa una prohibición de quemas")}`,
    "",
    T(
      lang,
      "A burn ban is an order from the county judge or Commissioners Court that suspends outdoor burning when drought and fuel conditions raise the wildfire risk. In Harris County it covers the unincorporated areas — which is where Crosby is — while cities inside the county set their own rules. Violating it is a Class C misdemeanor, punishable by a fine of up to $500.",
      "Una prohibición de quemas es una orden del juez del condado o de la Corte de Comisionados que suspende las quemas al aire libre cuando la sequía y las condiciones del combustible elevan el riesgo de incendios forestales. En el condado de Harris cubre las áreas no incorporadas — donde está Crosby — mientras que las ciudades dentro del condado fijan sus propias reglas. Violarla es un delito menor clase C, con una multa de hasta $500."
    ),
    "",
    `## ${T(lang, "Common questions", "Preguntas frecuentes")}`,
    ""
  );
  for (const f of burnbanFaq(lang)) out.push(`### ${f.q}`, "", f.a, "");
  out.push(
    "---",
    `${T(lang, "Source: Texas A&M Forest Service (tfsweb.tamu.edu), which tracks what counties report — it is not the issuing authority.", "Fuente: Servicio Forestal de Texas A&M (tfsweb.tamu.edu), que sigue lo que reportan los condados — no es la autoridad que emite la orden.")} · ${burnbanRelated(lang)
      .map((r) => `[${r.label}](${r.path ? canonicalFor(r.path, lang) : r.url})`)
      .join(" · ")} · [crosbynews.com](${canonicalFor("/", lang)})`
  );
  return out.join("\n");
}
