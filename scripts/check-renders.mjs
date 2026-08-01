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
    if (!/Html$|Markdown$|^api[A-Z]|Svg$|^jsonld/.test(name)) continue;
    for (const lang of ["en", "es"]) {
      // radarHtml takes (lang, data); everything else takes (data, lang).
      const args = name === "radarHtml" ? [lang, DATA] : [DATA, lang];
      calls++;
      try {
        fn(...args);
      } catch (err) {
        if (err instanceof ReferenceError) failures.push({ rel, name, lang, err });
      }
    }
  }
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

console.log(`Renderers OK — ${calls} calls across both languages, no ReferenceError.`);
