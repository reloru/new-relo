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

const failures = [];
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
        : NO_ARG.test(name) ? [] // discovery surfaces are pure
        : [DATA, lang];
      calls++;
      try {
        const r = fn(...args);
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
        if (err instanceof ReferenceError) failures.push({ rel, name, lang, err });
      }
    }
  }
}

// Let the async handlers above settle before judging.
await new Promise((r) => setImmediate(r));

if (failures.length) {
  console.error(`\nUnresolved references in ${failures.length} render path(s):\n`);
  for (const f of failures) {
    console.error(`  ${f.rel} → ${f.name}(lang="${f.lang}")`);
    console.error(`    ${f.err.message}\n`);
  }
  console.error("A name is used but never imported. Add the import.\n");
  process.exit(1);
}

console.log(`Renderers OK — ${calls} calls across both languages, no ReferenceError.`);
