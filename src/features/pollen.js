// The Houston Health Department's measured daily pollen and mold count.
//
// There is no API — fetchPollen scrapes the HHD site, and throws on failure OR
// on an unrecognizable layout, so neither an outage nor a Drupal redesign can
// wipe the last good count.
//
// Categories are republished verbatim from the lab, never reclassified.
// Counts publish weekday mornings only; weekends carry Friday's, labeled with
// its own countDate and never presented as today's.

import { T, canonicalFor, hreflangTags } from "../i18n.js";
import { BASE_CSS } from "../assets/base-css.js";
import { topbar, footer } from "../chrome.js";
import { JSONLD_SITE, OG_COMMON } from "../seo.js";

import { esc, capFirst, dayLabel } from "../lib/format.js";

// The Houston Health Department laboratory runs a National Allergy Bureau
// counting station (a Burkard spore trap on the lab roof) and publishes a
// MEASURED pollen and mold count every weekday morning — tree/weed/grass
// pollen and mold spores, each with an NAB category and a grains-per-m³
// count, plus a per-genus breakdown. That makes this the site's only measured
// environmental number besides NWS itself (the AQI is modeled; UV is a
// forecast). No API exists, so fetchPollen() scrapes the count page: the
// index page lists per-date URLs (".../houston-pollen-mold-count-thursday-
// july-16-2026"); we pick the newest by slug date. Worker reachability to
// www.houstonhealth.org was canary-verified from the deployed runtime
// (200 + real body on index and count page) before this shipped.
//
// Both halves of that scrape are deliberately LOOSE about the URL's shape,
// because HHD changes it without notice and the failure is silent: the fetch
// still succeeds, an older count still parses, and the page keeps rendering a
// real — but frozen — count. On 2026-08-03 the slug lost its day-year hyphen
// and some days moved to a capitalized "/Services/" path; between them the two
// strict patterns hid three days of counts and pinned /pollen to July 31 until
// the owner spotted a published count the site was not showing. Match the URL
// permissively and let parsePollenCount() below be the strict gate — it is the
// one that can tell a real layout change from a cosmetic URL change.
export const POLLEN_KV_KEY = "pollen";
export const POLLEN_ORIGIN = "https://www.houstonhealth.org";
export const POLLEN_INDEX_PATH = "/services/pollen-mold";

export const POLLEN_MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

// HHD writes the month name whichever way it feels like — the same week served
// "...-friday-august-212026" and "...-monday-aug-242026". An exact-name lookup
// silently dropped the abbreviated day, so the index's NEWEST entry became
// unparseable and /pollen quietly kept serving Friday's count into Monday
// evening with /api/health still reporting the feed ok.
//
// Resolved by unique prefix rather than by listing abbreviations: three letters
// is the shortest unambiguous prefix across all twelve months, so this also
// absorbs "sept" and any other truncation without another silent miss. The
// uniqueness check is what keeps it honest — an ambiguous prefix returns null
// (no date) rather than guessing a month, because a WRONG date here would make
// a stale count look current, which is worse than no count at all.
export function pollenMonth(name) {
  const n = String(name).toLowerCase();
  if (POLLEN_MONTHS[n]) return POLLEN_MONTHS[n];
  if (n.length < 3) return null;
  const hits = Object.keys(POLLEN_MONTHS).filter((m) => m.startsWith(n));
  return hits.length === 1 ? POLLEN_MONTHS[hits[0]] : null;
}

// "/services/pollen-mold/houston-pollen-mold-count-thursday-july-16-2026"
// → "2026-07-16" (null when the slug doesn't carry a parseable date).
//
// HHD publishes the day and year BOTH ways, and both must keep parsing:
// "...-july-31-2026" and, from 2026-08-03, "...-august-52026" with no
// separator. The month is likewise full OR abbreviated ("aug", "sept") —
// see pollenMonth. The day-year hyphen is therefore optional. The `\d{1,2}` stays
// greedy so a two-digit day still wins ("122026" → day 12, year 2026); on a
// one-digit day it backtracks to 1 because `\d{4}` cannot otherwise be
// satisfied ("52026" → day 5, year 2026).
export function pollenSlugDate(slug) {
  const m = String(slug).match(/-([a-z]+)-(\d{1,2})-?(\d{4})[^\d]*$/i);
  if (!m) return null;
  const mo = pollenMonth(m[1]);
  if (!mo) return null;
  return `${m[3]}-${String(mo).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}`;
}

export const pollenStrip = (s) =>
  s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();

// Parse one count page. The four headline readings render as
// "<strong>WEED POLLEN</strong><br><strong>LOW</strong><br><strong>6</strong>"
// (tag placement varies), so we tag-strip a window after each marker and read
// "GROUP CATEGORY NUMBER". Categories are the NAB scale (None / Low / Medium /
// Heavy / Extremely Heavy) but multi-word values are accepted as-is — we
// republish, never reclassify. Species lists are the first <ul> after each
// "Major … counted" heading, bounded at </ul> so sections can't bleed.
export function parsePollenCount(html) {
  const groups = {};
  for (const [key, marker] of [
    ["tree", "TREE POLLEN"],
    ["weed", "WEED POLLEN"],
    ["grass", "GRASS POLLEN"],
    ["mold", "MOLD SPORES"],
  ]) {
    const i = html.indexOf(marker);
    if (i === -1) continue;
    const m = pollenStrip(html.slice(i, i + 400)).match(
      /^(?:TREE POLLEN|WEED POLLEN|GRASS POLLEN|MOLD SPORES)\s+([A-Za-z][A-Za-z ]*?)\s+([\d,]+)/
    );
    if (!m) continue;
    groups[key] = {
      category: m[1].trim().toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()),
      count: Number(m[2].replace(/,/g, "")),
    };
  }
  const species = {};
  for (const [key, header] of [
    ["tree", "Major tree pollen counted"],
    ["weed", "Major weed pollen counted"],
    ["mold", "Major mold spores counted"],
  ]) {
    const h = html.indexOf(header);
    if (h === -1) continue;
    const ulStart = html.indexOf("<ul>", h);
    const ulEnd = html.indexOf("</ul>", ulStart);
    if (ulStart === -1 || ulEnd === -1 || ulStart - h > 2000) continue;
    const found = [];
    for (const li of html.slice(ulStart, ulEnd).matchAll(/<li>([\s\S]*?)<\/li>/g)) {
      const m = pollenStrip(li[1]).match(/^(.+?):\s*([\d,]+)\s*$/);
      if (!m) continue;
      const count = Number(m[2].replace(/,/g, ""));
      if (count > 0) found.push({ name: m[1].trim(), count });
    }
    found.sort((a, b) => b.count - a.count);
    species[key] = found.slice(0, 8);
  }
  return { groups, species };
}

// Index HTML → the newest count page as {path, date}, or null when none parse.
//
// Split out from fetchPollen() and kept free of network so the whole selection
// — both matchers plus newest-wins — is testable offline. It is the exact unit
// that failed on 2026-08-03: each half degraded quietly and the composition
// still returned a real, older page. See scripts/test-pollen-parse.mjs.
//
// The href match is case-insensitive because HHD serves the same section as
// both "/services/..." and "/Services/...", mixing the two on one index page,
// so a lowercase-only match silently drops whichever days happen to be
// published under the capitalized path.
export function pollenNewestFromIndex(idxHtml) {
  const candidates = [...String(idxHtml).matchAll(/href="(\/services\/pollen-mold\/houston-pollen-mold-count-[^"#?]+)"/gi)]
    .map((m) => ({ path: m[1], date: pollenSlugDate(m[1]) }))
    .filter((c) => c.date);
  if (!candidates.length) return null;
  return candidates.reduce((a, b) => (b.date > a.date ? b : a));
}

// Fetch the newest published count. Throws on any failure — including a page
// whose layout we no longer recognize (fewer than two groups parsed) — so the
// cron aborts-without-writing and the last good count survives (water pattern).
export async function fetchPollen() {
  const idx = await fetch(POLLEN_ORIGIN + POLLEN_INDEX_PATH, { headers: { "User-Agent": "crosbynews.com" } });
  if (!idx.ok) throw new Error(`HHD pollen index failed: ${idx.status} ${idx.statusText}`);
  const idxHtml = await idx.text();
  const newest = pollenNewestFromIndex(idxHtml);
  if (!newest) throw new Error("HHD pollen index listed no count pages");
  const page = await fetch(POLLEN_ORIGIN + newest.path, { headers: { "User-Agent": "crosbynews.com" } });
  if (!page.ok) throw new Error(`HHD pollen count page failed: ${page.status} ${page.statusText}`);
  const { groups, species } = parsePollenCount(await page.text());
  if (Object.keys(groups).length < 2) throw new Error("HHD pollen count page did not parse (layout change?)");
  return {
    updated: new Date().toISOString(),
    countDate: newest.date,
    url: POLLEN_ORIGIN + newest.path,
    groups,
    species,
  };
}

// Read the cached count, self-healing on a cold/malformed entry and degrading
// to an empty shape on total failure (mirrors loadTropics).
export async function loadPollen(env) {
  let data = null;
  try {
    data = await env.WEATHER.get(POLLEN_KV_KEY, "json");
  } catch (e) {
    console.error("KV pollen parse failed:", e && e.stack);
  }
  if (!data || !data.groups || !data.countDate) {
    try {
      data = await fetchPollen();
      await env.WEATHER.put(POLLEN_KV_KEY, JSON.stringify(data));
    } catch (e) {
      console.error("pollen cold fetch failed:", e && e.stack);
      data = { updated: null, countDate: null, url: POLLEN_ORIGIN + POLLEN_INDEX_PATH, groups: {}, species: {} };
    }
  }
  return data;
}

// NAB category labels → Spanish, hand dictionary with English fallback (the
// deterministic-translation policy). Species/genus names stay in the lab's
// official English + Latin.
export const POLLEN_CAT_ES = {
  None: "Ninguno",
  Low: "Bajo",
  Medium: "Medio",
  Heavy: "Alto",
  "Extremely Heavy": "Extremadamente alto",
};
export function pollenCatLabel(category, lang) {
  if (!category) return T(lang, "No data", "Sin datos");
  return lang === "es" ? POLLEN_CAT_ES[category] || category : category;
}
// Severity bucket for styling: the NAB scale, worst-first.
export function pollenCatRank(category) {
  const c = String(category || "").toLowerCase();
  if (c.startsWith("extremely")) return 4;
  if (c === "heavy") return 3;
  if (c === "medium") return 2;
  if (c === "low") return 1;
  if (c === "none") return 0;
  return -1;
}
export const POLLEN_GROUPS = [
  ["tree", ["Tree pollen", "Polen de árboles"]],
  ["weed", ["Weed pollen", "Polen de malezas"]],
  ["grass", ["Grass pollen", "Polen de pastos"]],
  ["mold", ["Mold spores", "Esporas de moho"]],
];
export function pollenGroupLabel(key, lang) {
  const pair = POLLEN_GROUPS.find(([k]) => k === key)?.[1];
  return pair ? T(lang, pair[0], pair[1]) : key;
}
// "Thursday, Jul 16" for a plain YYYY-MM-DD count date. Anchored to noon
// Central (18Z) so the calendar day can't shift across the UTC boundary.
export const pollenDateLabel = (countDate, lang) => capFirst(dayLabel(`${countDate}T18:00:00Z`, lang));

// JSON shape served at /api/pollen — the same HHD data behind /pollen.
export function apiPollen(data) {
  const groups = {};
  for (const [key] of POLLEN_GROUPS) {
    const g = data.groups?.[key];
    groups[key] = g ? { category: g.category, count: g.count } : null;
  }
  return {
    location: "Houston area (regional count, applies to Crosby, TX)",
    source: "Houston Health Department pollen and mold count (houstonhealth.org)",
    measured: true,
    stationNote:
      "Measured by the Houston Health Department laboratory, a National Allergy Bureau counting station. Counts publish weekday mornings; units are grains (spores) per cubic meter of air.",
    updated: data.updated ?? null,
    countDate: data.countDate ?? null,
    officialUrl: data.url ?? POLLEN_ORIGIN + POLLEN_INDEX_PATH,
    groups,
    species: data.species ?? {},
  };
}

export function pollenHtml(data, lang) {
  const title = T(lang, "Pollen &amp; Mold", "Polen y moho");
  const titlePlain = T(lang, "Pollen & Mold", "Polen y moho");
  const desc = T(
    lang,
    "Daily measured pollen and mold count for the Houston / Crosby, TX area from the Houston Health Department — tree, weed, and grass pollen and mold spores, with what's actually in the air.",
    "Conteo diario medido de polen y moho para la zona de Houston / Crosby, TX del Departamento de Salud de Houston — polen de árboles, malezas y pastos y esporas de moho."
  );
  const hasCount = data.countDate && Object.keys(data.groups ?? {}).length > 0;
  const catClass = (g) => ["c-none", "c-low", "c-med", "c-heavy", "c-extreme"][pollenCatRank(g?.category)] ?? "c-none";
  const cards = POLLEN_GROUPS.map(([key]) => {
    const g = data.groups?.[key];
    return `      <article class="pgroup ${g ? catClass(g) : "c-none"}">
        <h2>${pollenGroupLabel(key, lang)}</h2>
        <p class="pcat">${esc(pollenCatLabel(g?.category, lang))}</p>
        <p class="pcount">${g ? `${g.count.toLocaleString(lang === "es" ? "es-MX" : "en-US")} <span class="punit">${key === "mold" ? T(lang, "spores/m³", "esporas/m³") : T(lang, "grains/m³", "granos/m³")}</span>` : "&mdash;"}</p>
      </article>`;
  }).join("\n");
  const speciesBlocks = POLLEN_GROUPS.filter(([key]) => (data.species?.[key] ?? []).length).map(
    ([key]) => `      <div class="sp">
        <h3>${pollenGroupLabel(key, lang)}</h3>
        <ul>${(data.species[key] ?? [])
          .map((s) => `<li><span>${esc(s.name)}</span><span class="sp-n">${s.count.toLocaleString(lang === "es" ? "es-MX" : "en-US")}</span></li>`)
          .join("")}</ul>
      </div>`
  );
  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} &mdash; Crosby, TX &mdash; crosbynews.com</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/pollen", lang)}">
${OG_COMMON}
<link rel="canonical" href="${canonicalFor("/pollen", lang)}">
${hreflangTags("/pollen")}
${JSONLD_SITE}
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  .stamp { color:var(--muted); margin:0.6rem 0 0; }
  .pgrid { display:grid; gap:0.7rem; grid-template-columns:repeat(auto-fill,minmax(170px,1fr)); margin-top:1rem; }
  .pgroup { border-radius:12px; padding:0.85rem 1rem; background:var(--card); box-shadow:0 1px 3px rgba(0,0,0,0.07); border-left:5px solid var(--pg, #9aa4af); }
  .pgroup h2 { margin:0; font-size:0.95rem; color:var(--muted); font-weight:600; }
  .pcat { margin:0.25rem 0 0; font-size:1.35rem; font-weight:800; line-height:1.1; }
  .pcount { margin:0.3rem 0 0; font-size:0.95rem; color:var(--muted); }
  .punit { font-size:0.8rem; }
  .c-none { --pg:#9aa4af; } .c-none .pcat { color:#5b6770; }
  .c-low { --pg:#1f8b4c; } .c-low .pcat { color:#1f8b4c; }
  .c-med { --pg:#b58900; } .c-med .pcat { color:#9a7400; }
  .c-heavy { --pg:#d9480f; } .c-heavy .pcat { color:#d9480f; }
  .c-extreme { --pg:#c92a2a; } .c-extreme .pcat { color:#c92a2a; }
  .species { display:grid; gap:0.7rem; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); margin-top:0.8rem; }
  .sp { background:var(--card); border-radius:12px; padding:0.75rem 1rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); }
  .sp h3 { margin:0 0 0.3rem; font-size:0.95rem; }
  .sp ul { list-style:none; margin:0; padding:0; }
  .sp li { display:flex; justify-content:space-between; gap:0.6rem; padding:0.22rem 0; border-bottom:1px solid var(--line); font-size:0.9rem; }
  .sp li:last-child { border-bottom:none; }
  .sp-n { color:var(--muted); }
  .guide { margin-top:1.6rem; }
  .guide h2 { font-size:1.15rem; }
  .guide h3 { font-size:1rem; margin-bottom:0.3rem; }
  .guide p { font-size:0.95rem; line-height:1.55; }
  .guide .links { margin:0.5rem 0 0; padding-left:1.1rem; }
  .guide .links li { margin:0.3rem 0; font-size:0.92rem; }
  .scale-wrap { overflow-x:auto; }
  .scale { border-collapse:collapse; margin-top:0.5rem; font-size:0.88rem; min-width:430px; }
  .scale th, .scale td { border:1px solid var(--line); padding:0.35rem 0.6rem; text-align:left; }
  .scale th { background:var(--card); }
</style>
</head>
<body>
${topbar("/pollen", lang)}
<main id="main">
  <h1>${titlePlain}</h1>
  <p class="intro">${T(
    lang,
    "A real, measured count — not a model. The Houston Health Department laboratory (a certified National Allergy Bureau counting station) samples the air continuously and publishes the count every weekday morning. It's a regional reading: pollen travels, so the Houston count is the right guidance for Crosby air.",
    "Un conteo real y medido — no un modelo. El laboratorio del Departamento de Salud de Houston (una estación certificada del National Allergy Bureau) muestrea el aire continuamente y publica el conteo cada mañana entre semana. Es una lectura regional: el polen viaja, así que el conteo de Houston es la guía correcta para el aire de Crosby."
  )}</p>
  ${
    hasCount
      ? `<p class="stamp">${T(lang, "Count for", "Conteo del")} <strong>${pollenDateLabel(data.countDate, lang)}</strong> &middot; ${T(lang, "new counts publish weekday mornings", "los nuevos conteos se publican entre semana por la mañana")}.</p>
  <div class="pgrid">
${cards}
  </div>`
      : `<p class="stamp">${T(lang, "The count is temporarily unavailable — try again shortly, or read it directly on the", "El conteo no está disponible temporalmente — inténtalo de nuevo en un momento o consúltalo directamente en la")} <a href="${esc(POLLEN_ORIGIN + POLLEN_INDEX_PATH)}">${T(lang, "Houston Health Department page", "página del Departamento de Salud de Houston")}</a>.</p>`
  }
  ${
    speciesBlocks.length
      ? `<section class="guide">
    <h2>${T(lang, "What's in the air", "Qué hay en el aire")}</h2>
    <p>${T(lang, "Only types the lab actually counted today are listed (names as the lab reports them).", "Solo se listan los tipos que el laboratorio contó hoy (con los nombres tal como los reporta el laboratorio).")}</p>
    <div class="species">
${speciesBlocks.join("\n")}
    </div>
  </section>`
      : ""
  }
  <section class="guide" data-nosnippet>
    <h2>${T(lang, "How to read the categories", "Cómo leer las categorías")}</h2>
    <p>${T(
      lang,
      "Categories follow the National Allergy Bureau scale — None, Low, Medium, Heavy, Extremely Heavy — and the thresholds differ by type, because it takes far fewer grass grains than mold spores to bother people:",
      "Las categorías siguen la escala del National Allergy Bureau — Ninguno, Bajo, Medio, Alto, Extremadamente alto — y los umbrales varían según el tipo, porque se necesitan muchos menos granos de pasto que esporas de moho para causar molestias:"
    )}</p>
    <div class="scale-wrap"><table class="scale">
      <tr><th></th><th>${T(lang, "Low", "Bajo")}</th><th>${T(lang, "Medium", "Medio")}</th><th>${T(lang, "Heavy", "Alto")}</th><th>${T(lang, "Extremely Heavy", "Extremadamente alto")}</th></tr>
      <tr><td>${pollenGroupLabel("grass", lang)}</td><td>1&ndash;4</td><td>5&ndash;19</td><td>20&ndash;199</td><td>200+</td></tr>
      <tr><td>${pollenGroupLabel("weed", lang)}</td><td>1&ndash;9</td><td>10&ndash;49</td><td>50&ndash;499</td><td>500+</td></tr>
      <tr><td>${pollenGroupLabel("tree", lang)}</td><td>1&ndash;14</td><td>15&ndash;89</td><td>90&ndash;1,499</td><td>1,500+</td></tr>
      <tr><td>${pollenGroupLabel("mold", lang)}</td><td>1&ndash;6,499</td><td>6,500&ndash;12,999</td><td>13,000&ndash;49,999</td><td>50,000+</td></tr>
    </table></div>
    <h2>${T(lang, "The allergy year around Crosby", "El año de alergias en Crosby")}</h2>
    <p>${T(
      lang,
      "Tree pollen dominates mid-January through mid-April (oak, elm, pine — and cedar elm makes a second run in September–October). Grass pollen runs long here, spring through fall. Ragweed and other weeds peak in the fall. Mold spores are the year-round constant on the humid Gulf Coast — counts jump after rain and in the muggy summer, which is why a Heavy mold day in July is common.",
      "El polen de árboles domina de mediados de enero a mediados de abril (roble, olmo, pino — y el olmo cedro repite en septiembre-octubre). El polen de pastos dura mucho aquí, de primavera a otoño. La ambrosía y otras malezas alcanzan su pico en otoño. Las esporas de moho son la constante de todo el año en la húmeda costa del Golfo — los conteos suben después de la lluvia y en el verano bochornoso, por eso un día de moho Alto en julio es común."
    )}</p>
    <p>${T(
      lang,
      "On high days: mornings are usually worst for pollen, rain knocks pollen down (but pushes mold up a day or two later), and windy dry days spread everything. If you're sensitive, check the count before yard work and keep windows closed on Heavy days.",
      "En días altos: las mañanas suelen ser lo peor para el polen, la lluvia baja el polen (pero sube el moho uno o dos días después) y los días secos con viento lo dispersan todo. Si eres sensible, revisa el conteo antes de trabajar en el jardín y mantén las ventanas cerradas en días de nivel Alto."
    )}</p>
    <ul class="links">
      <li><a href="${esc(data.url || POLLEN_ORIGIN + POLLEN_INDEX_PATH)}">${T(lang, "Houston Health Department pollen &amp; mold count", "Conteo de polen y moho del Departamento de Salud de Houston")}</a> &mdash; ${T(lang, "the official daily report this page republishes", "el reporte oficial diario que esta página republica")}</li>
      <li><a href="https://pollen.aaaai.org/">${T(lang, "National Allergy Bureau", "National Allergy Bureau")}</a> &mdash; ${T(lang, "the certified station network and scale", "la red de estaciones certificadas y la escala")}</li>
      <li><a href="${lang === "es" ? "/es/weather" : "/weather"}">${T(lang, "Crosby forecast", "Pronóstico de Crosby")}</a> &mdash; ${T(lang, "rain and wind change what's in the air", "la lluvia y el viento cambian lo que hay en el aire")}</li>
    </ul>
  </section>
</main>
${footer({ page: "/pollen", lang, source: T(lang, `Pollen and mold count measured by the <a href="${POLLEN_ORIGIN + POLLEN_INDEX_PATH}">Houston Health Department</a>.`, `Conteo de polen y moho medido por el <a href="${POLLEN_ORIGIN + POLLEN_INDEX_PATH}">Departamento de Salud de Houston</a>.`) })}
</body>
</html>`;
}

export function pollenMarkdown(data, lang) {
  const hasCount = data.countDate && Object.keys(data.groups ?? {}).length > 0;
  const out = [
    `# ${T(lang, "Pollen & Mold", "Polen y moho")}`,
    "",
    `_${T(
      lang,
      "Measured daily (weekday mornings) by the Houston Health Department laboratory, a certified National Allergy Bureau counting station. Regional count — valid guidance for Crosby, TX air.",
      "Medido a diario (mañanas entre semana) por el laboratorio del Departamento de Salud de Houston, una estación certificada del National Allergy Bureau. Conteo regional — guía válida para el aire de Crosby, TX."
    )}_`,
    "",
  ];
  if (hasCount) {
    out.push(`**${T(lang, "Count for", "Conteo del")} ${pollenDateLabel(data.countDate, lang)}**`, "");
    for (const [key] of POLLEN_GROUPS) {
      const g = data.groups?.[key];
      if (!g) continue;
      out.push(`- ${pollenGroupLabel(key, lang)}: **${pollenCatLabel(g.category, lang)}** (${g.count.toLocaleString("en-US")}/m³)`);
    }
    for (const [key] of POLLEN_GROUPS) {
      const sp = data.species?.[key] ?? [];
      if (!sp.length) continue;
      out.push("", `## ${pollenGroupLabel(key, lang)} — ${T(lang, "counted today", "contado hoy")}`, "");
      for (const s of sp) out.push(`- ${s.name}: ${s.count.toLocaleString("en-US")}`);
    }
  } else {
    out.push(T(lang, "The count is temporarily unavailable — read it directly at the Houston Health Department:", "El conteo no está disponible temporalmente — consúltalo directamente en el Departamento de Salud de Houston:"), `<${POLLEN_ORIGIN + POLLEN_INDEX_PATH}>`);
  }
  out.push(
    "",
    "---",
    `${T(lang, "Source: Houston Health Department pollen and mold count (measured, National Allergy Bureau scale).", "Fuente: conteo de polen y moho del Departamento de Salud de Houston (medido, escala del National Allergy Bureau).")} · ${data.url || POLLEN_ORIGIN + POLLEN_INDEX_PATH} · [crosbynews.com](${canonicalFor("/", lang)})`
  );
  return out.join("\n");
}
