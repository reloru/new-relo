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

// NHC's Tropical Weather Outlook, which is a SEPARATE product from
// CurrentStorms.json and the reason this file grew a second fetch.
//
// CurrentStorms.json lists named/numbered cyclones only. Areas NHC is watching
// for development — the shaded blobs with formation percentages on the
// graphical outlook — appear ONLY in the TWO. On 2026-08-24 that gap showed
// its teeth: NHC was tracking AL95 (50%) and AL96 at 60% over 7 days while
// this page rendered a green "Nothing active in the Atlantic", because in our
// data model nothing WAS active. Literally true, read as "nothing to watch",
// during peak season, on a hurricane page. Same failure shape as a burn-ban
// page saying "no ban".
//
// The TWO is free-form forecaster prose with no JSON form, so it is parsed
// like the pollen scrape — permissively, and pinned by a test against real
// bulletins (scripts/test-two-parse.mjs).
export const TWO_URL = "https://www.nhc.noaa.gov/xml/TWOAT.xml";

// "* Formation chance through 7 days...medium...60 percent." — also
// "...low...near 0 percent." in a quiet outlook, hence the optional "near".
//
// The category is captured as `[^.]+` between the two dot runs, and that is a
// ReDoS fix rather than a style choice. The original `([a-z ]+?)\s*` paired a
// space-matching capture with a space-matching `\s*`, so on a line that
// ultimately fails to match, the engine could split a run of spaces between
// the two in quadratically many ways — 17ms at 200 spaces, 1424ms at 1600.
// `[^.]` against a literal dot is disjoint, so there is no ambiguous boundary
// and no nested quantifier at all; surrounding spaces are removed with trim()
// where the value is read. Every other adjacency here also pairs disjoint sets
// (\s vs dot, dot vs non-dot, digit vs \s).
const TWO_CHANCE_RE = /Formation chance through\s+(48\s*hours|7\s*days)\s*\.{2,}([^.]+)\.{2,}\s*(?:near\s+)?(\d{1,3})\s*percent/i;

// A disturbance heading: "Central Subtropical Atlantic (AL95):", sometimes
// enumerated ("1. Near the Cabo Verde Islands:"). The basin header
// ("For the North Atlantic...Caribbean Sea and the Gulf of America:") also
// ends in a colon, so it is excluded explicitly, as is anything carrying the
// "..." NHC uses in that header.
//
// The invest number is pulled out AFTERWARDS rather than as an optional group
// inside this pattern. Written as `([^:]{2,89}?)\s*(?:\((AL\d{2})\))?\s*:`
// the lazy capture and the `\s*` beside it both match whitespace, which is
// quadratic backtracking on a non-matching line (CodeQL flags it, correctly).
// `[^:]` against a literal `:` is disjoint, so this form is linear.
//
// The leading class excludes `\s` for the same reason: it sits directly after
// the optional enumerator's `\s*`, and `[^.*]` would otherwise match a space
// too, making that boundary ambiguous. Lines are trimmed before they get here,
// so a heading never begins with whitespace and nothing is lost.
const TWO_HEADING_RE = /^(?:\d+\.\s*)?([^.*\s][^:]{2,119}):$/;
const TWO_INVEST_RE = /\((AL\d{2})\)$/;

// NHC area names are place names: "Central Subtropical Atlantic", "Near the
// Cabo Verde Islands", "Offshore of the Carolinas". Anything outside that
// shape is not a place name, so it is dropped rather than escaped — escaping
// is per-renderer and this string has four consumers, one of which (markdown)
// has no escaper at all.
export function safeAreaName(raw) {
  return String(raw)
    .replace(/[^\p{L}\p{N} '.,\-\/()]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export function parseTwoDisturbances(text) {
  const lines = String(text).split("\n").map((l) => l.trim());
  const found = [];
  let cur = null;
  let prevBlank = true;
  for (const line of lines) {
    if (!line) {
      prevBlank = true;
      continue;
    }
    const chance = line.match(TWO_CHANCE_RE);
    if (chance) {
      // A percentage with no heading above it belongs to nothing — drop it
      // rather than inventing an area for it.
      if (cur) {
        const pct = Number(chance[3]);
        const category = chance[2].trim().toLowerCase();
        if (/48/.test(chance[1])) {
          cur.chance48 = pct;
          cur.category48 = category;
        } else {
          cur.chance7 = pct;
          cur.category7 = category;
        }
      }
      prevBlank = false;
      continue;
    }
    // A heading is ALWAYS preceded by a blank line in a TWO bulletin, and
    // requiring that is what keeps a prose sentence that happens to end in a
    // colon from stealing the percentages that follow it.
    const heading = prevBlank ? line.match(TWO_HEADING_RE) : null;
    prevBlank = false;
    if (!heading) continue;
    const area = heading[1].trim();
    if (/^For the\b/i.test(area) || area.includes("...")) {
      cur = null;
      continue;
    }
    const invest = area.match(TWO_INVEST_RE);
    cur = {
      // Sanitised at the PARSE boundary, not per-renderer. `area` reaches HTML
      // (escaped), markdown (NOT escaped — `- **${d.area}**`), the MCP text
      // block and the JSON API, and only the first of those is protected by
      // esc(). Constraining it once here covers all four. NHC area names are
      // plain English place names, so this allowlist loses nothing real.
      area: safeAreaName(invest ? area.slice(0, invest.index) : area),
      id: invest ? invest[1] : null,
      chance48: null,
      category48: null,
      chance7: null,
      category7: null,
    };
    found.push(cur);
  }
  // A heading with no formation chance under it is not a disturbance — this
  // is what makes a quiet outlook ("Tropical cyclone formation is not expected
  // during the next 7 days.") parse to an empty list rather than to noise.
  return found.filter((d) => d.chance48 != null || d.chance7 != null);
}

// Remove markup until the string stops changing. A single pass is what CodeQL
// calls "incomplete multi-character sanitization": stripping `<a<b>c>` once can
// leave text that is itself markup. Each pass strictly shortens the string, so
// the loop is bounded by its length.
function stripTags(text) {
  let out = String(text);
  for (let prev = null; prev !== out; ) {
    prev = out;
    out = out.replace(/<[^>]*>/g, "");
  }
  return out;
}

// ONE pass, output never rescanned — see the comment in twoTextFromRss for why
// a `.replace().replace()` chain is not equivalent.
const TWO_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", "#039": "'", nbsp: " " };
function decodeEntitiesOnce(text) {
  return String(text).replace(/&(#0?39|amp|lt|gt|quot|apos|nbsp);/gi, (m, name) => TWO_ENTITIES[name.toLowerCase()] ?? m);
}

// Pull the outlook bulletin out of the RSS envelope. The forecast text lives in
// a CDATA <description> with <br /> line breaks; the channel's own description
// ("National Hurricane Center - Atlantic Tropical Weather Outlook") and the
// NOAA logo item are decoys, so the block is chosen by CONTENT.
export function twoTextFromRss(xml) {
  // Scanned with indexOf rather than /<description>([\s\S]*?)<\/description>/g:
  // `[\s\S]` matches `<` too, so the lazy capture and the closing tag overlap,
  // and the input is an upstream document we do not control. indexOf is linear
  // by construction and there is nothing here a regex was buying.
  const s = String(xml);
  const OPEN = "<description>";
  const CLOSE = "</description>";
  const blocks = [];
  for (let i = 0; ; ) {
    const open = s.indexOf(OPEN, i);
    if (open === -1) break;
    const start = open + OPEN.length;
    const close = s.indexOf(CLOSE, start);
    if (close === -1) break;
    blocks.push(s.slice(start, close));
    i = close + CLOSE.length;
  }
  const raw = blocks.find((b) => /Tropical Weather Outlook/i.test(b) && /NWS National Hurricane Center|Formation chance|not expected/i.test(b));
  if (!raw) return null;
  let out = raw.replace(/^\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, "");
  out = out.replace(/<br\s*\/?>/gi, "\n");
  out = stripTags(out);
  // Decode AFTER the first strip and BEFORE the second. A single `.replace`
  // chain (&lt; then &gt; then &amp;) is a staged decode: each stage rescans
  // the previous stage's output, so `&amp;lt;script&amp;gt;` becomes a live
  // `<script>`. That exact bug already bit this repo once in the news pipeline
  // (scripts/test-decode-entities.mjs). decodeEntitiesOnce is a single pass
  // whose output is never rescanned.
  out = decodeEntitiesOnce(out);
  // ...and strip again, because anything that DECODED into markup has only
  // now become markup.
  out = stripTags(out);
  // A TWO bulletin is plain text. No angle bracket in it is meaningful, and a
  // dangling `<script` (no `>`) survives tag-stripping by construction, so the
  // residue goes.
  return out.replace(/[<>]/g, "").replace(/\r/g, "");
}

// Fetch the outlook. Returns [] for a genuinely quiet basin and THROWS on a
// non-200 or an unparseable envelope, so fetchTropics() can tell "NHC says
// nothing is brewing" apart from "we failed to read NHC" — collapsing those
// two into an empty list is exactly how a page starts lying quietly.
export async function fetchTwoDisturbances() {
  const res = await fetch(TWO_URL, { headers: { "User-Agent": "crosbynews.com", Accept: "application/xml" } });
  if (!res.ok) throw new Error(`NHC outlook request failed: ${res.status} ${res.statusText}`);
  const xml = await res.text();
  const text = twoTextFromRss(xml);
  if (!text) throw new Error("NHC outlook had no recognizable bulletin");
  const issued = [...xml.matchAll(/<pubDate>([^<]+)<\/pubDate>/g)].map((m) => m[1].trim()).pop() ?? null;
  const at = issued ? new Date(issued) : null;
  return { disturbances: parseTwoDisturbances(text), outlookIssued: at && !Number.isNaN(at.getTime()) ? at.toISOString() : null };
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
  // The outlook is fetched in the SAME call so one KV write carries both, and
  // a failure to read it throws rather than writing `disturbances: []` — an
  // empty list has to mean "NHC is watching nothing", never "we couldn't ask".
  const outlook = await fetchTwoDisturbances();
  return { updated: new Date().toISOString(), storms, ...outlook };
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
  // `!Array.isArray(data.disturbances)` also catches entries written before the
  // outlook shipped, so a legacy snapshot cold-warms into the new shape instead
  // of rendering as "nothing being watched" — which would be the same silent
  // false-negative this feature exists to remove.
  if (!data || !Array.isArray(data.storms) || !Array.isArray(data.disturbances)) {
    try {
      data = await fetchTropics();
      await env.WEATHER.put(TROPICS_KV_KEY, JSON.stringify(data));
    } catch (e) {
      console.error("tropics cold fetch failed:", e && e.stack);
      // `disturbances: null` (not []) so the renderers can say "outlook
      // unavailable" rather than asserting a quiet basin we never confirmed.
      data = { updated: null, storms: [], disturbances: null, outlookIssued: null };
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

// Formation-chance categories, hand-translated like every other piece of live
// third-party vocabulary on this site. The forecaster PROSE stays in NHC's
// official English (see the note the page renders) — only these fixed labels
// and our own copy are translated.
export const TWO_CATEGORY = {
  low: ["low", "baja"],
  medium: ["medium", "media"],
  high: ["high", "alta"],
};
export function twoCategoryLabel(cat, lang) {
  const pair = TWO_CATEGORY[String(cat || "").toLowerCase()];
  return pair ? T(lang, pair[0], pair[1]) : String(cat || "");
}

// The highest 7-day formation chance NHC currently gives any area, or null
// when there is nothing being watched. `null` disturbances (the outlook could
// not be read) also returns null — callers must not treat that as "quiet".
export function tropicsWatchPeak(disturbances) {
  if (!Array.isArray(disturbances) || !disturbances.length) return null;
  const vals = disturbances.map((d) => (Number.isFinite(d?.chance7) ? d.chance7 : Number.isFinite(d?.chance48) ? d.chance48 : null)).filter((v) => v != null);
  return vals.length ? Math.max(...vals) : null;
}

// The areas worth putting on the FRONT page: medium chance or better over 7
// days. Every tropical wave off Africa spends a day or two at 10-20%, and a
// homepage banner for each one is noise that teaches people to ignore the
// banner — so the gate lives here, in one place, shared by the HTML hub and
// its markdown twin. /tropics itself lists every area regardless.
export const TROPICS_WATCH_MIN_PCT = 40;
export function tropicsWatchAreas(tropics) {
  const dz = Array.isArray(tropics?.disturbances) ? tropics.disturbances : [];
  return dz.filter((d) => Number.isFinite(d?.chance7) && d.chance7 >= TROPICS_WATCH_MIN_PCT);
}

// "Eastern Tropical Atlantic (AL96) — 60% in 7 days". Shared by the page, the
// hub banner, markdown and MCP so the four cannot drift.
export function tropicsDisturbanceLine(d, lang) {
  const pct = Number.isFinite(d?.chance7) ? d.chance7 : d?.chance48;
  const window = Number.isFinite(d?.chance7) ? T(lang, "in 7 days", "en 7 días") : T(lang, "in 48 hours", "en 48 horas");
  const id = d?.id ? ` (${d.id})` : "";
  return `${d?.area ?? ""}${id}${Number.isFinite(pct) ? ` — ${pct}% ${window}` : ""}`;
}

// JSON shape served at /api/tropics — the same NHC data behind /tropics.
// An empty `storms` array is the normal quiet-basin state, not an error.
export function apiTropics(data) {
  return {
    basin: "Atlantic",
    source: "NOAA National Hurricane Center (nhc.noaa.gov)",
    updated: data.updated ?? null,
    // Areas NHC is watching for development but has not yet named. `null`
    // means the outlook could not be read — distinct from [], which means NHC
    // is watching nothing. A consumer that conflates them reports a quiet
    // basin during an outage.
    outlookIssued: data.outlookIssued ?? null,
    disturbances: Array.isArray(data.disturbances)
      ? data.disturbances.map((d) => ({
          area: d.area,
          id: d.id,
          chance48Percent: d.chance48,
          chance48Category: d.category48,
          chance7DayPercent: d.chance7,
          chance7DayCategory: d.category7,
        }))
      : null,
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
    "Active Atlantic tropical storms and hurricanes from the National Hurricane Center, the areas it is watching for development, and what hurricane season means for Crosby, TX. Quiet-basin friendly: shows nothing scary when nothing is happening.",
    "Tormentas tropicales y huracanes activos del Atlántico según el Centro Nacional de Huracanes, las zonas que vigila por posible desarrollo, y qué significa la temporada de huracanes para Crosby, TX."
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

  // THREE states, not two. The old binary said "nothing active" whenever
  // CurrentStorms.json was empty, which is how a green all-clear ended up on
  // the page while NHC was watching two areas at 50% and 60%.
  const disturbances = Array.isArray(data.disturbances) ? data.disturbances : null;
  const peak = tropicsWatchPeak(disturbances);
  const panel = (cls, icon, title, sub) =>
    `<div class="status ${cls}" role="status"><span class="status-icon">${icon}</span><div><p class="status-title">${title}</p><p class="status-sub">${sub}</p></div></div>`;

  const status = storms.length
    ? panel(
        "status-storm",
        "&#127744;",
        storms.length === 1 ? esc(tropicsStormLine(storms[0], lang)) : T(lang, `${storms.length} active systems in the Atlantic`, `${storms.length} sistemas activos en el Atlántico`),
        T(lang, "Details below. For what it means locally, watch official guidance and the alerts page.", "Detalles abajo. Para saber qué significa localmente, sigue la guía oficial y la página de alertas.")
      )
    : disturbances === null
      ? // The outlook could not be read. We have NOT confirmed a quiet basin,
        // so we must not draw the green panel that says we have.
        panel(
          "status-unknown",
          "&#8212;",
          T(lang, "Outlook unavailable", "Perspectiva no disponible"),
          T(lang, "We could not read the National Hurricane Center's tropical outlook just now, so this page cannot confirm whether anything is being watched. Check the NHC directly.", "No pudimos leer la perspectiva tropical del Centro Nacional de Huracanes en este momento, así que esta página no puede confirmar si hay algo bajo vigilancia. Consulta el NHC directamente.")
        )
      : disturbances.length
        ? panel(
            "status-watch",
            "&#128064;",
            disturbances.length === 1
              ? T(lang, "1 area being watched for development", "1 zona bajo vigilancia por posible desarrollo")
              : T(lang, `${disturbances.length} areas being watched for development`, `${disturbances.length} zonas bajo vigilancia por posible desarrollo`),
            T(
              lang,
              `No named storms right now. The National Hurricane Center gives ${peak != null ? `the most likely of these a ${peak}% chance` : "these a chance"} of forming a tropical cyclone within 7 days. A chance of forming is not a forecast track \u2014 it says nothing yet about where a system would go.`,
              `No hay tormentas con nombre en este momento. El Centro Nacional de Huracanes da ${peak != null ? `a la m\u00e1s probable un ${peak}% de probabilidad` : "a estas una probabilidad"} de formar un cicl\u00f3n tropical en 7 d\u00edas. Una probabilidad de formaci\u00f3n no es una trayectoria pronosticada \u2014 todav\u00eda no dice nada sobre ad\u00f3nde ir\u00eda un sistema.`
            )
          )
        : panel(
            "status-ok",
            "&#10004;",
            T(lang, "Nothing active in the Atlantic", "Nada activo en el Atlántico"),
            T(lang, "The National Hurricane Center has no named storms and no areas under watch for development in the Atlantic basin right now. This page rechecks about every hour.", "El Centro Nacional de Huracanes no tiene tormentas con nombre ni zonas bajo vigilancia por posible desarrollo en la cuenca del Atlántico en este momento. Esta página se actualiza aproximadamente cada hora.")
          );

  // The watch cards. Deliberately NOT styled like the storm cards: an area at
  // 40% is not a storm, and giving it the same visual weight would overstate
  // it on a page people read when they are already anxious.
  const watchCards = (disturbances ?? [])
    .map((d) => {
      const rows = [];
      if (Number.isFinite(d.chance48)) rows.push(`<li><span class="pk-label">${T(lang, "Next 48 hours", "Próximas 48 horas")}</span><span class="pk-val">${d.chance48}%${d.category48 ? ` <span class="dz-cat">(${esc(twoCategoryLabel(d.category48, lang))})</span>` : ""}</span></li>`);
      if (Number.isFinite(d.chance7)) rows.push(`<li><span class="pk-label">${T(lang, "Next 7 days", "Próximos 7 días")}</span><span class="pk-val">${d.chance7}%${d.category7 ? ` <span class="dz-cat">(${esc(twoCategoryLabel(d.category7, lang))})</span>` : ""}</span></li>`);
      return `      <article class="dz">
        <h3>${esc(d.area)}${d.id ? ` <span class="dz-id">${esc(d.id)}</span>` : ""}</h3>
        <ul class="peek">${rows.join("")}</ul>
      </article>`;
    })
    .join("\n");

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
  /* Amber, not red: an area at 40% is something to be aware of, not a threat.
     Both stops clear 4.5:1 against the white text (6.86 and 4.67), which the
     older panel gradients on this site do not. */
  .status-watch { background:linear-gradient(135deg,#8a4a00,#a86412); }
  .status-unknown { background:linear-gradient(135deg,#5b6470,#7a8494); }
  .watch { display:grid; gap:0.7rem; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); margin-top:0.9rem; }
  .dz { background:var(--card); border-radius:12px; padding:0.75rem 0.9rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); border-left:5px solid #a86412; }
  .dz h3 { margin:0 0 0.35rem; font-size:1rem; }
  .dz-id { font-size:0.78rem; font-weight:700; color:var(--muted); letter-spacing:0.03em; }
  .dz-cat { color:var(--muted); font-weight:400; }
  .two-note { margin:0.9rem 0 0; font-size:0.9rem; line-height:1.55; }
  .two-prose { margin:0.5rem 0 0; font-size:0.9rem; line-height:1.55; color:var(--muted); white-space:pre-line; }
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
  <p class="intro">${T(lang, "Active Atlantic tropical systems from the National Hurricane Center, plus the areas it is watching for development, checked about every hour. Storm advisories and names stay in NHC's official English.", "Sistemas tropicales activos del Atlántico según el Centro Nacional de Huracanes, además de las zonas que vigila por posible desarrollo, consultados aproximadamente cada hora. Los avisos y nombres de tormentas se muestran en el inglés oficial del NHC.")}${data.updated ? ` ${T(lang, "Updated", "Actualizado")} ${esc(fullTime(data.updated, lang))} CT.` : ""}</p>
  ${status}
  ${storms.length ? `<div class="storms">\n${cards}\n  </div>` : ""}
  ${watchCards ? `<section>
    <h2>${T(lang, "Areas being watched", "Zonas bajo vigilancia")}</h2>
    <p class="two-note">${T(lang, "The National Hurricane Center tracks these for possible development before they get a name. A percentage is the chance a tropical cyclone forms at all \u2014 not a track, and not a statement that it would reach Texas.", "El Centro Nacional de Huracanes les da seguimiento por posible desarrollo antes de que reciban un nombre. Un porcentaje es la probabilidad de que se forme un cicl\u00f3n tropical \u2014 no una trayectoria, ni una afirmaci\u00f3n de que llegar\u00eda a Texas.")}</p>
    <div class="watch">
${watchCards}
    </div>
  </section>` : ""}
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
    `_${T(lang, "Active Atlantic systems and areas under watch from the NOAA National Hurricane Center.", "Sistemas activos y zonas bajo vigilancia según el Centro Nacional de Huracanes de NOAA.")}${data.updated ? ` ${T(lang, "Updated", "Actualizado")} ${fullTime(data.updated, lang)} CT.` : ""}_`,
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
  }
  // Mirrors the HTML three-way exactly (one content model, two renderings):
  // named storms, then areas under watch, then a confirmed-quiet basin, and
  // "unavailable" kept distinct from "quiet".
  const dz = Array.isArray(data.disturbances) ? data.disturbances : null;
  if (dz === null) {
    out.push(T(lang, "The NHC tropical outlook could not be read just now, so this page cannot confirm whether anything is being watched. Check nhc.noaa.gov directly.", "No se pudo leer la perspectiva tropical del NHC en este momento, así que esta página no puede confirmar si hay algo bajo vigilancia. Consulta nhc.noaa.gov directamente."), "");
  } else if (dz.length) {
    out.push(`## ${T(lang, "Areas being watched", "Zonas bajo vigilancia")}`, "");
    out.push(
      T(
        lang,
        "Tracked by the NHC for possible development before they are named. A percentage is the chance a tropical cyclone forms at all — not a track, and not a statement that it would reach Texas.",
        "Seguidas por el NHC por posible desarrollo antes de recibir nombre. Un porcentaje es la probabilidad de que se forme un ciclón tropical — no una trayectoria, ni una afirmación de que llegaría a Texas."
      ),
      ""
    );
    for (const d of dz) {
      out.push(`- **${d.area}${d.id ? ` (${d.id})` : ""}**`);
      if (Number.isFinite(d.chance48)) out.push(`  - ${T(lang, "Next 48 hours", "Próximas 48 horas")}: ${d.chance48}%${d.category48 ? ` (${twoCategoryLabel(d.category48, lang)})` : ""}`);
      if (Number.isFinite(d.chance7)) out.push(`  - ${T(lang, "Next 7 days", "Próximos 7 días")}: ${d.chance7}%${d.category7 ? ` (${twoCategoryLabel(d.category7, lang)})` : ""}`);
    }
    out.push("");
  } else if (!storms.length) {
    out.push(T(lang, "No named storms and no areas under watch for development in the Atlantic basin right now. ✓", "No hay tormentas con nombre ni zonas bajo vigilancia por posible desarrollo en la cuenca del Atlántico en este momento. ✓"), "");
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
