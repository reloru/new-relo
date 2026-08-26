// Invoke every page renderer in BOTH languages and fail on ReferenceError.
//
// This exists because the static check (scripts/check-module-refs.mjs) has a
// blind spot that shipped a broken page. It reduces each file to code before
// matching, dropping string bodies but keeping template `${...}` substitutions —
// and its scanner does not descend into a template nested INSIDE a substitution.
// So this line in features/hourly.js was invisible to it:
//
//   ${lang === "es" ? `<p class="intro nws-note">${ES_NWS_NOTE}</p>` : ""}
//
// ES_NWS_NOTE was never imported. `node --check` passed, the dry-run passed, the
// static check passed, and /es/hourly returned 502 in production while /hourly
// was fine — because the reference is only reachable on the Spanish branch.
//
// Two lessons are baked in here:
//   1. A static approximation of "is this name in scope" will keep finding new
//      ways to be wrong. Running the code is the ground truth.
//   2. Language-conditional code needs BOTH languages exercised. Half this
//      site's render paths never execute under lang="en".
//
// Renderers are pure functions of (data, lang), so calling them needs no network,
// no KV, and no Worker runtime. TypeErrors from the stub data are expected and
// ignored; only ReferenceError means a name is genuinely unresolvable.
//
// Run: node scripts/check-renders.mjs

import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = new URL("../src/", import.meta.url).pathname;
const ISO = new Date().toISOString();

// Shaped like the KV payloads, so renderers get far enough in to touch their
// language branches rather than bailing at the first guard.
const period = {
  number: 1, name: "Today", startTime: ISO, endTime: ISO, isDaytime: true,
  temperature: 78, temperatureUnit: "F", temperatureTrend: null,
  shortForecast: "Sunny", detailedForecast: "Sunny skies.",
  windSpeed: "5 mph", windDirection: "SW", windGust: "10 mph",
  probabilityOfPrecipitation: { value: 10 }, relativeHumidity: { value: 60 },
  dewpoint: { value: 20 }, icon: "https://api.weather.gov/icons/land/day/few?size=small",
};
const DATA = {
  updated: ISO, place: "Crosby, TX",
  hourly: [period, { ...period, isDaytime: false }], periods: [period],
  alerts: [{ id: "urn:x", event: "Flash Flood Warning", severity: "Severe",
             headline: "H", description: "D", instruction: "I",
             effective: ISO, expires: ISO, onset: ISO, ends: ISO }],
  uv: { hourly: [] },
  aqi: { usAqi: 38, category: "Good", dominant: "pm25",
         subIndices: { pm25: 38, ozone: 11, pm10: 23 },
         sites: { pm25: "Baytown C148" }, dominantSite: "Baytown C148",
         agency: "TCEQ", measured: true, observed: ISO,
         nearby: { site: "Channelview C15", distanceMi: 8.5, aqi: 20,
                   agency: "TCEQ", observedIso: ISO } },
  gauges: [{ id: "x", name: "Cedar Bayou", category: "no_flooding",
             observed: { stage: 1, flow: 1 }, thresholds: {} }],
  items: [{ title: "T", link: "https://e.com/a", source: "S", published: ISO, category: "community" }],
  events: [{ summary: "E", start: Date.now(), allDay: true, location: "Crosby ISD" }],
  storms: [], stations: [], incidents: [], closures: [],
  countDate: ISO.slice(0, 10), url: "https://e.com",
  groups: { tree: { category: "Low", count: 1 } }, species: {},
};

async function jsFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await jsFiles(p)));
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out.sort();
}

// Renderers that take (lang) alone — the static pages plus the MCP explainer.
// Passing them (data, lang) makes `lang` an object, which is truthy-but-not-"es",
// so they render English twice and the Spanish branch never executes: a silent
// halving of coverage on exactly the pages this script exists to protect.
const ONE_ARG_LANG = /^(about|contact|privacy|emergency|sitemapPage|developers|mcpInfo)(Html|Markdown)$/;
// Pure discovery surfaces: no data, no language.
const NO_ARG = /^(llmsTxt|robotsTxt|sitemapXml|openApiSpec|apiCatalog|agentSkillsIndex|contentSecurityPolicy)$/;
// The hub takes its six datasets separately: (weather, water, news, cal, tropics,
// burnban, lang). DATA is a union of every KV shape, so it stands in for all six.
// Called as (DATA, lang) it put the string "en" in the `water` slot and left
// `news` undefined, so `news.items` threw a TypeError — which this script only
// records for ReferenceError. The homepage renderer therefore never executed at
// all, in either language, and /es dropped out of the Spanish-link check below.
const HOME = /^home(Html|Markdown)$/;

const failures = [];
const uncovered = []; // page renderers that never produced HTML, so never ran
const esHtml = [];   // every Spanish page's rendered HTML, for the link check below
let calls = 0;

for (const file of await jsFiles(SRC)) {
  const rel = relative(SRC, file);
  if (rel === "index.js") continue; // entry: exports the Worker handlers, not renderers
  let mod;
  try {
    mod = await import(pathToFileURL(file).href);
  } catch (err) {
    failures.push({ rel, name: "<module scope>", lang: "-", err });
    continue;
  }
  for (const [name, fn] of Object.entries(mod)) {
    if (typeof fn !== "function") continue;
    // mcp* is included deliberately. The MCP module is the site's widest
    // consumer — it calls into nearly every feature slice plus llmsTxt and
    // openApiSpec — and check-module-refs is structurally blind to a reference
    // whose target is not exported anywhere. During step 13, mcp/server.js
    // referenced llmsTxt while llmsTxt was still an unexported function in
    // index.js: invisible to the static check, and not covered here either
    // until mcp* was added to this filter.
    // The discovery surfaces (llmsTxt, robotsTxt, sitemapXml, openApiSpec,
    // apiCatalog, agentSkillsIndex), the RSS feeds, the shared chrome and
    // renderError are covered too. They were outside this filter until the
    // 2026-08-01 audit, and the consequence of a ReferenceError in any of them
    // is severe and silent in a way a page's is not: /llms.txt, /sitemap.xml or
    // /robots.txt would 500 with all three gates green, and a broken
    // renderError would turn every 502 into a 500 — the error page failing is
    // precisely when nobody is watching. No latent instance existed when this
    // widened (650 probe calls, both languages, clean); the point is the gate.
    if (!/Html$|Markdown$|^api[A-Z]|Svg$|^jsonld|^mcp[A-Z]|Txt$|Xml$|Spec$|Rss$|^render|^topbar$|^footer$|^agentSkillsIndex$|^contentSecurityPolicy$/.test(name)) continue;
    for (const lang of ["en", "es"]) {
      // Call shapes differ. Most renderers take (data, lang); the rest are
      // listed here rather than guessed, because calling one wrongly makes it
      // bail early and silently stop covering its own body.
      const args =
        name === "radarHtml" ? [lang, DATA] // (lang, data)
        : ONE_ARG_LANG.test(name) ? [lang] // static pages: (lang)
        : name === "footer" ? [{ page: "/", lang, source: "S", data: DATA }]
        : name === "topbar" ? ["/", lang]
        : name === "renderError" ? [new Error("probe"), "a data source"]
        : HOME.test(name) ? [DATA, DATA, DATA, DATA, DATA, DATA, lang]
        : NO_ARG.test(name) ? [] // discovery surfaces are pure
        : [DATA, lang];
      calls++;
      try {
        const r = fn(...args);
        // A page renderer that does not return a string never executed its body,
        // so every ReferenceError inside it is invisible to this gate. Only
        // ReferenceError is treated as a failure below, so a wrong call shape
        // fails *silently* — which is how homeHtml sat uncovered. Record the
        // miss instead of letting the pass stand on renderers that never ran.
        if (/Html$/.test(name) && typeof r !== "string") uncovered.push({ rel, name, lang, why: `returned ${typeof r}, not a string` });
        if (lang === "es" && /Html$/.test(name) && typeof r === "string") esHtml.push({ rel, name, html: r });
        // Async exports (the mcp* handlers) reject rather than throw, and an
        // unhandled rejection would crash this script *after* it printed OK —
        // which is worse than a miss, because it looks like a pass. Catch the
        // rejection and apply the same ReferenceError filter to it.
        if (r && typeof r.then === "function") {
          r.then(
            () => {},
            (err) => {
              if (err instanceof ReferenceError) failures.push({ rel, name, lang, err });
            },
          );
        }
      } catch (err) {
        if (/Html$/.test(name)) uncovered.push({ rel, name, lang, why: `threw ${err.constructor.name}: ${err.message}` });
        if (err instanceof ReferenceError) failures.push({ rel, name, lang, err });
      }
    }
  }
}

// Let the async handlers above settle before judging.
await new Promise((r) => setImmediate(r));

// --- phase 2: Spanish pages must link to Spanish pages ----------------------
//
// `/es` is one page set rendered with lang="es", so a link written as a bare
// English path silently strands the reader back in English. Every internal link
// to a BILINGUAL content path (i.e. one in PAGE_PATHS) must use its /es form
// when rendered in Spanish.
//
// This is a repeat offender rather than a hypothetical. /mcp began life as an
// endpoint and became a page; the /sitemap entry kept using the non-localizing
// `extLk` helper meant for English-only endpoints, so a Spanish reader browsing
// the site map was handed the English MCP page. Found by the owner, not by any
// check — hence this one.
//
// Links to English-only surfaces (the APIs, feeds, assets, .well-known) are
// correct as bare paths and are simply not in PAGE_PATHS, so they never match.
const { PAGE_PATHS } = await import(pathToFileURL(join(SRC, "index.js")).href);
const BILINGUAL = new Set([...PAGE_PATHS].filter((p) => !p.startsWith("/es")));

// Deliberate exceptions, each one a real decision rather than an oversight.
const ES_LINK_ALLOW = [
  // The Spanish MCP explainer exists to tell readers the PROTOCOL is English-only
  // and to connect to /mcp, never /es/mcp. Its English links are the whole point.
  { file: "mcp/server.js", path: "/mcp" },
  // /developers lists /mcp as the ENDPOINT, where the label is the URL itself and
  // a POST to /es/mcp 404s — localizing it would document a broken endpoint. That
  // alone is not sufficient justification, though: clicking an anchor is a GET,
  // and the Spanish note used to advertise "un GET muestra una página explicativa"
  // while handing over the English one. The exception is allowed because the
  // Spanish page now carries a SEPARATE, clearly-labelled /es/mcp link beside it,
  // so the explainer is reachable in Spanish. Remove that link and this exception
  // stops being honest.
  { file: "pages/developers.js", path: "/mcp" },
];
const allowed = (rel, p) => ES_LINK_ALLOW.some((a) => rel.endsWith(a.file) && a.path === p);

// Match whole anchors, not bare hrefs. The language toggle in topbar() is an
// English link on every Spanish page BY DESIGN — it is the switcher — and it is
// the one anchor that should point across languages. It is identifiable by its
// hreflang, so skip exactly that rather than special-casing 20 paths. (Scanning
// bare hrefs instead flagged all 18 Spanish pages on the first run: every hit
// was the toggle, and the one real bug was buried among them.)
const linkProblems = [];
for (const { rel, name, html } of esHtml) {
  const seen = new Set();
  for (const m of html.matchAll(/<a\s[^>]*href="(\/[^"#?]*)"[^>]*>/g)) {
    const [tag, href] = [m[0], m[1]];
    if (/hreflang="en-US"/.test(tag)) continue; // the language switcher
    const p = href.replace(/\/$/, "") || "/";
    if (seen.has(p) || !BILINGUAL.has(p) || allowed(rel, p)) continue;
    seen.add(p);
    linkProblems.push(`${rel} -> ${name}(lang="es") links "${p}" instead of its /es form`);
  }
}
if (linkProblems.length) {
  console.error(`\nSpanish pages linking to English pages (${linkProblems.length}):\n`);
  for (const p of linkProblems) console.error(`  ${p}`);
  console.error("\nUse the localizing link helper, or add a documented exception to ES_LINK_ALLOW.\n");
  process.exit(1);
}

// A page renderer that never returned HTML was never really checked, and the
// pass above says nothing about it. Fail rather than report a green gate over
// a page whose body did not run.
if (uncovered.length) {
  console.error(`\nPage renderers that never produced HTML (${uncovered.length}) — the gate did not cover them:\n`);
  for (const u of uncovered) console.error(`  ${u.rel} → ${u.name}(lang="${u.lang}") ${u.why}`);
  console.error("\nGive the renderer its own call shape above, next to radarHtml/HOME.\n");
  process.exit(1);
}

if (failures.length) {
  console.error(`\nUnresolved references in ${failures.length} render path(s):\n`);
  for (const f of failures) {
    console.error(`  ${f.rel} → ${f.name}(lang="${f.lang}")`);
    console.error(`    ${f.err.message}\n`);
  }
  console.error("A name is used but never imported. Add the import.\n");
  process.exit(1);
}

console.log(`Renderers OK — ${calls} calls across both languages, no ReferenceError; ${esHtml.length} Spanish pages link to Spanish pages.`);
