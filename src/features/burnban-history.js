// /burn-ban/history: every Harris County burn ban with known dates, and how a
// ban starts and ends. One level below /burn-ban, which stays a live status
// page; this one is the record, read from D1 `burnban_periods`.
//
// Built on D1, so a D1 failure answers 502 (router.js) rather than rendering a
// record with its rows missing.

import { T, canonicalFor, hreflangTags, esPath } from "../i18n.js";
import { esc } from "../lib/format.js";
import { BASE_CSS } from "../assets/base-css.js";
import { topbar, footer } from "../chrome.js";
import { JSONLD_SITE, sharedHead } from "../seo.js";
import { banHistoryRows, banHistoryNote, BURNBAN_COUNTY_URL, BURNBAN_DROUGHT_URL, BURNBAN_MAP_URL } from "./burnban.js";

export const BURNBAN_HISTORY_PATH = "/burn-ban/history";
const STATUTE_URL = "https://statutes.capitol.texas.gov/Docs/LG/htm/LG.352.htm#352.081";

const title = (lang) => T(lang, "Past Harris County Burn Bans", "Prohibiciones de quemas anteriores en el condado de Harris");
const desc = (lang) =>
  T(
    lang,
    "Every Harris County burn ban with known start and end dates, with sources, and how a ban starts and ends.",
    "Cada prohibición de quemas del condado de Harris con fechas conocidas, con sus fuentes, y cómo empieza y termina una prohibición."
  );
const lede = (lang) =>
  T(
    lang,
    "Every burn ban in unincorporated Harris County that this site has dates for, newest first. Each row links where its dates come from.",
    "Cada prohibición de quemas en la parte no incorporada del condado de Harris de la que este sitio tiene fechas, de la más reciente a la más antigua. Cada fila enlaza de dónde vienen sus fechas."
  );

// Plain paragraphs, in the order a reader needs them: who starts a ban, who
// ends it, what they measure, and why this site's status can trail the county.
// Every figure is dated to the source that gave it.
export function howBansWork(lang) {
  return [
    T(
      lang,
      "The Harris County Fire Marshal's Office watches how dry the county is. When the wildfire risk is high, it asks Commissioners Court for a ban, and the court votes one in. A ban covers the unincorporated county, Crosby included. Cities set their own rules.",
      "La Oficina del Jefe de Bomberos del condado de Harris vigila qué tan seco está el condado. Cuando el riesgo de incendio es alto, pide una prohibición a la Corte de Comisionados, y la corte la aprueba. Una prohibición cubre la parte no incorporada del condado, incluida Crosby. Las ciudades fijan sus propias reglas."
    ),
    T(
      lang,
      "The court does not vote again to end it. The order runs until the Texas A&M Forest Service finds the drought is over, and the Fire Marshal's Office announces that the ban is lifted. Under state law an order also expires after 90 days unless the court adopts a new one.",
      "La corte no vuelve a votar para terminarla. La orden sigue hasta que el Servicio Forestal de Texas A&M determina que la sequía terminó, y la Oficina del Jefe de Bomberos anuncia que se levantó. Por ley estatal, una orden también vence a los 90 días si la corte no aprueba otra."
    ),
    T(
      lang,
      "What the Fire Marshal's Office goes by is the Keetch-Byram Drought Index, which runs from 0 for soaked ground to 800 for the driest possible. In 2013 the office said it considers a ban when the index is above 500. In 2005 it said a ban ends once the index stays below 480 for 72 hours. Those are the latest figures this site has found, and the office may use others now.",
      "Lo que usa la Oficina del Jefe de Bomberos es el índice de sequía Keetch-Byram, que va de 0 con el suelo empapado a 800 con lo más seco posible. En 2013 la oficina dijo que considera una prohibición cuando el índice pasa de 500. En 2005 dijo que una prohibición termina cuando el índice se mantiene por debajo de 480 durante 72 horas. Son las cifras más recientes que este sitio encontró, y la oficina puede usar otras hoy."
    ),
    T(
      lang,
      "This site reads the current status from the Forest Service's statewide map, which counties report to, and the map can trail the county. The Fire Marshal's Office lifted the 2026 ban on November 16, 2026, and the map still listed it the next morning.",
      "Este sitio lee el estado actual del mapa estatal del Servicio Forestal, al que reportan los condados, y el mapa puede ir detrás del condado. La Oficina del Jefe de Bomberos levantó la prohibición de 2026 el 16 de noviembre de 2026, y el mapa todavía la mostraba a la mañana siguiente."
    ),
  ];
}

export function historyLinks(lang) {
  return [
    {
      url: BURNBAN_COUNTY_URL,
      label: T(lang, "Harris County Fire Marshal: wildfires and burn bans", "Jefe de Bomberos del Condado de Harris: incendios y prohibiciones"),
      note: T(lang, "The office's own explanation of the drought index and what a ban allows.", "La explicación de la propia oficina sobre el índice de sequía y lo que permite una prohibición."),
    },
    {
      url: BURNBAN_DROUGHT_URL,
      label: T(lang, "Drought conditions for Harris County", "Condiciones de sequía del condado de Harris"),
      note: T(lang, "The U.S. Drought Monitor's current map.", "El mapa actual del Monitor de Sequía de EE. UU."),
    },
    {
      url: BURNBAN_MAP_URL,
      label: T(lang, "Texas burn ban map", "Mapa de prohibiciones de Texas"),
      note: T(lang, "Every county's current status, statewide, from the Forest Service.", "El estado actual de cada condado, en todo el estado, del Servicio Forestal."),
    },
    {
      url: STATUTE_URL,
      label: T(lang, "Texas Local Government Code §352.081", "Código de Gobierno Local de Texas §352.081"),
      note: T(lang, "The state law that lets a county ban outdoor burning.", "La ley estatal que permite a un condado prohibir las quemas al aire libre."),
    },
  ];
}

const tableHeads = (lang) => [T(lang, "Began", "Comenzó"), T(lang, "Ended", "Terminó"), T(lang, "Length", "Duración"), T(lang, "Sources", "Fuentes")];

export function burnbanHistoryHtml(periods, lang) {
  const lk = (p) => (lang === "es" ? esPath(p) : p);
  const link = (x) => (x ? (x.url ? `<a href="${esc(x.url)}">${esc(x.text)}</a>` : esc(x.text)) : "");
  const rows = banHistoryRows(periods, lang)
    .map((r) => `        <tr><td>${esc(r.start)}</td><td>${esc(r.end)}</td><td>${esc(r.length || "—")}</td><td>${[link(r.startSrc), link(r.endSrc)].filter(Boolean).join("; ")}</td></tr>`)
    .join("\n");
  const breadcrumb = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: T(lang, "Burn Ban Status", "Estado de la prohibición de quemas"), item: canonicalFor("/burn-ban", lang) },
      { "@type": "ListItem", position: 2, name: title(lang), item: canonicalFor(BURNBAN_HISTORY_PATH, lang) },
    ],
  });
  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<title>${esc(title(lang))} &mdash; crosbynews.com</title>
<meta name="description" content="${esc(desc(lang))}">
<meta property="og:title" content="${esc(title(lang))}">
<meta property="og:description" content="${esc(desc(lang))}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor(BURNBAN_HISTORY_PATH, lang)}">
${sharedHead(lang)}
<link rel="canonical" href="${canonicalFor(BURNBAN_HISTORY_PATH, lang)}">
${hreflangTags(BURNBAN_HISTORY_PATH)}
${JSONLD_SITE}
<script type="application/ld+json">${breadcrumb}</script>
<style>${BASE_CSS}
  .crumbs { font-size:0.85rem; color:var(--muted); margin:0; }
  .lede { margin:0.7rem 0 0; font-size:1.02rem; }
  .card { background:var(--card); border-radius:12px; padding:0.9rem 1.1rem; margin-top:1rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); }
  .card h2 { margin:0 0 0.5rem; font-size:1.15rem; }
  .card p { font-size:0.95rem; line-height:1.55; }
  .tbl-wrap { overflow-x:auto; margin-top:0.5rem; }
  .tbl { border-collapse:collapse; font-size:0.88rem; width:100%; }
  .tbl th, .tbl td { border:1px solid var(--line); padding:0.35rem 0.55rem; text-align:left; vertical-align:top; }
  .note { font-size:0.85rem; color:var(--muted); margin:0.6rem 0 0; }
  .links { list-style:none; margin:0.4rem 0 0; padding:0; }
  .links li { padding:0.6rem 0; border-top:1px solid var(--line); }
  .links li:first-child { border-top:none; padding-top:0.2rem; }
  .links a { font-weight:600; }
  .link-note { display:block; margin-top:0.2rem; font-size:0.88rem; color:var(--muted); }
</style>
</head>
<body>
${topbar(BURNBAN_HISTORY_PATH, lang)}
<main id="main">
  <p class="crumbs"><a href="${lk("/burn-ban")}">${T(lang, "Burn Ban Status", "Estado de la prohibición de quemas")}</a> &rsaquo; ${esc(title(lang))}</p>
  <h1>${esc(title(lang))}</h1>
  <p class="lede">${esc(lede(lang))}</p>
  <section class="card bans">
    <h2>${T(lang, "Every ban with known dates", "Cada prohibición con fechas conocidas")}</h2>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr>${tableHeads(lang).map((h) => `<th>${h}</th>`).join("")}</tr></thead>
      <tbody>
${rows}
      </tbody>
    </table></div>
    <p class="note">${esc(banHistoryNote(lang))}</p>
  </section>
  <section class="card">
    <h2>${T(lang, "How a ban starts and ends", "Cómo empieza y termina una prohibición")}</h2>
${howBansWork(lang).map((p) => `    <p>${esc(p)}</p>`).join("\n")}
  </section>
  <section class="card">
    <h2>${T(lang, "Drought and the law", "La sequía y la ley")}</h2>
    <ul class="links">
${historyLinks(lang).map((l) => `      <li><a href="${esc(l.url)}">${esc(l.label)}</a><span class="link-note">${esc(l.note)}</span></li>`).join("\n")}
    </ul>
  </section>
</main>
${footer({ page: BURNBAN_HISTORY_PATH, lang, source: T(lang, "Dates from Harris County Commissioners Court records, the Harris County Fire Marshal's Office and news reports, each linked in its row.", "Fechas de los registros de la Corte de Comisionados del condado de Harris, de la Oficina del Jefe de Bomberos del condado de Harris y de reportes de prensa, cada una enlazada en su fila.") })}
</body>
</html>`;
}

export function burnbanHistoryMarkdown(periods, lang) {
  const link = (x) => (x ? (x.url ? `[${x.text}](${x.url})` : x.text) : "");
  const out = [`# ${title(lang)}`, "", lede(lang), "", `## ${T(lang, "Every ban with known dates", "Cada prohibición con fechas conocidas")}`, ""];
  out.push(`| ${tableHeads(lang).join(" | ")} |`, "|---|---|---|---|");
  for (const r of banHistoryRows(periods, lang)) out.push(`| ${r.start} | ${r.end} | ${r.length || "—"} | ${[link(r.startSrc), link(r.endSrc)].filter(Boolean).join("; ")} |`);
  out.push("", banHistoryNote(lang), "", `## ${T(lang, "How a ban starts and ends", "Cómo empieza y termina una prohibición")}`, "");
  for (const p of howBansWork(lang)) out.push(p, "");
  out.push(`## ${T(lang, "Drought and the law", "La sequía y la ley")}`, "");
  for (const l of historyLinks(lang)) out.push(`- [${l.label}](${l.url}): ${l.note}`);
  out.push("", "---", `[${T(lang, "Burn ban status", "Estado de la prohibición de quemas")}](${canonicalFor("/burn-ban", lang)}) · [crosbynews.com](${canonicalFor("/", lang)})`);
  return out.join("\n");
}
